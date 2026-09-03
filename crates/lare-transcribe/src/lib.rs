//! whisper.cpp transcription for Lare.
//!
//! 1. [`ensure_model`] downloads a ggml model (`ggml-small.en.bin` by default) into a models dir.
//! 2. [`decode_to_pcm16k`] uses ffmpeg to decode any audio/video file to 16 kHz mono f32.
//! 3. [`transcribe_file`] runs whisper and returns timestamped [`Segment`]s (ms, media-relative),
//!    the same `{s, e, text}` shape stored in `transcripts.segments`.

use std::path::{Path, PathBuf};

use anyhow::{Context, anyhow};
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use whisper_rs::{FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters};

pub const SAMPLE_RATE: u32 = 16_000;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ModelKind {
    TinyEn,
    BaseEn,
    SmallEn,
    MediumEn,
}

impl ModelKind {
    pub fn file_name(self) -> &'static str {
        match self {
            ModelKind::TinyEn => "ggml-tiny.en.bin",
            ModelKind::BaseEn => "ggml-base.en.bin",
            ModelKind::SmallEn => "ggml-small.en.bin",
            ModelKind::MediumEn => "ggml-medium.en.bin",
        }
    }

    pub fn url(self) -> String {
        format!(
            "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/{}",
            self.file_name()
        )
    }

    /// Approximate download size in MB (for UI).
    pub fn approx_mb(self) -> u32 {
        match self {
            ModelKind::TinyEn => 75,
            ModelKind::BaseEn => 142,
            ModelKind::SmallEn => 466,
            ModelKind::MediumEn => 1500,
        }
    }

    pub fn label(self) -> &'static str {
        match self {
            ModelKind::TinyEn => "tiny.en (fastest, least accurate)",
            ModelKind::BaseEn => "base.en (fast)",
            ModelKind::SmallEn => "small.en (recommended)",
            ModelKind::MediumEn => "medium.en (slow, most accurate)",
        }
    }
}

/// A transcript segment: start/end in milliseconds from the start of the audio.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Segment {
    pub s: u64,
    pub e: u64,
    pub text: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Progress {
    Download { received: u64, total: Option<u64> },
    Decoding,
    Transcribing { percent: u32 },
}

/// Ensure the model file exists locally, downloading it if needed. Returns its path.
pub async fn ensure_model<F>(models_dir: &Path, kind: ModelKind, mut on_progress: F) -> anyhow::Result<PathBuf>
where
    F: FnMut(Progress),
{
    tokio::fs::create_dir_all(models_dir).await?;
    let path = models_dir.join(kind.file_name());
    if let Ok(meta) = tokio::fs::metadata(&path).await {
        if meta.len() > 1_000_000 {
            return Ok(path);
        }
    }
    let tmp = models_dir.join(format!("{}.part", kind.file_name()));
    let client = reqwest::Client::builder()
        .user_agent(concat!("lare-desktop/", env!("CARGO_PKG_VERSION")))
        .build()?;
    let res = client.get(kind.url()).send().await?.error_for_status()?;
    let total = res.content_length();
    let mut file = tokio::fs::File::create(&tmp).await?;
    let mut stream = res.bytes_stream();
    let mut received = 0u64;
    use tokio::io::AsyncWriteExt;
    while let Some(chunk) = stream.next().await {
        let chunk = chunk?;
        file.write_all(&chunk).await?;
        received += chunk.len() as u64;
        on_progress(Progress::Download { received, total });
    }
    file.flush().await?;
    drop(file);
    tokio::fs::rename(&tmp, &path).await?;
    Ok(path)
}

/// Decode any container/codec ffmpeg understands into 16 kHz mono f32 samples.
pub fn decode_to_pcm16k(input: &Path) -> anyhow::Result<Vec<f32>> {
    ffmpeg::init().ok();
    let mut ictx = ffmpeg::format::input(input)
        .with_context(|| format!("opening {}", input.display()))?;
    let stream = ictx
        .streams()
        .best(ffmpeg::media::Type::Audio)
        .ok_or_else(|| anyhow!("no audio stream in {}", input.display()))?;
    let stream_index = stream.index();
    let codec_ctx = ffmpeg::codec::context::Context::from_parameters(stream.parameters())?;
    let mut decoder = codec_ctx.decoder().audio()?;
    if decoder.channel_layout().is_empty() {
        decoder.set_channel_layout(ffmpeg::ChannelLayout::default(decoder.channels() as i32));
    }

    let mut resampler = ffmpeg::software::resampling::Context::get(
        decoder.format(),
        decoder.channel_layout(),
        decoder.rate(),
        ffmpeg::format::Sample::F32(ffmpeg::format::sample::Type::Packed),
        ffmpeg::ChannelLayout::MONO,
        SAMPLE_RATE,
    )?;

    let mut out: Vec<f32> = Vec::new();
    let mut decoded = ffmpeg::frame::Audio::empty();
    let mut push_frame = |frame: &ffmpeg::frame::Audio, out: &mut Vec<f32>| -> anyhow::Result<()> {
        let mut resampled = ffmpeg::frame::Audio::empty();
        resampler.run(frame, &mut resampled)?;
        append_samples(&resampled, out);
        Ok(())
    };

    for (s, packet) in ictx.packets() {
        if s.index() != stream_index {
            continue;
        }
        decoder.send_packet(&packet)?;
        while decoder.receive_frame(&mut decoded).is_ok() {
            push_frame(&decoded, &mut out)?;
        }
    }
    decoder.send_eof()?;
    while decoder.receive_frame(&mut decoded).is_ok() {
        push_frame(&decoded, &mut out)?;
    }
    // Drain the resampler's delayed samples.
    loop {
        let mut more = ffmpeg::frame::Audio::empty();
        match resampler.flush(&mut more) {
            Ok(_) if more.samples() > 0 => append_samples(&more, &mut out),
            _ => break,
        }
    }
    Ok(out)
}

fn append_samples(frame: &ffmpeg::frame::Audio, out: &mut Vec<f32>) {
    let n = frame.samples();
    if n == 0 {
        return;
    }
    // Packed f32 mono: plane 0 holds n samples.
    let data = frame.data(0);
    let bytes = &data[..n * std::mem::size_of::<f32>()];
    out.extend(bytes.chunks_exact(4).map(|b| f32::from_le_bytes([b[0], b[1], b[2], b[3]])));
}

#[derive(Debug, Clone)]
pub struct TranscribeOptions {
    pub language: Option<String>,
    pub threads: Option<usize>,
    /// Domain hint that improves recognition of technical vocabulary.
    pub initial_prompt: Option<String>,
}

impl Default for TranscribeOptions {
    fn default() -> Self {
        Self {
            language: Some("en".into()),
            threads: None,
            initial_prompt: Some(
                "A software engineering mock interview about a LeetCode problem: arrays, hash maps, \
                 two pointers, binary search, dynamic programming, time complexity O(n), O(n log n), \
                 O(n^2), edge cases, test cases."
                    .into(),
            ),
        }
    }
}

/// Transcribe 16 kHz mono PCM. Blocking and CPU/GPU heavy: call from `spawn_blocking`.
pub fn transcribe_pcm<F>(
    model_path: &Path,
    pcm: &[f32],
    opts: &TranscribeOptions,
    mut on_progress: F,
) -> anyhow::Result<Vec<Segment>>
where
    F: FnMut(Progress) + Send + 'static,
{
    if pcm.len() < SAMPLE_RATE as usize / 2 {
        return Ok(Vec::new());
    }
    let ctx = WhisperContext::new_with_params(
        model_path
            .to_str()
            .ok_or_else(|| anyhow!("model path is not UTF-8"))?,
        WhisperContextParameters::default(),
    )
    .map_err(|e| anyhow!("loading whisper model: {e}"))?;
    let mut state = ctx.create_state().map_err(|e| anyhow!("whisper state: {e}"))?;

    let mut params = FullParams::new(SamplingStrategy::Greedy { best_of: 1 });
    let threads = opts
        .threads
        .unwrap_or_else(|| std::thread::available_parallelism().map(|n| n.get()).unwrap_or(4).min(8));
    params.set_n_threads(threads as i32);
    params.set_translate(false);
    params.set_language(opts.language.as_deref());
    params.set_print_special(false);
    params.set_print_progress(false);
    params.set_print_realtime(false);
    params.set_print_timestamps(false);
    params.set_token_timestamps(false);
    params.set_suppress_blank(true);
    params.set_max_len(0);
    if let Some(prompt) = &opts.initial_prompt {
        params.set_initial_prompt(prompt);
    }
    params.set_progress_callback_safe(move |p: i32| {
        on_progress(Progress::Transcribing {
            percent: p.clamp(0, 100) as u32,
        });
    });

    state
        .full(params, pcm)
        .map_err(|e| anyhow!("whisper full() failed: {e}"))?;

    let mut segments = Vec::new();
    for seg in state.as_iter() {
        let text = seg.to_str_lossy().map(|c| c.trim().to_string()).unwrap_or_default();
        if text.is_empty() || (text.starts_with('[') && text.ends_with(']')) {
            continue; // skip empty and pure non-speech markers like [BLANK_AUDIO]
        }
        // whisper timestamps are in centiseconds.
        let s = (seg.start_timestamp().max(0) as u64) * 10;
        let e = (seg.end_timestamp().max(0) as u64) * 10;
        segments.push(Segment { s, e: e.max(s), text });
    }
    Ok(segments)
}

/// Decode + transcribe a media file. Blocking; call from `spawn_blocking`.
pub fn transcribe_file<F>(
    model_path: &Path,
    input: &Path,
    opts: &TranscribeOptions,
    mut on_progress: F,
) -> anyhow::Result<Vec<Segment>>
where
    F: FnMut(Progress) + Send + 'static,
{
    on_progress(Progress::Decoding);
    let pcm = decode_to_pcm16k(input)?;
    transcribe_pcm(model_path, &pcm, opts, on_progress)
}

/// WebVTT rendering (for Bunny captions).
pub fn to_webvtt(segments: &[Segment]) -> String {
    fn ts(ms: u64) -> String {
        let h = ms / 3_600_000;
        let m = (ms % 3_600_000) / 60_000;
        let s = (ms % 60_000) / 1000;
        let f = ms % 1000;
        format!("{h:02}:{m:02}:{s:02}.{f:03}")
    }
    let mut out = String::from("WEBVTT\n\n");
    for (i, seg) in segments.iter().enumerate() {
        out.push_str(&format!(
            "{}\n{} --> {}\n{}\n\n",
            i + 1,
            ts(seg.s),
            ts(seg.e.max(seg.s + 1)),
            seg.text.trim()
        ));
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn webvtt_formats_timestamps() {
        let vtt = to_webvtt(&[Segment {
            s: 61_500,
            e: 63_000,
            text: "hello world".into(),
        }]);
        assert!(vtt.starts_with("WEBVTT\n\n1\n00:01:01.500 --> 00:01:03.000\nhello world\n"));
    }

    #[test]
    fn model_urls_point_at_ggerganov_hf() {
        assert_eq!(
            ModelKind::SmallEn.url(),
            "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.en.bin"
        );
    }
}
