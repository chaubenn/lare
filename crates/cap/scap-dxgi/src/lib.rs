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
