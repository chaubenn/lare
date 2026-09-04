#!/bin/sh
# Build the desktop app as a .app bundle and launch it through Launch Services.
#
# macOS attributes camera/microphone/screen-recording permission requests to the app bundle
# they come from, so recording permissions only work when Lare runs as a bundle (not as the
# bare `tauri dev` binary, which inherits the terminal's attribution). Signing with the stable
# local "Lare Development" identity (created once per machine) keeps the grants across rebuilds.
set -eu
cd "$(dirname "$0")/.."

identity="${APPLE_SIGNING_IDENTITY:-}"
if [ -z "$identity" ] && security find-identity -v -p codesigning 2>/dev/null | grep -q '"Lare Development"'; then
  identity="Lare Development"
fi

if [ -n "$identity" ]; then
  echo "Signing with $identity"
  APPLE_SIGNING_IDENTITY="$identity" pnpm --filter @lare/desktop tauri build --debug --bundles app
else
  echo "warning: no code signing identity found; permission grants will not survive rebuilds"
  pnpm --filter @lare/desktop tauri build --debug --bundles app
fi

open target/debug/bundle/macos/Lare.app
