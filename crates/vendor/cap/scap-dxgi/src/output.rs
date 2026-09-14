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
