//! Extract a JPEG poster frame from a video file with ffmpeg.

use std::path::Path;

use anyhow::{Context, anyhow};

/// Decode the first frame at or after `at_ms`, scale it to `max_width`, and write a JPEG.
/// Blocking; call from `spawn_blocking`.
pub fn extract_jpeg(video: &Path, output: &Path, at_ms: u64, max_width: u32) -> anyhow::Result<()> {
    ffmpeg::init().ok();
    let mut ictx = ffmpeg::format::input(video).with_context(|| format!("opening {}", video.display()))?;
    let stream = ictx
        .streams()
        .best(ffmpeg::media::Type::Video)
        .ok_or_else(|| anyhow!("no video stream in {}", video.display()))?;
    let stream_index = stream.index();
    let time_base = stream.time_base();
    let ctx = ffmpeg::codec::context::Context::from_parameters(stream.parameters())?;
    let mut decoder = ctx.decoder().video()?;

    // Seek near the target (backwards to a keyframe), then decode forward.
    let target_ts = (at_ms as f64 / 1000.0 / (time_base.numerator() as f64 / time_base.denominator() as f64)) as i64;
    if at_ms > 0 {
        let _ = ictx.seek(target_ts, ..target_ts);
    }

    let src_w = decoder.width();
    let src_h = decoder.height();
    if src_w == 0 || src_h == 0 {
        return Err(anyhow!("video has no dimensions"));
    }
    let out_w = src_w.min(max_width.max(64));
    let out_h = ((src_h as u64 * out_w as u64) / src_w as u64).max(1) as u32;
    let mut scaler = ffmpeg::software::scaling::Context::get(
        decoder.format(),
        src_w,
        src_h,
        ffmpeg::format::Pixel::RGB24,
        out_w & !1,
        out_h & !1,
        ffmpeg::software::scaling::Flags::BILINEAR,
    )?;

    let mut decoded = ffmpeg::frame::Video::empty();
    let mut chosen: Option<ffmpeg::frame::Video> = None;
    'outer: for (s, packet) in ictx.packets() {
        if s.index() != stream_index {
            continue;
        }
        decoder.send_packet(&packet)?;
        while decoder.receive_frame(&mut decoded).is_ok() {
            let pts = decoded.pts().unwrap_or(0);
            if at_ms == 0 || pts >= target_ts {
                let mut rgb = ffmpeg::frame::Video::empty();
                scaler.run(&decoded, &mut rgb)?;
                chosen = Some(rgb);
                break 'outer;
            }
        }
    }
    if chosen.is_none() {
        decoder.send_eof()?;
        while decoder.receive_frame(&mut decoded).is_ok() {
            let mut rgb = ffmpeg::frame::Video::empty();
            scaler.run(&decoded, &mut rgb)?;
            chosen = Some(rgb);
        }
    }
    let frame = chosen.ok_or_else(|| anyhow!("could not decode a frame from {}", video.display()))?;

    let w = frame.width();
    let h = frame.height();
    let stride = frame.stride(0);
    let data = frame.data(0);
    let mut img = image::RgbImage::new(w, h);
    for y in 0..h as usize {
        let row = &data[y * stride..y * stride + (w as usize) * 3];
        for x in 0..w as usize {
            img.put_pixel(x as u32, y as u32, image::Rgb([row[x * 3], row[x * 3 + 1], row[x * 3 + 2]]));
        }
    }
    if let Some(parent) = output.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let mut out = std::fs::File::create(output)?;
    let mut encoder = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut out, 85);
    encoder.encode_image(&img)?;
    Ok(())
}

/// Duration of a media file in milliseconds (container metadata).
pub fn duration_ms(video: &Path) -> Option<u64> {
    probe(video).ok().and_then(|m| m.duration_ms)
}

/// Container-level facts about a media file.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaInfo {
    pub duration_ms: Option<u64>,
    /// Dimensions of the first video stream (`None` for audio-only files).
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub has_audio: bool,
}

/// Read duration and video dimensions without decoding frames.
pub fn probe(path: &Path) -> anyhow::Result<MediaInfo> {
    ffmpeg::init().ok();
    let ictx = ffmpeg::format::input(path).with_context(|| format!("opening {}", path.display()))?;
    let d = ictx.duration();
    let duration_ms = (d > 0).then(|| (d as u64 * 1000) / ffmpeg::ffi::AV_TIME_BASE as u64);
    let mut width = None;
    let mut height = None;
    let mut has_audio = false;
    for stream in ictx.streams() {
        let params = stream.parameters();
        match params.medium() {
            ffmpeg::media::Type::Video if width.is_none() => {
                if let Ok(ctx) = ffmpeg::codec::context::Context::from_parameters(params) {
                    if let Ok(v) = ctx.decoder().video() {
                        if v.width() > 0 && v.height() > 0 {
                            width = Some(v.width());
                            height = Some(v.height());
                        }
                    }
                }
            }
            ffmpeg::media::Type::Audio => has_audio = true,
            _ => {}
        }
    }
    Ok(MediaInfo {
        duration_ms,
        width,
        height,
        has_audio,
    })
}
