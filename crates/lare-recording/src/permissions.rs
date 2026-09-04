//! OS capture permissions. On Windows there are no runtime prompts for screen capture;
//! camera/microphone access is governed by the system privacy settings.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PermissionStatus {
    Granted,
    Denied,
    NotDetermined,
    /// The platform does not gate this capability at runtime.
    NotApplicable,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Permissions {
    pub screen_recording: PermissionStatus,
    pub camera: PermissionStatus,
    pub microphone: PermissionStatus,
}

impl Permissions {
    pub fn recording_capable(&self) -> bool {
        matches!(
            self.screen_recording,
            PermissionStatus::Granted | PermissionStatus::NotApplicable
        )
    }
}

pub fn check() -> Permissions {
    Permissions {
        screen_recording: screen_recording(),
        camera: camera(),
        microphone: microphone(),
    }
}

#[cfg(target_os = "macos")]
pub fn screen_recording() -> PermissionStatus {
    if scap_screencapturekit::has_permission() {
        PermissionStatus::Granted
    } else {
        PermissionStatus::Denied
    }
}

#[cfg(not(target_os = "macos"))]
pub fn screen_recording() -> PermissionStatus {
    PermissionStatus::NotApplicable
}

#[cfg(target_os = "macos")]
fn av_status(media: cidre::arc::R<cidre::av::MediaType>, label: &str) -> PermissionStatus {
    use cidre::av;
    let status = av::CaptureDevice::authorization_status_for_media_type(&media);
    tracing::info!(target: "lare_permissions", "{label} raw authorization status: {status:?}");
    match status {
        Ok(av::AuthorizationStatus::NotDetermined) => PermissionStatus::NotDetermined,
        Ok(av::AuthorizationStatus::Authorized) => PermissionStatus::Granted,
        Ok(other) => {
            tracing::warn!(target: "lare_permissions", "{label} not authorized: {other:?}");
            PermissionStatus::Denied
        }
        Err(e) => {
            tracing::warn!(target: "lare_permissions", "{label} status query threw an exception");
            let _ = e;
            PermissionStatus::Denied
        }
    }
}

#[cfg(target_os = "macos")]
pub fn camera() -> PermissionStatus {
    av_status(cidre::av::MediaType::video().retained(), "camera")
}

#[cfg(target_os = "macos")]
pub fn microphone() -> PermissionStatus {
    av_status(cidre::av::MediaType::audio().retained(), "microphone")
}

#[cfg(not(target_os = "macos"))]
pub fn camera() -> PermissionStatus {
    PermissionStatus::NotApplicable
}

#[cfg(not(target_os = "macos"))]
pub fn microphone() -> PermissionStatus {
    PermissionStatus::NotApplicable
}

/// Trigger the macOS screen-recording prompt (first call only; afterwards the user must
/// enable it in System Settings > Privacy & Security > Screen Recording). Returns the
/// current status after prompting.
pub fn request_screen_recording() -> PermissionStatus {
    #[cfg(target_os = "macos")]
    {
        scap_screencapturekit::request_permission();
    }
    screen_recording()
}

pub async fn request_camera() -> PermissionStatus {
    #[cfg(target_os = "macos")]
    {
        tracing::info!(target: "lare_permissions", "requesting camera access");
        match cidre::av::CaptureDevice::request_access_for_media_type(cidre::av::MediaType::video()).await {
            Ok(granted) => tracing::info!(target: "lare_permissions", "camera requestAccess returned {granted}"),
            Err(_) => tracing::warn!(target: "lare_permissions", "camera requestAccess threw an exception"),
        }
    }
    camera()
}

pub async fn request_microphone() -> PermissionStatus {
    #[cfg(target_os = "macos")]
    {
        tracing::info!(target: "lare_permissions", "requesting microphone access");
        match cidre::av::CaptureDevice::request_access_for_media_type(cidre::av::MediaType::audio()).await {
            Ok(granted) => tracing::info!(target: "lare_permissions", "microphone requestAccess returned {granted}"),
            Err(_) => tracing::warn!(target: "lare_permissions", "microphone requestAccess threw an exception"),
        }
    }
    microphone()
}

/// Deep link into the relevant macOS privacy pane.
pub fn settings_url(which: &str) -> Option<&'static str> {
    match which {
        "screen_recording" => Some("x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture"),
        "camera" => Some("x-apple.systempreferences:com.apple.preference.security?Privacy_Camera"),
        "microphone" => Some("x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone"),
        _ => None,
    }
}
