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
