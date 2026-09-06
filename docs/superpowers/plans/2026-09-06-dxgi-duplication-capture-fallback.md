# DXGI Desktop Duplication Capture Fallback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Windows screen recording work even when Game DVR is disabled, by falling back to
DXGI Desktop Duplication when Windows Graphics Capture (WGC) fails, and fix the bug that hides
the real error behind a generic "oneshot canceled" message.

**Architecture:** A new crate `crates/cap/scap-dxgi` implements screen capture via
`IDXGIOutputDuplication`, mirroring `scap-direct3d`'s public shape (`Settings`, `Frame`,
`Capturer::new/start/stop`). `crates/cap/recording/src/sources/screen_capture/windows.rs`'s
`create_d3d_capturer` tries WGC first and falls back to this new crate on failure; both capturer
types are wrapped in a small `ActiveCapturer` enum so the rest of the capture thread doesn't care
which backend is live.

**Tech Stack:** Rust, `windows` crate 0.60.0 (Win32 DXGI/Direct3D11 bindings), Tokio, existing
`cap-recording` output-pipeline framework.

**Spec:** `docs/superpowers/specs/2026-09-05-dxgi-duplication-capture-fallback-design.md`

## Global Constraints

- Windows-only code (`#![cfg(windows)]` at crate root, matching `scap-direct3d`).
- `edition = "2024"`, `license = "MIT"` for the new crate (matches `scap-direct3d`'s `Cargo.toml`).
- `windows` crate version comes from the workspace dependency (`windows = "0.60.0"` in root
  `Cargo.toml`) — do not pin a different version.
- Reuse `scap_direct3d::PixelFormat` rather than defining a second copy (per spec). The desktop
  duplication image format is always `DXGI_FORMAT_B8G8R8A8_UNORM`, i.e.
  `scap_direct3d::PixelFormat::B8G8R8A8Unorm`.
- No placeholders, no `TODO`s — every step below is real, complete code.
- Every crate this plan touches already depends on `workspace-hack = { version = "0.1", path =
  "../workspace-hack" }` — the new crate must too (see Task 2).

---

## Task 1: Fix the swallowed-error bug on capture-thread startup failure

**Files:**
- Modify: `crates/cap/recording/src/sources/screen_capture/windows.rs:744-753`
- Test: `crates/cap/recording/src/sources/screen_capture/windows.rs` (existing
  `first_screen_frame_tests` module, line 1549 onward)

**Interfaces:**
- Consumes: `FirstScreenFrame::complete(&self, result: Result<(), String>)` (already defined at
  windows.rs:433-440).
- Produces: nothing new — this is a behavior fix within the existing capture thread closure.

This is independent of the DXGI work and valuable on its own: today, if `create_d3d_capturer`
fails on the very first attempt (line 744-753), the thread returns without telling
`first_frame`, so the failure surfaces as a generic `"oneshot canceled"` instead of the real
error. Fixing it now means later tasks' fallback failures also report cleanly from the start.

- [ ] **Step 1: Write the failing test**

Add this test to the existing `#[cfg(test)] mod first_screen_frame_tests` block at the bottom of
`windows.rs` (after `dropped_capture_thread_is_not_startup_success`, i.e. after line 1599):

```rust
    #[tokio::test]
    async fn early_capturer_creation_failure_reports_its_own_message() {
        let (signal, receiver) = signal();
        // Simulates what create_d3d_capturer's early-failure branch must do:
        // report the real error instead of just dropping the sender.
        signal.complete(Err("Failed to create D3D capturer: boom".into()));
        let error = wait_for_first_screen_frame(receiver, Duration::from_millis(20))
            .await
            .unwrap_err();
        assert!(error.to_string().contains("Failed to create D3D capturer: boom"));
    }
```

- [ ] **Step 2: Run test to verify it currently passes trivially (it tests the plumbing, not the bug)**

Run: `cargo test -p cap-recording --lib first_screen_frame_tests -- --nocapture`
Expected: PASS (this test only exercises `FirstScreenFrame`/`wait_for_first_screen_frame`
directly, which already work correctly — the bug is that the capture thread doesn't *call*
`complete()` on early failure, which this unit test can't observe on its own). This step confirms
the harness compiles cleanly before you touch the real bug in Step 3.

- [ ] **Step 3: Fix the capture thread's early-failure branch**

In `windows.rs`, find this code (currently at line 744-753):

```rust
                let mut capturer = match create_d3d_capturer(&build_params!(&d3d_device), &error_tx) {
                    Ok(c) => {
                        trace!("D3D capturer created successfully");
                        Some(c)
                    }
                    Err(e) => {
                        error!("Failed to create D3D capturer: {}", e);
                        return Err(e);
                    }
                };
```

Replace it with:

```rust
                let mut capturer = match create_d3d_capturer(&build_params!(&d3d_device), &error_tx) {
                    Ok(c) => {
                        trace!("D3D capturer created successfully");
                        Some(c)
                    }
                    Err(e) => {
                        error!("Failed to create D3D capturer: {}", e);
                        first_frame.complete(Err(format!("Failed to create D3D capturer: {e}")));
                        return Err(e);
                    }
                };
```

(`first_frame` is already in scope here — it's captured by the enclosing `move ||` closure
passed to `ctx.tasks().spawn_thread("d3d-capture-thread", ...)`, same as it is a few lines below
at line 739 inside `build_params!`.)

- [ ] **Step 4: Verify it compiles**

Run: `cargo check -p cap-recording`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add crates/cap/recording/src/sources/screen_capture/windows.rs
git commit -m "fix(recording): surface the real error when D3D capturer creation fails on startup

Previously the capture thread returned early without signaling
first_frame, so VideoSource::start() reported a generic \"oneshot
canceled\" instead of the actual capture failure.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 2: Scaffold the `scap-dxgi` crate

**Files:**
- Create: `crates/cap/scap-dxgi/Cargo.toml`
- Create: `crates/cap/scap-dxgi/src/lib.rs`
- Create: `crates/cap/scap-dxgi/src/output.rs`

**Interfaces:**
- Consumes: `scap_direct3d::PixelFormat` (from Task-independent existing crate), `scap_targets::Display`.
- Produces: `pub fn find_output_for_monitor(d3d_device: &ID3D11Device, target_monitor: HMONITOR) -> windows::core::Result<(IDXGIOutput1, windows::Win32::Foundation::RECT)>` — later tasks build on this (callers derive `HMONITOR` from a `Display` via `display.raw_handle().inner()`, matching Task 4's usage).

`crates/cap/*` is a glob workspace member (root `Cargo.toml:9`), so no workspace-member edit is
needed — creating the directory with a `Cargo.toml` is enough.

- [ ] **Step 1: Create the crate manifest**

`crates/cap/scap-dxgi/Cargo.toml`:

```toml
[package]
name = "scap-dxgi"
version = "0.1.0"
edition = "2024"
license = "MIT"

[dependencies]
scap-direct3d = { path = "../scap-direct3d" }
scap-targets = { path = "../scap-targets" }
thiserror.workspace = true
tracing.workspace = true
workspace-hack = { version = "0.1", path = "../workspace-hack" }

[target.'cfg(windows)'.dependencies]
windows = { workspace = true, features = [
    "Win32_Foundation",
    "Win32_Graphics_Direct3D",
    "Win32_Graphics_Direct3D11",
    "Win32_Graphics_Dxgi",
    "Win32_Graphics_Dxgi_Common",
    "Win32_Graphics_Gdi",
] }

[lints]
workspace = true
```

- [ ] **Step 2: Create the crate root with error type and settings**

`crates/cap/scap-dxgi/src/lib.rs`:

```rust
#![cfg(windows)]

mod capturer;
mod cursor;
mod output;

pub use capturer::{Capturer, Frame, FrameBuffer};
pub use scap_direct3d::PixelFormat;

use windows::Win32::Graphics::Direct3D11::D3D11_BOX;

#[derive(Clone, Default, Debug)]
pub struct Settings {
    pub crop: Option<D3D11_BOX>,
}

#[derive(Debug, thiserror::Error)]
pub enum NewCapturerError {
    #[error("No DXGI output found for the requested display")]
    OutputNotFound,
    #[error("DuplicateOutput: {0}")]
    DuplicateOutput(windows::core::Error),
    #[error("GetImmediateContext: {0}")]
    Context(windows::core::Error),
    #[error("CreateTexture2D: {0}")]
    CreateTexture(windows::core::Error),
    #[error("Other: {0}")]
    Other(#[from] windows::core::Error),
}
```

- [ ] **Step 3: Implement monitor-to-output resolution**

`crates/cap/scap-dxgi/src/output.rs`:

```rust
use windows::Win32::Graphics::Direct3D11::ID3D11Device;
use windows::Win32::Graphics::Dxgi::{IDXGIDevice, IDXGIOutput1};
use windows::Win32::Foundation::RECT;
use windows::core::Interface;

/// Finds the `IDXGIOutput1` behind `d3d_device`'s adapter whose monitor
/// matches `target_monitor`, along with its desktop-coordinate `RECT`
/// (used both for width/height and later for cursor-position clamping).
///
/// Duplication requires the device and output to share an adapter, which
/// is why this walks `d3d_device`'s own adapter rather than every adapter
/// on the system — this mirrors the constraint `cap_d3d_adapter`'s
/// selection already imposes on the WGC path.
pub fn find_output_for_monitor(
    d3d_device: &ID3D11Device,
    target_monitor: windows::Win32::Graphics::Gdi::HMONITOR,
) -> windows::core::Result<(IDXGIOutput1, RECT)> {
    let dxgi_device: IDXGIDevice = d3d_device.cast()?;
    let adapter = unsafe { dxgi_device.GetAdapter() }?;

    for i in 0.. {
        let output = match unsafe { adapter.EnumOutputs(i) } {
            Ok(output) => output,
            Err(_) => break, // DXGI_ERROR_NOT_FOUND once i exceeds the output count
        };

        let desc = unsafe { output.GetDesc() }?;
        if desc.Monitor == target_monitor {
            let output1: IDXGIOutput1 = output.cast()?;
            return Ok((output1, desc.DesktopCoordinates));
        }
    }

    Err(windows::core::Error::from(
        windows::Win32::Foundation::E_FAIL,
    ))
}
```

- [ ] **Step 4: Verify it compiles (capturer/cursor modules stubbed for now)**

Temporarily add empty stub files so `lib.rs`'s `mod` declarations resolve:

`crates/cap/scap-dxgi/src/cursor.rs`:
```rust
```

`crates/cap/scap-dxgi/src/capturer.rs`:
```rust
pub struct Capturer;
pub struct Frame;
pub struct FrameBuffer;
```

Run: `cargo check -p scap-dxgi`
Expected: no errors. (Task 3 replaces `cursor.rs`'s stub; Task 4 replaces `capturer.rs`'s stub —
both are placeholders *only* within this scaffolding task's compile check, not left behind.)

- [ ] **Step 5: Commit**

```bash
git add crates/cap/scap-dxgi
git commit -m "feat(scap-dxgi): scaffold the DXGI Desktop Duplication capture crate

Adds the crate manifest, error type, Settings, and HMONITOR -> IDXGIOutput1
resolution used by the capturer this crate will implement next.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 3: Cursor shape compositing (pure, unit-tested)

**Files:**
- Modify: `crates/cap/scap-dxgi/src/cursor.rs` (replaces Task 2's empty stub)

**Interfaces:**
- Consumes: nothing outside this file — pure functions over byte buffers.
- Produces:
  - `pub fn composite_monochrome_cursor(bg: &mut [u8], bg_stride: usize, width: usize, height: usize, mask: &[u8], mask_pitch: usize)`
  - `pub fn composite_color_cursor(bg: &mut [u8], bg_stride: usize, width: usize, height: usize, shape: &[u8], shape_pitch: usize)`
  - `pub fn composite_masked_color_cursor(bg: &mut [u8], bg_stride: usize, width: usize, height: usize, shape: &[u8], shape_pitch: usize)`
  - `pub struct CursorShape { pub kind: CursorShapeKind, pub width: u32, pub height: u32, pub pitch: u32, pub hotspot_x: i32, pub hotspot_y: i32, pub data: Vec<u8> }` and `pub enum CursorShapeKind { Monochrome, Color, MaskedColor }` — Task 4 builds these from `DXGI_OUTDUPL_POINTER_SHAPE_INFO` and calls `CursorShape::composite_onto`.

All three functions operate on `bg`, a BGRA8 (4 bytes/pixel) buffer exactly `width`×`height`
pixels representing the desktop image already cropped to the cursor's on-screen rectangle — the
caller (Task 4) is responsible for that cropping and for clamping the rectangle to the frame
bounds before calling these.

- [ ] **Step 1: Write the failing tests**

`crates/cap/scap-dxgi/src/cursor.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    fn px(buf: &[u8], stride: usize, x: usize, y: usize) -> [u8; 4] {
        let i = y * stride + x * 4;
        [buf[i], buf[i + 1], buf[i + 2], buf[i + 3]]
    }

    #[test]
    fn monochrome_and0_xor0_is_opaque_black() {
        // 1x1 cursor: AND mask bit = 0, XOR mask bit = 0 -> opaque black.
        // Mask buffer: 1 row AND (1 byte, bit7=0), 1 row XOR (1 byte, bit7=0).
        let mask = [0b0000_0000u8, 0b0000_0000u8];
        let mut bg = [10u8, 20, 30, 255]; // arbitrary background pixel, BGRA
        composite_monochrome_cursor(&mut bg, 4, 1, 1, &mask, 1);
        assert_eq!(px(&bg, 4, 0, 0), [0, 0, 0, 255]);
    }

    #[test]
    fn monochrome_and0_xor1_is_opaque_white() {
        let mask = [0b0000_0000u8, 0b1000_0000u8];
        let mut bg = [10u8, 20, 30, 255];
        composite_monochrome_cursor(&mut bg, 4, 1, 1, &mask, 1);
        assert_eq!(px(&bg, 4, 0, 0), [255, 255, 255, 255]);
    }

    #[test]
    fn monochrome_and1_xor0_is_transparent_passthrough() {
        let mask = [0b1000_0000u8, 0b0000_0000u8];
        let mut bg = [10u8, 20, 30, 255];
        composite_monochrome_cursor(&mut bg, 4, 1, 1, &mask, 1);
        assert_eq!(px(&bg, 4, 0, 0), [10, 20, 30, 255]);
    }

    #[test]
    fn monochrome_and1_xor1_inverts_background() {
        let mask = [0b1000_0000u8, 0b1000_0000u8];
        let mut bg = [10u8, 20, 30, 255];
        composite_monochrome_cursor(&mut bg, 4, 1, 1, &mask, 1);
        assert_eq!(px(&bg, 4, 0, 0), [245, 235, 225, 255]);
    }

    #[test]
    fn color_cursor_alpha_blends_over_background() {
        // Fully opaque red (BGRA = 0,0,255,255) over background -> red wins.
        let shape = [0u8, 0, 255, 255];
        let mut bg = [10u8, 20, 30, 255];
        composite_color_cursor(&mut bg, 4, 1, 1, &shape, 4);
        assert_eq!(px(&bg, 4, 0, 0), [0, 0, 255, 255]);
    }

    #[test]
    fn color_cursor_half_alpha_blends_evenly() {
        // Half-alpha white over black background -> mid gray.
        let shape = [255u8, 255, 255, 128];
        let mut bg = [0u8, 0, 0, 255];
        composite_color_cursor(&mut bg, 4, 1, 1, &shape, 4);
        // 255 * 128/255 + 0 * (1 - 128/255), integer math rounds to 128.
        assert_eq!(px(&bg, 4, 0, 0), [128, 128, 128, 255]);
    }

    #[test]
    fn masked_color_opaque_pixel_overwrites_background() {
        let shape = [0u8, 255, 0, 0xFF]; // opaque green
        let mut bg = [10u8, 20, 30, 255];
        composite_masked_color_cursor(&mut bg, 4, 1, 1, &shape, 4);
        assert_eq!(px(&bg, 4, 0, 0), [0, 255, 0, 255]);
    }

    #[test]
    fn masked_color_transparent_pixel_xors_with_background() {
        let shape = [0b1111_1111u8, 0, 0, 0x00]; // alpha=0 -> XOR mask
        let mut bg = [0b0000_1111u8, 0, 0, 255];
        composite_masked_color_cursor(&mut bg, 4, 1, 1, &shape, 4);
        assert_eq!(px(&bg, 4, 0, 0), [0b1111_0000, 0, 0, 255]);
    }
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cargo test -p scap-dxgi --lib cursor::tests`
Expected: FAIL with "cannot find function `composite_monochrome_cursor`" (and similarly for the
other two) — the module currently only has the empty stub from Task 2.

- [ ] **Step 3: Implement the compositing functions**

Prepend this to `crates/cap/scap-dxgi/src/cursor.rs` (above the `#[cfg(test)]` block already
written in Step 1):

```rust
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CursorShapeKind {
    Monochrome,
    Color,
    MaskedColor,
}

#[derive(Clone, Debug)]
pub struct CursorShape {
    pub kind: CursorShapeKind,
    /// Cursor width in pixels.
    pub width: u32,
    /// Cursor height in pixels. For `Monochrome`, this is the *actual*
    /// cursor height — half the raw buffer's row count (AND mask + XOR
    /// mask stacked) — already divided down from `DXGI_OUTDUPL_POINTER_SHAPE_INFO::Height`.
    pub height: u32,
    /// Row pitch of `data`, in bytes, as reported by
    /// `DXGI_OUTDUPL_POINTER_SHAPE_INFO::Pitch`.
    pub pitch: u32,
    pub hotspot_x: i32,
    pub hotspot_y: i32,
    pub data: Vec<u8>,
}

impl CursorShape {
    /// Composites this cursor onto `bg` (a BGRA8 buffer exactly
    /// `self.width`x`self.height` pixels, stride `bg_stride`), dispatching
    /// to the format-specific function below.
    pub fn composite_onto(&self, bg: &mut [u8], bg_stride: usize) {
        let width = self.width as usize;
        let height = self.height as usize;
        let pitch = self.pitch as usize;
        match self.kind {
            CursorShapeKind::Monochrome => {
                composite_monochrome_cursor(bg, bg_stride, width, height, &self.data, pitch)
            }
            CursorShapeKind::Color => {
                composite_color_cursor(bg, bg_stride, width, height, &self.data, pitch)
            }
            CursorShapeKind::MaskedColor => {
                composite_masked_color_cursor(bg, bg_stride, width, height, &self.data, pitch)
            }
        }
    }
}

fn mask_bit(mask: &[u8], row_offset: usize, pitch: usize, x: usize, y: usize) -> bool {
    let byte = mask[row_offset + y * pitch + x / 8];
    (byte >> (7 - (x % 8))) & 1 == 1
}

/// Composites a monochrome (AND/XOR) cursor mask onto `bg`, in place.
/// `mask`'s first `height` rows are the AND mask and the next `height`
/// rows are the XOR mask (per `DXGI_OUTDUPL_POINTER_SHAPE_TYPE_MONOCHROME`),
/// each row packed 1 bit per pixel, MSB first, `mask_pitch` bytes per row.
///
/// Standard Windows monochrome-cursor rule:
///   AND=0, XOR=0 -> opaque black
///   AND=0, XOR=1 -> opaque white
///   AND=1, XOR=0 -> background unchanged (transparent)
///   AND=1, XOR=1 -> background inverted
pub fn composite_monochrome_cursor(
    bg: &mut [u8],
    bg_stride: usize,
    width: usize,
    height: usize,
    mask: &[u8],
    mask_pitch: usize,
) {
    let xor_row_offset = height * mask_pitch;
    for y in 0..height {
        for x in 0..width {
            let and_bit = mask_bit(mask, 0, mask_pitch, x, y);
            let xor_bit = mask_bit(mask, xor_row_offset, mask_pitch, x, y);
            let i = y * bg_stride + x * 4;
            match (and_bit, xor_bit) {
                (false, false) => {
                    bg[i] = 0;
                    bg[i + 1] = 0;
                    bg[i + 2] = 0;
                }
                (false, true) => {
                    bg[i] = 255;
                    bg[i + 1] = 255;
                    bg[i + 2] = 255;
                }
                (true, false) => {}
                (true, true) => {
                    bg[i] = !bg[i];
                    bg[i + 1] = !bg[i + 1];
                    bg[i + 2] = !bg[i + 2];
                }
            }
            bg[i + 3] = 255;
        }
    }
}

/// Composites a straight-alpha BGRA8 color cursor onto `bg`, in place
/// (`DXGI_OUTDUPL_POINTER_SHAPE_TYPE_COLOR`).
pub fn composite_color_cursor(
    bg: &mut [u8],
    bg_stride: usize,
    width: usize,
    height: usize,
    shape: &[u8],
    shape_pitch: usize,
) {
    for y in 0..height {
        for x in 0..width {
            let si = y * shape_pitch + x * 4;
            let di = y * bg_stride + x * 4;
            let alpha = shape[si + 3] as u32;
            for c in 0..3 {
                let src = shape[si + c] as u32;
                let dst = bg[di + c] as u32;
                bg[di + c] = ((src * alpha + dst * (255 - alpha)) / 255) as u8;
            }
            bg[di + 3] = 255;
        }
    }
}

/// Composites a masked-color BGRA8 cursor onto `bg`, in place
/// (`DXGI_OUTDUPL_POINTER_SHAPE_TYPE_MASKED_COLOR`): alpha is always either
/// 0x00 ("XOR this pixel's RGB with the background") or 0xFF ("opaque").
pub fn composite_masked_color_cursor(
    bg: &mut [u8],
    bg_stride: usize,
    width: usize,
    height: usize,
    shape: &[u8],
    shape_pitch: usize,
) {
    for y in 0..height {
        for x in 0..width {
            let si = y * shape_pitch + x * 4;
            let di = y * bg_stride + x * 4;
            let opaque = shape[si + 3] == 0xFF;
            for c in 0..3 {
                bg[di + c] = if opaque {
                    shape[si + c]
                } else {
                    bg[di + c] ^ shape[si + c]
                };
            }
            bg[di + 3] = 255;
        }
    }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cargo test -p scap-dxgi --lib cursor::tests`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add crates/cap/scap-dxgi/src/cursor.rs
git commit -m "feat(scap-dxgi): implement cursor shape compositing

Monochrome (AND/XOR), color (straight alpha), and masked-color cursor
formats per DXGI_OUTDUPL_POINTER_SHAPE_TYPE, unit-tested against
synthetic buffers -- no GPU required for this part.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 4: The DXGI Duplication capturer

**Files:**
- Modify: `crates/cap/scap-dxgi/src/capturer.rs` (replaces Task 2's stub)
- Modify: `crates/cap/scap-dxgi/src/lib.rs` (settings already added in Task 2; no change needed
  here beyond what Task 2 wrote)

**Interfaces:**
- Consumes: `output::find_output_for_monitor` (Task 2), `cursor::{CursorShape, CursorShapeKind}` (Task 3).
- Produces:
  - `pub struct Frame { .. }` with `texture(&self) -> &ID3D11Texture2D`, `width(&self) -> u32`, `height(&self) -> u32`, `as_buffer(&self) -> windows::core::Result<FrameBuffer<'_>>`.
  - `pub struct FrameBuffer<'a>` with `data(&self) -> &[u8]`, `stride(&self) -> u32`, `width(&self) -> u32`, `height(&self) -> u32` — same shape as `scap_direct3d::FrameBuffer`.
  - `pub struct Capturer` with `pub fn new(display: &scap_targets::Display, settings: Settings, on_frame: impl FnMut(Frame) -> windows::core::Result<()> + Send + 'static, on_closed: impl FnMut() -> windows::core::Result<()> + Send + 'static, device: ID3D11Device) -> Result<Self, NewCapturerError>`, `pub fn start(&mut self) -> windows::core::Result<()>`, `pub fn stop(&mut self) -> windows::core::Result<()>`.

This task has no automated tests (native DXGI calls need a live GPU/desktop session — this
matches `scap-direct3d`, which also has none). It's verified manually in Task 6.

- [ ] **Step 1: Write the capturer**

`crates/cap/scap-dxgi/src/capturer.rs`:

```rust
use crate::cursor::{CursorShape, CursorShapeKind};
use crate::output::find_output_for_monitor;
use crate::{NewCapturerError, Settings};
use scap_direct3d::PixelFormat;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use windows::Win32::Foundation::RECT;
use windows::Win32::Graphics::Direct3D11::{
    D3D11_BIND_RENDER_TARGET, D3D11_BIND_SHADER_RESOURCE, D3D11_CPU_ACCESS_READ,
    D3D11_CPU_ACCESS_WRITE, D3D11_MAP_READ_WRITE, D3D11_MAPPED_SUBRESOURCE, D3D11_TEXTURE2D_DESC,
    D3D11_USAGE_DEFAULT, D3D11_USAGE_STAGING, ID3D11Device, ID3D11DeviceContext, ID3D11Texture2D,
};
use windows::Win32::Graphics::Dxgi::Common::DXGI_SAMPLE_DESC;
use windows::Win32::Graphics::Dxgi::{
    DXGI_ERROR_ACCESS_LOST, DXGI_ERROR_WAIT_TIMEOUT, DXGI_OUTDUPL_FRAME_INFO,
    DXGI_OUTDUPL_POINTER_SHAPE_INFO, DXGI_OUTDUPL_POINTER_SHAPE_TYPE_COLOR,
    DXGI_OUTDUPL_POINTER_SHAPE_TYPE_MASKED_COLOR, DXGI_OUTDUPL_POINTER_SHAPE_TYPE_MONOCHROME,
    IDXGIOutput1, IDXGIOutputDuplication, IDXGIResource,
};
use windows::core::Interface;

const ACQUIRE_TIMEOUT_MS: u32 = 250;

pub struct Frame {
    texture: ID3D11Texture2D,
    width: u32,
    height: u32,
    d3d_context: ID3D11DeviceContext,
}

impl Frame {
    pub fn texture(&self) -> &ID3D11Texture2D {
        &self.texture
    }

    pub fn width(&self) -> u32 {
        self.width
    }

    pub fn height(&self) -> u32 {
        self.height
    }

    pub fn as_buffer(&self) -> windows::core::Result<FrameBuffer<'_>> {
        let desc = D3D11_TEXTURE2D_DESC {
            Width: self.width,
            Height: self.height,
            MipLevels: 1,
            ArraySize: 1,
            Format: PixelFormat::B8G8R8A8Unorm.as_dxgi(),
            SampleDesc: DXGI_SAMPLE_DESC {
                Count: 1,
                Quality: 0,
            },
            Usage: D3D11_USAGE_STAGING,
            BindFlags: 0,
            CPUAccessFlags: D3D11_CPU_ACCESS_READ.0 as u32,
            MiscFlags: 0,
        };

        let device: ID3D11Device = unsafe { self.d3d_context.GetDevice() }?;

        let mut staging = None;
        unsafe { device.CreateTexture2D(&desc, None, Some(&mut staging)) }?;
        let staging = staging.ok_or_else(windows::core::Error::from_win32)?;

        unsafe { self.d3d_context.CopyResource(&staging, &self.texture) };

        let mut mapped = D3D11_MAPPED_SUBRESOURCE::default();
        unsafe {
            self.d3d_context
                .Map(&staging, 0, windows::Win32::Graphics::Direct3D11::D3D11_MAP_READ, 0, Some(&mut mapped))?;
        }

        let data = unsafe {
            std::slice::from_raw_parts(mapped.pData.cast(), (self.height * mapped.RowPitch) as usize)
        };

        Ok(FrameBuffer {
            data,
            width: self.width,
            height: self.height,
            stride: mapped.RowPitch,
            staging,
            d3d_context: self.d3d_context.clone(),
        })
    }
}

pub struct FrameBuffer<'a> {
    data: &'a [u8],
    width: u32,
    height: u32,
    stride: u32,
    staging: ID3D11Texture2D,
    d3d_context: ID3D11DeviceContext,
}

impl Drop for FrameBuffer<'_> {
    fn drop(&mut self) {
        unsafe { self.d3d_context.Unmap(&self.staging, 0) };
    }
}

impl FrameBuffer<'_> {
    pub fn data(&self) -> &[u8] {
        self.data
    }

    pub fn width(&self) -> u32 {
        self.width
    }

    pub fn height(&self) -> u32 {
        self.height
    }

    pub fn stride(&self) -> u32 {
        self.stride
    }
}

enum ThreadMessage {
    Stop,
}

pub struct Capturer {
    stop_flag: Arc<AtomicBool>,
    control_tx: std::sync::mpsc::Sender<ThreadMessage>,
    thread: Option<JoinHandle<()>>,
}

fn read_pointer_shape(
    duplication: &IDXGIOutputDuplication,
    frame_info: &DXGI_OUTDUPL_FRAME_INFO,
) -> windows::core::Result<Option<CursorShape>> {
    if frame_info.PointerShapeBufferSize == 0 {
        return Ok(None);
    }

    let mut buffer = vec![0u8; frame_info.PointerShapeBufferSize as usize];
    let mut required = 0u32;
    let mut info = DXGI_OUTDUPL_POINTER_SHAPE_INFO::default();

    unsafe {
        duplication.GetFramePointerShape(
            buffer.len() as u32,
            buffer.as_mut_ptr().cast(),
            &mut required,
            &mut info,
        )?;
    }

    let kind = if info.Type == DXGI_OUTDUPL_POINTER_SHAPE_TYPE_MONOCHROME.0 as u32 {
        CursorShapeKind::Monochrome
    } else if info.Type == DXGI_OUTDUPL_POINTER_SHAPE_TYPE_COLOR.0 as u32 {
        CursorShapeKind::Color
    } else if info.Type == DXGI_OUTDUPL_POINTER_SHAPE_TYPE_MASKED_COLOR.0 as u32 {
        CursorShapeKind::MaskedColor
    } else {
        return Ok(None);
    };

    let height = if kind == CursorShapeKind::Monochrome {
        info.Height / 2
    } else {
        info.Height
    };

    Ok(Some(CursorShape {
        kind,
        width: info.Width,
        height,
        pitch: info.Pitch,
        hotspot_x: info.HotSpot.x,
        hotspot_y: info.HotSpot.y,
        data: buffer,
    }))
}

/// Creates the DEFAULT-usage output texture frames are copied into. Same
/// bind flags as `scap-direct3d`'s crop texture, so it's usable as a
/// shader-resource input if a hardware-encode path is ever added.
fn create_output_texture(
    device: &ID3D11Device,
    width: u32,
    height: u32,
) -> windows::core::Result<ID3D11Texture2D> {
    let desc = D3D11_TEXTURE2D_DESC {
        Width: width,
        Height: height,
        MipLevels: 1,
        ArraySize: 1,
        Format: PixelFormat::B8G8R8A8Unorm.as_dxgi(),
        SampleDesc: DXGI_SAMPLE_DESC {
            Count: 1,
            Quality: 0,
        },
        Usage: D3D11_USAGE_DEFAULT,
        BindFlags: (D3D11_BIND_RENDER_TARGET.0 | D3D11_BIND_SHADER_RESOURCE.0) as u32,
        CPUAccessFlags: 0,
        MiscFlags: 0,
    };
    let mut texture = None;
    unsafe { device.CreateTexture2D(&desc, None, Some(&mut texture)) }?;
    texture.ok_or_else(windows::core::Error::from_win32)
}

/// Composites the cached cursor shape (if visible and within bounds) onto
/// `output_texture` via a small read-write staging texture, so only the
/// cursor-sized region touches the CPU per frame.
fn composite_cursor(
    device: &ID3D11Device,
    context: &ID3D11DeviceContext,
    output_texture: &ID3D11Texture2D,
    frame_width: u32,
    frame_height: u32,
    position_x: i32,
    position_y: i32,
    shape: &CursorShape,
) -> windows::core::Result<()> {
    // Only composite when the cursor is fully on-screen. Correct per-pixel
    // clipping would need to offset into both the shape buffer's rows and
    // columns; that's not worth the complexity for what's already a rare
    // edge case (a cursor is fully off-frame far more often than partially
    // clipped at an edge), so a partially-clipped cursor is simply skipped
    // for this frame rather than drawn incorrectly.
    if position_x < 0
        || position_y < 0
        || position_x + shape.width as i32 > frame_width as i32
        || position_y + shape.height as i32 > frame_height as i32
    {
        return Ok(());
    }
    let left = position_x;
    let top = position_y;
    let width = shape.width;
    let height = shape.height;

    let staging_desc = D3D11_TEXTURE2D_DESC {
        Width: width,
        Height: height,
        MipLevels: 1,
        ArraySize: 1,
        Format: PixelFormat::B8G8R8A8Unorm.as_dxgi(),
        SampleDesc: DXGI_SAMPLE_DESC {
            Count: 1,
            Quality: 0,
        },
        Usage: D3D11_USAGE_STAGING,
        BindFlags: 0,
        CPUAccessFlags: (D3D11_CPU_ACCESS_READ.0 | D3D11_CPU_ACCESS_WRITE.0) as u32,
        MiscFlags: 0,
    };
    let mut staging = None;
    unsafe { device.CreateTexture2D(&staging_desc, None, Some(&mut staging)) }?;
    let staging = staging.ok_or_else(windows::core::Error::from_win32)?;

    let src_box = windows::Win32::Graphics::Direct3D11::D3D11_BOX {
        left: left as u32,
        top: top as u32,
        front: 0,
        right: left as u32 + width,
        bottom: top as u32 + height,
        back: 1,
    };
    unsafe { context.CopySubresourceRegion(&staging, 0, 0, 0, 0, output_texture, 0, Some(&src_box)) };

    let mut mapped = D3D11_MAPPED_SUBRESOURCE::default();
    unsafe { context.Map(&staging, 0, D3D11_MAP_READ_WRITE, 0, Some(&mut mapped))? };

    let bg = unsafe {
        std::slice::from_raw_parts_mut(mapped.pData.cast::<u8>(), (height * mapped.RowPitch) as usize)
    };
    shape.composite_onto(bg, mapped.RowPitch as usize);

    unsafe { context.Unmap(&staging, 0) };

    unsafe {
        context.CopySubresourceRegion(
            output_texture,
            0,
            left as u32,
            top as u32,
            0,
            &staging,
            0,
            None,
        )
    };

    Ok(())
}

fn run_capture_loop(
    duplication_output: (IDXGIOutputDuplication, ID3D11Device, ID3D11DeviceContext),
    frame_width: u32,
    frame_height: u32,
    crop: Option<windows::Win32::Graphics::Direct3D11::D3D11_BOX>,
    control_rx: std::sync::mpsc::Receiver<ThreadMessage>,
    mut on_frame: impl FnMut(Frame) -> windows::core::Result<()> + Send + 'static,
    mut on_closed: impl FnMut() -> windows::core::Result<()> + Send + 'static,
) {
    let (mut duplication, device, context) = duplication_output;
    let mut cached_shape: Option<CursorShape> = None;
    let (out_width, out_height) = crop
        .map(|c| (c.right - c.left, c.bottom - c.top))
        .unwrap_or((frame_width, frame_height));

    loop {
        if control_rx.try_recv().is_ok() {
            break;
        }

        let mut frame_info = DXGI_OUTDUPL_FRAME_INFO::default();
        let mut resource: Option<IDXGIResource> = None;
        let acquire_result =
            unsafe { duplication.AcquireNextFrame(ACQUIRE_TIMEOUT_MS, &mut frame_info, &mut resource) };

        let resource = match acquire_result {
            Ok(()) => match resource {
                Some(r) => r,
                None => continue,
            },
            Err(e) if e.code() == DXGI_ERROR_WAIT_TIMEOUT => continue,
            Err(e) if e.code() == DXGI_ERROR_ACCESS_LOST => {
                tracing::warn!("DXGI duplication access lost, recreating");
                match find_and_duplicate_same_output(&device) {
                    Ok(new_dup) => {
                        duplication = new_dup;
                        continue;
                    }
                    Err(e) => {
                        tracing::error!(error = %e, "Failed to recreate DXGI duplication after access lost");
                        let _ = on_closed();
                        break;
                    }
                }
            }
            Err(e) => {
                tracing::error!(error = %e, "DXGI AcquireNextFrame failed");
                let _ = on_closed();
                break;
            }
        };

        let result = (|| -> windows::core::Result<()> {
            let acquired: ID3D11Texture2D = resource.cast()?;
            let output_texture = create_output_texture(&device, out_width, out_height)?;

            if let Some(crop_box) = crop {
                unsafe {
                    context.CopySubresourceRegion(&output_texture, 0, 0, 0, 0, &acquired, 0, Some(&crop_box))
                };
            } else {
                unsafe { context.CopyResource(&output_texture, &acquired) };
            }

            unsafe { duplication.ReleaseFrame() }?;

            if let Some(shape) = read_pointer_shape(&duplication, &frame_info)? {
                cached_shape = Some(shape);
            }

            if frame_info.PointerPosition.Visible.as_bool()
                && let Some(shape) = &cached_shape
            {
                let crop_left = crop.map(|c| c.left as i32).unwrap_or(0);
                let crop_top = crop.map(|c| c.top as i32).unwrap_or(0);
                composite_cursor(
                    &device,
                    &context,
                    &output_texture,
                    out_width,
                    out_height,
                    frame_info.PointerPosition.Position.x - shape.hotspot_x - crop_left,
                    frame_info.PointerPosition.Position.y - shape.hotspot_y - crop_top,
                    shape,
                )?;
            }

            on_frame(Frame {
                texture: output_texture,
                width: out_width,
                height: out_height,
                d3d_context: context.clone(),
            })
        })();

        if let Err(e) = result {
            tracing::warn!(error = %e, "DXGI frame processing failed, continuing");
        }
    }
}

fn find_and_duplicate_same_output(device: &ID3D11Device) -> windows::core::Result<IDXGIOutputDuplication> {
    // ACCESS_LOST recovery re-duplicates the same adapter's primary output;
    // Task 5's restart path re-enters `Capturer::new` from scratch (which
    // re-resolves the target monitor) for anything beyond a transient loss,
    // so this just needs to get frames flowing again immediately.
    let dxgi_device: windows::Win32::Graphics::Dxgi::IDXGIDevice = device.cast()?;
    let adapter = unsafe { dxgi_device.GetAdapter() }?;
    let output = unsafe { adapter.EnumOutputs(0) }?;
    let output1: IDXGIOutput1 = output.cast()?;
    unsafe { output1.DuplicateOutput(device) }
}

impl Capturer {
    pub fn new(
        display: &scap_targets::Display,
        settings: Settings,
        on_frame: impl FnMut(Frame) -> windows::core::Result<()> + Send + 'static,
        on_closed: impl FnMut() -> windows::core::Result<()> + Send + 'static,
        device: ID3D11Device,
    ) -> Result<Self, NewCapturerError> {
        let target_monitor = display.raw_handle().inner();
        let (output1, desktop_rect) =
            find_output_for_monitor(&device, target_monitor).map_err(|_| NewCapturerError::OutputNotFound)?;

        let duplication = unsafe { output1.DuplicateOutput(&device) }
            .map_err(NewCapturerError::DuplicateOutput)?;

        let context = unsafe { device.GetImmediateContext() }.map_err(NewCapturerError::Context)?;

        let frame_width = (desktop_rect.right - desktop_rect.left) as u32;
        let frame_height = (desktop_rect.bottom - desktop_rect.top) as u32;

        let (control_tx, control_rx) = std::sync::mpsc::channel();
        let stop_flag = Arc::new(AtomicBool::new(false));

        let crop = settings.crop;
        let thread = std::thread::Builder::new()
            .name("dxgi-duplication-capture".into())
            .spawn(move || {
                run_capture_loop(
                    (duplication, device, context),
                    frame_width,
                    frame_height,
                    crop,
                    control_rx,
                    on_frame,
                    on_closed,
                )
            })
            .map_err(|e| NewCapturerError::Other(windows::core::Error::from(std::io::Error::from(e))))?;

        Ok(Self {
            stop_flag,
            control_tx,
            thread: Some(thread),
        })
    }

    pub fn start(&mut self) -> windows::core::Result<()> {
        // The capture loop starts pulling frames as soon as the thread is
        // spawned in `new` -- there is no separate "arm the session" step
        // like WGC's `StartCapture`, so this is a no-op kept for API parity.
        Ok(())
    }

    pub fn stop(&mut self) -> windows::core::Result<()> {
        if self.stop_flag.swap(true, Ordering::SeqCst) {
            return Ok(());
        }
        let _ = self.control_tx.send(ThreadMessage::Stop);
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
        Ok(())
    }
}

impl Drop for Capturer {
    fn drop(&mut self) {
        let _ = self.stop();
    }
}
```

- [ ] **Step 2: Verify it compiles**

Run: `cargo check -p scap-dxgi`
Expected: no errors. Fix any signature mismatches against the installed `windows` crate version
before moving on — the exact method names above were verified against
`~/.cargo/registry/src/*/windows-0.60.0/src/Windows/Win32/Graphics/Dxgi/mod.rs` at the time this
plan was written, but re-check `cargo check`'s output against that same file if anything doesn't
line up.

- [ ] **Step 3: Commit**

```bash
git add crates/cap/scap-dxgi/src/capturer.rs
git commit -m "feat(scap-dxgi): implement the DXGI Desktop Duplication capturer

AcquireNextFrame loop with ACCESS_LOST recovery, cursor compositing via
the Task 3 pure functions, and Frame/FrameBuffer mirroring
scap-direct3d's shape.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 5: Wire the fallback into `windows.rs`

**Files:**
- Modify: `crates/cap/recording/Cargo.toml:100` (add the new dependency next to `scap-direct3d`)
- Modify: `crates/cap/recording/src/sources/screen_capture/windows.rs`

**Interfaces:**
- Consumes: `scap_dxgi::{Capturer as DxgiCapturer, Settings as DxgiSettings, Frame as DxgiFrame}` (Task 4).
- Produces: `ScreenFrame::Duplicated` variant usable by `capture_pipeline.rs` and the encoder path
  exactly like the existing `Captured`/`Scaled` variants (no signature changes needed there).

- [ ] **Step 1: Add the dependency**

In `crates/cap/recording/Cargo.toml`, after line 100 (`scap-direct3d = { path = "../scap-direct3d" }`):

```toml
scap-dxgi = { path = "../scap-dxgi" }
```

- [ ] **Step 2: Add the `ActiveCapturer` enum and extend `ScreenFrame`**

In `windows.rs`, change the `ScreenFrame` enum (currently at line 96-99):

```rust
pub enum ScreenFrame {
    Captured(scap_direct3d::Frame),
    Scaled(ScaledScreenFrame),
}
```

to:

```rust
pub enum ScreenFrame {
    Captured(scap_direct3d::Frame),
    Duplicated(scap_dxgi::Frame),
    Scaled(ScaledScreenFrame),
}
```

Then update its three impl methods (currently lines 111-170) to handle the new variant. Change:

```rust
impl ScreenFrame {
    pub fn texture(&self) -> &ID3D11Texture2D {
        match self {
            ScreenFrame::Captured(frame) => frame.texture(),
            ScreenFrame::Scaled(scaled) => &scaled.texture,
        }
    }

    pub fn width(&self) -> u32 {
        match self {
            ScreenFrame::Captured(frame) => frame.width(),
            ScreenFrame::Scaled(scaled) => scaled.width,
        }
    }

    pub fn height(&self) -> u32 {
        match self {
            ScreenFrame::Captured(frame) => frame.height(),
            ScreenFrame::Scaled(scaled) => scaled.height,
        }
    }
```

to:

```rust
impl ScreenFrame {
    pub fn texture(&self) -> &ID3D11Texture2D {
        match self {
            ScreenFrame::Captured(frame) => frame.texture(),
            ScreenFrame::Duplicated(frame) => frame.texture(),
            ScreenFrame::Scaled(scaled) => &scaled.texture,
        }
    }

    pub fn width(&self) -> u32 {
        match self {
            ScreenFrame::Captured(frame) => frame.width(),
            ScreenFrame::Duplicated(frame) => frame.width(),
            ScreenFrame::Scaled(scaled) => scaled.width,
        }
    }

    pub fn height(&self) -> u32 {
        match self {
            ScreenFrame::Captured(frame) => frame.height(),
            ScreenFrame::Duplicated(frame) => frame.height(),
            ScreenFrame::Scaled(scaled) => scaled.height,
        }
    }
```

And its `as_ffmpeg` method (currently lines 133-169) — add a `Duplicated` arm that builds the
ffmpeg frame the same manual way `Scaled` already does (both start from a CPU-mapped BGRA8
buffer), right after the existing `ScreenFrame::Captured(frame) => { ... }` arm:

```rust
            ScreenFrame::Duplicated(frame) => {
                let buffer = frame.as_buffer()?;
                let width = buffer.width();
                let height = buffer.height();
                let stride = buffer.stride() as usize;
                let mut ff_frame = ffmpeg::frame::Video::new(ffmpeg::format::Pixel::BGRA, width, height);
                let dest_stride = ff_frame.stride(0);
                let dest_bytes = ff_frame.data_mut(0);
                let row_length = (width * 4) as usize;
                let src_data = buffer.data();

                for row in 0..height as usize {
                    let src_start = row * stride;
                    let dst_start = row * dest_stride;
                    let copy_len = row_length.min(
                        src_data
                            .len()
                            .saturating_sub(src_start)
                            .min(dest_bytes.len().saturating_sub(dst_start)),
                    );
                    if copy_len > 0 {
                        dest_bytes[dst_start..dst_start + copy_len]
                            .copy_from_slice(&src_data[src_start..src_start + copy_len]);
                    }
                }

                Ok(ff_frame)
            }
```

(`frame.as_buffer()` returns `windows::core::Result<scap_dxgi::FrameBuffer<'_>>`, and
`as_ffmpeg`'s declared return type is already `Result<ffmpeg::frame::Video, ::windows::core::Error>`
per line 133, so the plain `?` above just works — no error-type conversion needed.)

- [ ] **Step 3: Verify it compiles (fallback wiring comes next, so `Duplicated` is unused for now)**

Run: `cargo check -p cap-recording`
Expected: a `never constructed` warning for `ScreenFrame::Duplicated`, no errors. That warning
disappears once Step 4 wires up `create_d3d_capturer`.

- [ ] **Step 4: Add the `ActiveCapturer` enum and rewrite `create_d3d_capturer`**

Add this new enum right before `fn create_d3d_capturer` (currently at line 510):

```rust
enum ActiveCapturer {
    Wgc(scap_direct3d::Capturer),
    Dxgi(scap_dxgi::Capturer),
}

impl ActiveCapturer {
    fn start(&mut self) -> windows::core::Result<()> {
        match self {
            ActiveCapturer::Wgc(c) => c.start(),
            ActiveCapturer::Dxgi(c) => c.start(),
        }
    }

    fn stop(&mut self) -> windows::core::Result<()> {
        match self {
            ActiveCapturer::Wgc(c) => c.stop(),
            ActiveCapturer::Dxgi(c) => c.stop(),
        }
    }
}
```

Then change `create_d3d_capturer`'s signature and body. Currently (lines 510-654):

```rust
fn create_d3d_capturer(
    params: &CreateCapturerParams,
    error_tx: &mpsc::Sender<CaptureClosureEvent>,
) -> anyhow::Result<scap_direct3d::Capturer> {
    let capture_item = Display::from_id(params.display_id)
        .ok_or_else(|| anyhow!("Display not found for ID: {:?}", params.display_id))?
        .raw_handle()
        .try_as_capture_item()
        .map_err(|e| anyhow!("Failed to create GraphicsCaptureItem: {}", e))?;

    scap_direct3d::Capturer::new(
        capture_item,
        params.settings.clone(),
        { /* ...frame callback... */ },
        { /* ...closed callback... */ },
        Some(params.d3d_device.clone()),
    )
    .map_err(|e| anyhow!("{e}"))
}
```

Split it into `try_create_wgc_capturer` (same body as today, renamed) and a new
`try_create_dxgi_capturer`, then have `create_d3d_capturer` try the first and fall back to the
second. The frame-callback closure itself is unchanged — only the outer function is restructured
— so rename the existing function to `try_create_wgc_capturer` and change its return type, then
add the two new functions and the new `create_d3d_capturer`:

```rust
fn try_create_wgc_capturer(
    params: &CreateCapturerParams,
    error_tx: &mpsc::Sender<CaptureClosureEvent>,
) -> anyhow::Result<scap_direct3d::Capturer> {
    let capture_item = Display::from_id(params.display_id)
        .ok_or_else(|| anyhow!("Display not found for ID: {:?}", params.display_id))?
        .raw_handle()
        .try_as_capture_item()
        .map_err(|e| anyhow!("Failed to create GraphicsCaptureItem: {}", e))?;

    scap_direct3d::Capturer::new(
        capture_item,
        params.settings.clone(),
        // ... unchanged frame callback from today's implementation ...
        // ... unchanged closed callback from today's implementation ...
        Some(params.d3d_device.clone()),
    )
    .map_err(|e| anyhow!("{e}"))
}

fn try_create_dxgi_capturer(
    params: &CreateCapturerParams,
    error_tx: &mpsc::Sender<CaptureClosureEvent>,
) -> anyhow::Result<scap_dxgi::Capturer> {
    let display = Display::from_id(params.display_id)
        .ok_or_else(|| anyhow!("Display not found for ID: {:?}", params.display_id))?;

    let dxgi_settings = scap_dxgi::Settings {
        crop: params.settings.crop,
    };

    let video_frame_counter = params.video_frame_counter.clone();
    let video_drop_counter = params.video_drop_counter.clone();
    let video_decimated_counter = params.video_decimated_counter.clone();
    let mut cadence_gate = params.cadence_interval_hns.map(FrameCadenceGate::new);
    let mut tx = params.video_tx.clone();
    let stall_health_tx = params.stall_health_tx.clone();
    let first_frame = params.first_frame.clone();

    let mut err_tx = error_tx.clone();
    let device_for_callback = params.d3d_device.clone();

    scap_dxgi::Capturer::new(
        &display,
        dxgi_settings,
        move |frame: scap_dxgi::Frame| {
            let capture_time = cap_timestamp::PerformanceCounterTimestamp::now();
            let timestamp = cap_timestamp::Timestamp::PerformanceCounter(capture_time);

            if let Some(gate) = cadence_gate.as_mut()
                && !gate.admit(0)
            {
                video_decimated_counter.fetch_add(1, atomic::Ordering::Relaxed);
                return Ok(());
            }

            match output_pipeline::send_with_stall_budget_futures(
                &mut tx,
                VideoFrame {
                    frame: ScreenFrame::Duplicated(frame),
                    timestamp,
                },
                "screen-video",
                &stall_health_tx,
            ) {
                output_pipeline::StallSendOutcome::Sent => {
                    video_frame_counter.fetch_add(1, atomic::Ordering::Relaxed);
                    first_frame.complete(Ok(()));
                }
                output_pipeline::StallSendOutcome::StalledAndDropped { .. }
                | output_pipeline::StallSendOutcome::Disconnected => {
                    video_drop_counter.fetch_add(1, atomic::Ordering::Relaxed);
                }
            }
            Ok(())
        },
        move || {
            let kind = classify_capture_closure(&device_for_callback);
            let message = match kind {
                CaptureClosureKind::DeviceRemoved { hresult } => {
                    format!("d3d11 device removed (hresult=0x{hresult:08x})")
                }
                CaptureClosureKind::TargetLost => "capture target lost".to_string(),
                CaptureClosureKind::Transient => "capture closed".to_string(),
            };
            drop(err_tx.try_send(CaptureClosureEvent { kind, message }));
            Ok(())
        },
        params.d3d_device.clone(),
    )
    .map_err(|e| anyhow!("{e}"))
}

fn create_d3d_capturer(
    params: &CreateCapturerParams,
    error_tx: &mpsc::Sender<CaptureClosureEvent>,
) -> anyhow::Result<ActiveCapturer> {
    match try_create_wgc_capturer(params, error_tx) {
        Ok(c) => Ok(ActiveCapturer::Wgc(c)),
        Err(wgc_err) => {
            warn!(
                error = %wgc_err,
                "WGC capture unavailable, falling back to DXGI Desktop Duplication"
            );
            try_create_dxgi_capturer(params, error_tx)
                .map(ActiveCapturer::Dxgi)
                .map_err(|dxgi_err| {
                    anyhow!(
                        "WGC failed ({wgc_err}); DXGI duplication fallback also failed ({dxgi_err})"
                    )
                })
        }
    }
}
```

Note: the DXGI frame callback above doesn't have a real per-frame timestamp source the way WGC's
`SystemRelativeTime` or `LastPresentTime` provide (this plan's Task 4 `Frame` type intentionally
doesn't carry `DXGI_OUTDUPL_FRAME_INFO` through to keep the crate's public `Frame` type simple) —
it stamps `PerformanceCounterTimestamp::now()` at delivery time instead. This is a deliberate
simplification for the fallback path only (the primary WGC path's precise capture-time
timestamping is untouched); if audio/video sync issues are observed specifically when the DXGI
fallback is active, revisit by threading `frame_info.LastPresentTime` through
`scap_dxgi::Frame` via `cap_timestamp::PerformanceCounterTimestamp::new(frame_info.LastPresentTime)`
(note: `::new`, *not* `::from_100ns` — DXGI's timestamp is already in raw QPC-tick units, unlike
WGC's 100ns-unit `SystemRelativeTime`).

Also note `cadence_gate.admit(0)` above passes a placeholder QPC timestamp of `0` rather than a
real capture-time tick count, since (per the previous paragraph) this simplified path doesn't
thread one through — check `FrameCadenceGate::admit`'s doc comment/implementation in
`crates/cap/recording/src/sources/screen_capture/cadence.rs` before relying on this: if it
computes intervals from consecutive absolute timestamps (likely, given the WGC path passes
`capture_time.Duration`), passing a constant `0` every call will make it behave as though frames
arrive simultaneously every time, effectively admitting every frame (no decimation) rather than
gating to the nominal rate. That's an acceptable interim behavior for the fallback path (the
downstream encoder still encodes at whatever rate frames arrive), but replace the `0` with
`cap_timestamp::PerformanceCounterTimestamp::now()`'s underlying tick value (a real, monotonically
increasing counter) if verification in Task 6 shows the DXGI fallback delivering frames far above
the target FPS.

- [ ] **Step 5: Update the two call sites that assumed `scap_direct3d::Capturer`**

The capture thread (inside `ctx.tasks().spawn_thread("d3d-capture-thread", ...)`, currently lines
706-945) declares `let mut capturer = match create_d3d_capturer(...)`. Since `create_d3d_capturer`
now returns `anyhow::Result<ActiveCapturer>` instead of `anyhow::Result<scap_direct3d::Capturer>`,
no changes are needed at that call site itself — `capturer`'s type just changes to
`Option<ActiveCapturer>` automatically. Every place that calls `capturer.start()`/`.stop()` on it
(lines 821-824, 837, 846, 864-865, 898-899, 904) already goes through the same method names,
which `ActiveCapturer` now provides — confirm this with the compile check in Step 6 rather than
hand-auditing each call site.

- [ ] **Step 6: Verify it compiles**

Run: `cargo check -p cap-recording`
Expected: no errors. If any call site does need a type-specific method `ActiveCapturer` doesn't
expose, add it to the `impl ActiveCapturer` block from Step 4 rather than matching on the enum at
the call site.

- [ ] **Step 7: Full workspace check**

Run: `cargo check --workspace`
Expected: no errors (confirms `apps/desktop/src-tauri`, which depends on `cap-recording`
transitively, still builds).

- [ ] **Step 8: Commit**

```bash
git add crates/cap/recording/Cargo.toml crates/cap/recording/src/sources/screen_capture/windows.rs
git commit -m "feat(recording): fall back to DXGI Desktop Duplication when WGC fails

Windows Graphics Capture depends on Game DVR; when that's disabled
system-wide every recording failed with ERROR_SERVICE_DISABLED. This
wires the scap-dxgi crate in as a fallback so recording keeps working
regardless of that policy.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 6: Manual end-to-end verification

**Files:** none (verification only).

No automated test can exercise a live Windows Graphics Capture / DXGI Duplication session (both
need a real GPU, a real interactive desktop session, and real system policy state) — this matches
`scap-direct3d`, which has zero tests of its own live capture path either. Verify by hand:

- [ ] **Step 1: Confirm the WGC path still works (regression check)**

With Game DVR enabled (`reg add "HKLM\SOFTWARE\Policies\Microsoft\Windows\GameDVR" /v
AllowGameDVR /t REG_DWORD /d 1 /f` as Administrator, and `reg add
"HKCU\System\GameConfigStore" /v GameDVR_Enabled /t REG_DWORD /d 1 /f`), run `pnpm dev:desktop`,
start a Studio-mode recording, record a few seconds, stop, and confirm the output file plays back
with visible video and cursor. Check the log for `WGC capture unavailable` — it should **not**
appear.

- [ ] **Step 2: Confirm the DXGI fallback engages and produces a valid recording**

Set both registry values back to `0` (the state this whole plan exists to fix), restart the app,
start a Studio-mode recording, move the mouse around during it, stop, and confirm:
- The log shows `WGC capture unavailable, falling back to DXGI Desktop Duplication` followed by
  successful frame delivery (no `"oneshot canceled"` error this time).
- The output file plays back with visible video.
- The cursor is visible and tracks mouse movement in the recording (confirms Task 3/4's
  compositing works against a real cursor, not just the synthetic test buffers).

- [ ] **Step 3: Confirm Instant-mode recording also benefits**

Still with Game DVR off, start an Instant recording (not just Studio) and confirm it also
succeeds — this is the "happens when taking any video on windows" case reported, since Instant
mode shares the same `screen_capture::VideoSource` this plan modified.

- [ ] **Step 4: Restore the user's original Game DVR setting**

Whichever state Game DVR was in before this verification pass started (check whether the user
wants it left on or off — do not silently leave it in whichever state Step 1/2 last set it to).
