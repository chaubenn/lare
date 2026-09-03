import { cn } from "@lare/ui";
import { Link } from "react-router";
import { useExtensionStatus } from "./useExtensionStatus";

export function StatusFooter() {
  const { connected, port } = useExtensionStatus();
  return (
    <footer className="flex h-7 shrink-0 items-center gap-3 border-t border-zinc-800/80 bg-zinc-950 px-3 text-[11px] text-zinc-500">
      <Link to="/settings" className="flex items-center gap-1.5 hover:text-zinc-300">
        <span
          aria-hidden
          className={cn(
            "size-1.5 rounded-full",
            connected ? "bg-emerald-400 shadow-[0_0_6px] shadow-emerald-500/60" : "bg-zinc-600",
          )}
        />
        Extension: {connected ? "connected" : "not connected"}
      </Link>
      <span aria-hidden>·</span>
      <span className="font-mono">127.0.0.1:{port}</span>
    </footer>
  );
}
