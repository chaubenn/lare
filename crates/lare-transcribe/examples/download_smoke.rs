//! Smoke test: `cargo run -p lare-transcribe --example download_smoke`
//!
//! Verifies the model downloader end to end against the live mirror:
//! 1. plants a corrupt orphan `.part` file (the exact state that caused the checksum
//!    failure in the app) and confirms it is discarded instead of resumed;
//! 2. downloads the model fresh, in parallel chunks, and confirms the SHA-256 passes.
use std::path::PathBuf;

use lare_transcribe::{ModelKind, Progress, ensure_model};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let kind = ModelKind::TinyEn;
    let dir = std::env::var("LARE_SMOKE_MODELS_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|_| std::env::temp_dir().join("lare-download-smoke"));
    tokio::fs::create_dir_all(&dir).await?;

    let part = dir.join(format!("{}.part", kind.file_name()));
    tokio::fs::write(&part, vec![0xABu8; 41_943_040]).await?;
    println!("planted corrupt orphan .part (40 MiB of 0xAB)");

    let mut last = 0u64;
    let path = ensure_model(&dir, kind, |p| {
        if let Progress::Download { received, total } = p {
            if received >= last + 8 * 1024 * 1024 || Some(received) == total {
                last = received;
                println!(
                    "download {}/{} bytes",
                    received,
                    total.map_or("?".to_string(), |t| t.to_string())
                );
            }
        }
    })
    .await?;

    let meta = tokio::fs::metadata(&path).await?;
    assert_eq!(meta.len(), kind.size(), "model file is the exact size");
    assert!(
        !tokio::fs::try_exists(&part).await.unwrap_or(false),
        "partial file is gone"
    );
    println!("OK: {} verified ({} bytes)", path.display(), meta.len());
    Ok(())
}
