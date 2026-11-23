//! The facecam bubble's shape, size and place on screen, and where they are kept between takes.
//!
//! The bubble is its own window (see [`crate::windows::open_camera`]) and is captured as part of
//! the screen, so its geometry *is* the window's geometry. This module owns that geometry: the
//! webview only asks for a shape and a height, and reports when the user has moved it.

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tracing::warn;

use crate::sync::lock;

/// Transparent margin around the bubble, on every side, so its border is not clipped by the
/// window edge. The camera window's root has the same padding (`p-1` in `CameraWindow.tsx`).
pub const PAD: f64 = 4.0;
/// Bounds of the bubble's height in points. The low end still fits the hover toolbar inside a
/// circle; the high end keeps a 16:9 bubble inside a laptop screen.
pub const MIN_HEIGHT: f64 = 140.0;
pub const MAX_HEIGHT: f64 = 440.0;
/// The 212pt circle the bubble has always been (a 220pt window).
const DEFAULT_HEIGHT: f64 = 212.0;
/// Gap between the bubble and the screen edge it is first placed against.
const DEFAULT_MARGIN: f64 = 16.0;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum CameraShape {
    #[default]
    Circle,
    Square,
    /// 16:9, the shape of the camera's own picture.
    Rectangle,
    /// 4:3 with deep, soft corners.
    Pillow,
}

impl CameraShape {
    /// Width over height.
    fn aspect(self) -> f64 {
        match self {
            Self::Circle | Self::Square => 1.0,
            Self::Rectangle => 16.0 / 9.0,
            Self::Pillow => 4.0 / 3.0,
        }
    }
}

/// The work-area corner the bubble is kept against. Resizing grows it away from this corner, and
/// a smaller or larger screen next time keeps it the same distance from it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Corner {
    TopLeft,
    TopRight,
    BottomLeft,
    #[default]
    BottomRight,
}

impl Corner {
    fn right(self) -> bool {
        matches!(self, Self::TopRight | Self::BottomRight)
    }
    fn bottom(self) -> bool {
        matches!(self, Self::BottomLeft | Self::BottomRight)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct CameraLayout {
    pub shape: CameraShape,
    /// The bubble's height in points, without [`PAD`].
    pub height: f64,
    pub corner: Corner,
    /// Distance in points from the window to the two work-area edges that meet at `corner`.
    pub dx: f64,
    pub dy: f64,
}

impl Default for CameraLayout {
    fn default() -> Self {
        Self {
            shape: CameraShape::Circle,
            height: DEFAULT_HEIGHT,
            corner: Corner::BottomRight,
            dx: DEFAULT_MARGIN,
            dy: DEFAULT_MARGIN,
        }
    }
}

/// A rectangle in logical points.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Rect {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

pub fn clamp_height(height: f64) -> f64 {
    if height.is_finite() {
        height.clamp(MIN_HEIGHT, MAX_HEIGHT)
    } else {
        DEFAULT_HEIGHT
    }
}

/// The window size for a shape at a height, margin included.
pub fn window_size(shape: CameraShape, height: f64) -> (f64, f64) {
    let h = clamp_height(height);
    ((h * shape.aspect()).round() + 2.0 * PAD, h + 2.0 * PAD)
}

/// Where the window goes in `area`: `dx`/`dy` from the layout's corner, pulled back inside when
/// the area is too small for that.
pub fn place(layout: &CameraLayout, area: Rect) -> Rect {
    let (w, h) = window_size(layout.shape, layout.height);
    let x = if layout.corner.right() {
        area.x + area.w - w - layout.dx
    } else {
        area.x + layout.dx
    };
    let y = if layout.corner.bottom() {
        area.y + area.h - h - layout.dy
    } else {
        area.y + layout.dy
    };
    let x = x.min(area.x + area.w - w).max(area.x);
    let y = y.min(area.y + area.h - h).max(area.y);
    Rect { x, y, w, h }
}

/// The window resized to `size` with the layout's corner held still, kept inside `area`.
pub fn resize_from_corner(window: Rect, corner: Corner, size: (f64, f64), area: Rect) -> Rect {
    let (w, h) = size;
    let x = if corner.right() {
        window.x + window.w - w
    } else {
        window.x
    };
    let y = if corner.bottom() {
        window.y + window.h - h
    } else {
        window.y
    };
    let x = x.min(area.x + area.w - w).max(area.x);
    let y = y.min(area.y + area.h - h).max(area.y);
    Rect { x, y, w, h }
}

/// The corner nearest the window's centre, and how far the window sits from it.
pub fn anchor(window: Rect, area: Rect) -> (Corner, f64, f64) {
    let right = window.x + window.w / 2.0 > area.x + area.w / 2.0;
    let bottom = window.y + window.h / 2.0 > area.y + area.h / 2.0;
    let corner = match (right, bottom) {
        (false, false) => Corner::TopLeft,
        (true, false) => Corner::TopRight,
        (false, true) => Corner::BottomLeft,
        (true, true) => Corner::BottomRight,
    };
    let dx = if right {
        area.x + area.w - (window.x + window.w)
    } else {
        window.x - area.x
    };
    let dy = if bottom {
        area.y + area.h - (window.y + window.h)
    } else {
        window.y - area.y
    };
    (corner, dx.max(0.0), dy.max(0.0))
}

/// The layout in use, and the file it is saved to.
pub struct CameraStore {
    path: PathBuf,
    layout: Mutex<CameraLayout>,
}

impl CameraStore {
    pub fn new(data_dir: &Path) -> Self {
        let path = data_dir.join("camera-layout.json");
        let layout = std::fs::read_to_string(&path)
            .ok()
            .and_then(|text| {
                serde_json::from_str(&text)
                    .map_err(|error| {
                        warn!(path = %path.display(), %error, "camera layout does not parse; using the default");
                    })
                    .ok()
            })
            .unwrap_or_default();
        Self {
            path,
            layout: Mutex::new(layout),
        }
    }

    pub fn get(&self) -> CameraLayout {
        *lock(&self.layout)
    }

    /// Replace the layout in memory only: a resize sends one of these per frame.
    pub fn set(&self, layout: CameraLayout) {
        *lock(&self.layout) = layout;
    }

    /// Replace the layout and write it out, for the next take and the next launch.
    pub fn save(&self, layout: CameraLayout) {
        self.set(layout);
        let written = self
            .path
            .parent()
            .map_or(Ok(()), std::fs::create_dir_all)
            .and_then(|()| {
                let json = serde_json::to_string_pretty(&layout).map_err(std::io::Error::other)?;
                std::fs::write(&self.path, json)
            });
        if let Err(error) = written {
            warn!(path = %self.path.display(), %error, "could not save the camera layout");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const AREA: Rect = Rect {
        x: 0.0,
        y: 25.0,
        w: 1440.0,
        h: 800.0,
    };

    #[test]
    fn the_default_is_the_old_bottom_right_circle() {
        let r = place(&CameraLayout::default(), AREA);
        assert_eq!(
            r,
            Rect {
                x: 1440.0 - 220.0 - 16.0,
                y: 25.0 + 800.0 - 220.0 - 16.0,
                w: 220.0,
                h: 220.0
            }
        );
    }

    #[test]
    fn a_moved_window_comes_back_to_the_same_place() {
        let window = Rect {
            x: 100.0,
            y: 60.0,
            w: 220.0,
            h: 220.0,
        };
        let (corner, dx, dy) = anchor(window, AREA);
        assert_eq!(corner, Corner::TopLeft);
        let layout = CameraLayout {
            corner,
            dx,
            dy,
            ..CameraLayout::default()
        };
        assert_eq!(place(&layout, AREA), window);
    }

    #[test]
    fn keeps_its_distance_from_the_corner_on_another_screen() {
        let layout = CameraLayout {
            corner: Corner::BottomRight,
            dx: 40.0,
            dy: 30.0,
            ..CameraLayout::default()
        };
        let small = Rect {
            x: 0.0,
            y: 0.0,
            w: 1024.0,
            h: 700.0,
        };
        let r = place(&layout, small);
        assert_eq!((r.x + r.w, r.y + r.h), (1024.0 - 40.0, 700.0 - 30.0));
    }

    #[test]
    fn stays_on_screen_when_the_offset_no_longer_fits() {
        let layout = CameraLayout {
            corner: Corner::TopLeft,
            dx: 5000.0,
            dy: -50.0,
            ..CameraLayout::default()
        };
        let r = place(&layout, AREA);
        assert_eq!((r.x, r.y), (AREA.x + AREA.w - r.w, AREA.y));
    }

    #[test]
    fn resizing_holds_the_anchored_corner() {
        let window = Rect {
            x: 1000.0,
            y: 500.0,
            w: 220.0,
            h: 220.0,
        };
        let size = window_size(CameraShape::Rectangle, 300.0);
        let r = resize_from_corner(window, Corner::BottomRight, size, AREA);
        assert_eq!((r.x + r.w, r.y + r.h), (1220.0, 720.0));
        // Growing right from the top-left corner would leave the screen, so it is pulled back.
        let r = resize_from_corner(window, Corner::TopLeft, size, AREA);
        assert_eq!((r.x, r.y, r.w), (1440.0 - 541.0, 500.0, 541.0));
    }

    #[test]
    fn height_is_bounded() {
        assert_eq!(
            window_size(CameraShape::Circle, 10.0).1,
            MIN_HEIGHT + 2.0 * PAD
        );
        assert_eq!(
            window_size(CameraShape::Circle, 1e6).1,
            MAX_HEIGHT + 2.0 * PAD
        );
        assert_eq!(
            window_size(CameraShape::Circle, f64::NAN).1,
            DEFAULT_HEIGHT + 2.0 * PAD
        );
    }

    #[test]
    fn shapes_have_their_aspect() {
        assert_eq!(window_size(CameraShape::Square, 200.0), (208.0, 208.0));
        assert_eq!(window_size(CameraShape::Rectangle, 180.0), (328.0, 188.0));
        assert_eq!(window_size(CameraShape::Pillow, 180.0), (248.0, 188.0));
    }

    #[test]
    fn an_old_or_partial_file_still_loads() {
        let layout: CameraLayout = serde_json::from_str(r#"{"shape":"pillow"}"#).unwrap();
        assert_eq!(layout.shape, CameraShape::Pillow);
        assert_eq!(layout.height, DEFAULT_HEIGHT);
        assert_eq!(layout.corner, Corner::BottomRight);
    }
}
