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

/// Forget this app's screen-recording decision, so the next request prompts from scratch.
///
/// macOS ties the grant to the app's code signature. Lare's releases are not signed with a stable
/// Developer ID, so every build carries a different ad-hoc signature and the entry recorded against
/// the previous one stops matching after an update: capture is refused while System Settings still
/// lists Lare with the switch on. The stale entry has to be removed before the permission can be
/// granted again — which is what the "-" button under that list does, and what this does without
/// making anyone leave the app.
///
/// Signing releases with a Developer ID is the actual fix; the grant would then follow the
/// signature across updates and this would never need to be called.
#[cfg(target_os = "macos")]
pub fn reset_screen_recording(bundle_id: &str) -> Result<(), String> {
    let output = std::process::Command::new("tccutil")
        .args(["reset", "ScreenCapture", bundle_id])
        .output()
        .map_err(|e| format!("could not run tccutil: {e}"))?;
    if output.status.success() {
        tracing::info!(target: "lare_permissions", "reset screen-recording approval for {bundle_id}");
        return Ok(());
    }
    // tccutil reports "No such bundle identifier" when there is nothing to forget. That is the
    // desired end state, not a failure.
    let stderr = String::from_utf8_lossy(&output.stderr);
    if stderr.contains("No such bundle identifier") {
        tracing::info!(target: "lare_permissions", "no screen-recording entry to reset for {bundle_id}");
        return Ok(());
    }
    Err(format!("tccutil failed: {}", stderr.trim()))
}

#[cfg(not(target_os = "macos"))]
pub fn reset_screen_recording(_bundle_id: &str) -> Result<(), String> {
    Err("screen recording is not gated on this platform".to_string())
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
