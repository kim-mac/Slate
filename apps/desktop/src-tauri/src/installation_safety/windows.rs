//! Invalidate the current participant on any WebView2 process failure. A monitor
//! registration failure leaves the participant unable to satisfy readiness.
use super::SafetyCoordinator;
use std::sync::Arc;
use tauri::WebviewWindow;
use webview2_com::ProcessFailedEventHandler;

pub(crate) fn observe(window: &WebviewWindow, safety: &Arc<SafetyCoordinator>) {
    let label = window.label().to_owned();
    if safety.require_lifecycle_monitor(&label).is_err() {
        return;
    }
    let safety = Arc::clone(safety);
    let _ = window.with_webview(move |webview| {
        let failed_safety = Arc::clone(&safety);
        let failed_label = label.clone();
        let handler = ProcessFailedEventHandler::create(Box::new(move |_, _| {
            let _ = failed_safety.disconnected(&failed_label);
            Ok(())
        }));
        // WebView2 owns a COM reference to this handler for the webview lifetime.
        // Neither a registration nor dispatch error can mark the participant safe.
        let registered = unsafe {
            webview.controller().CoreWebView2().and_then(|core| {
                let mut token = 0;
                core.add_ProcessFailed(&handler, &mut token)
            })
        };
        if registered.is_ok() {
            let _ = safety.lifecycle_monitor_ready(&label);
        }
    });
}
