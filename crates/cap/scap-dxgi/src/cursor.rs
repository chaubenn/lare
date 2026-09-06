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
    // kept for documentation -- DXGI_OUTDUPL_POINTER_POSITION::Position
    // already accounts for the hotspot, so these aren't used in
    // compositing; do not resurrect the subtraction.
    #[allow(dead_code)]
    pub hotspot_x: i32,
    #[allow(dead_code)]
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
