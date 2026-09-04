//! whisper.cpp transcription for Lare.
//!
//! 1. [`ensure_model`] downloads a ggml model (`ggml-small.en.bin` by default) into a models dir.
//! 2. [`decode_to_pcm16k`] uses ffmpeg to decode any audio/video file to 16 kHz mono f32.
//! 3. [`transcribe_file`] runs whisper and returns timestamped [`Segment`]s (ms, media-relative),
//!    the same `{s, e, text}` shape stored in `transcripts.segments`.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, OnceLock};
use std::time::Duration;

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

/// Project mirror of the upstream ggml models, published by `.github/workflows/publish-models.yml`.
/// GitHub release assets are served from a fast CDN; HuggingFace is the fallback.
pub const GITHUB_MODELS_BASE: &str =
    "https://github.com/chaubenn/lare/releases/download/whisper-models";

impl ModelKind {
    /// Exact file size in bytes (from the upstream LFS pointer). Lets the downloader plan ranged
    /// requests and preallocate the file without trusting the server's headers.
    pub fn size(self) -> u64 {
        match self {
            ModelKind::TinyEn => 77_704_715,
            ModelKind::BaseEn => 147_964_211,
            ModelKind::SmallEn => 487_614_201,
            ModelKind::MediumEn => 1_533_774_781,
        }
    }

    /// Upstream SHA-256 of the file; verified after every download.
    pub fn sha256(self) -> &'static str {
        match self {
            ModelKind::TinyEn => "921e4cf8686fdd993dcd081a5da5b6c365bfde1162e72b08d75ac75289920b1f",
            ModelKind::BaseEn => "a03779c86df3323075f5e796cb2ce5029f00ec8869eee3fdfb897afe36c6d002",
            ModelKind::SmallEn => {
                "c6138d6d58ecc8322097e0f987c32f1be8bb0a18532a3f88f734d1bbf9c41e5d"
            }
            ModelKind::MediumEn => {
                "cc37e93478338ec7700281a7ac30a10128929eb8f427dda2e865faa8f6da4356"
            }
        }
    }

    /// Download sources in order of preference: an operator override (`LARE_MODEL_BASE_URL`),
    /// the project's GitHub release mirror, then HuggingFace upstream.
    pub fn urls(self) -> Vec<String> {
        let mut urls = Vec::with_capacity(3);
        if let Ok(base) = std::env::var("LARE_MODEL_BASE_URL") {
            let base = base.trim().trim_end_matches('/');
            if !base.is_empty() {
                urls.push(format!("{base}/{}", self.file_name()));
            }
        }
        urls.push(format!("{GITHUB_MODELS_BASE}/{}", self.file_name()));
        urls.push(self.url());
        urls
    }
}

/// Progress events are throttled to this cadence so the webview is not flooded with one IPC
/// message per network chunk (thousands per second), which freezes the UI.
const PROGRESS_INTERVAL: Duration = Duration::from_millis(200);

/// Models are fetched as many ranged requests in parallel. HuggingFace's CDN throttles a single
/// connection to a few dozen KB/s from some networks (a 466 MB model would take hours), but each
/// connection gets its own budget, so eight in flight bring that down to minutes.
const CHUNK_BYTES: u64 = 8 * 1024 * 1024;
const PARALLEL_CHUNKS: usize = 8;
const CHUNK_ATTEMPTS: u32 = 4;

/// One download at a time: the settings page and a transcription job may race for the same
/// model file, and two writers on one `.part` file corrupt it.
static DOWNLOAD_LOCK: OnceLock<tokio::sync::Mutex<()>> = OnceLock::new();

/// Latest progress of the in-flight download, so callers waiting for the lock can still report
/// something meaningful instead of sitting at 0 bytes.
static LATEST_DOWNLOAD: std::sync::Mutex<Option<Progress>> = std::sync::Mutex::new(None);

fn publish_download(p: Progress) {
    if let Ok(mut latest) = LATEST_DOWNLOAD.lock() {
        *latest = Some(p);
    }
}

/// A finished model is exactly the upstream file: anything else is a partial or corrupt download.
async fn is_complete_model(path: &Path, kind: ModelKind) -> bool {
    tokio::fs::metadata(path)
        .await
        .map(|m| m.is_file() && m.len() == kind.size())
        .unwrap_or(false)
}

/// Ensure the model file exists locally, downloading it if needed. Returns its path.
///
/// Downloads are ranged and parallel, resume from where an interrupted attempt stopped
/// (`<model>.part` + `<model>.part.json`), time out when a connection stalls instead of hanging,
/// and are verified against the upstream SHA-256 before the file is renamed into place.
pub async fn ensure_model<F>(
    models_dir: &Path,
    kind: ModelKind,
    mut on_progress: F,
) -> anyhow::Result<PathBuf>
where
    F: FnMut(Progress),
{
    tokio::fs::create_dir_all(models_dir)
        .await
        .with_context(|| format!("creating {}", models_dir.display()))?;
    let path = models_dir.join(kind.file_name());
    if is_complete_model(&path, kind).await {
        return Ok(path);
    }
    let lock = DOWNLOAD_LOCK.get_or_init(|| tokio::sync::Mutex::new(()));
    let _guard = loop {
        match lock.try_lock() {
            Ok(guard) => break guard,
            Err(_) => {
                // Someone else is downloading (possibly a different model); mirror their
                // progress so this caller's UI moves too, and bail out early once our file lands.
                if is_complete_model(&path, kind).await {
                    return Ok(path);
                }
                if let Some(p) = LATEST_DOWNLOAD.lock().ok().and_then(|l| *l) {
                    on_progress(p);
                }
                tokio::time::sleep(PROGRESS_INTERVAL).await;
            }
        }
    };
    // Another caller may have finished the download while we waited for the lock.
    if is_complete_model(&path, kind).await {
        return Ok(path);
    }
    let result = download_model(&path, kind, &mut |p| {
        publish_download(p);
        on_progress(p);
    })
    .await
    .with_context(|| format!("downloading {}", kind.file_name()));
    if let Ok(mut latest) = LATEST_DOWNLOAD.lock() {
        *latest = None;
    }
    result?;
    Ok(path)
}

/// Resume bookkeeping for a partially downloaded model.
#[derive(Debug, Clone, Serialize, Deserialize)]
struct PartState {
    chunk_bytes: u64,
    size: u64,
    /// Indices of chunks fully written to the `.part` file.
    done: Vec<u32>,
}

fn chunk_count(size: u64) -> usize {
    size.div_ceil(CHUNK_BYTES) as usize
}

/// Inclusive byte range of chunk `i`.
fn chunk_bounds(i: usize, size: u64) -> (u64, u64) {
    let start = i as u64 * CHUNK_BYTES;
    let end = (start + CHUNK_BYTES).min(size) - 1;
    (start, end)
}

fn write_at(file: &std::fs::File, offset: u64, buf: &[u8]) -> std::io::Result<()> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::FileExt;
        file.write_all_at(buf, offset)
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::FileExt;
        let mut written = 0usize;
        while written < buf.len() {
            let n = file.seek_write(&buf[written..], offset + written as u64)?;
            if n == 0 {
                return Err(std::io::Error::new(
                    std::io::ErrorKind::WriteZero,
                    "seek_write wrote nothing",
                ));
            }
            written += n;
        }
        Ok(())
    }
}

fn http_client() -> anyhow::Result<reqwest::Client> {
    Ok(reqwest::Client::builder()
        .user_agent(concat!("lare-desktop/", env!("CARGO_PKG_VERSION")))
        .connect_timeout(Duration::from_secs(20))
        // Time between bytes, not for the whole transfer.
        .read_timeout(Duration::from_secs(45))
        .build()?)
}

/// First source that serves ranged requests for this model.
async fn pick_source(client: &reqwest::Client, kind: ModelKind) -> anyhow::Result<String> {
    let mut failures = Vec::new();
    for url in kind.urls() {
        let probe = client
            .get(&url)
            .header(reqwest::header::RANGE, "bytes=0-0")
            .send()
            .await;
        match probe {
            Ok(res) if res.status() == reqwest::StatusCode::PARTIAL_CONTENT => return Ok(url),
            Ok(res) => failures.push(format!("{url}: HTTP {}", res.status())),
            Err(e) => failures.push(format!("{url}: {e}")),
        }
    }
    anyhow::bail!("no download source is reachable:\n{}", failures.join("\n"))
}

/// Stream `bytes={start}-{end}` into the file at `start`, returning how many bytes landed.
/// Bytes are written as they arrive, so a dropped connection keeps everything received so far.
async fn fetch_range(
    client: &reqwest::Client,
    url: &str,
    start: u64,
    end: u64,
    file: &std::fs::File,
    received: &AtomicU64,
) -> (u64, anyhow::Result<()>) {
    let want = end - start + 1;
    let mut got = 0u64;
    let res = match client
        .get(url)
        .header(reqwest::header::RANGE, format!("bytes={start}-{end}"))
        .send()
        .await
    {
        Ok(res) => res,
        Err(e) => return (0, Err(e.into())),
    };
    if res.status() != reqwest::StatusCode::PARTIAL_CONTENT {
        return (
            0,
            Err(anyhow!(
                "server ignored the range request (HTTP {})",
                res.status()
            )),
        );
    }
    let mut stream = res.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = match chunk {
            Ok(c) => c,
            Err(e) => return (got, Err(anyhow!(e).context("connection dropped mid-chunk"))),
        };
        if got + chunk.len() as u64 > want {
            return (got, Err(anyhow!("server sent more bytes than requested")));
        }
        // pwrite of a network-sized buffer is microseconds on local storage; not worth a hop
        // to the blocking pool per packet.
        if let Err(e) = write_at(file, start + got, &chunk) {
            return (got, Err(anyhow!(e).context("writing model chunk")));
        }
        got += chunk.len() as u64;
        received.fetch_add(chunk.len() as u64, Ordering::Relaxed);
    }
    if got != want {
        return (got, Err(anyhow!("short read: {got} of {want} bytes")));
    }
    (got, Ok(()))
}

/// Download chunk `index` completely. Each retry continues from the bytes already written, so
/// a CDN that cuts long-lived connections (HuggingFace does, on throttled links) cannot stop a
/// chunk from eventually completing; only `CHUNK_ATTEMPTS` consecutive attempts that make no
/// progress at all give up.
async fn fetch_chunk(
    client: reqwest::Client,
    url: String,
    index: usize,
    size: u64,
    file: Arc<std::fs::File>,
    received: Arc<AtomicU64>,
) -> anyhow::Result<usize> {
    let (start, end) = chunk_bounds(index, size);
    let mut have = 0u64;
    let mut stalled = 0u32;
    let mut last_err = None;
    while start + have <= end {
        if stalled > 0 {
            tokio::time::sleep(Duration::from_millis(500 * u64::from(stalled))).await;
        }
        let (got, result) = fetch_range(&client, &url, start + have, end, &file, &received).await;
        have += got;
        match result {
            Ok(()) => return Ok(index),
            Err(e) => {
                stalled = if got > 0 { 0 } else { stalled + 1 };
                tracing::warn!(index, have, stalled, error = %e, "model chunk interrupted");
                if stalled >= CHUNK_ATTEMPTS {
                    return Err(e).with_context(|| {
                        format!("chunk {index} ({start}-{end}) made no progress in {CHUNK_ATTEMPTS} attempts")
                    });
                }
                last_err = Some(e);
            }
        }
    }
    // Loop exit means every byte landed even though the final response ended with an error.
    if let Some(e) = last_err {
        tracing::debug!(index, error = %e, "chunk completed despite trailing error");
    }
    Ok(index)
}

fn sha256_file(path: &Path) -> anyhow::Result<String> {
    use sha2::Digest;
    let mut file = std::fs::File::open(path)?;
    let mut hasher = sha2::Sha256::new();
    std::io::copy(&mut file, &mut hasher)?;
    Ok(hex::encode(hasher.finalize()))
}

async fn download_model<F>(path: &Path, kind: ModelKind, on_progress: &mut F) -> anyhow::Result<()>
where
    F: FnMut(Progress),
{
    let size = kind.size();
    let n_chunks = chunk_count(size);
    let tmp = path.with_file_name(format!("{}.part", kind.file_name()));
    let state_path = path.with_file_name(format!("{}.part.json", kind.file_name()));

    // Work out which chunks an earlier attempt already wrote.
    let mut done = vec![false; n_chunks];
    if let Ok(meta) = tokio::fs::metadata(&tmp).await {
        match tokio::fs::read_to_string(&state_path).await {
            Ok(text) => {
                if let Ok(state) = serde_json::from_str::<PartState>(&text) {
                    if state.chunk_bytes == CHUNK_BYTES && state.size == size {
                        for i in state.done {
                            if let Some(d) = done.get_mut(i as usize) {
                                *d = true;
                            }
                        }
                    }
                }
            }
            Err(_) if meta.len() < size => {
                // A `.part` from the old sequential downloader: its first `len` bytes are valid.
                // (A full-size `.part` without state is a preallocated file from an attempt of
                // this downloader that died before writing its state; it holds no usable data.)
                let len = meta.len();
                for (i, d) in done.iter_mut().enumerate() {
                    *d = chunk_bounds(i, size).1 < len;
                }
            }
            Err(_) => {}
        }
    }

    let mut state = PartState {
        chunk_bytes: CHUNK_BYTES,
        size,
        done: done
            .iter()
            .enumerate()
            .filter(|(_, d)| **d)
            .map(|(i, _)| i as u32)
            .collect(),
    };

    // Find a working source before touching the disk, so an offline attempt leaves no debris.
    let client = http_client()?;
    let source = pick_source(&client, kind).await?;

    let file = std::fs::OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .open(&tmp)
        .with_context(|| format!("opening {}", tmp.display()))?;
    file.set_len(size)
        .with_context(|| format!("allocating {} bytes for {}", size, tmp.display()))?;
    let file = Arc::new(file);
    // Record the state immediately: from here on the `.part` is full-size, and without this file
    // a later attempt could not tell which chunks are real.
    tokio::fs::write(&state_path, serde_json::to_vec(&state)?)
        .await
        .with_context(|| format!("writing {}", state_path.display()))?;

    let already: u64 = done
        .iter()
        .enumerate()
        .filter(|(_, d)| **d)
        .map(|(i, _)| {
            let (s, e) = chunk_bounds(i, size);
            e - s + 1
        })
        .sum();
    let received = Arc::new(AtomicU64::new(already));
    on_progress(Progress::Download {
        received: already,
        total: Some(size),
    });
    tracing::info!(model = kind.file_name(), source = %source, resume_bytes = already, "downloading model");

    let pending: Vec<usize> = done
        .iter()
        .enumerate()
        .filter(|(_, d)| !**d)
        .map(|(i, _)| i)
        .collect();
    let mut chunks = futures_util::stream::iter(pending.into_iter().map(|i| {
        fetch_chunk(
            client.clone(),
            source.clone(),
            i,
            size,
            Arc::clone(&file),
            Arc::clone(&received),
        )
    }))
    .buffer_unordered(PARALLEL_CHUNKS);

    let mut ticker = tokio::time::interval(PROGRESS_INTERVAL);
    loop {
        tokio::select! {
            next = chunks.next() => match next {
                None => break,
                Some(Ok(index)) => {
                    state.done.push(index as u32);
                    let _ = tokio::fs::write(&state_path, serde_json::to_vec(&state)?).await;
                }
                Some(Err(e)) => return Err(e),
            },
            _ = ticker.tick() => on_progress(Progress::Download {
                received: received.load(Ordering::Relaxed),
                total: Some(size),
            }),
        }
    }
    drop(chunks);
    file.sync_all()?;
    drop(file);
    on_progress(Progress::Download {
        received: size,
        total: Some(size),
    });

    let digest = {
        let tmp = tmp.clone();
        tokio::task::spawn_blocking(move || sha256_file(&tmp))
            .await
            .context("checksum task failed")??
    };
    if digest != kind.sha256() {
        let _ = tokio::fs::remove_file(&tmp).await;
        let _ = tokio::fs::remove_file(&state_path).await;
        anyhow::bail!(
            "downloaded {} is corrupt (sha256 {digest}, expected {}); the partial file was discarded, try again",
            kind.file_name(),
            kind.sha256()
        );
    }
    tokio::fs::rename(&tmp, path)
        .await
        .with_context(|| format!("moving the model into place at {}", path.display()))?;
    let _ = tokio::fs::remove_file(&state_path).await;
    Ok(())
}

/// Decode any container/codec ffmpeg understands into 16 kHz mono f32 samples.
pub fn decode_to_pcm16k(input: &Path) -> anyhow::Result<Vec<f32>> {
    ffmpeg::init().ok();
    let mut ictx =
        ffmpeg::format::input(input).with_context(|| format!("opening {}", input.display()))?;
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
    out.extend(
        bytes
            .chunks_exact(4)
            .map(|b| f32::from_le_bytes([b[0], b[1], b[2], b[3]])),
    );
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
    let mut state = ctx
        .create_state()
        .map_err(|e| anyhow!("whisper state: {e}"))?;

    let mut params = FullParams::new(SamplingStrategy::Greedy { best_of: 1 });
    let threads = opts.threads.unwrap_or_else(|| {
        std::thread::available_parallelism()
            .map(|n| n.get())
            .unwrap_or(4)
            .min(8)
    });
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
        let text = seg
            .to_str_lossy()
            .map(|c| c.trim().to_string())
            .unwrap_or_default();
        if text.is_empty() || (text.starts_with('[') && text.ends_with(']')) {
            continue; // skip empty and pure non-speech markers like [BLANK_AUDIO]
        }
        // whisper timestamps are in centiseconds.
        let s = (seg.start_timestamp().max(0) as u64) * 10;
        let e = (seg.end_timestamp().max(0) as u64) * 10;
        segments.push(Segment {
            s,
            e: e.max(s),
            text,
        });
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
    fn chunk_bounds_cover_the_file_exactly() {
        let size = ModelKind::TinyEn.size();
        let n = chunk_count(size);
        let mut next = 0u64;
        for i in 0..n {
            let (s, e) = chunk_bounds(i, size);
            assert_eq!(s, next);
            assert!(e >= s && e - s < CHUNK_BYTES);
            next = e + 1;
        }
        assert_eq!(next, size);
    }

    #[test]
    fn sources_prefer_the_github_mirror_then_huggingface() {
        let urls = ModelKind::SmallEn.urls();
        assert!(urls[0].starts_with(GITHUB_MODELS_BASE) || urls.len() == 3);
        assert_eq!(urls.last().unwrap(), &ModelKind::SmallEn.url());
    }

    #[test]
    fn model_urls_point_at_ggerganov_hf() {
        assert_eq!(
            ModelKind::SmallEn.url(),
            "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.en.bin"
        );
    }
}
