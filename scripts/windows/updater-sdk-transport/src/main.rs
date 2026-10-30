//! Headless TEST transport only: no desktop import, profile, payload writes or execution.
use futures_util::future::{AbortHandle, Abortable};
use reqwest::{redirect::Policy, Certificate};
use semver::Version;
use serde::Deserialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    io::{self, Read},
    sync::{Arc, Mutex},
    time::Duration,
};
use tauri::{
    plugin::Plugin,
    test::{mock_builder, mock_context, noop_assets, MockRuntime},
};
use tauri_plugin_updater::{Error, Update, UpdaterExt};
use url::Url;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Input {
    endpoint: String,
    origin: String,
    public_key: String,
    ca_pem: String,
    current_version: String,
    target: Option<String>,
    cancel_after_chunk: bool,
    retry_after_cancel: bool,
}

fn test_url(url: &Url, origin: &Url) -> bool {
    url.scheme() == "https"
        && url.host_str() == Some("127.0.0.1")
        && url.port().is_some_and(|port| port > 0)
        && url.origin() == origin.origin()
        && url.username().is_empty()
        && url.password().is_none()
        && url.query().is_none()
        && url.fragment().is_none()
        && url.path().starts_with("/slate-sdk-test/")
}

fn classify(error: &Error) -> &'static str {
    match error {
        Error::SignedVersionMismatch { .. } => "signed_version_mismatch",
        Error::MissingSignedVersion => "missing_signed_version",
        Error::Minisign(_) | Error::Base64(_) | Error::SignatureUtf8(_) => "signature_failure",
        Error::Reqwest(error) if error.is_redirect() => "redirect_rejected",
        Error::Reqwest(error) if error.is_timeout() => "timeout",
        Error::Reqwest(error) if error.is_decode() => "manifest_invalid",
        Error::Reqwest(_) => "transport_failure",
        Error::ReleaseNotFound => "release_not_found",
        Error::Serialization(_) | Error::Semver(_) => "manifest_invalid",
        Error::Network(_) => "download_http_failure",
        _ => "sdk_failure",
    }
}

async fn exercise(input: Input) -> Result<Value, &'static str> {
    let endpoint = Url::parse(&input.endpoint).map_err(|_| "invalid_input")?;
    let origin = Url::parse(&input.origin).map_err(|_| "invalid_input")?;
    if !test_url(&endpoint, &origin)
        || !matches!(input.current_version.as_str(), "0.1.0" | "0.2.0" | "0.2.1")
        || !matches!(
            input.target.as_deref(),
            None | Some("windows-x86_64" | "windows-aarch64")
        )
        || input.public_key.len() > 16_384
        || input.ca_pem.len() > 16_384
    {
        return Err("invalid_input");
    }
    let certificate =
        Certificate::from_pem(input.ca_pem.as_bytes()).map_err(|_| "invalid_test_ca")?;
    let mut context = mock_context::<MockRuntime, _>(noop_assets());
    context.config_mut().identifier = "tech.tryslate.sdk-transport-test".into();
    context.package_info_mut().name = "Slate SDK Transport TEST".into();
    context.package_info_mut().version =
        Version::parse(&input.current_version).map_err(|_| "invalid_input")?;
    let app = mock_builder()
        .build(context)
        .map_err(|_| "mock_runtime_failed")?;
    // Initialize the SDK's state, without registering its webview command handlers.
    let mut sdk = tauri_plugin_updater::Builder::new().build::<MockRuntime>();
    sdk.initialize(
        app.handle(),
        json!({
            "pubkey": input.public_key,
            "endpoints": [input.endpoint],
            "requireSignedVersion": true,
            "allowDowngrades": false,
            "dangerousInsecureTransportProtocol": false,
            "dangerousAcceptInvalidCerts": false,
            "dangerousAcceptInvalidHostnames": false
        }),
    )
    .map_err(|_| "sdk_initialization_failed")?;
    let redirect_origin = origin.clone();
    let mut builder = app
        .updater_builder()
        .timeout(Duration::from_secs(5))
        .no_proxy()
        .version_comparator(|current, release| current.cmp_precedence(&release.version).is_lt())
        .configure_client(move |client| {
            let origin = redirect_origin.clone();
            client
                .tls_backend_native()
                .tls_certs_only([certificate.clone()])
                .https_only(true)
                .redirect(Policy::custom(move |attempt| {
                    if attempt.previous().len() <= 3 && test_url(attempt.url(), &origin) {
                        attempt.follow()
                    } else {
                        attempt.error("TEST redirect policy")
                    }
                }))
        });
    if let Some(target) = input.target {
        builder = builder.target(target);
    }
    let updater = builder.build().map_err(|_| "sdk_builder_failed")?;
    let mut update = match updater.check().await {
        Ok(Some(update)) => update,
        Ok(None) => {
            return Ok(
                json!({"sdk":true,"outcome":"no_update","checkAttempted":true,"downloadAttempted":false}),
            )
        }
        Err(error) => {
            return Ok(
                json!({"sdk":true,"outcome":"error","category":classify(&error),"checkAttempted":true,"downloadAttempted":false}),
            )
        }
    };
    if !test_url(&update.download_url, &origin) {
        return Err("unsafe_download_url");
    }
    // SDK check() does not propagate its timeout into the returned Update.
    update.timeout = Some(Duration::from_secs(5));
    let mut report = download_once(&update, input.cancel_after_chunk).await;
    if input.retry_after_cancel && report["outcome"] == "cancelled" {
        report["retry"] = download_once(&update, false).await;
    }
    Ok(report)
}

async fn download_once(update: &Update, cancel: bool) -> Value {
    let progress = Arc::new(Mutex::new((0u64, 0u64, false)));
    let on_chunk = progress.clone();
    let on_finish = progress.clone();
    let (abort, registration) = AbortHandle::new_pair();
    let result = Abortable::new(
        update.download(
            move |bytes, _total| {
                let mut progress = on_chunk.lock().unwrap();
                progress.0 += bytes as u64;
                progress.1 += 1;
                if cancel {
                    abort.abort();
                }
            },
            move || {
                on_finish.lock().unwrap().2 = true;
            },
        ),
        registration,
    )
    .await;
    let (received, chunks, finished) = *progress.lock().unwrap();
    let mut report = json!({
        "sdk":true,"checkAttempted":true,"downloadAttempted":true,
        "version":update.version,"received":received,"chunks":chunks,
        "downloadFinished":finished,"verified":false
    });
    match result {
        Err(_) => {
            report["outcome"] = json!("cancelled");
        }
        Ok(Err(error)) => {
            report["outcome"] = json!("error");
            report["category"] = json!(classify(&error));
        }
        Ok(Ok(bytes)) => {
            report["outcome"] = json!("verified");
            report["verified"] = json!(true);
            report["bytes"] = json!(bytes.len());
            report["sha256"] = json!(format!("{:X}", Sha256::digest(&bytes)));
        }
    }
    report
}

fn main() {
    if !cfg!(debug_assertions) || !cfg!(windows) || std::env::args_os().len() != 1 {
        eprintln!("TEST harness rejected: debug Windows, no arguments required");
        std::process::exit(1);
    }
    let mut bytes = Vec::new();
    let input = io::stdin()
        .take(65_537)
        .read_to_end(&mut bytes)
        .map_err(|_| "invalid_input")
        .and_then(|_| {
            if bytes.len() > 65_536 {
                Err("invalid_input")
            } else {
                serde_json::from_slice::<Input>(&bytes).map_err(|_| "invalid_input")
            }
        });
    let result = input.and_then(|input| tauri::async_runtime::block_on(exercise(input)));
    match result {
        Ok(report) => println!("{report}"),
        Err(code) => {
            // Static codes only. Never print input, raw SDK errors or environment.
            eprintln!("TEST harness rejected: {code}");
            std::process::exit(1);
        }
    }
}
