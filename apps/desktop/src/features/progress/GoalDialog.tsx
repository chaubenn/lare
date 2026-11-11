import {
  describeGoal,
  GOAL_DIFFICULTIES,
  GOAL_TARGET_MAX,
  GOAL_TARGET_MIN,
  type Goal,
  type GoalDifficulty,
  type GoalPeriod,
  parseGoalForm,
} from "@lare/shared";
import { Button, Input, Label, Modal, SegmentedTabs, Select } from "@lare/ui/primitives";
import { useState } from "react";
import { notify, notifyError } from "@/lib/notices";
import { useClearGoal, useSaveGoal } from "./queries";

const PERIODS: Array<{ key: GoalPeriod; label: string }> = [
  { key: "day", label: "Daily" },
  { key: "week", label: "Weekly" },
];

/**
 * Always mounted, so the modal can play its exit animation. The form lives in the modal's
 * children, which mount on open, so it starts from the current goal every time.
 */
export function GoalDialog({
  open,
  goal,
  onClose,
}: {
  open: boolean;
  goal: Goal | null;
  onClose: () => void;
}) {
  return (
    <Modal open={open} onClose={onClose} title="Practice goal">
      <GoalForm goal={goal} onClose={onClose} />
    </Modal>
  );
}

function GoalForm({ goal, onClose }: { goal: Goal | null; onClose: () => void }) {
  const [period, setPeriod] = useState<GoalPeriod>(goal?.period ?? "week");
  const [target, setTarget] = useState(String(goal?.target ?? 3));
  const [minDifficulty, setMinDifficulty] = useState<GoalDifficulty | "">(
    goal?.min_difficulty ?? "",
  );
  const save = useSaveGoal();
  const clear = useClearGoal();

  const parsed = parseGoalForm({ period, target, min_difficulty: minDifficulty });
  const busy = save.isPending || clear.isPending;

  const onSave = () => {
    if (!parsed) return;
    save.mutate(parsed, {
      onSuccess: () => {
        notify({ title: "Goal saved", variant: "success" });
        onClose();
      },
      onError: (err) => notifyError("Couldn't save your goal", err),
    });
  };

  const onRemove = () =>
    clear.mutate(undefined, {
      onSuccess: () => {
        notify({ title: "Goal removed" });
        onClose();
      },
      onError: (err) => notifyError("Couldn't remove your goal", err),
    });

  return (
    <form
      className="space-y-4 p-4"
      onSubmit={(e) => {
        e.preventDefault();
        onSave();
      }}
    >
      <SegmentedTabs label="Goal period" value={period} onChange={setPeriod} items={PERIODS} />
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="goal-target">Problems</Label>
          <Input
            id="goal-target"
            type="number"
            inputMode="numeric"
            min={GOAL_TARGET_MIN}
            max={GOAL_TARGET_MAX}
            value={target}
            onChange={(e) => setTarget(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="goal-difficulty">Minimum difficulty</Label>
          <Select
            id="goal-difficulty"
            value={minDifficulty}
            onChange={(e) => setMinDifficulty(e.target.value as GoalDifficulty | "")}
          >
            <option value="">Any</option>
            {GOAL_DIFFICULTIES.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </Select>
        </div>
      </div>
      <p className="text-sm text-[var(--text)]">
        {parsed
          ? describeGoal(parsed)
          : `Pick between ${GOAL_TARGET_MIN} and ${GOAL_TARGET_MAX} problems.`}
      </p>
      <p className="text-xs text-[var(--text-tertiary)]">
        The goal streak is measured against the goal as it is now, so changing it recalculates the
        streak.
      </p>
      <div className="flex items-center justify-between gap-2">
        {goal ? (
          <Button
            variant="danger"
            size="sm"
            onClick={onRemove}
            disabled={busy}
            loading={clear.isPending}
          >
            Remove goal
          </Button>
        ) : (
          <span />
        )}
        <div className="flex gap-2">
          <Button size="sm" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            type="submit"
            variant="primary"
            size="sm"
            disabled={!parsed || busy}
            loading={save.isPending}
          >
            Save goal
          </Button>
        </div>
      </div>
    </form>
  );
}
