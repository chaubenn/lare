import { cn } from "@lare/ui";
import type { ReactNode } from "react";

type Tone = "zinc" | "emerald" | "amber" | "rose" | "sky" | "violet";

const TONES: Record<Tone, string> = {
  zinc: "bg-zinc-500/15 text-zinc-300",
  emerald: "bg-emerald-500/15 text-emerald-400",
  amber: "bg-amber-500/15 text-amber-400",
  rose: "bg-rose-500/15 text-rose-400",
  sky: "bg-sky-500/15 text-sky-400",
  violet: "bg-violet-500/15 text-violet-400",
};

export function Badge({
  tone = "zinc",
  className,
  children,
}: {
  tone?: Tone;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium",
        TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function KindBadge({ kind }: { kind: "practice" | "interview" }) {
  return kind === "interview" ? (
    <Badge tone="violet">Interview</Badge>
  ) : (
    <Badge tone="sky">Practice</Badge>
  );
}

export function SessionStatusBadge({
  status,
}: {
  status: "active" | "paused" | "ended" | "abandoned";
}) {
  const tone: Tone =
    status === "active"
      ? "emerald"
      : status === "paused"
        ? "amber"
        : status === "abandoned"
          ? "rose"
          : "zinc";
  return <Badge tone={tone}>{status}</Badge>;
}

export function CountBadge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span className="lare-badge-pop ml-auto inline-flex min-w-5 items-center justify-center rounded-full bg-zinc-100 px-1.5 text-[11px] font-semibold text-zinc-950">
      {count > 99 ? "99+" : count}
    </span>
  );
}
