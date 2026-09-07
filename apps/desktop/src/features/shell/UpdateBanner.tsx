import { Progress } from "@lare/ui/primitives";
import { ArrowDownToLine, X } from "lucide-react";
import { useEffect } from "react";
import { Button } from "@/components/ui/Button";
import { checkForUpdate, dismissUpdate, installUpdate, useUpdateState } from "@/lib/updater";

/** Delay before the launch check so it never competes with the first paint / auth round-trip. */
const LAUNCH_CHECK_DELAY_MS = 3_000;
/**
 * Re-check interval. People leave Lare open for days; a launch-only check would never notice a
 * release published after startup, so poll while running too.
 */
const RECHECK_INTERVAL_MS = 60 * 60 * 1000;

/**
 * Checks GitHub Releases on launch and then hourly, and shows a slim banner when a newer Lare
 * exists. Errors from background checks stay silent (Settings shows them on a manual check).
 */
export function UpdateBanner() {
  const state = useUpdateState();

  useEffect(() => {
    let timer = setTimeout(run, LAUNCH_CHECK_DELAY_MS);
    function run() {
      void checkForUpdate().then((result) => {
        if (result.status === "error") dismissUpdate();
      });
      timer = setTimeout(run, RECHECK_INTERVAL_MS);
    }
    return () => clearTimeout(timer);
  }, []);

  if (
    state.status !== "available" &&
    state.status !== "downloading" &&
    state.status !== "installing"
  ) {
    return null;
  }

  const busy = state.status !== "available";
  const label =
    state.status === "downloading"
      ? state.progress === null
        ? "Downloading…"
        : `Downloading… ${Math.round(state.progress * 100)}%`
      : state.status === "installing"
        ? "Installing…"
        : `Update to v${state.version}`;

  return (
    <div
      role="status"
      className="lare-material-regular flex h-9 shrink-0 items-center gap-3 border-b border-[var(--border)] px-3 text-xs text-[var(--text-secondary)]"
    >
      <ArrowDownToLine className="size-3.5 text-[var(--lare-info)]" aria-hidden />
      <span className="min-w-0 flex-1 truncate">
        Lare v{state.version} is available.
        {state.status === "available" ? " It installs in the background and relaunches." : ""}
      </span>
      {state.status === "downloading" && state.progress !== null ? (
        <Progress value={state.progress * 100} label="Download progress" className="h-1 w-24" />
      ) : null}
      <Button size="sm" variant="primary" loading={busy} onClick={() => void installUpdate()}>
        {label}
      </Button>
      {!busy ? (
        <Button
          variant="ghost"
          size="icon"
          aria-label="Dismiss update"
          tooltip="Later"
          tooltipAlign="end"
          onClick={dismissUpdate}
        >
          <X className="size-4" aria-hidden />
        </Button>
      ) : null}
    </div>
  );
}
