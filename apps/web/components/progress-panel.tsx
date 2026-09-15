import {
  buildActivityDays,
  isActiveGoal,
  parseGoalProgress,
  parseSolvedActivity,
  summarizeActivity,
} from "@lare/shared";
import { GoalSummary } from "@lare/ui/GoalSummary";
import { Flame } from "lucide-react";
import type { ReactNode } from "react";
import { GoalEditor } from "@/components/goal-editor";
import { createClient } from "@/lib/supabase/server";

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-[var(--lare-r-4)] border border-[var(--border)] bg-[var(--surface-raised)] p-4">
      <h2 className="mb-3 text-sm font-semibold text-[var(--text)]">{title}</h2>
      {children}
    </section>
  );
}

/** The viewer's streak and practice goal, beside the feed. */
export async function ProgressPanel({ handle }: { handle: string }) {
  const supabase = await createClient();
  const [activityResult, goalResult] = await Promise.all([
    supabase.rpc("solved_activity", { target_handle: handle }),
    supabase.rpc("goal_progress"),
  ]);
  const activity = activityResult.error ? null : parseSolvedActivity(activityResult.data);
  const progress = goalResult.error ? null : parseGoalProgress(goalResult.data);
  const summary = activity?.visible ? summarizeActivity(buildActivityDays(activity)) : null;

  return (
    <aside className="space-y-4" aria-label="Your progress">
      {summary ? (
        <Panel title="Your streak">
          <p className="flex items-center gap-2">
            <Flame
              className="size-5"
              style={{
                color: summary.streak > 0 ? "var(--lare-diff-medium)" : "var(--text-tertiary)",
              }}
              aria-hidden
            />
            <span className="text-2xl font-semibold leading-none tabular-nums text-[var(--text)]">
              {summary.streak}
            </span>
            <span className="text-xs text-[var(--text-secondary)]">
              day{summary.streak === 1 ? "" : "s"} in a row
            </span>
          </p>
          <p className="mt-2 text-xs text-[var(--text-secondary)]">
            Best {summary.longestStreak} · {summary.last7} solved in 7 days
          </p>
        </Panel>
      ) : null}
      {progress ? (
        <Panel title="Goal">
          {isActiveGoal(progress) ? (
            <GoalSummary progress={progress} />
          ) : (
            <p className="text-xs text-[var(--text-secondary)]">
              Set a daily or weekly target and keep a streak going.
            </p>
          )}
          <GoalEditor goal={progress.goal} />
        </Panel>
      ) : null}
    </aside>
  );
}
