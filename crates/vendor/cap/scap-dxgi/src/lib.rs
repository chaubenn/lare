#![cfg(windows)]

mod capturer;
mod cursor;
mod output;

pub use capturer::{Capturer, Frame, FrameBuffer};
pub use scap_direct3d::PixelFormat;

use windows::Win32::Graphics::Direct3D11::D3D11_BOX;

#[derive(Clone, Debug)]
pub struct Settings {
    pub crop: Option<D3D11_BOX>,
    pub show_cursor: bool,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            crop: None,
            show_cursor: true,
        }
    }
}

#[derive(Debug, thiserror::Error)]
pub enum NewCapturerError {
    #[error("OutputNotFound: {0}")]
    OutputNotFound(windows::core::Error),
    #[error("DuplicateOutput: {0}")]
    DuplicateOutput(windows::core::Error),
    #[error("GetImmediateContext: {0}")]
    Context(windows::core::Error),
    #[error("CreateTexture2D: {0}")]
    CreateTexture(windows::core::Error),
    #[error("Other: {0}")]
    Other(#[from] windows::core::Error),
}
