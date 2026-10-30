import { cn } from "@lare/ui";
import { Link } from "react-router";
import { useExtensionStatus } from "./useExtensionStatus";

/** Whether the Chrome extension is talking to this app. Links to Settings. */
export function ExtensionStatus({ collapsed }: { collapsed: boolean }) {
  const { connected } = useExtensionStatus();
  const label = connected ? "connected" : "not connected";
  const dot = (
    <span
      aria-hidden
      className={cn(
        "size-1.5 shrink-0 rounded-full",
        connected
          ? "bg-[var(--lare-status-run)] shadow-[0_0_6px] shadow-[color-mix(in_oklab,var(--lare-status-run)_60%,transparent)]"
          : "bg-[var(--lare-status-stop)]",
      )}
    />
  );

  if (collapsed) {
    return (
      <Link
        to="/settings"
        title={`Extension ${label}`}
        aria-label={`Extension ${label}`}
        className="flex size-11 items-center justify-center rounded-lg"
      >
        {dot}
      </Link>
    );
  }

  return (
    <Link
      to="/settings"
      className="lare-micro block rounded-lg px-3 py-1.5 text-[var(--text-tertiary)] transition-colors hover:text-[var(--text-secondary)]"
    >
      <span className="flex items-center gap-2">
        {dot}
        <span>
          Extension:{" "}
          <span className="text-[color-mix(in_oklab,var(--text)_80%,transparent)]">{label}</span>
        </span>
      </span>
    </Link>
  );
}
