//! Download a whisper model with progress, e.g. `cargo run -p lare-transcribe --example download -- /tmp/models tiny-en`.
use std::time::Instant;

use lare_transcribe::{ModelKind, Progress, ensure_model};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let mut args = std::env::args().skip(1);
    let dir = std::path::PathBuf::from(args.next().unwrap_or_else(|| "/tmp/lare-models".into()));
    let kind: ModelKind = serde_json::from_value(serde_json::Value::String(
        args.next().unwrap_or_else(|| "tiny-en".into()),
    ))?;
    let started = Instant::now();
    let mut last = 0u64;
    let path = ensure_model(&dir, kind, |p| {
        if let Progress::Download { received, total } = p {
            if received / (4 << 20) != last / (4 << 20) || Some(received) == total {
                let mb = received as f64 / 1e6;
                let rate = mb / started.elapsed().as_secs_f64().max(0.001);
                println!(
                    "{mb:8.1} MB / {:.1} MB  ({rate:.1} MB/s)",
                    total.unwrap_or(0) as f64 / 1e6
                );
            }
            last = received;
        }
    })
    .await?;
    println!(
        "ready: {} in {:.1}s",
        path.display(),
        started.elapsed().as_secs_f64()
    );
    Ok(())
}
