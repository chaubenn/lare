//! A small, UI-friendly edit description that maps onto Cap's [`ProjectConfiguration`].
//!
//! The desktop editor never has to understand Cap's full project schema: it sends a
//! [`StudioEdit`] (kept ranges, camera PiP placement, background) and [`apply_edit`] produces
//! the configuration `cap-export` renders.

use cap_project::{
    AspectRatio, BackgroundSource, CameraPosition, CameraShape, CameraXPosition, CameraYPosition,
    ProjectConfiguration, TimelineConfiguration, TimelineSegment,
};
use serde::{Deserialize, Serialize};

/// A kept range of the *source* recording, in seconds.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TimeRange {
    pub start: f64,
    pub end: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "kebab-case")]
pub enum Corner {
    TopLeft,
    TopRight,
    BottomLeft,
    #[default]
    BottomRight,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct CameraEdit {
    pub hide: bool,
    pub position: Corner,
    /// Size as a percentage of the frame (Cap's scale, 20-60 is sensible).
    pub size: f32,
    /// Corner rounding, 0-100 (100 = circle for square shape).
    pub rounding: f32,
    pub mirror: bool,
    /// `true` keeps the camera's own aspect ratio instead of a square crop.
    pub keep_aspect: bool,
}

impl Default for CameraEdit {
    fn default() -> Self {
        Self {
            hide: false,
            position: Corner::BottomRight,
            size: 30.0,
            rounding: 100.0,
            mirror: false,
            keep_aspect: false,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum BackgroundEdit {
    /// Plain colour behind the recording (only visible with padding or aspect-ratio bars).
    Color { rgb: [u8; 3] },
    /// Cap's default wallpaper.
    Wallpaper,
}

impl Default for BackgroundEdit {
    fn default() -> Self {
        BackgroundEdit::Color { rgb: [0, 0, 0] }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Aspect {
    Wide,
    Vertical,
    Square,
    Classic,
    Tall,
}

impl From<Aspect> for AspectRatio {
    fn from(a: Aspect) -> Self {
        match a {
            Aspect::Wide => AspectRatio::Wide,
            Aspect::Vertical => AspectRatio::Vertical,
            Aspect::Square => AspectRatio::Square,
            Aspect::Classic => AspectRatio::Classic,
            Aspect::Tall => AspectRatio::Tall,
        }
    }
}

/// What the editor lets the user change.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct StudioEdit {
    /// Kept ranges of the source, in playback order. Empty = whole recording.
    pub segments: Vec<TimeRange>,
    pub camera: CameraEdit,
    pub background: BackgroundEdit,
    /// Padding around the recording as a percentage (0 = edge to edge).
    pub padding: f64,
    pub aspect_ratio: Option<Aspect>,
}

impl StudioEdit {
    /// Total output duration in seconds given the source duration (used for previews).
    pub fn output_duration(&self, source_duration_s: f64) -> f64 {
        if self.segments.is_empty() {
            return source_duration_s;
        }
        self.segments
            .iter()
            .map(|r| (r.end.min(source_duration_s) - r.start.max(0.0)).max(0.0))
            .sum()
    }
}

/// Normalise ranges: clamp to `[0, duration]`, drop empty/inverted ones, sort by start.
pub fn normalise_ranges(ranges: &[TimeRange], duration_s: f64) -> Vec<TimeRange> {
    let mut out: Vec<TimeRange> = ranges
        .iter()
        .map(|r| TimeRange {
            start: r.start.clamp(0.0, duration_s),
            end: r.end.clamp(0.0, duration_s),
        })
        .filter(|r| r.end - r.start > 0.05)
        .collect();
    out.sort_by(|a, b| a.start.partial_cmp(&b.start).unwrap_or(std::cmp::Ordering::Equal));
    out
}

/// Map kept ranges expressed on the concatenated recording (all clips back to back) onto Cap
/// timeline segments, which address one recording clip each. `clip_durations` are the clip
/// lengths in seconds, in recording order.
pub fn timeline_segments(ranges: &[TimeRange], clip_durations: &[f64]) -> Vec<TimelineSegment> {
    let total: f64 = clip_durations.iter().sum();
    let mut out = Vec::new();
    for r in normalise_ranges(ranges, total) {
        let mut offset = 0.0;
        for (clip, &len) in clip_durations.iter().enumerate() {
            let clip_start = offset;
            let clip_end = offset + len;
            offset = clip_end;
            let s = r.start.max(clip_start);
            let e = r.end.min(clip_end);
            if e - s > 0.05 {
                out.push(TimelineSegment {
                    recording_clip: clip as u32,
                    timescale: 1.0,
                    start: s - clip_start,
                    end: e - clip_start,
                    name: None,
                    speed_audio_mode: None,
                });
            }
        }
    }
    out
}

/// Build the Cap configuration for an edit. `base` is the project's saved configuration (or
/// `ProjectConfiguration::default()`); `clip_durations` are the recording clips' lengths in
/// seconds (one studio recording produces one clip per pause/resume stretch).
///
/// With no kept ranges the timeline is left unset so `cap-export` synthesises its default
/// (every clip, in full).
pub fn apply_edit(mut base: ProjectConfiguration, edit: &StudioEdit, clip_durations: &[f64]) -> ProjectConfiguration {
    let segments = timeline_segments(&edit.segments, clip_durations);
    base.timeline = if segments.is_empty() {
        None
    } else {
        Some(TimelineConfiguration {
            segments,
            transitions: Vec::new(),
            zoom_segments: Vec::new(),
            scene_segments: Vec::new(),
            mask_segments: Vec::new(),
            text_segments: Vec::new(),
            caption_segments: Vec::new(),
            keyboard_segments: Vec::new(),
            audio_segments: Vec::new(),
            camera3d_segments: Vec::new(),
        })
    };

    let cam = &edit.camera;
    base.camera.hide = cam.hide;
    base.camera.mirror = cam.mirror;
    base.camera.manual_position = None;
    base.camera.position = CameraPosition {
        x: match cam.position {
            Corner::TopLeft | Corner::BottomLeft => CameraXPosition::Left,
            Corner::TopRight | Corner::BottomRight => CameraXPosition::Right,
        },
        y: match cam.position {
            Corner::TopLeft | Corner::TopRight => CameraYPosition::Top,
            Corner::BottomLeft | Corner::BottomRight => CameraYPosition::Bottom,
        },
    };
    base.camera.size = cam.size.clamp(10.0, 80.0);
    base.camera.rounding = cam.rounding.clamp(0.0, 100.0);
    base.camera.shape = if cam.keep_aspect { CameraShape::Source } else { CameraShape::Square };

    base.background.padding = edit.padding.clamp(0.0, 40.0);
    base.background.source = match &edit.background {
        BackgroundEdit::Color { rgb } => BackgroundSource::Color {
            value: [rgb[0] as u16, rgb[1] as u16, rgb[2] as u16],
            alpha: 255,
        },
        BackgroundEdit::Wallpaper => BackgroundSource::default(),
    };
    base.aspect_ratio = edit.aspect_ratio.map(Into::into);
    base
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_edit_leaves_timeline_to_cap_default() {
        let cfg = apply_edit(ProjectConfiguration::default(), &StudioEdit::default(), &[12.5]);
        assert!(cfg.timeline.is_none());
    }

    #[test]
    fn ranges_are_clamped_sorted_and_filtered() {
        let edit = StudioEdit {
            segments: vec![
                TimeRange { start: 8.0, end: 30.0 },
                TimeRange { start: 3.0, end: 3.01 },
                TimeRange { start: -1.0, end: 2.0 },
            ],
            ..Default::default()
        };
        let cfg = apply_edit(ProjectConfiguration::default(), &edit, &[10.0]);
        let segs = cfg.timeline.unwrap().segments;
        assert_eq!(segs.len(), 2);
        assert_eq!((segs[0].start, segs[0].end), (0.0, 2.0));
        assert_eq!((segs[1].start, segs[1].end), (8.0, 10.0));
        assert!((edit.output_duration(10.0) - 4.01).abs() < 1e-9);
    }

    #[test]
    fn ranges_split_across_recording_clips() {
        // Two clips (a pause in between): 10 s + 5 s. Keep 8 s..13 s of the concatenated recording.
        let segs = timeline_segments(&[TimeRange { start: 8.0, end: 13.0 }], &[10.0, 5.0]);
        assert_eq!(segs.len(), 2);
        assert_eq!(segs[0].recording_clip, 0);
        assert_eq!((segs[0].start, segs[0].end), (8.0, 10.0));
        assert_eq!(segs[1].recording_clip, 1);
        assert_eq!((segs[1].start, segs[1].end), (0.0, 3.0));
    }

    #[test]
    fn camera_corner_maps_to_cap_position() {
        let edit = StudioEdit {
            camera: CameraEdit {
                position: Corner::TopLeft,
                size: 500.0,
                ..Default::default()
            },
            ..Default::default()
        };
        let cfg = apply_edit(ProjectConfiguration::default(), &edit, &[1.0]);
        assert!(matches!(cfg.camera.position.x, CameraXPosition::Left));
        assert!(matches!(cfg.camera.position.y, CameraYPosition::Top));
        assert_eq!(cfg.camera.size, 80.0);
    }

    #[test]
    fn edit_round_trips_through_json_with_defaults() {
        let edit: StudioEdit = serde_json::from_str(r#"{"segments":[{"start":1,"end":2}]}"#).unwrap();
        assert_eq!(edit.camera.position, Corner::BottomRight);
        assert_eq!(edit.background, BackgroundEdit::Color { rgb: [0, 0, 0] });
        let json = serde_json::to_string(&edit).unwrap();
        assert!(json.contains(r#""position":"bottom-right""#));
    }
}
