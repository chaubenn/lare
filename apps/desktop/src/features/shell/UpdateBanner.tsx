import { ArrowDownToLine, X } from "lucide-react";
import { useEffect } from "react";
import { Button } from "@/components/ui/Button";
import { Tooltip } from "@/components/ui/Tooltip";
import { checkForUpdate, dismissUpdate, installUpdate, useUpdateState } from "@/lib/updater";

/** Delay before the launch check so it never competes with the first paint / auth round-trip. */
const LAUNCH_CHECK_DELAY_MS = 3_000;

/**
 * Checks GitHub Releases once on launch and shows a slim banner when a newer Lare exists.
 * Errors from the launch check stay silent (Settings shows them on a manual check).
 */
export function UpdateBanner() {
  const state = useUpdateState();

  useEffect(() => {
    const timer = setTimeout(() => {
      void checkForUpdate().then((result) => {
        if (result.status === "error") dismissUpdate();
      });
    }, LAUNCH_CHECK_DELAY_MS);
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
      className="flex h-9 shrink-0 items-center gap-3 border-b border-zinc-800/80 bg-zinc-900/80 px-3 text-xs text-zinc-300"
    >
      <ArrowDownToLine className="size-3.5 text-sky-400" aria-hidden />
      <span className="min-w-0 flex-1 truncate">
        Lare v{state.version} is available.
        {state.status === "available" ? " It installs in the background and relaunches." : ""}
      </span>
      {state.status === "downloading" && state.progress !== null ? (
        <span className="h-1 w-24 overflow-hidden rounded-full bg-zinc-800" aria-hidden>
          <span
            className="block h-full bg-sky-400 transition-[width]"
            style={{ width: `${Math.round(state.progress * 100)}%` }}
          />
        </span>
      ) : null}
      <Button size="sm" variant="primary" loading={busy} onClick={() => void installUpdate()}>
        {label}
      </Button>
      {!busy ? (
        <Tooltip label="Later" align="end">
          <button
            type="button"
            aria-label="Dismiss update"
            onClick={dismissUpdate}
            className="rounded p-0.5 text-zinc-500 hover:text-zinc-200"
          >
            <X className="size-4" aria-hidden />
          </button>
        </Tooltip>
      ) : null}
    </div>
  );
}
