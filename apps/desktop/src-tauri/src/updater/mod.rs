#[cfg(windows)]
mod handoff;
mod tauri_driver;

use futures_util::future::{AbortHandle, Abortable, BoxFuture};
use semver::Version;
use serde::Serialize;
use std::{
    any::Any,
    sync::{Arc, Mutex},
};
use tauri::{AppHandle, Emitter, Manager, State, WebviewWindow};

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Phase {
    Unconfigured,
    Idle,
    Checking,
    UpToDate,
    Available,
    Downloading,
    Verifying,
    Ready,
    Preparing,
    Error,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct SafeError {
    pub code: &'static str,
    pub message: &'static str,
}
impl SafeError {
    const INSTALLATION_DISABLED: Self = Self {
        code: "installation_disabled",
        message: "Update installation is not enabled in this build.",
    };
    const UNSAFE_TO_RESTART: Self = Self {
        code: "unsafe_to_restart",
        message: "Finish your edit or confirmation in Slate and Quick Search, then try again.",
    };
    const PREPARATION_FAILED: Self = Self {
        code: "preparation_failed",
        message: "Slate could not safely prepare to restart. Nothing was installed. Try again.",
    };
    const HANDOFF_FAILED: Self = Self {
        code: "handoff_failed",
        message: "The installer could not be started. Slate has not closed. Try again.",
    };
    const CHECK_FAILED: Self = Self {
        code: "check_failed",
        message: "Updates could not be checked. Try again.",
    };
    const DOWNLOAD_FAILED: Self = Self {
        code: "download_failed",
        message: "The update could not be downloaded. Try again.",
    };
    const OFFLINE: Self = Self {
        code: "offline",
        message: "Unable to connect. Check your connection and try again.",
    };
    const SIGNATURE_FAILURE: Self = Self {
        code: "signature_failure",
        message: "The update could not be verified. Try again.",
    };
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateSnapshot {
    pub revision: u64,
    pub phase: Phase,
    pub current_version: String,
    pub available_version: Option<String>,
    pub downloaded_bytes: u64,
    pub total_bytes: Option<u64>,
    pub dismissed: bool,
    pub error: Option<SafeError>,
    pub installation_enabled: bool,
}

#[derive(Clone)]
struct Offer {
    version: String,
    payload: Arc<dyn Any + Send + Sync>,
}
enum Progress {
    Chunk(usize, Option<u64>),
    Verifying,
}
type ProgressCallback = Arc<dyn Fn(Progress) + Send + Sync>;
trait Driver: Send + Sync {
    fn configured(&self) -> bool;
    fn check(&self) -> BoxFuture<'static, Result<Option<Offer>, SafeError>>;
    fn download(
        &self,
        offer: Offer,
        progress: ProgressCallback,
    ) -> BoxFuture<'static, Result<Vec<u8>, SafeError>>;
}
type Sink = Arc<dyn Fn(UpdateSnapshot) + Send + Sync>;
// This boundary never receives endpoints, filenames, or bytes from JavaScript.
trait StagedInstall: Send {
    fn launch(&mut self) -> Result<(), SafeError>;
}
trait InstallBoundary: Send + Sync {
    fn stage(&self, version: &str, bytes: Arc<[u8]>) -> Result<Box<dyn StagedInstall>, SafeError>;
    fn quit(&self, authorization: crate::installation_safety::UpdateExitAuthorization);
}
struct ControllerState {
    snapshot: UpdateSnapshot,
    offer: Option<Offer>,
    verified_bytes: Option<Arc<[u8]>>,
    generation: u64,
    operation: Option<AbortHandle>,
    // Retain both the global barrier and staged file pins until normal process exit.
    installation_guard: Option<crate::installation_safety::PreparationGuard>,
    staged_install: Option<Box<dyn StagedInstall>>,
}
pub struct UpdateController {
    state: Mutex<ControllerState>,
    driver: Arc<dyn Driver>,
    sink: Sink,
}
impl UpdateController {
    fn new(version: String, driver: Arc<dyn Driver>, sink: Sink) -> Arc<Self> {
        Arc::new(Self {
            state: Mutex::new(ControllerState {
                snapshot: UpdateSnapshot {
                    revision: 0,
                    phase: if driver.configured() {
                        Phase::Idle
                    } else {
                        Phase::Unconfigured
                    },
                    current_version: version,
                    available_version: None,
                    downloaded_bytes: 0,
                    total_bytes: None,
                    dismissed: false,
                    error: None,
                    installation_enabled: cfg!(windows) && driver.configured(),
                },
                offer: None,
                verified_bytes: None,
                generation: 0,
                operation: None,
                installation_guard: None,
                staged_install: None,
            }),
            driver,
            sink,
        })
    }
    pub fn snapshot(&self) -> UpdateSnapshot {
        self.state.lock().unwrap().snapshot.clone()
    }

    // Serialize state transitions and their events under the same lock. The sink only emits
    // immutable snapshots; it must not call back into the controller.
    fn publish(&self, state: &mut ControllerState) -> UpdateSnapshot {
        state.snapshot.revision += 1;
        let snapshot = state.snapshot.clone();
        (self.sink)(snapshot.clone());
        snapshot
    }
    pub fn check(self: &Arc<Self>) -> UpdateSnapshot {
        let mut state = self.state.lock().unwrap();
        if state.operation.is_some()
            || state.snapshot.phase == Phase::Preparing
            || !self.driver.configured()
        {
            return state.snapshot.clone();
        }
        // Manual checks restore the retained offer or verified download after Later. This
        // avoids discarding either resource just to show the same notification again.
        if state.offer.is_some() {
            let phase = if state.verified_bytes.is_some() {
                Phase::Ready
            } else {
                Phase::Available
            };
            if !state.snapshot.dismissed
                && state.snapshot.phase == phase
                && state.snapshot.error.is_none()
            {
                return state.snapshot.clone();
            }
            state.snapshot.phase = phase;
            state.snapshot.dismissed = false;
            state.snapshot.error = None;
            return self.publish(&mut state);
        }
        state.generation += 1;
        let generation = state.generation;
        let (abort, registration) = AbortHandle::new_pair();
        state.operation = Some(abort);
        state.snapshot.phase = Phase::Checking;
        state.snapshot.dismissed = false;
        state.snapshot.error = None;
        let snapshot = self.publish(&mut state);
        drop(state);
        let controller = self.clone();
        tauri::async_runtime::spawn(async move {
            let work = async { controller.driver.check().await };
            if let Ok(result) = Abortable::new(work, registration).await {
                controller.finish_check(generation, result);
            }
        });
        snapshot
    }
    fn finish_check(&self, generation: u64, result: Result<Option<Offer>, SafeError>) {
        let mut state = self.state.lock().unwrap();
        if state.generation != generation || state.operation.is_none() {
            return;
        }
        state.operation = None;
        match result {
            Ok(Some(offer)) => {
                match (
                    Version::parse(&state.snapshot.current_version),
                    Version::parse(&offer.version),
                ) {
                    (Ok(current), Ok(remote)) if current.cmp_precedence(&remote).is_lt() => {
                        state.snapshot.available_version = Some(remote.to_string());
                        state.snapshot.phase = Phase::Available;
                        state.offer = Some(offer);
                    }
                    (Ok(_), Ok(_)) => {
                        state.snapshot.phase = Phase::UpToDate;
                    }
                    _ => {
                        state.snapshot.phase = Phase::Error;
                        state.snapshot.error = Some(SafeError::CHECK_FAILED);
                    }
                }
            }
            Ok(None) => {
                state.snapshot.phase = Phase::UpToDate;
            }
            Err(error) => {
                state.snapshot.phase = Phase::Error;
                state.snapshot.error = Some(error);
            }
        }
        self.publish(&mut state);
    }
    pub fn download(self: &Arc<Self>) -> UpdateSnapshot {
        let mut state = self.state.lock().unwrap();
        if state.operation.is_some()
            || state.snapshot.phase == Phase::Preparing
            || state.verified_bytes.is_some()
        {
            return state.snapshot.clone();
        }
        let Some(offer) = state.offer.clone() else {
            return state.snapshot.clone();
        };
        state.generation += 1;
        let generation = state.generation;
        let (abort, registration) = AbortHandle::new_pair();
        state.operation = Some(abort);
        state.snapshot.phase = Phase::Downloading;
        state.snapshot.downloaded_bytes = 0;
        state.snapshot.total_bytes = None;
        state.snapshot.dismissed = false;
        state.snapshot.error = None;
        let snapshot = self.publish(&mut state);
        drop(state);
        let receiver = Arc::downgrade(self);
        let progress: ProgressCallback = Arc::new(move |progress| {
            if let Some(controller) = receiver.upgrade() {
                controller.progress(generation, progress);
            }
        });
        let controller = self.clone();
        tauri::async_runtime::spawn(async move {
            let work = async { controller.driver.download(offer, progress).await };
            if let Ok(result) = Abortable::new(work, registration).await {
                controller.finish_download(generation, result);
            }
        });
        snapshot
    }
    fn progress(&self, generation: u64, progress: Progress) {
        let mut state = self.state.lock().unwrap();
        if state.generation != generation || state.operation.is_none() {
            return;
        }
        let before = state.snapshot.clone();
        match progress {
            Progress::Chunk(bytes, total) if state.snapshot.phase == Phase::Downloading => {
                state.snapshot.downloaded_bytes =
                    state.snapshot.downloaded_bytes.saturating_add(bytes as u64);
                state.snapshot.total_bytes = total;
            }
            Progress::Verifying if state.snapshot.phase == Phase::Downloading => {
                state.snapshot.phase = Phase::Verifying;
            }
            _ => return,
        }
        if state.snapshot != before {
            self.publish(&mut state);
        }
    }
    fn finish_download(&self, generation: u64, result: Result<Vec<u8>, SafeError>) {
        let mut state = self.state.lock().unwrap();
        if state.generation != generation || state.operation.is_none() {
            return;
        }
        state.operation = None;
        match result {
            Ok(bytes) => {
                state.snapshot.downloaded_bytes = bytes.len() as u64;
                state.snapshot.phase = Phase::Ready;
                state.verified_bytes = Some(bytes.into());
            }
            Err(error) => {
                state.snapshot.phase = Phase::Error;
                state.snapshot.error = Some(error);
            }
        }
        self.publish(&mut state);
    }
    pub fn cancel(&self) -> UpdateSnapshot {
        let mut state = self.state.lock().unwrap();
        let Some(abort) = state.operation.take() else {
            return state.snapshot.clone();
        };
        state.generation += 1;
        abort.abort();
        state.snapshot.phase = if state.offer.is_some() {
            Phase::Available
        } else {
            Phase::Idle
        };
        state.snapshot.downloaded_bytes = 0;
        state.snapshot.total_bytes = None;
        state.snapshot.error = None;
        state.snapshot.dismissed = false;
        self.publish(&mut state)
    }
    pub fn dismiss(&self) -> UpdateSnapshot {
        let mut state = self.state.lock().unwrap();
        if state.operation.is_some()
            || state.snapshot.dismissed
            || !matches!(
                state.snapshot.phase,
                Phase::Available | Phase::Ready | Phase::Error
            )
        {
            return state.snapshot.clone();
        }
        state.snapshot.dismissed = true;
        self.publish(&mut state)
    }

    fn restart(
        self: &Arc<Self>,
        safety: Arc<crate::installation_safety::SafetyCoordinator>,
        boundary: Arc<dyn InstallBoundary>,
    ) -> Result<UpdateSnapshot, SafeError> {
        use crate::installation_safety::SafetyError;
        let mut state = self.state.lock().unwrap();
        // Enablement never authorizes a handoff by itself: the explicit main-window
        // action still needs authenticated bytes and every preparation/safety gate.
        if !state.snapshot.installation_enabled {
            return Err(SafeError::INSTALLATION_DISABLED);
        }
        if state.operation.is_some() || state.snapshot.phase != Phase::Ready {
            return Err(SafeError::PREPARATION_FAILED);
        }
        let (Some(offer), Some(bytes)) = (&state.offer, &state.verified_bytes) else {
            return Err(SafeError::PREPARATION_FAILED);
        };
        if state.snapshot.available_version.as_deref() != Some(&offer.version) {
            return Err(SafeError::PREPARATION_FAILED);
        }
        let version = offer.version.clone();
        let bytes = bytes.clone();
        let attempt = match safety.begin_user_preparation() {
            Ok(attempt) => attempt,
            Err(error) => {
                state.snapshot.error = Some(if error == SafetyError::Busy {
                    SafeError::UNSAFE_TO_RESTART
                } else {
                    SafeError::PREPARATION_FAILED
                });
                return Ok(self.publish(&mut state));
            }
        };
        state.generation += 1;
        let generation = state.generation;
        state.snapshot.phase = Phase::Preparing;
        state.snapshot.dismissed = false;
        state.snapshot.error = None;
        let snapshot = self.publish(&mut state);
        drop(state);
        let controller = self.clone();
        tauri::async_runtime::spawn_blocking(move || {
            let mut attempt = attempt;
            let mut staged = match boundary.stage(&version, bytes) {
                Ok(staged) => staged,
                Err(error) => {
                    drop(attempt); // Restore admission before reporting retry readiness.
                    controller.failed_restart(generation, error);
                    return;
                }
            };
            let mut guard = loop {
                match attempt.try_freeze() {
                    Ok(guard) => break guard,
                    Err((SafetyError::NotReady, pending)) => {
                        attempt = pending;
                        std::thread::park_timeout(std::time::Duration::from_millis(10));
                    }
                    Err((_, pending)) => {
                        drop(pending);
                        controller.failed_restart(generation, SafeError::PREPARATION_FAILED);
                        return;
                    }
                }
            };
            // The coordinator rechecks generations/readiness under policy at the
            // exact process-creation boundary. It never waits for the installer.
            match guard.handoff(|| staged.launch()) {
                Ok(Ok(authorization)) => {
                    let mut state = controller.state.lock().unwrap();
                    state.installation_guard = Some(guard);
                    state.staged_install = Some(staged);
                    drop(state);
                    // Normal Tauri exit, only after successful process creation.
                    // NSIS independently obtains A/B and waits for Slate to exit.
                    boundary.quit(authorization);
                }
                _ => {
                    drop(guard);
                    controller.failed_restart(generation, SafeError::HANDOFF_FAILED);
                }
            }
        });
        Ok(snapshot)
    }
    fn failed_restart(&self, generation: u64, error: SafeError) {
        let mut state = self.state.lock().unwrap();
        if state.generation != generation || state.snapshot.phase != Phase::Preparing {
            return;
        }
        state.snapshot.phase = Phase::Ready;
        state.snapshot.error = Some(error);
        self.publish(&mut state);
    }
}

pub fn initialize(app: &AppHandle) {
    let event_app = app.clone();
    let controller = UpdateController::new(
        app.package_info().version.to_string(),
        Arc::new(tauri_driver::TauriDriver::new(app.clone())),
        Arc::new(move |snapshot| {
            let _ = event_app.emit_to("main", "slate:update-state", snapshot);
        }),
    );
    app.manage(controller.clone());
    // Starts an abortable background future; setup never awaits network work or shows a window.
    controller.check();
}
fn require_main(label: &str) -> Result<(), &'static str> {
    if label == "main" {
        Ok(())
    } else {
        Err("Updates are only available in the main window.")
    }
}
#[tauri::command]
pub fn get_update_status(
    window: WebviewWindow,
    controller: State<'_, Arc<UpdateController>>,
) -> Result<UpdateSnapshot, &'static str> {
    require_main(window.label())?;
    Ok(controller.snapshot())
}
#[tauri::command]
pub fn check_for_updates(
    window: WebviewWindow,
    controller: State<'_, Arc<UpdateController>>,
) -> Result<UpdateSnapshot, &'static str> {
    require_main(window.label())?;
    Ok(controller.check())
}
#[tauri::command]
pub fn download_update(
    window: WebviewWindow,
    controller: State<'_, Arc<UpdateController>>,
) -> Result<UpdateSnapshot, &'static str> {
    require_main(window.label())?;
    Ok(controller.download())
}
#[tauri::command]
pub fn cancel_update(
    window: WebviewWindow,
    controller: State<'_, Arc<UpdateController>>,
) -> Result<UpdateSnapshot, &'static str> {
    require_main(window.label())?;
    Ok(controller.cancel())
}
#[tauri::command]
pub fn dismiss_update(
    window: WebviewWindow,
    controller: State<'_, Arc<UpdateController>>,
) -> Result<UpdateSnapshot, &'static str> {
    require_main(window.label())?;
    Ok(controller.dismiss())
}

#[tauri::command]
pub fn restart_to_update(
    window: WebviewWindow,
    controller: State<'_, Arc<UpdateController>>,
    safety: State<'_, Arc<crate::installation_safety::SafetyCoordinator>>,
) -> Result<UpdateSnapshot, &'static str> {
    require_main(window.label())?;
    #[cfg(windows)]
    return controller
        .restart(
            safety.inner().clone(),
            Arc::new(handoff::WindowsInstall::new(window.app_handle().clone())),
        )
        .map_err(|error| error.message);
    #[cfg(not(windows))]
    {
        let _ = (controller, safety);
        Err(SafeError::INSTALLATION_DISABLED.message)
    }
}

#[cfg(test)]
mod tests;
