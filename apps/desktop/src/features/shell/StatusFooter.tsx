import { cn } from "@lare/ui";
import { Link } from "react-router";
import { useExtensionStatus } from "./useExtensionStatus";

export function StatusFooter() {
  const { connected, port } = useExtensionStatus();
  return (
    <footer className="lare-material-regular flex h-7 shrink-0 items-center gap-3 border-t border-[var(--border)] px-3 text-[var(--text-tertiary)]">
      <Link
        to="/settings"
        className="lare-micro flex items-center gap-1.5 hover:text-[var(--text-secondary)]"
      >
        <span
          aria-hidden
          className={cn(
            "size-1.5 rounded-full",
            connected
              ? "bg-[var(--lare-status-run)] shadow-[0_0_6px] shadow-[color-mix(in_oklab,var(--lare-status-run)_60%,transparent)]"
              : "bg-[var(--lare-status-stop)]",
          )}
        />
        Extension: {connected ? "connected" : "not connected"}
      </Link>
      <span aria-hidden>·</span>
      <span className="lare-micro font-mono">127.0.0.1:{port}</span>
    </footer>
  );
}
