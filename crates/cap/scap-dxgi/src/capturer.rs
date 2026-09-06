use crate::cursor::{CursorShape, CursorShapeKind};
use crate::output::find_output_for_monitor;
use crate::{NewCapturerError, Settings};
use scap_direct3d::PixelFormat;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread::JoinHandle;
use windows::Win32::Foundation::RECT;
use windows::Win32::Graphics::Direct3D11::{
    D3D11_BIND_RENDER_TARGET, D3D11_BIND_SHADER_RESOURCE, D3D11_CPU_ACCESS_READ,
    D3D11_CPU_ACCESS_WRITE, D3D11_MAP_READ_WRITE, D3D11_MAPPED_SUBRESOURCE, D3D11_TEXTURE2D_DESC,
    D3D11_USAGE_DEFAULT, D3D11_USAGE_STAGING, ID3D11Device, ID3D11DeviceContext, ID3D11Multithread,
    ID3D11Texture2D,
};
use windows::Win32::Graphics::Dxgi::Common::DXGI_SAMPLE_DESC;
use windows::Win32::Graphics::Dxgi::{
    DXGI_ERROR_ACCESS_LOST, DXGI_ERROR_WAIT_TIMEOUT, DXGI_OUTDUPL_FRAME_INFO,
    DXGI_OUTDUPL_POINTER_SHAPE_INFO, DXGI_OUTDUPL_POINTER_SHAPE_TYPE_COLOR,
    DXGI_OUTDUPL_POINTER_SHAPE_TYPE_MASKED_COLOR, DXGI_OUTDUPL_POINTER_SHAPE_TYPE_MONOCHROME,
    IDXGIOutputDuplication, IDXGIResource,
};
use windows::core::Interface;

const ACQUIRE_TIMEOUT_MS: u32 = 250;
/// Bounded retry count for re-establishing duplication after
/// `DXGI_ERROR_ACCESS_LOST`. The most common cause (a secure-desktop
/// transition for a UAC prompt or Ctrl+Alt+Del, or a display mode change)
/// typically rejects an immediate re-`DuplicateOutput` attempt, so a single
/// failure isn't treated as terminal.
const ACCESS_LOST_MAX_RETRIES: u32 = 8;
/// Delay between `ACCESS_LOST` recovery attempts.
const ACCESS_LOST_RETRY_DELAY_MS: u64 = 100;

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
    armed: Arc<AtomicBool>,
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

/// Re-resolves `target_monitor` to its `IDXGIOutput1` and re-`DuplicateOutput`s
/// it. Used for `ACCESS_LOST` recovery: re-resolving (rather than just
/// re-duplicating adapter output 0, which may not be the monitor we were
/// asked to capture) matters on multi-monitor machines, and the freshly
/// returned desktop rect lets the caller pick up a resolution change that
/// happened while access was lost.
fn recover_duplication(
    device: &ID3D11Device,
    target_monitor: windows::Win32::Graphics::Gdi::HMONITOR,
) -> windows::core::Result<(IDXGIOutputDuplication, RECT)> {
    let (output1, desktop_rect) = find_output_for_monitor(device, target_monitor)?;
    let duplication = unsafe { output1.DuplicateOutput(device) }?;
    Ok((duplication, desktop_rect))
}

fn run_capture_loop(
    duplication_output: (IDXGIOutputDuplication, ID3D11Device, ID3D11DeviceContext),
    target_monitor: isize,
    mut frame_width: u32,
    mut frame_height: u32,
    crop: Option<windows::Win32::Graphics::Direct3D11::D3D11_BOX>,
    show_cursor: bool,
    control_rx: std::sync::mpsc::Receiver<ThreadMessage>,
    armed: Arc<AtomicBool>,
    mut on_frame: impl FnMut(Frame) -> windows::core::Result<()> + Send + 'static,
    mut on_closed: impl FnMut() -> windows::core::Result<()> + Send + 'static,
) {
    let (mut duplication, device, context) = duplication_output;
    let mut cached_shape: Option<CursorShape> = None;
    // DXGI only refreshes `PointerPosition` on a frame whose
    // `LastMouseUpdateTime` is non-zero; on any other frame it reads back as
    // all zeros. Position/visibility are cached across frames the same way
    // the shape already is, so the cursor doesn't flicker out on desktop-only
    // update frames.
    let mut cached_position: (i32, i32) = (0, 0);
    let mut cached_visible = false;
    let mut out_width = crop.map(|c| c.right - c.left).unwrap_or(frame_width);
    let mut out_height = crop.map(|c| c.bottom - c.top).unwrap_or(frame_height);

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
                None => {
                    // `AcquireNextFrame` succeeded but handed back no resource --
                    // the frame is still considered acquired, so it must be
                    // released or every subsequent `AcquireNextFrame` call fails
                    // with `DXGI_ERROR_INVALID_CALL`.
                    let _ = unsafe { duplication.ReleaseFrame() };
                    continue;
                }
            },
            Err(e) if e.code() == DXGI_ERROR_WAIT_TIMEOUT => continue,
            Err(e) if e.code() == DXGI_ERROR_ACCESS_LOST => {
                tracing::warn!("DXGI duplication access lost, recreating");
                let monitor = windows::Win32::Graphics::Gdi::HMONITOR(target_monitor as *mut core::ffi::c_void);

                let mut recovered = None;
                for attempt in 0..ACCESS_LOST_MAX_RETRIES {
                    match recover_duplication(&device, monitor) {
                        Ok(result) => {
                            recovered = Some(result);
                            break;
                        }
                        Err(e) => {
                            tracing::warn!(
                                error = %e,
                                attempt,
                                "Failed to recreate DXGI duplication, retrying"
                            );
                            std::thread::sleep(std::time::Duration::from_millis(
                                ACCESS_LOST_RETRY_DELAY_MS,
                            ));
                        }
                    }
                }

                match recovered {
                    Some((new_dup, desktop_rect)) => {
                        duplication = new_dup;
                        frame_width = (desktop_rect.right - desktop_rect.left) as u32;
                        frame_height = (desktop_rect.bottom - desktop_rect.top) as u32;
                        if crop.is_none() {
                            out_width = frame_width;
                            out_height = frame_height;
                        }
                        continue;
                    }
                    None => {
                        tracing::error!(
                            "Failed to recreate DXGI duplication after access lost, giving up"
                        );
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

        // The desktop frame must be released promptly regardless of whether
        // the work below it succeeds -- `AcquireNextFrame` fails with
        // `DXGI_ERROR_INVALID_CALL` on the next call if the previous frame
        // was never released, and `GetFramePointerShape` (inside
        // `read_pointer_shape`) is only valid to call while the frame is
        // still owned, so it must run *before* `ReleaseFrame`, not after.
        let owned_result = (|| -> windows::core::Result<(ID3D11Texture2D, Option<CursorShape>)> {
            let acquired: ID3D11Texture2D = resource.cast()?;
            let output_texture = create_output_texture(&device, out_width, out_height)?;

            if let Some(crop_box) = crop {
                unsafe {
                    context.CopySubresourceRegion(&output_texture, 0, 0, 0, 0, &acquired, 0, Some(&crop_box))
                };
            } else {
                unsafe { context.CopyResource(&output_texture, &acquired) };
            }

            let shape = read_pointer_shape(&duplication, &frame_info)?;

            Ok((output_texture, shape))
        })();

        let release_result = unsafe { duplication.ReleaseFrame() };

        let (output_texture, shape) = match owned_result {
            Ok(v) => v,
            Err(e) => {
                tracing::warn!(error = %e, "DXGI frame processing failed, continuing");
                if let Err(e) = release_result {
                    tracing::warn!(error = %e, "DXGI ReleaseFrame failed, continuing");
                }
                continue;
            }
        };
        if let Err(e) = release_result {
            tracing::warn!(error = %e, "DXGI ReleaseFrame failed, continuing");
        }

        if let Some(shape) = shape {
            cached_shape = Some(shape);
        }

        if frame_info.LastMouseUpdateTime != 0 {
            cached_visible = frame_info.PointerPosition.Visible.as_bool();
            cached_position = (
                frame_info.PointerPosition.Position.x,
                frame_info.PointerPosition.Position.y,
            );
        }

        let result = (|| -> windows::core::Result<()> {
            if show_cursor
                && cached_visible
                && let Some(shape) = &cached_shape
            {
                let crop_left = crop.map(|c| c.left as i32).unwrap_or(0);
                let crop_top = crop.map(|c| c.top as i32).unwrap_or(0);
                // `DXGI_OUTDUPL_POINTER_POSITION::Position` is already the
                // top-left of the pointer bitmap in desktop coordinates --
                // Windows has already applied the hotspot offset, so it must
                // not be subtracted again here (only our own crop offset is
                // ours to account for).
                composite_cursor(
                    &device,
                    &context,
                    &output_texture,
                    out_width,
                    out_height,
                    cached_position.0 - crop_left,
                    cached_position.1 - crop_top,
                    shape,
                )?;
            }

            // Frames must still be acquired and released as normal even
            // before `start()` is called (releasing promptly is required
            // regardless), but delivery to `on_frame` is gated on `armed` so
            // no frame reaches the pipeline before the caller actually
            // started recording.
            if !armed.load(Ordering::Acquire) {
                return Ok(());
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
            find_output_for_monitor(&device, target_monitor).map_err(NewCapturerError::OutputNotFound)?;

        let duplication = unsafe { output1.DuplicateOutput(&device) }
            .map_err(NewCapturerError::DuplicateOutput)?;

        let context = unsafe { device.GetImmediateContext() }.map_err(NewCapturerError::Context)?;

        if let Ok(multithread) = device.cast::<ID3D11Multithread>() {
            unsafe {
                let _ = multithread.SetMultithreadProtected(true);
            }
        }

        let frame_width = (desktop_rect.right - desktop_rect.left) as u32;
        let frame_height = (desktop_rect.bottom - desktop_rect.top) as u32;

        let (control_tx, control_rx) = std::sync::mpsc::channel();
        let stop_flag = Arc::new(AtomicBool::new(false));
        let armed = Arc::new(AtomicBool::new(false));
        let armed_for_loop = armed.clone();

        let crop = settings.crop;
        let show_cursor = settings.show_cursor;
        // `HMONITOR` wraps a raw pointer and so isn't `Send`; carry it across
        // the thread boundary as its underlying integer value and rebuild the
        // handle from that on the capture thread (it's never dereferenced,
        // only passed back into Win32 APIs that accept it as an opaque id).
        let target_monitor_raw = target_monitor.0 as isize;
        let thread = std::thread::Builder::new()
            .name("dxgi-duplication-capture".into())
            .spawn(move || {
                run_capture_loop(
                    (duplication, device, context),
                    target_monitor_raw,
                    frame_width,
                    frame_height,
                    crop,
                    show_cursor,
                    control_rx,
                    armed_for_loop,
                    on_frame,
                    on_closed,
                )
            })
            .map_err(|e| NewCapturerError::Other(windows::core::Error::from(std::io::Error::from(e))))?;

        Ok(Self {
            stop_flag,
            armed,
            control_tx,
            thread: Some(thread),
        })
    }

    pub fn start(&mut self) -> windows::core::Result<()> {
        // The capture loop starts pulling (and releasing) frames as soon as
        // the thread is spawned in `new`, but delivery to `on_frame` is
        // gated on `armed` -- this is what makes `start()` meaningful, in
        // parity with WGC's `session.StartCapture()`.
        self.armed.store(true, Ordering::Release);
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
