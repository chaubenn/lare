//! Device enumeration for the recorder UI.

use cap_recording::feeds::microphone::MicrophoneFeed;
use scap_targets::Display;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DisplayInfo {
    /// Stable id string (parse back with `DisplayId::from_str`).
    pub id: String,
    pub name: String,
    pub primary: bool,
    pub width: u32,
    pub height: u32,
    pub refresh_rate: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CameraInfo {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MicrophoneInfo {
    /// Device label; pass back as `StartRequest::mic_label`.
    pub name: String,
    pub default: bool,
}

pub fn list_displays() -> Vec<DisplayInfo> {
    let primary = Display::primary().id();
    Display::list()
        .into_iter()
        .enumerate()
        .map(|(i, d)| {
            let id = d.id();
            let size = d.physical_size();
            DisplayInfo {
                name: d.name().unwrap_or_else(|| format!("Display {}", i + 1)),
                primary: id == primary,
                width: size.as_ref().map(|s| s.width() as u32).unwrap_or(0),
                height: size.as_ref().map(|s| s.height() as u32).unwrap_or(0),
                refresh_rate: d.refresh_rate(),
                id: id.to_string(),
            }
        })
        .collect()
}

/// Logical (points) bounds `(x, y, width, height)` of a display in global top-left-origin
/// coordinates; `None` id = the primary display. Used to place overlay windows on the display
/// that is being recorded.
pub fn display_logical_bounds(display_id: Option<&str>) -> Option<(f64, f64, f64, f64)> {
    let display = match display_id {
        Some(id) => Display::from_id(&id.parse().ok()?)?,
        None => Display::primary(),
    };
    #[cfg(target_os = "macos")]
    {
        let b = display.raw_handle().logical_bounds()?;
        Some((b.position().x(), b.position().y(), b.size().width(), b.size().height()))
    }
    #[cfg(not(target_os = "macos"))]
    {
        let s = display.logical_size()?;
        Some((0.0, 0.0, s.width(), s.height()))
    }
}

pub fn list_cameras() -> Vec<CameraInfo> {
    cap_camera::list_cameras()
        .map(|c| CameraInfo {
            id: c.device_id().to_string(),
            name: c.display_name().to_string(),
        })
        .collect()
}

pub fn list_microphones() -> Vec<MicrophoneInfo> {
    let default = MicrophoneFeed::default_device().map(|(name, _, _)| name);
    MicrophoneFeed::list_names()
        .into_iter()
        .map(|name| MicrophoneInfo {
            default: default.as_deref() == Some(name.as_str()),
            name,
        })
        .collect()
}
