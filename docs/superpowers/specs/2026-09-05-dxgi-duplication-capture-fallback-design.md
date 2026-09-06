# Windows screen capture: DXGI Desktop Duplication fallback

## Problem

Lare's Windows screen capture (`crates/cap/recording/src/sources/screen_capture/windows.rs`,
`crates/cap/scap-direct3d`) uses only Windows.Graphics.Capture (WGC). WGC sits on the same
system infrastructure as Game DVR. When Game DVR is disabled (`HKLM:\SOFTWARE\Policies\Microsoft\
Windows\GameDVR\AllowGameDVR=0`, or the per-user `HKCU:\System\GameConfigStore\GameDVR_Enabled=0`),
`GraphicsCaptureItem` creation fails with `ERROR_SERVICE_DISABLED` (`0x80070422`), and every
Studio-mode recording on that machine fails to start.

Confirmed live on a Windows 11 24H2 (build 26100) machine: both registry values were `0`, and the
desktop app's log showed the failure at the exact call site:

```
ERROR ... cap_recording::sources::screen_capture::windows: Failed to create D3D capturer:
Failed to create GraphicsCaptureItem: The service cannot be started, either because it is
disabled or because it has no enabled devices associated with it. (0x80070422)
```

A separate bug compounds this: when `create_d3d_capturer` fails on the capture thread's first
attempt, the thread returns early without signaling the `first_frame` oneshot channel. The
`VideoSource::start()` caller sees the channel dropped and reports a generic `"oneshot canceled"`
instead of the real error, which is what actually reached the UI ("Capture startup cleanup is
unconfirmed: oneshot canceled: screen pipeline setup: oneshot canceled").

Ruled out as causes: `FrameServer`/`FrameServerMonitor` services (both `Manual`, not `Disabled`),
and the graphics-capture privacy consent store (`HKCU:...\CapabilityAccessManager\ConsentStore\
graphicsCaptureProgrammatic` / `graphicsCaptureWithoutBorder`, both `Allow`). The app process is
in the same session as the interactive desktop (not a session/elevation mismatch).

## Goal

Recording should work on machines with Game DVR disabled, without requiring the user to change
that system policy. Add a second Windows capture backend — DXGI Desktop Duplication
(`IDXGIOutputDuplication`) — that Lare falls back to automatically when WGC fails.

## Non-goals

- Replacing WGC as the primary backend (WGC is kept as the default: it already works when Game
  DVR is on, and it includes cursor capture for free).
- macOS/Linux capture — unaffected.
- Window/region capture parity for the duplication path beyond what's needed to match today's
  monitor + crop capture (duplication captures full outputs; existing crop-via-`D3D11_BOX`
  behavior is preserved by cropping the output texture the same way the WGC path already does).

## Architecture

```
create_d3d_capturer()
  -> try: Display -> GraphicsCaptureItem -> scap_direct3d::Capturer   (WGC, existing)
  -> on failure: warn!, try: scap_dxgi::Capturer                     (new, this spec)
  -> both wrapped in ActiveCapturer enum used by the rest of the capture thread
```

`ActiveCapturer` is a thin enum (`Wgc(scap_direct3d::Capturer)` / `Dxgi(scap_dxgi::Capturer)`)
exposing `start()`/`stop()` that delegate to whichever variant is active. The existing
restart/device-recreate control loop in `windows.rs` (`VideoControl::Restart`,
`VideoControl::RecreateDevice`) is backend-agnostic already (it just calls `create_d3d_capturer`
again) and needs no structural change — the fallback happens inside that function on every
(re)creation attempt, so a mid-recording restart also retries WGC first, then falls back again if
still unavailable.

`ScreenFrame` (in `windows.rs`) gains a third variant, `Duplicated(scap_dxgi::Frame)`, alongside
today's `Captured`/`Scaled`. `texture()`/`width()`/`height()`/`as_ffmpeg()` are extended the same
way the existing `Scaled` variant is handled — no changes needed in the encoder or scaler beyond
this match arm, since both backends ultimately hand over an `ID3D11Texture2D` of the same pixel
format (`R8G8B8A8Unorm`, matching `Direct3DCapture::PIXEL_FORMAT`).

## New crate: `crates/cap/scap-dxgi`

Mirrors `scap-direct3d`'s public shape so the two backends are symmetric at the call site:

`scap-dxgi` takes a regular (one-directional) dependency on `scap-direct3d` purely to reuse its
`PixelFormat` enum rather than defining a second copy — `scap-direct3d` gains no dependency back.

```rust
pub struct Settings {
    pub crop: Option<D3D11_BOX>,
    pub pixel_format: scap_direct3d::PixelFormat,
}

pub struct Frame { /* wraps ID3D11Texture2D + width/height */ }
impl Frame {
    pub fn texture(&self) -> &ID3D11Texture2D;
    pub fn width(&self) -> u32;
    pub fn height(&self) -> u32;
    pub fn as_buffer(&self) -> windows::core::Result<MappedBuffer>; // same shape as scap_direct3d::Frame::as_buffer
}

#[derive(thiserror::Error, Debug)]
pub enum NewCapturerError { /* mirrors scap_direct3d::NewCapturerError's cases */ }

pub struct Capturer { /* ... */ }
impl Capturer {
    pub fn new(
        display: &scap_targets::Display,
        settings: Settings,
        on_frame: impl FnMut(Frame) -> windows::core::Result<()> + Send + 'static,
        on_closed: impl FnMut() -> windows::core::Result<()> + Send + 'static,
        device: ID3D11Device,
    ) -> Result<Self, NewCapturerError>;
    pub fn start(&mut self) -> windows::core::Result<()>;
    pub fn stop(&mut self) -> windows::core::Result<()>;
}
```

### Duplication lifecycle

1. Resolve the target `Display`'s `HMONITOR` (`display.raw_handle().inner()`) to its owning
   `IDXGIOutput`: get the `IDXGIAdapter` behind the passed-in `ID3D11Device` via
   `device.cast::<IDXGIDevice>()?.GetAdapter()?`, then `EnumOutputs` on that adapter and match
   `GetDesc().Monitor` against the target `HMONITOR`. (Duplication requires the device and output
   to share an adapter — this also means the fallback only works for the display attached to the
   currently-selected GPU, same constraint WGC has via `cap_d3d_adapter`'s adapter selection.)
2. `output.cast::<IDXGIOutput1>()?.DuplicateOutput(&device)` → `IDXGIOutputDuplication`.
3. Dedicated OS thread (same pattern as `d3d-capture-thread` today) loops:
   `AcquireNextFrame(timeout_ms, &mut frame_info, &mut resource)`.
   - `DXGI_ERROR_WAIT_TIMEOUT`: no new frame within the timeout; loop again (this is normal —
     duplication only delivers a frame on desktop change).
   - `DXGI_ERROR_ACCESS_LOST`: the duplication interface is invalid (lock screen, UAC secure
     desktop, mode change) — drop it and recreate from step 2. Reported the same way WGC's
     "target lost" is today, so the existing restart plumbing in `windows.rs` applies unchanged.
   - Other errors: reported via the existing `on_closed`/error-channel path.
   - Success: resource → `ID3D11Texture2D` via `.cast()`, apply crop (same
     `CopySubresourceRegion` approach `scap-direct3d` already uses), composite cursor (below),
     call `on_frame`, then `ReleaseFrame()` promptly (duplication stalls the desktop compositor
     until released).

### Cursor compositing

`DXGI_OUTDUPL_FRAME_INFO` reports pointer position/visibility every call, and pointer *shape*
data only when it changes (`PointerShapeBufferSize > 0`, fetched via `GetFramePointerShape`).
Shape arrives in one of three documented formats — monochrome (stacked AND/XOR 1bpp masks), color
(32bpp BGRA with real alpha), or masked-color (32bpp BGRA where alpha is 0x00 "XOR with
background" or 0xFF "opaque") — the same three cases Microsoft's own duplication sample and most
third-party recorders implement.

Approach (deliberately CPU-side, on a small buffer, not full-frame):
1. Cache the latest shape + mask type whenever `PointerShapeBufferSize > 0`.
2. When the pointer is visible: copy just the cursor-sized rectangle from the (post-crop) desktop
   texture into a small staging texture (`CopySubresourceRegion` with a `D3D11_BOX` sized to the
   cursor, not the full frame) and `Map` it for CPU read.
3. Composite the cached shape onto that small CPU buffer per its mask type's standard rule
   (mono: `out = (bg & and_mask) ^ xor_mask`; color: straight alpha blend; masked-color: `alpha ==
   0xFF ? rgb : bg ^ rgb`).
4. Copy the composited small patch onto a **fresh** output texture (a copy of the full desktop
   frame — the original duplication resource is released immediately after, per DXGI's
   requirements) via `UpdateSubresource`/`CopySubresourceRegion`.
5. If the pointer isn't visible, or no shape has been cached yet, skip straight to handing over
   the uncomposited copy.

This avoids a shader/render pipeline (none exists yet in this codebase) and avoids a full-frame
CPU readback (expensive at 1080p/4K) — only a small, cursor-sized region touches the CPU per
frame.

## Fallback wiring in `windows.rs`

`create_d3d_capturer` changes from "build WGC or fail" to "build WGC, and only on failure build
DXGI duplication":

```rust
fn create_d3d_capturer(...) -> anyhow::Result<ActiveCapturer> {
    match try_create_wgc_capturer(params, error_tx) {
        Ok(c) => Ok(ActiveCapturer::Wgc(c)),
        Err(wgc_err) => {
            warn!(error = %wgc_err, "WGC capture unavailable, falling back to DXGI Desktop Duplication");
            create_dxgi_capturer(params, error_tx)
                .map(ActiveCapturer::Dxgi)
                .map_err(|dxgi_err| anyhow!("WGC failed ({wgc_err}); DXGI duplication fallback also failed ({dxgi_err})"))
        }
    }
}
```

Both backends' frame callbacks share the cadence-gate / scaling / stall-budget-send / first-frame-
ack logic that exists today only for WGC. That logic is extracted into a helper generic over a
small `RawFrame` trait (`timestamp_100ns() -> windows::core::Result<i64>`, `width()`, `height()`,
`into_screen_frame(self) -> ScreenFrame`), implemented once for `scap_direct3d::Frame` (existing
behavior, unchanged) and once for `scap_dxgi::Frame` (new).

### Bug fix: early-failure startup signal

Today, if the first `create_d3d_capturer(...)` call on the capture thread fails, the thread does:

```rust
Err(e) => {
    error!("Failed to create D3D capturer: {}", e);
    return Err(e);
}
```

...without calling `first_frame.complete(Err(...))`. The `first_frame` oneshot sender is dropped
when the thread returns, and the awaiting side (`wait_for_first_screen_frame`) reports a generic
`"closed before its first frame"` / the caller's wrapping produces the `"oneshot canceled"` text
users see instead of the real error. Fix: call `first_frame.complete(Err(format!("{e}")))` before
returning, so a genuine double-failure (WGC *and* DXGI both fail) surfaces its real combined
message instead of the generic cancellation text. This is a small, targeted fix alongside the
fallback — it doesn't change behavior when either backend succeeds.

## Error handling

- WGC failure → DXGI attempt → both fail: real combined error surfaces (see bug fix above),
  recording start fails with an actionable message instead of "oneshot canceled".
- DXGI `ACCESS_LOST` mid-recording: treated as target-lost, reuses the existing
  `CaptureClosureKind`/restart path (`VideoControl::Restart` re-enters `create_d3d_capturer`,
  which again tries WGC first — if Game DVR got re-enabled mid-session it will switch back to
  WGC on the next restart, which is harmless and not worth special-casing against).
- Device-lost (`GetDeviceRemovedReason`) handling is unchanged — it already lives above the
  backend-specific code and applies to whichever `ActiveCapturer` variant is live.

## Testing

No existing capture-backend test harness exists for `scap-direct3d` either (native, GPU/OS
dependent, no CI runner has been set up for it). Scope:
- Unit tests for the pure cursor-compositing math (mono/color/masked-color blend rules) against
  synthetic mask buffers — deterministic, no GPU required.
- Unit tests for the `HMONITOR` → `IDXGIOutput` matching logic if it can be isolated from live
  DXGI calls (likely not fully testable without a GPU; if not feasible, skip and rely on manual
  verification).
- Manual verification: record with Game DVR on (confirms WGC path unaffected) and with Game DVR
  off (confirms DXGI fallback engages and produces a valid recording, cursor visible).
