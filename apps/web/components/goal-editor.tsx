"use client";

import { GOAL_DIFFICULTIES, GOAL_TARGET_MAX, GOAL_TARGET_MIN, type Goal } from "@lare/shared";
import { Button, Input, Label, Select } from "@lare/ui/primitives";
import { useActionState, useEffect, useRef } from "react";
import { clearGoal, saveGoal } from "@/app/progress-actions";
import { FormToast } from "@/components/form-toast";
import { PendingButton } from "@/components/pending-button";
import { GOAL_FORM_IDLE } from "@/lib/forms";

/** Set, change or remove the practice goal, tucked into a disclosure under the panel. */
export function GoalEditor({ goal }: { goal: Goal | null }) {
  const [state, action] = useActionState(saveGoal, GOAL_FORM_IDLE);
  const details = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    if (state.ok && details.current) details.current.open = false;
  }, [state]);

  return (
    <details ref={details} className="mt-3 border-t border-[var(--border)] pt-3">
      <summary className="cursor-pointer text-xs text-[var(--text-secondary)] hover:text-[var(--text)]">
        {goal ? "Edit goal" : "Set a goal"}
      </summary>
      <form action={action} className="mt-3 space-y-3">
        <FormToast error={state.error} />
        <fieldset className="flex gap-4 text-sm text-[var(--text)]">
          <legend className="sr-only">Period</legend>
          {(["day", "week"] as const).map((period) => (
            <label key={period} className="flex items-center gap-1.5">
              <input
                type="radio"
                name="period"
                value={period}
                defaultChecked={(goal?.period ?? "week") === period}
              />
              {period === "day" ? "Daily" : "Weekly"}
            </label>
          ))}
        </fieldset>
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <Label htmlFor="goal-target">Problems</Label>
            <Input
              id="goal-target"
              name="target"
              type="number"
              inputMode="numeric"
              min={GOAL_TARGET_MIN}
              max={GOAL_TARGET_MAX}
              defaultValue={goal?.target ?? 3}
              required
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="goal-difficulty">Minimum</Label>
            <Select
              id="goal-difficulty"
              name="min_difficulty"
              defaultValue={goal?.min_difficulty ?? ""}
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
        <p className="text-xs text-[var(--text-tertiary)]">
          Changing a goal recalculates its streak.
        </p>
        <div className="flex justify-end gap-2">
          {goal ? (
            <Button type="submit" formAction={clearGoal} formNoValidate variant="ghost" size="sm">
              Remove
            </Button>
          ) : null}
          <PendingButton variant="primary" size="sm">
            Save goal
          </PendingButton>
        </div>
      </form>
    </details>
  );
}
