//! Download a model the same way the app does:
//! `cargo run -p lare-transcribe --example fetch_model -- <tiny-en|base-en|small-en|medium-en> <models-dir>`
use std::path::PathBuf;

use lare_transcribe::{ModelKind, Progress, ensure_model};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let mut args = std::env::args().skip(1);
    let name = args.next();
    let Some(kind) = name.as_deref().and_then(ModelKind::from_name) else {
        anyhow::bail!("unknown model {name:?} (expected tiny-en|base-en|small-en|medium-en)");
    };
    let dir = args
        .next()
        .map(PathBuf::from)
        .ok_or_else(|| anyhow::anyhow!("usage: fetch_model <model> <models-dir>"))?;

    let mut last = 0u64;
    let path = ensure_model(&dir, kind, |p| {
        if let Progress::Download { received, total } = p {
            if received >= last + 16 * 1024 * 1024 || Some(received) == total {
                last = received;
                let total = total.map_or("?".to_string(), |t| t.to_string());
                eprintln!("download {received}/{total} bytes");
            }
        }
    })
    .await?;
    println!("{}", path.display());
    Ok(())
}
