import type { ReactNode } from "react";
import { cn } from "../cn";

type Tone = "zinc" | "emerald" | "amber" | "rose" | "sky" | "violet" | "easy" | "medium" | "hard";

const TONES: Record<Tone, string> = {
  zinc: "bg-[color-mix(in_oklab,var(--text-tertiary)_15%,transparent)] text-[var(--text-secondary)]",
  emerald:
    "bg-[color-mix(in_oklab,var(--lare-status-run)_15%,transparent)] text-[var(--lare-status-run)]",
  amber:
    "bg-[color-mix(in_oklab,var(--lare-status-pause)_15%,transparent)] text-[var(--lare-status-pause)]",
  rose: "bg-[color-mix(in_oklab,var(--lare-danger)_15%,transparent)] text-[var(--lare-danger)]",
  sky: "bg-[color-mix(in_oklab,var(--lare-info)_15%,transparent)] text-[var(--lare-info)]",
  violet: "bg-[color-mix(in_oklab,var(--text)_12%,transparent)] text-[var(--text-secondary)]",
  easy: "bg-[color-mix(in_oklab,var(--lare-diff-easy)_15%,transparent)] text-[var(--lare-diff-easy)]",
  medium:
    "bg-[color-mix(in_oklab,var(--lare-diff-medium)_15%,transparent)] text-[var(--lare-diff-medium)]",
  hard: "bg-[color-mix(in_oklab,var(--lare-diff-hard)_15%,transparent)] text-[var(--lare-diff-hard)]",
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
    <span className="lare-badge-pop inline-flex min-w-5 items-center justify-center rounded-full bg-[var(--accent)] px-1.5 text-[11px] font-semibold text-[var(--accent-fg)]">
      {count > 99 ? "99+" : count}
    </span>
  );
}
