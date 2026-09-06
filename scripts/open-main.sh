#!/bin/sh
# Open the current checkout (main, the developer branch) as a live desktop + extension stack.
#
# This is not a release. It does not bump versions, tag, or wait for CI. The installed
# /Applications/Lare.app is the last stable package; this script quits it so its
# single-instance lock cannot swallow the local window.
#
# The desktop app runs as a signed .app bundle launched through Launch Services, not as the
# bare `tauri dev` binary: macOS attributes camera/microphone permission requests to the app
# bundle they come from, so with the bare binary requestAccess is auto-denied (the prompt never
# appears and the status stays NotDetermined) and the facecam cannot be used. See
# scripts/dev-bundle.sh, which this script reuses to build and sign the bundle.
set -eu
cd "$(dirname "$0")/.."

LOG_DIR=".context"
mkdir -p "$LOG_DIR"
DESKTOP_LOG="$LOG_DIR/open-main-desktop.log"
EXT_LOG="$LOG_DIR/open-main-extension.log"

quit_released_app() {
  osascript -e 'tell application "Lare" to quit' >/dev/null 2>&1 || true
  # The installed binary, a leftover bare debug binary, and the bundle binary share the name.
  killall lare-desktop >/dev/null 2>&1 || true
  killall Lare >/dev/null 2>&1 || true
  sleep 0.6
}

extension_running() {
  pgrep -f 'wxt|apps/extension' >/dev/null 2>&1
}

desktop_running() {
  pgrep -f 'Lare.app/Contents/MacOS|/target/debug/lare-desktop' >/dev/null 2>&1
}

focus_window() {
  osascript >/dev/null 2>&1 <<'EOF' || true
tell application "System Events"
  repeat with p in (every process whose name is "lare-desktop" or name is "Lare")
    try
      set frontmost of p to true
    end try
  end repeat
end tell
EOF
}

wait_for_window() {
  i=0
  while [ "$i" -lt 90 ]; do
    if desktop_running; then
      focus_window
      return 0
    fi
    i=$((i + 1))
    sleep 2
  done
  echo "warning: desktop app did not come up in time; see $DESKTOP_LOG" >&2
  return 1
}

quit_released_app

if ! extension_running; then
  echo "Starting Chrome extension watcher (load apps/extension/.output/chrome-mv3-dev if it is not already unpacked)."
  pnpm --filter @lare/extension dev >"$EXT_LOG" 2>&1 &
else
  echo "Extension watcher already running."
fi

# The bundle serves its own built frontend; a leftover Vite on :1420 is stale, not a fast path.
pkill -f 'apps/desktop.*vite' >/dev/null 2>&1 || true

echo "Building the signed .app bundle (camera/microphone grants require a real bundle; build log: $DESKTOP_LOG)."
if ! sh scripts/dev-bundle.sh >"$DESKTOP_LOG" 2>&1; then
  echo "Bundle build failed; last lines of $DESKTOP_LOG:" >&2
  tail -20 "$DESKTOP_LOG" >&2
  exit 1
fi

if wait_for_window; then
  echo "Lare (main checkout) is open. Extension output: apps/extension/.output/chrome-mv3-dev"
  echo "App logs: /tmp/lare-app.log"
else
  echo "Started in the background. Check $DESKTOP_LOG"
  exit 1
fi
