# Deferred: studio editor

The studio editor was removed on 2026-09-16 and will be rebuilt when it is needed. The last commit
that still has it is `bc0e70b` on `dev` (`fix(desktop): pad the goal dialog`); restore pieces with
`git show bc0e70b:<path>`.

What it consisted of:

- Desktop editor: `apps/desktop/src/features/media/studio/` (timeline, clips, preview, render
  panel), routes `/studio/:videoId` and `/studio/local/:recordingId`, "Record (Studio)" in the draft
  media panel, render/export steps in `features/media/pipeline.ts` (`renderStudio`,
  `exportAndPublish`).
- Desktop Rust: `studio_project_info`, `export_studio`, `cancel_job` in `src-tauri/src/commands.rs`;
  cloud import in `src-tauri/src/source_import.rs`; studio recording mode in `recorder.rs`.
- `crates/lare-recording`: studio recording actor, `edit.rs` (`StudioEdit`, `apply_edit`),
  `export_studio` over `cap-export`, remux and per-track helpers, `examples/export_smoke.rs`.
- Web: `apps/web/app/studio/[videoId]` and links from drafts, posts and sessions.
- Supabase: `functions/bunny-download-source` (signed MP4 rendition for cloud import) and
  `docs/cloud-studio.md` (the Bunny library settings it needed). Undeploy the function from
  Supabase; the `studio` value of the `video_mode` enum is still in the database.
