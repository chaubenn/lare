#!/usr/bin/env bash
# Vendor the Cap (https://github.com/CapSoftware/Cap) crates that Lare's desktop app
# recycles for recording/rendering/export. Re-run to bump the pinned upstream commit.
#
#   scripts/sync-cap.sh [<commit-or-ref>]
#
# The copied crates live under crates/cap/ (same directory names as upstream so the
# relative `path = "../x"` dependencies keep working). Local modifications are listed
# in crates/cap/CHANGES.md and re-applied by this script (see `apply_local_changes`).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEST="$ROOT/crates/cap"
REF="${1:-$(cat "$DEST/UPSTREAM_COMMIT" 2>/dev/null || echo main)}"
SRC="${CAP_SRC:-$(mktemp -d)/cap}"

# Transitive closure of cap-recording + cap-export (computed from upstream Cargo.toml path deps).
CRATES=(
  audio camera camera-avfoundation camera-directshow camera-effects camera-ffmpeg
  camera-mediafoundation camera-windows cap-muxer-protocol cursor-capture cursor-info
  d3d-adapter editor enc-avfoundation enc-ffmpeg enc-gif enc-mediafoundation export fail
  ffmpeg-hw-device flags frame-converter media media-info mediafoundation-ffmpeg
  mediafoundation-utils project recording rendering scap-cpal scap-direct3d scap-ffmpeg
  scap-screencapturekit scap-targets timestamp utils video-decode
)

if [ ! -d "$SRC/.git" ]; then
  echo "Cloning Cap into $SRC"
  git clone -q --filter=blob:none https://github.com/CapSoftware/Cap "$SRC"
fi
git -C "$SRC" fetch -q origin "$REF" 2>/dev/null || true
git -C "$SRC" checkout -q "$REF"
COMMIT="$(git -C "$SRC" rev-parse HEAD)"
echo "Vendoring Cap @ $COMMIT"

mkdir -p "$DEST" "$DEST/licenses" "$DEST/vendor"
for c in "${CRATES[@]}"; do
  rm -rf "$DEST/$c"
  cp -R "$SRC/crates/$c" "$DEST/$c"
  # Drop upstream examples/tests/benches that pull in extra dev-only deps.
  rm -rf "$DEST/$c/examples" "$DEST/$c/tests" "$DEST/$c/benches"
done
rm -rf "$DEST/vendor/wgpu-hal"
cp -R "$SRC/vendor/wgpu-hal" "$DEST/vendor/wgpu-hal"
cp "$SRC/LICENSE" "$DEST/licenses/LICENSE-CAP"
cp "$SRC/licenses/LICENSE-MIT" "$DEST/licenses/LICENSE-MIT"
echo "$COMMIT" > "$DEST/UPSTREAM_COMMIT"

# Slim replacement for Cap's cargo-hakari workspace-hack (feature unification only).
mkdir -p "$DEST/workspace-hack/src"
cat > "$DEST/workspace-hack/Cargo.toml" <<'EOF'
[package]
name = "workspace-hack"
version = "0.1.0"
edition = "2021"
description = "Lare's slim stand-in for Cap's cargo-hakari workspace-hack crate."
publish = false

[dependencies]
# Features that Cap's crates rely on being unified by hakari.
tokio = { version = "1", features = ["fs", "io-util", "macros", "net", "process", "rt-multi-thread", "sync", "time"] }
serde = { version = "1", features = ["derive", "rc"] }
serde_json = { version = "1", features = ["raw_value"] }
futures-util = { version = "0.3", features = ["channel", "io", "sink"] }
uuid = { version = "1", features = ["serde", "v4", "v7"] }
tracing = { version = "0.1", features = ["log"] }
EOF
echo "// Intentionally empty: see Cargo.toml." > "$DEST/workspace-hack/src/lib.rs"

# ---------------------------------------------------------------------------
# cidre (Apple frameworks bindings). Cap pins a fork; upstream's build.rs shells out
# to `xcodebuild` for its Objective-C shims, which needs full Xcode. We vendor the
# crate and swap in scripts/patches/cidre-build.rs (compiles the shims with `cc`).
# ---------------------------------------------------------------------------
CIDRE_REV="bf84b67079a8"
CIDRE_SRC="$(ls -d "$HOME"/.cargo/git/checkouts/cidre-*/"$CIDRE_REV"* 2>/dev/null | head -1 || true)"
if [ -z "$CIDRE_SRC" ]; then
  CIDRE_CLONE="$(mktemp -d)/cidre"
  git clone -q https://github.com/CapSoftware/cidre "$CIDRE_CLONE"
  git -C "$CIDRE_CLONE" checkout -q "$CIDRE_REV"
  CIDRE_SRC="$CIDRE_CLONE"
fi
rm -rf "$DEST/vendor/cidre"
cp -R "$CIDRE_SRC/cidre" "$DEST/vendor/cidre"
cp "$CIDRE_SRC/LICENSE.txt" "$DEST/vendor/cidre/LICENSE.txt"
rm -rf "$DEST/vendor/cidre/examples" "$DEST/vendor/cidre/tests" "$DEST/vendor/cidre/benches"
cp "$ROOT/scripts/patches/cidre-build.rs" "$DEST/vendor/cidre/build.rs"
python3 - "$DEST/vendor/cidre/Cargo.toml" <<'PY2'
import re, sys
p = sys.argv[1]
s = open(p).read()
s = re.sub(r'^\[\[(example|test|bench)\]\]\n(?:(?!\[)[^\n]*\n?)*', '', s, flags=re.M)
if '[build-dependencies]' not in s:
    s = s.rstrip() + '\n\n[build-dependencies]\ncc = "1"\n'
elif 'cc = ' not in s:
    s = s.replace('[build-dependencies]\n', '[build-dependencies]\ncc = "1"\n', 1)
open(p, 'w').write(s)
PY2

apply_local_changes() {
  # Strip `[[example]]`/`[[test]]` tables whose sources were removed above.
  for c in "${CRATES[@]}"; do
    python3 - "$DEST/$c/Cargo.toml" <<'PY'
import re, sys
p = sys.argv[1]
s = open(p).read()
# Remove a [[example]]/[[test]]/[[bench]] table: its header plus every following line
# that does not itself start a new table (a line beginning with `[`).
s = re.sub(r'^\[\[(example|test|bench)\]\]\n(?:(?!\[)[^\n]*\n?)*', '', s, flags=re.M)
s = re.sub(r'\n{3,}', '\n\n', s)
open(p, 'w').write(s.rstrip() + '\n')
PY
  done
  # cap-editor declares sentry but never uses it; drop the heavy dependency.
  sed -i.bak '/^sentry/d' "$DEST/editor/Cargo.toml" && rm -f "$DEST/editor/Cargo.toml.bak"
}
apply_local_changes

cat > "$DEST/CHANGES.md" <<EOF
# Local changes to vendored Cap crates

Upstream: https://github.com/CapSoftware/Cap @ \`$COMMIT\`
Re-sync with \`scripts/sync-cap.sh <ref>\`; the edits below are re-applied automatically.

- \`workspace-hack\` replaced by a slim feature-unification crate (no axum/clap/schemars/tauri-utils/reqwest fork).
- Upstream \`examples/\`, \`tests/\`, \`benches/\` directories and their manifest tables removed.
- \`editor/Cargo.toml\`: unused \`sentry\` dependency removed.
- \`vendor/wgpu-hal\` copied verbatim (patched via root \`[patch.crates-io]\`).
- \`vendor/cidre\` (Cap fork @ $CIDRE_REV) with \`build.rs\` replaced by \`scripts/patches/cidre-build.rs\`:
  the pomace Objective-C shims are compiled with the \`cc\` crate (\`-fobjc-arc -fmodules -fno-common\`)
  instead of \`xcodebuild\`, so full Xcode is not required to build on macOS.
EOF

echo "Done. Crates: ${#CRATES[@]} + workspace-hack, wgpu-hal vendored."
