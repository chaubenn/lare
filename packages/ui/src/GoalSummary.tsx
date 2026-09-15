import {
  type ActiveGoalProgress,
  describeGoal,
  describeGoalStreak,
  goalRatio,
  goalStatus,
} from "@lare/shared";
import { Flame } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "./cn";

/** Circular progress; turns the "easy" green once the goal is met. */
export function GoalRing({
  ratio,
  size = 64,
  stroke = 6,
  children,
  className,
}: {
  ratio: number;
  size?: number;
  stroke?: number;
  children?: ReactNode;
  className?: string;
}) {
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.min(1, Math.max(0, ratio));
  return (
    <div
      className={cn("relative inline-grid shrink-0 place-items-center", className)}
      style={{ width: size, height: size }}
    >
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        className="-rotate-90"
        aria-hidden
      >
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="var(--border)"
          strokeWidth={stroke}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={clamped >= 1 ? "var(--lare-diff-easy)" : "var(--accent)"}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - clamped)}
          style={{ transition: "stroke-dashoffset 400ms ease" }}
        />
      </svg>
      <span className="absolute inset-0 grid place-items-center">{children}</span>
    </div>
  );
}

/** Ring, goal copy, goal streak and the last periods as dots. Shared by desktop and web. */
export function GoalSummary({ progress }: { progress: ActiveGoalProgress }) {
  const { goal } = progress;
  return (
    <div>
      <div className="flex items-center gap-4">
        <GoalRing ratio={goalRatio(progress.current, goal.target)}>
          <span className="text-sm font-semibold tabular-nums text-[var(--text)]">
            {progress.current}/{goal.target}
          </span>
        </GoalRing>
        <div className="min-w-0">
          <p className="text-sm font-medium text-[var(--text)]">{describeGoal(goal)}</p>
          <p className="mt-0.5 text-xs text-[var(--text-secondary)]">{goalStatus(progress)}</p>
        </div>
      </div>
      <div className="mt-3 flex items-center justify-between gap-3 border-t border-[var(--border)] pt-3">
        <p className="flex items-center gap-1.5 text-xs text-[var(--text-secondary)]">
          <Flame
            className="size-3.5"
            style={{
              color: progress.streak > 0 ? "var(--lare-diff-medium)" : "var(--text-tertiary)",
            }}
            aria-hidden
          />
          {describeGoalStreak(progress.streak, goal.period)}
        </p>
        <ol className="flex gap-1" aria-label={`Last ${progress.history.length} ${goal.period}s`}>
          {progress.history.map((h) => (
            <li
              key={h.start}
              title={`${h.start}: ${h.count} solved`}
              className="size-2 rounded-full"
              style={{
                background: h.met
                  ? "var(--lare-diff-easy)"
                  : h.count > 0
                    ? "var(--border-strong)"
                    : "var(--border)",
              }}
            >
              <span className="sr-only">
                {h.start}: {h.count} solved{h.met ? ", goal met" : ""}
              </span>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
