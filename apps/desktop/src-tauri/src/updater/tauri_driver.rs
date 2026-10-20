use super::{Driver, Offer, Progress, ProgressCallback, SafeError};
use futures_util::{future::BoxFuture, FutureExt};
use serde_json::Value;
use std::{sync::Arc, time::Duration};
use tauri::{plugin::Plugin, AppHandle};
use tauri_plugin_updater::{Config, Error, Update, UpdaterExt};
use url::Url;

const REQUEST_TIMEOUT: Duration = Duration::from_secs(30);

pub(super) struct TauriDriver {
    app: AppHandle,
    config: Option<Config>,
}
impl TauriDriver {
    pub(super) fn new(app: AppHandle) -> Self {
        let config = trusted_config(app.config().plugins.0.get("updater"))
            .filter(|config| initialize_sdk(&app, config));
        Self { app, config }
    }
}

fn initialize_sdk(app: &AppHandle, config: &Config) -> bool {
    // UpdaterBuilder's constructor is private in the pinned SDK. Its public plugin
    // setup initializes the Rust state needed by UpdaterExt. Initialize a temporary
    // plugin with sanitized trusted config, then drop it WITHOUT adding it to the
    // application plugin store: none of its JavaScript command handlers are exposed.
    let mut sdk = tauri_plugin_updater::Builder::new().build();
    sdk.initialize(
        app,
        serde_json::json!({
            "pubkey": config.pubkey,
            "endpoints": config.endpoints,
            "requireSignedVersion": true,
            "allowDowngrades": false,
            "dangerousInsecureTransportProtocol": false,
            "dangerousAcceptInvalidCerts": false,
            "dangerousAcceptInvalidHostnames": false,
        }),
    )
    .is_ok()
}

pub(super) fn secure_url(url: &Url) -> bool {
    url.scheme() == "https"
        && url.host_str().is_some()
        && url.username().is_empty()
        && url.password().is_none()
}

// Only the application's bundled, trusted configuration is consulted. No IPC command
// accepts endpoints, public keys, headers, or updater configuration from a webview.
pub(super) fn trusted_config(value: Option<&Value>) -> Option<Config> {
    let value = value?.as_object()?;
    let pubkey = value.get("pubkey")?.as_str()?;
    if pubkey.trim().is_empty() {
        return None;
    }
    for flag in [
        "dangerousInsecureTransportProtocol",
        "dangerous-insecure-transport-protocol",
        "dangerousAcceptInvalidCerts",
        "dangerous-accept-invalid-certs",
        "dangerousAcceptInvalidHostnames",
        "dangerous-accept-invalid-hostnames",
        "allowDowngrades",
        "allow-downgrades",
    ] {
        if value
            .get(flag)
            .is_some_and(|value| value != &Value::Bool(false))
        {
            return None;
        }
    }
    let endpoints: Option<Vec<Url>> = value
        .get("endpoints")?
        .as_array()?
        .iter()
        .map(|value| {
            let url = Url::parse(value.as_str()?).ok()?;
            secure_url(&url).then_some(url)
        })
        .collect();
    let endpoints = endpoints?;
    if endpoints.is_empty() {
        return None;
    }
    Some(Config {
        endpoints,
        pubkey: pubkey.to_owned(),
        require_signed_version: true,
        allow_downgrades: false,
        ..Config::default()
    })
}

pub(super) fn safe_error(error: Error, downloading: bool) -> SafeError {
    match error {
        Error::Minisign(_)
        | Error::Base64(_)
        | Error::SignatureUtf8(_)
        | Error::SignedVersionMismatch { .. }
        | Error::MissingSignedVersion => SafeError::SIGNATURE_FAILURE,
        Error::Reqwest(error) if error.is_connect() || error.is_timeout() => SafeError::OFFLINE,
        _ if downloading => SafeError::DOWNLOAD_FAILED,
        _ => SafeError::CHECK_FAILED,
    }
}

impl Driver for TauriDriver {
    fn configured(&self) -> bool {
        self.config.is_some()
    }
    fn check(&self) -> BoxFuture<'static, Result<Option<Offer>, SafeError>> {
        let app = self.app.clone();
        let config = self.config.clone();
        async move {
            config.ok_or(SafeError::CHECK_FAILED)?;
            let updater = app
                .updater_builder()
                .timeout(REQUEST_TIMEOUT)
                .version_comparator(|current, release| {
                    current.cmp_precedence(&release.version).is_lt()
                })
                // Enforces HTTPS on redirect destinations as well as the original URL.
                .configure_client(|client| client.https_only(true))
                .build()
                .map_err(|error| safe_error(error, false))?;
            let update = updater
                .check()
                .await
                .map_err(|error| safe_error(error, false))?;
            update
                .map(|mut update| {
                    if !secure_url(&update.download_url) {
                        return Err(SafeError::CHECK_FAILED);
                    }
                    // The pinned SDK does not carry the builder timeout into Update.
                    update.timeout = Some(REQUEST_TIMEOUT);
                    Ok(Offer {
                        version: update.version.clone(),
                        payload: Arc::new(update),
                    })
                })
                .transpose()
        }
        .boxed()
    }
    fn download(
        &self,
        offer: Offer,
        progress: ProgressCallback,
    ) -> BoxFuture<'static, Result<Vec<u8>, SafeError>> {
        async move {
            let update = offer
                .payload
                .downcast_ref::<Update>()
                .ok_or(SafeError::DOWNLOAD_FAILED)?;
            if !secure_url(&update.download_url) || update.version != offer.version {
                return Err(SafeError::DOWNLOAD_FAILED);
            }
            let finished = progress.clone();
            // SDK success means both the artifact signature and its signed version passed.
            // These bytes remain in controller memory; this adapter has no execution API.
            update
                .download(
                    move |bytes, total| progress(Progress::Chunk(bytes, total)),
                    move || finished(Progress::Verifying),
                )
                .await
                .map_err(|error| safe_error(error, true))
        }
        .boxed()
    }
}
