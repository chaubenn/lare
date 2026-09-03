# Local changes to vendored Cap crates

Upstream: https://github.com/CapSoftware/Cap @ `ff25b5a6c28df0db0da4e929721e0e507b796f62`
Re-sync with `scripts/sync-cap.sh <ref>`; the edits below are re-applied automatically.

- `workspace-hack` replaced by a slim feature-unification crate (no axum/clap/schemars/tauri-utils/reqwest fork).
- Upstream `examples/`, `tests/`, `benches/` directories and their manifest tables removed.
- `editor/Cargo.toml`: unused `sentry` dependency removed.
- `vendor/wgpu-hal` copied verbatim (patched via root `[patch.crates-io]`).
- `vendor/cidre` (Cap fork @ bf84b67079a8) with `build.rs` replaced by `scripts/patches/cidre-build.rs`:
  the pomace Objective-C shims are compiled with the `cc` crate (`-fobjc-arc -fmodules -fno-common`)
  instead of `xcodebuild`, so full Xcode is not required to build on macOS.
