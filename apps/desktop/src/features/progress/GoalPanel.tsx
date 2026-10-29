import { isActiveGoal } from "@lare/shared";
import { GoalSummary } from "@lare/ui";
import { Pencil, Target } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { GoalDialog } from "./GoalDialog";
import { useGoalProgress } from "./queries";

/** The viewer's practice goal in the feed's side column. Hidden until the data is there. */
export function GoalPanel() {
  const progress = useGoalProgress();
  const [editing, setEditing] = useState(false);
  const data = progress.data;
  if (!data) return null;
  const active = isActiveGoal(data) ? data : null;

  return (
    <section className="rounded-[var(--lare-r-4)] border border-[var(--border)] bg-[var(--surface-raised)] p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-[var(--text)]">Goal</h2>
        {active ? (
          <Button
            variant="ghost"
            size="sm"
            icon={<Pencil className="size-3" aria-hidden />}
            onClick={() => setEditing(true)}
          >
            Edit
          </Button>
        ) : null}
      </div>
      {active ? (
        <GoalSummary progress={active} />
      ) : (
        <div className="flex items-center gap-3">
          <Target className="size-6 shrink-0 text-[var(--text-tertiary)]" aria-hidden />
          <p className="flex-1 text-xs text-[var(--text-secondary)]">
            Set a daily or weekly target and keep a streak going.
          </p>
          <Button size="sm" onClick={() => setEditing(true)}>
            Set a goal
          </Button>
        </div>
      )}
      {editing ? (
        <GoalDialog goal={active?.goal ?? null} onClose={() => setEditing(false)} />
      ) : null}
    </section>
  );
}
