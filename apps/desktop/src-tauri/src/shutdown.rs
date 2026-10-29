//! Releasing the screen, camera and microphone before Lare's process goes away.
//!
//! macOS does not hand a ScreenCaptureKit stream to the app that asked for it: `replayd` owns
//! the session and the app only holds a handle to it. A process that exits without calling
//! `stopCapture` therefore leaves the session behind, and Control Center goes on listing Lare in
//! its screen-sharing menu — with an empty "Currently Sharing" list, because the client it would
//! have to ask is gone, and with a "Stop Sharing" button that messages that same dead process
//! and so does nothing. The purple indicator stays up until `replayd` is restarted or the Mac is.
//!
//! Nothing in the recording stack notices the process ending, so the release has to be driven
//! from every way out:
//!
//! * **Quit Lare / Cmd+Q / logout** — `applicationShouldTerminate:`. `NSApp terminate:` does not
//!   go through tao's exit path at all (tao only implements `applicationWillTerminate:`, which
//!   runs when it is already too late to await anything), so this installs the delegate method
//!   tao leaves free and answers `NSTerminateLater`.
//! * **Closing the main window, and [`tauri::AppHandle::exit`]** — `RunEvent::ExitRequested`.
//! * **SIGINT** (Ctrl-C under `pnpm dev:desktop`), **SIGTERM** (`killall Lare`, logout) and
//!   **SIGHUP** (the terminal going away).
//!
//! `kill -9` and a hard crash cannot be caught by anyone; that case is what the
//! `clear_screen_sharing` command is for.

use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use tauri::{AppHandle, Manager};
use tokio::sync::Mutex;
use tracing::warn;

use crate::recorder::Recorder;

/// A recording that will not stop must not turn a quit into a hang. Generous, because the last
/// thing [`Recorder::shutdown`] does is mux the take the user just made, and losing that to an
/// impatient timeout would be the worse bug.
const TEARDOWN_TIMEOUT: Duration = Duration::from_secs(15);

static DONE: AtomicBool = AtomicBool::new(false);
/// Set by the first `ExitRequested` that has to hold the exit open.
static STARTED: AtomicBool = AtomicBool::new(false);
/// Serialises the exit paths against each other: a Cmd+Q while the window-close teardown is
/// still running waits for it rather than starting a second one.
static RUNNING: Mutex<()> = Mutex::const_new(());

/// Whether the capture devices have already been released.
pub fn is_done() -> bool {
    DONE.load(Ordering::SeqCst)
}

/// Stop everything the OS can see Lare holding. Idempotent, bounded, and safe to call from
/// several exit paths at once.
pub async fn teardown(app: &AppHandle) {
    let _guard = RUNNING.lock().await;
    if is_done() {
        return;
    }
    crate::windows::mark_quitting();
    if let Some(recorder) = app.try_state::<Arc<Recorder>>() {
        let recorder = recorder.inner().clone();
        if tokio::time::timeout(TEARDOWN_TIMEOUT, recorder.shutdown())
            .await
            .is_err()
        {
            warn!(
                secs = TEARDOWN_TIMEOUT.as_secs(),
                "releasing the capture devices timed out; exiting anyway"
            );
        }
    }
    DONE.store(true, Ordering::SeqCst);
}

/// Hold a requested exit open until the capture is down, then let it through.
///
/// The second `ExitRequested` — the one [`teardown`] itself asks for — sees [`is_done`] and
/// falls straight through to `RunEvent::Exit`.
pub fn on_exit_requested(app: &AppHandle, api: &tauri::ExitRequestApi, code: Option<i32>) {
    if is_done() {
        return;
    }
    api.prevent_exit();
    if STARTED.swap(true, Ordering::SeqCst) {
        // Already saving; the exit it asks for when it finishes is the one that gets through.
        return;
    }
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        teardown(&app).await;
        // The original code carries through, so an updater restart still restarts.
        app.exit(code.unwrap_or(0));
    });
}

/// Release the capture devices on SIGINT/SIGTERM/SIGHUP instead of dying with the stream open.
#[cfg(unix)]
pub fn install_signal_handlers(app: &AppHandle) {
    use tokio::signal::unix::{SignalKind, signal};
    // Module-scoped so the import does not go unused on Windows, which has no signal handling.
    use tracing::info;

    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let mut sigint = match signal(SignalKind::interrupt()) {
            Ok(s) => s,
            Err(e) => return warn!(%e, "could not listen for SIGINT"),
        };
        let mut sigterm = match signal(SignalKind::terminate()) {
            Ok(s) => s,
            Err(e) => return warn!(%e, "could not listen for SIGTERM"),
        };
        let mut sighup = match signal(SignalKind::hangup()) {
            Ok(s) => s,
            Err(e) => return warn!(%e, "could not listen for SIGHUP"),
        };
        let name = tokio::select! {
            _ = sigint.recv() => "SIGINT",
            _ = sigterm.recv() => "SIGTERM",
            _ = sighup.recv() => "SIGHUP",
        };
        info!(
            signal = name,
            "releasing the capture devices before exiting"
        );
        teardown(&app).await;
        // The event loop is on the main thread and is not going to run again, so leave directly
        // rather than through `AppHandle::exit`.
        std::process::exit(0);
    });
}

#[cfg(not(unix))]
pub fn install_signal_handlers(_app: &AppHandle) {}

/// Install the `applicationShouldTerminate:` hook. Call once the delegate exists (`RunEvent::Ready`).
#[cfg(target_os = "macos")]
pub fn install_terminate_handler(app: &AppHandle) {
    macos::install(app);
}

#[cfg(not(target_os = "macos"))]
pub fn install_terminate_handler(_app: &AppHandle) {}

#[cfg(target_os = "macos")]
#[allow(unexpected_cfgs)] // objc 0.2's `msg_send!` expands `cfg(feature = "cargo-clippy")`
mod macos {
    use std::ffi::{c_char, c_void};
    use std::sync::OnceLock;

    use objc::runtime::{BOOL, Class, NO, Object, Sel, YES};
    use objc::{class, msg_send, sel, sel_impl};
    use tauri::AppHandle;
    use tracing::{info, warn};

    // NSApplicationTerminateReply
    const TERMINATE_NOW: u64 = 1;
    const TERMINATE_LATER: u64 = 2;

    /// `NSUInteger applicationShouldTerminate:(id sender)` — return, self, _cmd, sender.
    const SHOULD_TERMINATE_TYPES: &[u8] = b"Q@:@\0";

    unsafe extern "C" {
        fn class_addMethod(
            cls: *const Class,
            name: Sel,
            imp: *const c_void,
            types: *const c_char,
        ) -> BOOL;
        fn object_getClass(obj: *mut Object) -> *const Class;
        fn dispatch_async_f(
            queue: *mut c_void,
            context: *mut c_void,
            work: extern "C" fn(*mut c_void),
        );
        /// `dispatch_get_main_queue()` is a macro over the address of this symbol.
        static _dispatch_main_q: c_void;
    }

    static APP: OnceLock<AppHandle> = OnceLock::new();

    pub fn install(app: &AppHandle) {
        if APP.set(app.clone()).is_err() {
            return;
        }
        // SAFETY: called on the main thread, on the delegate tao installed on NSApp.
        unsafe {
            let ns_app: *mut Object = msg_send![class!(NSApplication), sharedApplication];
            let delegate: *mut Object = msg_send![ns_app, delegate];
            if delegate.is_null() {
                warn!("NSApp has no delegate; quitting will not release the capture devices");
                return;
            }
            // tao does not implement this selector. If a future version starts to, its own
            // handling wins and `RunEvent::ExitRequested` still covers the other exits.
            let responds: BOOL =
                msg_send![delegate, respondsToSelector: sel!(applicationShouldTerminate:)];
            if responds != NO {
                info!("NSApp delegate already answers applicationShouldTerminate:");
                return;
            }
            let added = class_addMethod(
                object_getClass(delegate),
                sel!(applicationShouldTerminate:),
                should_terminate as extern "C" fn(&Object, Sel, *mut Object) -> u64
                    as *const c_void,
                SHOULD_TERMINATE_TYPES.as_ptr() as *const c_char,
            );
            if added == NO {
                warn!("could not install applicationShouldTerminate:");
            }
        }
    }

    /// `NSTerminateLater` keeps the run loop spinning while the recording is saved, so this does
    /// not beach-ball the quit, and answers with `replyToApplicationShouldTerminate:` when done.
    extern "C" fn should_terminate(_this: &Object, _cmd: Sel, _sender: *mut Object) -> u64 {
        if super::is_done() {
            return TERMINATE_NOW;
        }
        let Some(app) = APP.get().cloned() else {
            return TERMINATE_NOW;
        };
        tauri::async_runtime::spawn(async move {
            super::teardown(&app).await;
            // `replyToApplicationShouldTerminate:` is main-thread only. The main queue keeps
            // draining while AppKit waits for the reply; tao's event loop does not.
            // SAFETY: `_dispatch_main_q` is libdispatch's own main queue object.
            unsafe {
                dispatch_async_f(
                    &raw const _dispatch_main_q as *mut c_void,
                    std::ptr::null_mut(),
                    reply_terminate_now,
                )
            };
        });
        TERMINATE_LATER
    }

    extern "C" fn reply_terminate_now(_context: *mut c_void) {
        // SAFETY: dispatched onto the main queue, which is the main thread.
        unsafe {
            let ns_app: *mut Object = msg_send![class!(NSApplication), sharedApplication];
            let _: () = msg_send![ns_app, replyToApplicationShouldTerminate: YES];
        }
    }
}
