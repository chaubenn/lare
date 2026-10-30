import { DEFAULT_REVIEW_CRITERIA, REVIEW_CRITERIA_MAX_LENGTH } from "@lare/shared";
import { ChevronDown } from "@lare/ui/icons";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Textarea } from "@/components/ui/Field";
import { useNotify } from "@/features/notifications/notices";
import { errorMessage } from "@/lib/supabase";
import { useResetReviewCriteria, useReviewCriteria, useSaveReviewCriteria } from "./queries";

/**
 * What the AI review grades against, for a graded mock interview. Starts as the built-in default;
 * the user can rewrite it and save it, and it then applies to every review they generate.
 */
export function ReviewCriteria() {
  const saved = useReviewCriteria();
  const save = useSaveReviewCriteria();
  const reset = useResetReviewCriteria();
  const { notify } = useNotify();
  const [draft, setDraft] = useState<string | null>(null);

  if (saved.isPending || saved.isError) return null;

  const custom = saved.data;
  const stored = custom ?? DEFAULT_REVIEW_CRITERIA;
  const text = draft ?? stored;
  const trimmed = text.trim();
  const changed = trimmed !== stored.trim();
  const busy = save.isPending || reset.isPending;

  const onSave = () =>
    save.mutate(trimmed, {
      onSuccess: () => {
        setDraft(null);
        notify({ title: "Criteria saved", variant: "success" });
      },
      onError: (err) =>
        notify({
          title: "Couldn't save your criteria",
          description: errorMessage(err),
          variant: "error",
        }),
    });

  const onReset = () =>
    reset.mutate(undefined, {
      onSuccess: () => {
        setDraft(null);
        notify({ title: "Back to the default criteria" });
      },
      onError: (err) =>
        notify({
          title: "Couldn't reset your criteria",
          description: errorMessage(err),
          variant: "error",
        }),
    });

  return (
    <Card>
      <details className="group">
        <summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-medium text-[var(--text)] [&::-webkit-details-marker]:hidden">
          <ChevronDown
            className="size-4 shrink-0 text-[var(--text-tertiary)] transition-transform duration-[var(--duration-fast)] group-open:rotate-180"
            aria-hidden
          />
          Grading criteria
          <span className="text-xs font-normal text-[var(--text-tertiary)]">
            {custom ? "Your criteria" : "Default"}
          </span>
        </summary>

        <div className="mt-3 space-y-3">
          <p className="text-xs text-[var(--text-secondary)]">
            What the AI review grades this interview against. Edit it to match what you want
            feedback on. It is saved to your account and used for every review you generate; an
            existing review only changes when you regenerate it.
          </p>
          <Textarea
            aria-label="Grading criteria"
            value={text}
            maxLength={REVIEW_CRITERIA_MAX_LENGTH}
            rows={8}
            onChange={(e) => setDraft(e.target.value)}
            className="resize-y"
          />
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs tabular-nums text-[var(--text-tertiary)]">
              {text.length}/{REVIEW_CRITERIA_MAX_LENGTH}
            </span>
            <div className="flex gap-2">
              {custom || changed ? (
                <Button size="sm" onClick={onReset} disabled={busy} loading={reset.isPending}>
                  Reset to default
                </Button>
              ) : null}
              <Button
                size="sm"
                variant="primary"
                onClick={onSave}
                disabled={!changed || trimmed.length === 0 || busy}
                loading={save.isPending}
              >
                Save criteria
              </Button>
            </div>
          </div>
        </div>
      </details>
    </Card>
  );
}
