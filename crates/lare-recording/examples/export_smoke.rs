//! Smoke test: `cargo run -p lare-recording --example export_smoke -- <project-dir> [start_s end_s]`
//! Renders a studio project (optionally trimmed to one range) to `<project>/output/result.mp4`
//! with the default edit (camera bottom-right, black background) and probes the result.
use std::path::PathBuf;

use lare_recording::edit::{StudioEdit, TimeRange, apply_edit};
use lare_recording::{ExportQuality, ExportRequest, ProjectConfiguration};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let mut args = std::env::args().skip(1);
    let project: PathBuf = args
        .next()
        .map(PathBuf::from)
        .ok_or_else(|| anyhow::anyhow!("usage: export_smoke <project-dir> [start_s end_s]"))?;
    let range = match (args.next(), args.next()) {
        (Some(s), Some(e)) => Some(TimeRange {
            start: s.parse()?,
            end: e.parse()?,
        }),
        _ => None,
    };

    lare_recording::remux_studio_if_needed(&project)?;
    let clips = lare_recording::clip_tracks(&project);
    anyhow::ensure!(!clips.is_empty(), "no display tracks in {}", project.display());
    for (path, secs) in &clips {
        println!("clip: {} ({secs:.2}s)", path.display());
    }
    let clip_durations: Vec<f64> = clips.iter().map(|(_, d)| *d).collect();

    let edit = StudioEdit {
        segments: range.into_iter().collect(),
        ..Default::default()
    };
    let config = apply_edit(ProjectConfiguration::load(&project).unwrap_or_default(), &edit, &clip_durations);
    let output = project.join("output").join("result.mp4");
    let started = std::time::Instant::now();
    let path = lare_recording::export_studio(
        ExportRequest {
            project_path: project.clone(),
            config: Some(config),
            output,
            fps: 30,
            resolution_base: None,
            quality: ExportQuality::Social,
        },
        |frame, total| {
            if frame % 30 == 0 || frame == total {
                println!("  rendered {frame}/{total}");
            }
            true
        },
    )
    .await?;
    let out_info = lare_recording::thumbnail::probe(&path)?;
    println!("exported {} in {:?}: {:?}", path.display(), started.elapsed(), out_info);
    let thumb = path.with_file_name("thumbnail.jpg");
    lare_recording::thumbnail::extract_jpeg(&path, &thumb, 500, 640)?;
    println!("thumbnail {} ({} bytes)", thumb.display(), std::fs::metadata(&thumb)?.len());
    Ok(())
}
