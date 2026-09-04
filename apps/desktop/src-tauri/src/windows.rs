//! Secondary windows: the always-on-top recorder pill and the facecam preview.
//!
//! Both load the same React bundle with a `?window=` query so `main.tsx` can render the
//! matching mini UI instead of the full app.
//!
//! All AppKit / window mutations must run on the main thread. Recording start runs on a
//! Tokio worker, so public helpers marshal via `run_on_main_thread` (and run inline when
//! already on the main thread to avoid deadlocking the event loop).

use std::sync::OnceLock;
use std::sync::atomic::{AtomicBool, Ordering};
use std::thread::ThreadId;
use std::time::Duration;

use tauri::{AppHandle, LogicalPosition, LogicalSize, Manager, WebviewUrl, WebviewWindowBuilder};

pub const RECORDER_LABEL: &str = "recorder";
pub const CAMERA_LABEL: &str = "camera";

static MAIN_THREAD: OnceLock<ThreadId> = OnceLock::new();

/// Call once from Tauri `setup` so we can detect main-thread callers.
pub fn mark_main_thread() {
    let _ = MAIN_THREAD.set(std::thread::current().id());
}

fn is_main_thread() -> bool {
    MAIN_THREAD
        .get()
        .is_some_and(|id| *id == std::thread::current().id())
}

/// Run window work on the AppKit/UI thread. Blocks the caller until done when off-main.
fn on_main<T, F>(app: &AppHandle, f: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce(&AppHandle) -> Result<T, String> + Send + 'static,
{
    if is_main_thread() {
        return f(app);
    }
    let (tx, rx) = std::sync::mpsc::channel();
    let app2 = app.clone();
    app.run_on_main_thread(move || {
        let _ = tx.send(f(&app2));
    })
    .map_err(|e| format!("failed to schedule on main thread: {e}"))?;
    rx.recv()
        .map_err(|_| "main-thread window work was cancelled".to_string())?
}

fn on_main_unit<F>(app: &AppHandle, f: F)
where
    F: FnOnce(&AppHandle) + Send + 'static,
{
    let _ = on_main(app, move |app| {
        f(app);
        Ok(())
    });
}

fn window_url(kind: &str) -> WebviewUrl {
    WebviewUrl::App(format!("index.html?window={kind}").into())
}

/// A monitor's usable area (excluding the menu bar and Dock) in logical pixels.
#[derive(Debug, Clone, Copy)]
struct WorkArea {
    x: f64,
    y: f64,
    w: f64,
    h: f64,
}

impl WorkArea {
    fn from_monitor(m: &tauri::Monitor) -> Self {
        let scale = m.scale_factor();
        let wa = m.work_area();
        Self {
            x: wa.position.x as f64 / scale,
            y: wa.position.y as f64 / scale,
            w: wa.size.width as f64 / scale,
            h: wa.size.height as f64 / scale,
        }
    }
}

/// Work area of the display being recorded (`display_id` = Cap display id string, `None` =
/// primary), matched against Tauri monitors by logical origin. Falls back to the monitor under
/// the cursor, then the primary monitor, then 1440x900.
fn target_work_area(app: &AppHandle, display_id: Option<&str>) -> WorkArea {
    let monitors = app.available_monitors().unwrap_or_default();
    let recorded = lare_recording::devices::display_logical_bounds(display_id).and_then(|(x, y, _, _)| {
        monitors.iter().find(|m| {
            let scale = m.scale_factor();
            let p = m.position();
            (p.x as f64 / scale - x).abs() < 1.0 && (p.y as f64 / scale - y).abs() < 1.0
        })
    });
    let under_cursor = || {
        let c = app.cursor_position().ok()?;
        app.monitor_from_point(c.x, c.y).ok().flatten()
    };
    recorded
        .cloned()
        .or_else(under_cursor)
        .or_else(|| app.primary_monitor().ok().flatten())
        .map(|m| WorkArea::from_monitor(&m))
        .unwrap_or(WorkArea { x: 0.0, y: 0.0, w: 1440.0, h: 900.0 })
}

const RECORDER_SIZE: (f64, f64) = (360.0, 64.0);
const CAMERA_SIZE: f64 = 220.0;
const EDGE_MARGIN: f64 = 16.0;

/// Bottom-centre of the work area, clear of the Dock.
fn recorder_position(wa: WorkArea) -> (f64, f64) {
    let (w, h) = RECORDER_SIZE;
    (wa.x + (wa.w - w) / 2.0, wa.y + wa.h - h - EDGE_MARGIN)
}

/// Bottom-right of the work area, clear of the Dock.
fn camera_position(wa: WorkArea, size: f64) -> (f64, f64) {
    (wa.x + wa.w - size - EDGE_MARGIN, wa.y + wa.h - size - EDGE_MARGIN)
}

/// Raise overlay windows above Chrome, the Dock, fullscreen spaces, and other apps, and make
/// them follow the user across Spaces (like Zoom's floating controls).
///
/// On macOS the tao `NSWindow` is turned into a non-activating `NSPanel`: since macOS 10.14 a
/// plain window of a regular (Dock-icon) app is not allowed to float over *other apps'*
/// fullscreen Spaces, and clicking it activates Lare, which yanks the user back to the Space the
/// main window lives on. A non-activating panel has neither problem; it is what Cap, Loom and
/// Screen Studio use for their recording controls. The class swap is safe because `NSPanel` adds
/// no instance variables to `NSWindow` (this is the same trick `tauri-nspanel` relies on).
///
/// `NSScreenSaverWindowLevel` (1000) keeps the pill/facecam above the Dock (20) and fullscreen
/// windows. Tauri's `set_always_on_top` is deliberately not used here: tao implements it as an
/// *async* `setLevel: NSFloatingWindowLevel` that would land after our synchronous `setLevel:`
/// and drag the window back under the Dock.
#[allow(unexpected_cfgs)] // objc 0.2's `msg_send!` expands `cfg(feature = "cargo-clippy")`
fn promote_overlay(window: &tauri::WebviewWindow) {
    if !window.is_visible().unwrap_or(false) {
        return;
    }
    #[cfg(target_os = "macos")]
    {
        if let Ok(ptr) = window.ns_window() {
            // SAFETY: called on the main thread with a live NSWindow owned by tao.
            unsafe { macos::promote(ptr.cast()) };
        }
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = window.set_always_on_top(true);
        let _ = window.set_visible_on_all_workspaces(true);
    }
}

#[cfg(target_os = "macos")]
#[allow(unexpected_cfgs)] // objc 0.2's `msg_send!` expands `cfg(feature = "cargo-clippy")`
mod macos {
    use objc::runtime::{BOOL, Class, NO, Object, YES};
    use objc::{msg_send, sel, sel_impl};

    unsafe extern "C" {
        fn object_setClass(obj: *mut Object, cls: *const Class) -> *const Class;
    }

    const NS_SCREEN_SAVER_WINDOW_LEVEL: i64 = 1000;
    /// `NSWindowStyleMaskNonactivatingPanel`: clicks reach the panel without activating the app.
    const NON_ACTIVATING_PANEL: u64 = 1 << 7;

    // NSWindowCollectionBehavior bits.
    const CAN_JOIN_ALL_SPACES: u64 = 1 << 0;
    const MOVE_TO_ACTIVE_SPACE: u64 = 1 << 1;
    const STATIONARY: u64 = 1 << 4;
    const IGNORES_CYCLE: u64 = 1 << 6;
    const FULL_SCREEN_AUXILIARY: u64 = 1 << 8;
    const OVERLAY_BEHAVIOR: u64 = CAN_JOIN_ALL_SPACES | STATIONARY | IGNORES_CYCLE | FULL_SCREEN_AUXILIARY;
    const MOVE_BEHAVIOR: u64 = MOVE_TO_ACTIVE_SPACE | STATIONARY | IGNORES_CYCLE | FULL_SCREEN_AUXILIARY;

    /// Idempotent: safe to call repeatedly (every focus change and once a second while recording).
    pub unsafe fn promote(ns: *mut Object) {
        if ns.is_null() {
            return;
        }
        // A window that is closing (or not yet shown) must be left alone: `orderFrontRegardless`
        // would resurrect a closed window right before AppKit deallocates it.
        let visible: BOOL = msg_send![ns, isVisible];
        if visible == NO {
            return;
        }
        // 1. Become a non-activating NSPanel (the class swap happens once; later calls only see
        //    an already-converted panel). Interacting with the pill must not activate Lare.
        if let Some(panel) = Class::get("NSPanel") {
            let is_panel: BOOL = msg_send![ns, isKindOfClass: panel];
            if is_panel == NO {
                // SAFETY: NSPanel adds no ivars over NSWindow, so the instance layout still fits.
                unsafe { object_setClass(ns, panel) };
            }
            let mask: u64 = msg_send![ns, styleMask];
            if mask & NON_ACTIVATING_PANEL == 0 {
                let _: () = msg_send![ns, setStyleMask: mask | NON_ACTIVATING_PANEL];
            }
            let _: () = msg_send![ns, setBecomesKeyOnlyIfNeeded: YES];
            let _: () = msg_send![ns, setWorksWhenModal: YES];
        }
        // 2. Level and visibility flags. NSPanel defaults to hidesOnDeactivate = YES, so this
        //    must be re-asserted after the class swap.
        let level: i64 = msg_send![ns, level];
        if level != NS_SCREEN_SAVER_WINDOW_LEVEL {
            let _: () = msg_send![ns, setLevel: NS_SCREEN_SAVER_WINDOW_LEVEL];
        }
        let _: () = msg_send![ns, setHidesOnDeactivate: NO];
        let _: () = msg_send![ns, setCanHide: NO];
        let behavior: u64 = msg_send![ns, collectionBehavior];
        if behavior != OVERLAY_BEHAVIOR {
            let _: () = msg_send![ns, setCollectionBehavior: OVERLAY_BEHAVIOR];
        }
        // 3. If the window is somehow still parked on another Space, drag it to the active one
        //    (MoveToActiveSpace is honoured by orderFront), then restore the all-Spaces flags.
        let on_active: BOOL = msg_send![ns, isOnActiveSpace];
        if on_active == NO {
            let _: () = msg_send![ns, setCollectionBehavior: MOVE_BEHAVIOR];
            let _: () = msg_send![ns, orderFrontRegardless];
            let _: () = msg_send![ns, setCollectionBehavior: OVERLAY_BEHAVIOR];
        }
        let _: () = msg_send![ns, orderFrontRegardless];
    }
}

/// Re-assert overlay window levels after another app takes focus.
pub fn repromote_overlays(app: &AppHandle) {
    on_main_unit(app, |app| {
        for label in [RECORDER_LABEL, CAMERA_LABEL] {
            if let Some(w) = app.get_webview_window(label) {
                promote_overlay(&w);
            }
        }
    });
}

static WATCHDOG_RUNNING: AtomicBool = AtomicBool::new(false);

/// While an overlay window exists, re-promote once a second. Focus events alone are not enough:
/// switching Spaces or entering another app's fullscreen does not focus any of our windows, and
/// macOS occasionally resets window levels when the display configuration changes.
fn start_overlay_watchdog(app: &AppHandle) {
    if WATCHDOG_RUNNING.swap(true, Ordering::SeqCst) {
        return;
    }
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        loop {
            tokio::time::sleep(Duration::from_secs(1)).await;
            let any_open = [RECORDER_LABEL, CAMERA_LABEL]
                .iter()
                .any(|label| app.get_webview_window(label).is_some());
            if !any_open {
                break;
            }
            repromote_overlays(&app);
        }
        WATCHDOG_RUNNING.store(false, Ordering::SeqCst);
    });
}

/// Show the recorder pill (bottom-centre of the recorded display, above the Dock).
pub fn open_recorder(app: &AppHandle, display_id: Option<&str>) -> Result<(), String> {
    let display_id = display_id.map(str::to_owned);
    on_main(app, move |app| {
        let (x, y) = recorder_position(target_work_area(app, display_id.as_deref()));
        if let Some(w) = app.get_webview_window(RECORDER_LABEL) {
            let _ = w.set_position(LogicalPosition::new(x, y));
            w.show().map_err(|e| e.to_string())?;
            promote_overlay(&w);
            start_overlay_watchdog(app);
            return Ok(());
        }
        let (w, h) = RECORDER_SIZE;
        let window = WebviewWindowBuilder::new(app, RECORDER_LABEL, window_url("recorder"))
            .title("Lare recorder")
            .inner_size(w, h)
            .position(x, y)
            .decorations(false)
            .transparent(true)
            .shadow(false)
            .resizable(false)
            .skip_taskbar(true)
            .focused(false)
            .visible_on_all_workspaces(true)
            .build()
            .map_err(|e| format!("could not open recorder window: {e}"))?;
        promote_overlay(&window);
        start_overlay_watchdog(app);
        Ok(())
    })
}

pub fn close_recorder(app: &AppHandle) {
    on_main_unit(app, |app| {
        if let Some(w) = app.get_webview_window(RECORDER_LABEL) {
            let _ = w.close();
        }
    });
}

/// Show the facecam preview (bottom-right of the recorded display, above the Dock). Captured as
/// part of the screen in instant mode, so it must sit on the display being recorded; purely a
/// preview in studio mode.
pub fn open_camera(app: &AppHandle, display_id: Option<&str>) -> Result<(), String> {
    let display_id = display_id.map(str::to_owned);
    on_main(app, move |app| {
        let wa = target_work_area(app, display_id.as_deref());
        if let Some(w) = app.get_webview_window(CAMERA_LABEL) {
            let scale = w.scale_factor().unwrap_or(1.0);
            let size = w
                .outer_size()
                .map(|s| s.width as f64 / scale)
                .unwrap_or(CAMERA_SIZE);
            let (x, y) = camera_position(wa, size);
            let _ = w.set_position(LogicalPosition::new(x, y));
            w.show().map_err(|e| e.to_string())?;
            promote_overlay(&w);
            start_overlay_watchdog(app);
            return Ok(());
        }
        let size = CAMERA_SIZE;
        let (x, y) = camera_position(wa, size);
        let window = WebviewWindowBuilder::new(app, CAMERA_LABEL, window_url("camera"))
            .title("Lare camera")
            .inner_size(size, size)
            .position(x, y)
            .decorations(false)
            .transparent(true)
            .shadow(false)
            .resizable(false)
            .skip_taskbar(true)
            .focused(false)
            .visible_on_all_workspaces(true)
            .build()
            .map_err(|e| format!("could not open camera window: {e}"))?;
        promote_overlay(&window);
        start_overlay_watchdog(app);
        Ok(())
    })
}

pub fn close_camera(app: &AppHandle) {
    on_main_unit(app, |app| {
        if let Some(w) = app.get_webview_window(CAMERA_LABEL) {
            let _ = w.close();
        }
    });
}

/// Resize the camera preview (small/medium/large presets from the pill).
pub fn resize_camera(app: &AppHandle, size: f64) -> Result<(), String> {
    on_main(app, move |app| {
        let w = app
            .get_webview_window(CAMERA_LABEL)
            .ok_or("camera window is not open")?;
        let size = size.clamp(120.0, 480.0);
        let scale = w.scale_factor().unwrap_or(1.0);
        let pos = w.outer_position().map_err(|e| e.to_string())?;
        let old = w.outer_size().map_err(|e| e.to_string())?;
        // Keep the bottom-right corner anchored while resizing.
        let dx = (old.width as f64 / scale) - size;
        let dy = (old.height as f64 / scale) - size;
        w.set_size(LogicalSize::new(size, size))
            .map_err(|e| e.to_string())?;
        w.set_position(LogicalPosition::new(
            pos.x as f64 / scale + dx,
            pos.y as f64 / scale + dy,
        ))
        .map_err(|e| e.to_string())?;
        Ok(())
    })
}
