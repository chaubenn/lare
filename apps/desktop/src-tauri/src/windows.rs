//! Secondary windows: the always-on-top recorder pill and the facecam preview.
//!
//! Both load the same React bundle with a `?window=` query so `main.tsx` can render the
//! matching mini UI instead of the full app.

use tauri::{AppHandle, LogicalPosition, LogicalSize, Manager, WebviewUrl, WebviewWindowBuilder};

pub const RECORDER_LABEL: &str = "recorder";
pub const CAMERA_LABEL: &str = "camera";

fn window_url(kind: &str) -> WebviewUrl {
    WebviewUrl::App(format!("index.html?window={kind}").into())
}

/// Primary monitor work-area size in logical pixels (falls back to 1440x900).
fn primary_size(app: &AppHandle) -> (f64, f64) {
    app.primary_monitor()
        .ok()
        .flatten()
        .map(|m| {
            let scale = m.scale_factor();
            let size = m.size();
            (size.width as f64 / scale, size.height as f64 / scale)
        })
        .unwrap_or((1440.0, 900.0))
}

/// Show the recorder pill (bottom-centre of the primary display).
pub fn open_recorder(app: &AppHandle) -> Result<(), String> {
    if let Some(w) = app.get_webview_window(RECORDER_LABEL) {
        w.show().map_err(|e| e.to_string())?;
        w.set_focus().ok();
        return Ok(());
    }
    let (sw, sh) = primary_size(app);
    let (w, h) = (360.0, 64.0);
    WebviewWindowBuilder::new(app, RECORDER_LABEL, window_url("recorder"))
        .title("Lare recorder")
        .inner_size(w, h)
        .position((sw - w) / 2.0, sh - h - 48.0)
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .always_on_top(true)
        .resizable(false)
        .skip_taskbar(true)
        .visible_on_all_workspaces(true)
        .build()
        .map(|_| ())
        .map_err(|e| format!("could not open recorder window: {e}"))
}

pub fn close_recorder(app: &AppHandle) {
    if let Some(w) = app.get_webview_window(RECORDER_LABEL) {
        let _ = w.close();
    }
}

/// Show the facecam preview (bottom-right of the primary display). Captured as part of the
/// screen in instant mode; purely a preview in studio mode.
pub fn open_camera(app: &AppHandle) -> Result<(), String> {
    if let Some(w) = app.get_webview_window(CAMERA_LABEL) {
        w.show().map_err(|e| e.to_string())?;
        return Ok(());
    }
    let (sw, sh) = primary_size(app);
    let size = 220.0;
    WebviewWindowBuilder::new(app, CAMERA_LABEL, window_url("camera"))
        .title("Lare camera")
        .inner_size(size, size)
        .position(sw - size - 32.0, sh - size - 140.0)
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .always_on_top(true)
        .resizable(false)
        .skip_taskbar(true)
        .visible_on_all_workspaces(true)
        .build()
        .map(|_| ())
        .map_err(|e| format!("could not open camera window: {e}"))
}

pub fn close_camera(app: &AppHandle) {
    if let Some(w) = app.get_webview_window(CAMERA_LABEL) {
        let _ = w.close();
    }
}

/// Resize the camera preview (small/medium/large presets from the pill).
pub fn resize_camera(app: &AppHandle, size: f64) -> Result<(), String> {
    let w = app.get_webview_window(CAMERA_LABEL).ok_or("camera window is not open")?;
    let size = size.clamp(120.0, 480.0);
    let scale = w.scale_factor().unwrap_or(1.0);
    let pos = w.outer_position().map_err(|e| e.to_string())?;
    let old = w.outer_size().map_err(|e| e.to_string())?;
    // Keep the bottom-right corner anchored while resizing.
    let dx = (old.width as f64 / scale) - size;
    let dy = (old.height as f64 / scale) - size;
    w.set_size(LogicalSize::new(size, size)).map_err(|e| e.to_string())?;
    w.set_position(LogicalPosition::new(pos.x as f64 / scale + dx, pos.y as f64 / scale + dy))
        .map_err(|e| e.to_string())?;
    Ok(())
}
