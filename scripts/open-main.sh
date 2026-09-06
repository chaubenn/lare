#!/bin/sh
# Open the current checkout (main, the developer branch) as a live desktop + extension stack.
#
# This is not a release. It does not bump versions, tag, or wait for CI. The installed
# /Applications/Lare.app is the last stable package; this script quits it so its
# single-instance lock cannot swallow the local window.
set -eu
cd "$(dirname "$0")/.."

LOG_DIR=".context"
mkdir -p "$LOG_DIR"
DESKTOP_LOG="$LOG_DIR/open-main-desktop.log"
EXT_LOG="$LOG_DIR/open-main-extension.log"

quit_released_app() {
  osascript -e 'tell application "Lare" to quit' >/dev/null 2>&1 || true
  # The installed binary and a leftover debug binary share the process name.
  killall lare-desktop >/dev/null 2>&1 || true
  sleep 0.6
}

extension_running() {
  pgrep -f 'wxt|apps/extension' >/dev/null 2>&1
}

desktop_running() {
  pgrep -f '/target/debug/lare-desktop' >/dev/null 2>&1
}

vite_ready() {
  # Vite binds `localhost`, which can resolve to ::1 only — probe both spellings.
  curl -sf -o /dev/null http://localhost:1420/ || curl -sf -o /dev/null http://127.0.0.1:1420/
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
    if desktop_running && vite_ready; then
      focus_window
      return 0
    fi
    i=$((i + 1))
    sleep 2
  done
  echo "warning: desktop process or Vite did not come up in time; see $DESKTOP_LOG" >&2
  return 1
}

quit_released_app

if ! extension_running; then
  echo "Starting Chrome extension watcher (load apps/extension/.output/chrome-mv3-dev if it is not already unpacked)."
  pnpm --filter @lare/extension dev >"$EXT_LOG" 2>&1 &
else
  echo "Extension watcher already running."
fi

if desktop_running && vite_ready; then
  echo "Local desktop already running from this checkout."
  focus_window
  echo "Lare (main checkout) should be in front. Extension output: apps/extension/.output/chrome-mv3-dev"
  exit 0
fi

# A leftover Vite on :1420 without the Tauri window still blocks `tauri dev`.
if vite_ready && ! desktop_running; then
  pkill -f 'apps/desktop.*vite' >/dev/null 2>&1 || true
  sleep 0.4
fi

echo "Starting Tauri from this checkout (hot reload; not a release build)."
pnpm --filter @lare/desktop tauri dev >"$DESKTOP_LOG" 2>&1 &

if wait_for_window; then
  echo "Lare (main checkout) is open. Extension output: apps/extension/.output/chrome-mv3-dev"
else
  echo "Started in the background. Check $DESKTOP_LOG"
  exit 1
fi
