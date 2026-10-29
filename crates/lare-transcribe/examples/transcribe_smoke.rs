//! Smoke test: `cargo run -p lare-transcribe --example transcribe_smoke -- <audio-file> [tiny-en|base-en|small-en]`
use std::path::PathBuf;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let mut args = std::env::args().skip(1);
    let input = PathBuf::from(args.next().expect("audio file path"));
    let kind = match args.next().as_deref() {
        Some("base-en") => lare_transcribe::ModelKind::BaseEn,
        Some("small-en") => lare_transcribe::ModelKind::SmallEn,
        _ => lare_transcribe::ModelKind::TinyEn,
    };
    let models_dir = dirs_fallback().join("models");
    let model = lare_transcribe::ensure_model(&models_dir, kind, |p| {
        if let lare_transcribe::Progress::Download { received, total } = p {
            if received % (8 * 1024 * 1024) < 65536 {
                eprintln!("download {received}/{}", total.map(|t| t.to_string()).unwrap_or("?".into()));
            }
        }
    })
    .await?;
    eprintln!("model: {}", model.display());

    let t0 = std::time::Instant::now();
    let pcm = lare_transcribe::decode_to_pcm16k(&input)?;
    eprintln!("decoded {} samples ({:.1}s) in {:?}", pcm.len(), pcm.len() as f32 / 16000.0, t0.elapsed());

    let t1 = std::time::Instant::now();
    let segments = tokio::task::spawn_blocking(move || {
        lare_transcribe::transcribe_pcm(&model, &pcm, &lare_transcribe::TranscribeOptions::default(), |p| {
            if let lare_transcribe::Progress::Transcribing { percent } = p {
                eprintln!("transcribing {percent}%");
            }
        })
    })
    .await??;
    eprintln!("transcribed in {:?}", t1.elapsed());
    for s in &segments {
        println!("[{:>7} -> {:>7}] {}", s.s, s.e, s.text);
    }
    print!("{}", lare_transcribe::to_webvtt(&segments));
    Ok(())
}

fn dirs_fallback() -> PathBuf {
    std::env::var_os("HOME")
        .map(PathBuf::from)
        .unwrap_or_else(std::env::temp_dir)
        .join(".lare")
}
