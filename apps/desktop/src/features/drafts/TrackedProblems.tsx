import { DifficultyBadge } from "@lare/ui";
import { Radio } from "lucide-react";
import { useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { useToast } from "@/components/toast/ToastProvider";
import { Button } from "@/components/ui/Button";
import { Card, SectionTitle } from "@/components/ui/Card";
import { formatListWhen, plural } from "@/lib/format";
import { errorMessage } from "@/lib/supabase";
import { type TrackedProblemRow, usePublishTracked, useTrackedProblems } from "./queries";

/**
 * Problems the extension tracked while you were solving, waiting to be posted.
 *
 * Tick the ones that belong together and publish them as a single draft. Nothing
 * here is timed — passive tracking has no timer — so the list is about *what* you
 * solved, not how long it took.
 */
export function TrackedProblems() {
  const tracked = useTrackedProblems();
  const publish = usePublishTracked();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const rows = tracked.data ?? [];
  const chosen = useMemo(() => rows.filter((r) => selected.has(r.id)), [rows, selected]);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function doPublish() {
    if (chosen.length === 0) return;
    try {
      const postId = await publish.mutateAsync({
        sessionProblemIds: chosen.map((r) => r.id),
      });
      setSelected(new Set());
      void navigate(`/drafts/${postId}`);
    } catch (err) {
      toast({
        title: "Couldn't create the post",
        description: errorMessage(err),
        variant: "error",
      });
    }
  }

  // Nothing tracked and nothing loading: stay out of the way entirely.
  if (!tracked.isPending && rows.length === 0) return null;

  return (
    <Card className="mb-5 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <SectionTitle className="mb-0.5">Tracked problems</SectionTitle>
          <p className="text-xs text-[var(--text-tertiary)]">
            Captured automatically by the extension. Pick the ones to post together.
          </p>
        </div>
        <span className="inline-flex items-center gap-1.5 text-xs text-[var(--text-tertiary)]">
          <Radio className="size-3.5" aria-hidden />
          {plural(rows.length, "problem")}
        </span>
      </div>

      {tracked.isPending ? (
        <p className="mt-3 text-sm text-[var(--text-tertiary)]">Loading…</p>
      ) : (
        <>
          <ul className="mt-3 space-y-1">
            {rows.map((row) => (
              <li key={row.id}>
                <TrackedRow
                  row={row}
                  checked={selected.has(row.id)}
                  onToggle={() => toggle(row.id)}
                />
              </li>
            ))}
          </ul>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button
              variant="primary"
              disabled={chosen.length === 0 || publish.isPending}
              loading={publish.isPending}
              onClick={() => void doPublish()}
            >
              {chosen.length <= 1 ? "Create post" : `Create post from ${chosen.length} problems`}
            </Button>
            {chosen.length > 0 && (
              <Button variant="ghost" onClick={() => setSelected(new Set())}>
                Clear
              </Button>
            )}
          </div>
        </>
      )}
    </Card>
  );
}

function TrackedRow({
  row,
  checked,
  onToggle,
}: {
  row: TrackedProblemRow;
  checked: boolean;
  onToggle: () => void;
}) {
  const submissions = row.submissions ?? [];
  const accepted = submissions.filter((s) => s.accepted).length;
  const when = formatListWhen(row.opened_at);

  return (
    <label className="flex cursor-pointer items-center gap-3 rounded-[var(--lare-r-2)] px-2 py-2 hover:bg-[color-mix(in_oklab,var(--surface-raised)_45%,transparent)]">
      <input
        type="checkbox"
        checked={checked}
        onChange={onToggle}
        className="size-4 shrink-0 accent-[var(--accent)]"
      />
      <span className="min-w-0 flex-1 truncate text-sm text-[var(--text)]">{row.title}</span>
      {row.difficulty ? <DifficultyBadge difficulty={row.difficulty} /> : null}
      <span className="whitespace-nowrap text-xs text-[var(--text-tertiary)]">
        {submissions.length === 0 ? "opened" : `${accepted}/${submissions.length} accepted`}
      </span>
      <span
        className="hidden whitespace-nowrap font-mono text-xs tabular-nums text-[var(--text-tertiary)] sm:block"
        title={when.title}
      >
        {when.label}
      </span>
    </label>
  );
}
