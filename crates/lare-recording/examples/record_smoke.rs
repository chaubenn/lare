//! Smoke test: `cargo run -p lare-recording --example record_smoke -- [instant|studio] [seconds] [mic-label]`
//! Records the primary display and prints the resulting files.
use std::time::Duration;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let mut args = std::env::args().skip(1);
    let mode = match args.next().as_deref() {
        Some("studio") => lare_recording::RecordingMode::Studio,
        _ => lare_recording::RecordingMode::Instant,
    };
    let seconds: u64 = args.next().and_then(|s| s.parse().ok()).unwrap_or(4);
    let mic_label = args.next();

    let dir = std::env::temp_dir().join(format!("lare-smoke-{}", std::process::id()));
    let feeds = lare_recording::Feeds::spawn();
    let started = std::time::Instant::now();
    let rec = lare_recording::start(
        lare_recording::StartRequest {
            mode,
            dir: dir.clone(),
            display_id: None,
            mic_label,
            camera_id: None,
            max_fps: 30,
            max_output_size: Some(1280),
            system_audio: false,
        },
        &feeds,
    )
    .await?;
    println!("started {:?} in {:?} -> {}", mode, started.elapsed(), rec.project_path().display());
    tokio::time::sleep(Duration::from_secs(seconds)).await;
    rec.pause().await?;
    println!("paused");
    tokio::time::sleep(Duration::from_millis(800)).await;
    rec.resume().await?;
    println!("resumed");
    tokio::time::sleep(Duration::from_secs(1)).await;
    let done = rec.stop().await?;
    println!("stopped: {done:#?}");
    for entry in walk(&done.project_path) {
        let size = std::fs::metadata(&entry).map(|m| m.len()).unwrap_or(0);
        println!("  {} ({size} bytes)", entry.strip_prefix(&done.project_path).unwrap_or(&entry).display());
    }
    feeds.release_mic().await;
    Ok(())
}

fn walk(dir: &std::path::Path) -> Vec<std::path::PathBuf> {
    let mut out = Vec::new();
    if let Ok(rd) = std::fs::read_dir(dir) {
        for e in rd.flatten() {
            let p = e.path();
            if p.is_dir() {
                out.extend(walk(&p));
            } else {
                out.push(p);
            }
        }
    }
    out.sort();
    out
}
