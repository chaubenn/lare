//! Secondary windows: the always-on-top recorder pill and the facecam preview.
//!
//! Both load the same React bundle with a `?window=` query so `main.tsx` can render the
//! matching mini UI instead of the full app.
//!
//! Overlays are built once and then only shown and hidden. Closing one destroys its wry webview,
//! and the pill's stop button is *inside* that webview: tearing it down while its `recording_stop`
//! invoke is still in flight raises an Objective-C exception on the main thread, which unwinds
//! into tao's event loop as a foreign exception and aborts the process. [`destroy_overlays`] is
//! the only place that closes them, at quit, when nothing is in flight.
//!
//! All AppKit / window mutations must run on the main thread. Recording start runs on a
//! Tokio worker, so public helpers marshal via `run_on_main_thread` (and run inline when
//! already on the main thread to avoid deadlocking the event loop).

use std::sync::OnceLock;
use std::sync::atomic::{AtomicBool, Ordering};
use std::thread::ThreadId;
use std::time::Duration;

use tauri::{AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut};

pub const RECORDER_LABEL: &str = "recorder";
pub const CAMERA_LABEL: &str = "camera";

/// Hides and shows the pill until the user picks their own. Three modifiers plus a letter that no
/// OS, browser or editor binds, and nothing a recording session types (code, speech) produces,
/// so it is the same on every platform and never collides with anything.
pub const DEFAULT_PILL_SHORTCUT: &str = "Control+Alt+Shift+H";

/// True from the moment the pill is put up for a recording until it is taken down. The shortcut is
/// only registered, and only does anything, in between, so it can never shadow the same keys in
/// another app outside a take.
static PILL_LIVE: AtomicBool = AtomicBool::new(false);

/// Tells the facecam preview whether it should be holding the webcam open. A hidden window keeps
/// running its script, and nobody wants the camera light on between takes.
fn set_camera_active(app: &AppHandle, active: bool) {
    if let Err(e) = app.emit_to(CAMERA_LABEL, "camera:active", active) {
        tracing::warn!(%e, "emit camera:active failed");
    }
}

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

static QUITTING: AtomicBool = AtomicBool::new(false);

/// Called by [`crate::shutdown`] before it tears the recording down.
///
/// `run_on_main_thread` posts an application-defined `NSEvent` that only tao's own event loop
/// dequeues, and by then the main thread is inside AppKit's `applicationShouldTerminate:` run
/// loop, which never gets back to tao. An off-main [`on_main`] call would block until the process
/// died. Hiding a window on the way out is moot anyway, so they stop marshalling.
pub fn mark_quitting() {
    QUITTING.store(true, Ordering::SeqCst);
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
    if QUITTING.load(Ordering::SeqCst) {
        return Err("Lare is quitting".into());
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

/// Transparent room above the pill for its tooltips. The window keeps it the whole time, and the
/// pointer watch lets clicks through it (see [`start_pointer_watch`]).
const TOOLTIP_ROOM: f64 = 34.0;
/// The pill itself is 52pt tall, sitting in the bottom 72pt with room for its shadow; the
/// tooltip room is on top of that.
const RECORDER_SIZE: (f64, f64) = (464.0, 72.0 + TOOLTIP_ROOM);
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

/// Turn a freshly built, still hidden overlay into a non-activating `NSPanel` (macOS only).
///
/// Since macOS 10.14 a plain window of a regular (Dock-icon) app is not allowed onto *other
/// apps'* fullscreen Spaces, and clicking it activates Lare, which yanks the user back to the
/// Space the main window lives on. A non-activating panel has neither problem; it is what Cap,
/// Loom and Screen Studio use for their recording controls. The class swap is safe because
/// `NSPanel` adds no instance variables to `NSWindow` (the same trick `tauri-nspanel` relies on).
///
/// This has to happen before the window is ever on screen. WindowServer decides whether a window
/// may join another app's fullscreen Space when it first orders it in, and a window it has seen as
/// an ordinary one stays barred from fullscreen Spaces for good, however it is converted later.
/// That is why the overlays are built hidden and shown with [`show_overlay`].
fn prepare_overlay(window: &tauri::WebviewWindow) {
    #[cfg(target_os = "macos")]
    {
        if let Ok(ptr) = window.ns_window() {
            // SAFETY: called on the main thread with a live NSWindow owned by tao.
            unsafe { macos::make_panel(ptr.cast()) };
        }
    }
    #[cfg(not(target_os = "macos"))]
    let _ = window;
}

/// Put an overlay on screen, above whatever is in front, without taking focus from it.
///
/// On macOS the panel is ordered in with `orderFrontRegardless` rather than Tauri's `show`, which
/// is `makeKeyAndOrderFront:` and would pull keyboard focus out of the browser being recorded.
fn show_overlay(window: &tauri::WebviewWindow) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let ptr = window.ns_window().map_err(|e| e.to_string())?;
        // SAFETY: called on the main thread with a live NSWindow owned by tao.
        unsafe { macos::order_in(ptr.cast()) };
    }
    #[cfg(not(target_os = "macos"))]
    window.show().map_err(|e| e.to_string())?;
    promote_overlay(window);
    Ok(())
}

/// Raise overlay windows above Chrome, the Dock, fullscreen spaces, and other apps, and make
/// them follow the user across Spaces (like Zoom's floating controls).
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

    /// Make `ns` a non-activating panel with the overlay level and Space flags. Must run while the
    /// window has never been ordered in (see [`super::prepare_overlay`]). Idempotent.
    pub unsafe fn make_panel(ns: *mut Object) {
        if ns.is_null() {
            return;
        }
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
            // The class swap skips NSPanel's init, which is where AppKit tells WindowServer the
            // panel never activates its app; `setStyleMask:` does not sync that tag. Set it the way
            // init would.
            let prevents = sel!(_setPreventsActivation:);
            let responds: BOOL = msg_send![ns, respondsToSelector: prevents];
            if responds == YES {
                let _: () = msg_send![ns, _setPreventsActivation: YES];
            }
            let _: () = msg_send![ns, setBecomesKeyOnlyIfNeeded: YES];
            let _: () = msg_send![ns, setWorksWhenModal: YES];
        }
        // NSPanel defaults to hidesOnDeactivate = YES, so this must come after the class swap.
        let _: () = msg_send![ns, setHidesOnDeactivate: NO];
        let _: () = msg_send![ns, setCanHide: NO];
        let _: () = msg_send![ns, setLevel: NS_SCREEN_SAVER_WINDOW_LEVEL];
        let _: () = msg_send![ns, setCollectionBehavior: OVERLAY_BEHAVIOR];
    }

    #[repr(C)]
    #[derive(Clone, Copy)]
    struct CGPoint {
        x: f64,
        y: f64,
    }
    #[repr(C)]
    #[derive(Clone, Copy)]
    struct CGSize {
        width: f64,
        height: f64,
    }
    #[repr(C)]
    #[derive(Clone, Copy)]
    struct CGRect {
        origin: CGPoint,
        size: CGSize,
    }
    unsafe impl objc::Encode for CGPoint {
        fn encode() -> objc::Encoding {
            unsafe { objc::Encoding::from_str("{CGPoint=dd}") }
        }
    }
    unsafe impl objc::Encode for CGRect {
        fn encode() -> objc::Encoding {
            unsafe { objc::Encoding::from_str("{CGRect={CGPoint=dd}{CGSize=dd}}") }
        }
    }

    /// Where the pointer is over the window, in points from its top-left, or `None` off it.
    pub unsafe fn pointer_in(ns: *mut Object) -> Option<(f64, f64)> {
        if ns.is_null() {
            return None;
        }
        let event = Class::get("NSEvent")?;
        let at: CGPoint = msg_send![event, mouseLocation];
        let frame: CGRect = msg_send![ns, frame];
        let x = at.x - frame.origin.x;
        let y = frame.origin.y + frame.size.height - at.y;
        (x >= 0.0 && y >= 0.0 && x < frame.size.width && y < frame.size.height).then_some((x, y))
    }

    /// Order the panel in front of everything without making it key or activating Lare.
    pub unsafe fn order_in(ns: *mut Object) {
        if ns.is_null() {
            return;
        }
        let _: () = msg_send![ns, orderFrontRegardless];
    }

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
        // 1. Level and visibility flags, in case macOS reset them (it does on display changes).
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
        // 2. If the window is somehow still parked on another Space, drag it to the active one
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
            // Visibility, not existence: the overlays outlive every recording now.
            let any_visible = [RECORDER_LABEL, CAMERA_LABEL].iter().any(|label| {
                app.get_webview_window(label)
                    .is_some_and(|w| w.is_visible().unwrap_or(false))
            });
            if !any_visible {
                break;
            }
            repromote_overlays(&app);
        }
        WATCHDOG_RUNNING.store(false, Ordering::SeqCst);
    });
}

static POINTER_WATCH_RUNNING: AtomicBool = AtomicBool::new(false);

/// Event carrying the pointer's position over the pill window, in points from its top-left
/// (`null` when it is off the window).
const POINTER_EVENT: &str = "recorder:pointer";

/// While the pill is up, follow the pointer over it.
///
/// Two jobs. The window is taller than the pill, to leave room for tooltips, and a transparent
/// window still takes the clicks meant for the page behind it; so the window ignores the mouse
/// unless the pointer is on the pill itself. And on macOS the pill is a non-activating panel, never
/// the key window, where WebKit tracks no hover while overlay scrollbars are on (the default), so
/// the webview is told where the pointer is instead.
fn start_pointer_watch(app: &AppHandle) {
    if POINTER_WATCH_RUNNING.swap(true, Ordering::SeqCst) {
        return;
    }
    let app = app.clone();
    std::thread::spawn(move || {
        let mut last: Option<(i32, i32)> = None;
        let mut ignoring: Option<bool> = None;
        loop {
            std::thread::sleep(Duration::from_millis(50));
            let at = on_main(&app, |app| {
                let Some(w) = app.get_webview_window(RECORDER_LABEL) else {
                    return Ok(None);
                };
                if !w.is_visible().unwrap_or(false) {
                    return Ok(None);
                }
                Ok(Some(pointer_over(&w)))
            });
            // The pill is gone (or the app is quitting), so the watch ends with it. It starts out
            // taking the mouse again next time.
            let Ok(Some(at)) = at else {
                if let Some(w) = app.get_webview_window(RECORDER_LABEL) {
                    let _ = w.set_ignore_cursor_events(false);
                }
                if last.is_some() {
                    let _ = app.emit_to(RECORDER_LABEL, POINTER_EVENT, None::<(i32, i32)>);
                }
                break;
            };
            let on_pill = at.is_some_and(|(_, y)| y >= TOOLTIP_ROOM);
            if ignoring != Some(!on_pill) {
                if let Some(w) = app.get_webview_window(RECORDER_LABEL) {
                    let _ = w.set_ignore_cursor_events(!on_pill);
                }
                ignoring = Some(!on_pill);
            }
            let at = at.map(|(x, y)| (x.round() as i32, y.round() as i32));
            if at != last {
                let _ = app.emit_to(RECORDER_LABEL, POINTER_EVENT, at);
                last = at;
            }
        }
        POINTER_WATCH_RUNNING.store(false, Ordering::SeqCst);
        // Shown again while this was on its way out: its own start found the watch still running.
        let shown = on_main(&app, |app| {
            Ok(app
                .get_webview_window(RECORDER_LABEL)
                .is_some_and(|w| w.is_visible().unwrap_or(false)))
        });
        if shown.unwrap_or(false) {
            start_pointer_watch(&app);
        }
    });
}

/// Where the pointer is over the window, in points from its top-left, or `None` off it. Main
/// thread only.
fn pointer_over(w: &tauri::WebviewWindow) -> Option<(f64, f64)> {
    #[cfg(target_os = "macos")]
    {
        let ptr = w.ns_window().ok()?;
        // SAFETY: on the main thread with a live NSWindow owned by tao.
        unsafe { macos::pointer_in(ptr.cast()) }
    }
    // Physical pixels on both sides: the cursor and the window share the desktop's coordinates.
    #[cfg(not(target_os = "macos"))]
    {
        let cursor = w.cursor_position().ok()?;
        let pos = w.outer_position().ok()?;
        let size = w.outer_size().ok()?;
        let scale = w.scale_factor().ok()?;
        let (x, y) = (cursor.x - pos.x as f64, cursor.y - pos.y as f64);
        (x >= 0.0 && y >= 0.0 && x < size.width as f64 && y < size.height as f64)
            .then_some((x / scale, y / scale))
    }
}

/// Whether a shortcut is safe to claim system-wide: a function key, or any key held with a
/// modifier other than Shift. Anything else would swallow ordinary typing for as long as a
/// recording runs. The settings page enforces the same rule when it captures a chord.
fn is_claimable(shortcut: &Shortcut) -> bool {
    let function_keys = [
        Code::F1, Code::F2, Code::F3, Code::F4, Code::F5, Code::F6, Code::F7, Code::F8,
        Code::F9, Code::F10, Code::F11, Code::F12, Code::F13, Code::F14, Code::F15, Code::F16,
        Code::F17, Code::F18, Code::F19, Code::F20, Code::F21, Code::F22, Code::F23, Code::F24,
    ];
    function_keys.contains(&shortcut.key) || !shortcut.mods.difference(Modifiers::SHIFT).is_empty()
}

/// Reads the user's pill shortcut: `None` is the default, `Some("")` turns it off.
pub fn parse_pill_shortcut(setting: Option<&str>) -> Result<Option<Shortcut>, String> {
    let raw = match setting.map(str::trim) {
        None => DEFAULT_PILL_SHORTCUT,
        Some("") => return Ok(None),
        Some(raw) => raw,
    };
    let shortcut = raw
        .parse::<Shortcut>()
        .map_err(|e| format!("\"{raw}\" is not a valid shortcut: {e}"))?;
    if !is_claimable(&shortcut) {
        return Err(format!(
            "\"{raw}\" would take over a plain typing key: hold Ctrl, Alt or Cmd with it."
        ));
    }
    Ok(Some(shortcut))
}

/// Makes the registered global shortcut match the recording state and the saved setting.
/// Lare has no other global shortcut, so everything is cleared and the one wanted is re-added.
pub fn sync_pill_shortcut(app: &AppHandle) {
    on_main_unit(app, |app| {
        let shortcuts = app.global_shortcut();
        if let Err(e) = shortcuts.unregister_all() {
            tracing::warn!(%e, "could not clear the pill shortcut");
        }
        if !PILL_LIVE.load(Ordering::SeqCst) {
            return;
        }
        let setting = app
            .try_state::<std::sync::Arc<crate::recorder::Recorder>>()
            .and_then(|rec| rec.settings().pill_shortcut);
        match parse_pill_shortcut(setting.as_deref()) {
            Ok(Some(shortcut)) => {
                // Typically the OS or another app already owns a combination the user picked;
                // the pill then simply stays put.
                if let Err(e) = shortcuts.register(shortcut) {
                    tracing::warn!(%e, "could not register the pill shortcut");
                }
            }
            Ok(None) => {}
            Err(e) => tracing::warn!(%e, "ignoring the saved pill shortcut"),
        }
    });
}

/// Hide the pill if it is showing, bring it back if it is hidden. The webview keeps running while
/// it is off screen, and it comes back where the user left it, so the timer and the recording are
/// untouched either way. Does nothing unless a recording has the pill up.
pub fn toggle_recorder(app: &AppHandle) {
    on_main_unit(app, |app| {
        if !PILL_LIVE.load(Ordering::SeqCst) {
            return;
        }
        let Some(w) = app.get_webview_window(RECORDER_LABEL) else {
            return;
        };
        if w.is_visible().unwrap_or(false) {
            let _ = w.hide();
        } else if show_overlay(&w).is_ok() {
            start_overlay_watchdog(app);
            start_pointer_watch(app);
        }
    });
}

/// Take the pill off screen for the rest of the take without ending it, from the pill's own hide
/// button. The recording keeps running and the shortcut brings the pill back, exactly as if the
/// user had pressed it.
pub fn tuck_recorder(app: &AppHandle) {
    on_main_unit(app, |app| {
        if let Some(w) = app.get_webview_window(RECORDER_LABEL) {
            let _ = w.hide();
        }
    });
}

/// Show the recorder pill (bottom-centre of the recorded display, above the Dock).
pub fn open_recorder(app: &AppHandle, display_id: Option<&str>) -> Result<(), String> {
    let display_id = display_id.map(str::to_owned);
    on_main(app, move |app| {
        let (x, y) = recorder_position(target_work_area(app, display_id.as_deref()));
        PILL_LIVE.store(true, Ordering::SeqCst);
        sync_pill_shortcut(app);
        if let Some(w) = app.get_webview_window(RECORDER_LABEL) {
            let _ = w.set_position(LogicalPosition::new(x, y));
            show_overlay(&w)?;
            start_overlay_watchdog(app);
            start_pointer_watch(app);
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
            .visible(false)
            .visible_on_all_workspaces(true)
            .build()
            .map_err(|e| format!("could not open recorder window: {e}"))?;
        prepare_overlay(&window);
        show_overlay(&window)?;
        start_overlay_watchdog(app);
        start_pointer_watch(app);
        Ok(())
    })
}

/// Take the pill off screen. It keeps its webview so a stop still in flight can finish.
pub fn hide_recorder(app: &AppHandle) {
    on_main_unit(app, |app| {
        PILL_LIVE.store(false, Ordering::SeqCst);
        sync_pill_shortcut(app);
        if let Some(w) = app.get_webview_window(RECORDER_LABEL) {
            let _ = w.hide();
        }
    });
}

/// Show the facecam preview (bottom-right of the recorded display, above the Dock). It is
/// captured as part of the screen, so it must sit on the display being recorded.
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
            show_overlay(&w)?;
            set_camera_active(app, true);
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
            .visible(false)
            .visible_on_all_workspaces(true)
            .build()
            .map_err(|e| format!("could not open camera window: {e}"))?;
        prepare_overlay(&window);
        show_overlay(&window)?;
        start_overlay_watchdog(app);
        Ok(())
    })
}

/// Take the facecam preview off screen, keeping its webview (see [`hide_recorder`]).
pub fn hide_camera(app: &AppHandle) {
    on_main_unit(app, |app| {
        if let Some(w) = app.get_webview_window(CAMERA_LABEL) {
            let _ = w.hide();
            set_camera_active(app, false);
        }
    });
}

/// Tear the overlays down for good, on the way out. `close` only *asks* a window to close, which
/// is no use when the process is about to end; `destroy` takes it down there and then, so the
/// panels leave the screen with the main window rather than a beat after it.
pub fn destroy_overlays(app: &AppHandle) {
    on_main_unit(app, |app| {
        for label in [RECORDER_LABEL, CAMERA_LABEL] {
            if let Some(w) = app.get_webview_window(label) {
                let _ = w.destroy();
            }
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

#[cfg(test)]
mod tests {
    use super::{DEFAULT_PILL_SHORTCUT, parse_pill_shortcut};

    #[test]
    fn unset_is_the_default_and_empty_is_off() {
        assert_eq!(
            parse_pill_shortcut(None).unwrap(),
            Some(DEFAULT_PILL_SHORTCUT.parse().unwrap())
        );
        assert_eq!(parse_pill_shortcut(Some("")).unwrap(), None);
        assert_eq!(parse_pill_shortcut(Some("  ")).unwrap(), None);
    }

    #[test]
    fn every_accelerator_the_settings_page_can_produce_parses() {
        for accelerator in [
            "Command+Space",
            "Control+Space",
            "Super+Shift+H",
            "Control+Alt+Shift+P",
            "Alt+7",
            "Control+Up",
            "Control+`",
            "Control+-",
            "Control+\\",
            "F9",
        ] {
            assert!(
                parse_pill_shortcut(Some(accelerator)).is_ok(),
                "{accelerator} should parse"
            );
        }
    }

    #[test]
    fn a_plain_typing_key_cannot_be_claimed_globally() {
        for accelerator in ["H", "Space", "Shift+H", "Shift+Space", "Up", "7"] {
            assert!(
                parse_pill_shortcut(Some(accelerator)).is_err(),
                "{accelerator} should be refused"
            );
        }
        for accelerator in ["F9", "Shift+F9", "Alt+H", "Control+Shift+H", "Command+Space"] {
            assert!(
                parse_pill_shortcut(Some(accelerator)).is_ok(),
                "{accelerator} should be accepted"
            );
        }
    }

    #[test]
    fn nonsense_is_rejected() {
        assert!(parse_pill_shortcut(Some("Control+Banana")).is_err());
        assert!(parse_pill_shortcut(Some("Control+")).is_err());
    }
}
