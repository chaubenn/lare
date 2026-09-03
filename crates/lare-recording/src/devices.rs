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
