import { checkpoints, codeAt, type EditLog, LANGUAGE_LABELS } from "@lare/shared";
import type { SessionProblem } from "@lare/supabase-types";
import { CodeBlock, cn, DifficultyBadge } from "@lare/ui";
import type { UseQueryResult } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, FileCode2 } from "lucide-react";
import { type ReactNode, useMemo, useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, SectionTitle } from "@/components/ui/Card";
import { ErrorState, Spinner } from "@/components/ui/States";
import { epochToMedia, formatMediaTime, mediaToEpoch } from "./media";

/** Typing pause that separates two checkpoints (mirrors the ai-review function). */
const CHECKPOINT_PAUSE_MS = 20_000;
/** Ignore checkpoints within this distance of the current time when stepping. */
const STEP_EPSILON_S = 0.25;

type CodeProblem = Pick<SessionProblem, "id" | "title" | "difficulty" | "edits_path">;

function languageLabel(lang: string | undefined): string | null {
  if (!lang) return null;
  return LANGUAGE_LABELS[lang] ?? lang;
}

/**
 * Replays a Monaco edit log to show the editor contents at `currentTime`, with prev/next
 * checkpoint stepping (a checkpoint is the code at the end of every typing pause ≥ 20s).
 */
export function CodeTimeline({
  problems,
  logs,
  t0,
  currentTime,
  onJump,
}: {
  problems: readonly CodeProblem[];
  /** One query per problem, aligned with `problems` (see `useEditLogs`). */
  logs: readonly UseQueryResult<EditLog, Error>[];
  /** Epoch ms of media time zero. */
  t0: number;
  /** Media seconds. */
  currentTime: number;
  /** Move the page's current time (does not re-load the video). */
  onJump: (t: number) => void;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const fallback = problems.find((p) => p.edits_path) ?? problems[0] ?? null;
  const selected = problems.find((p) => p.id === selectedId) ?? fallback;
  const selectedIndex = selected ? problems.indexOf(selected) : -1;
  const query = selectedIndex >= 0 ? logs[selectedIndex] : undefined;
  const lang = languageLabel(query?.data?.language);

  return (
    <Card>
      <SectionTitle action={lang ? <Badge>{lang}</Badge> : undefined}>Code timeline</SectionTitle>

      {problems.length > 1 ? (
        <div role="tablist" aria-label="Problems" className="mb-3 flex flex-wrap gap-1">
          {problems.map((p) => {
            const active = p.id === selected?.id;
            return (
              <button
                key={p.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setSelectedId(p.id)}
                className={cn(
                  "inline-flex max-w-full items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs transition-colors",
                  active
                    ? "border-zinc-700 bg-zinc-800 text-zinc-100"
                    : "border-zinc-800 text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200",
                )}
              >
                <span className="truncate">{p.title}</span>
                <DifficultyBadge difficulty={p.difficulty} />
                {!p.edits_path ? <span className="text-zinc-600">(no edits)</span> : null}
              </button>
            );
          })}
        </div>
      ) : null}

      {!selected ? (
        <Placeholder>No problems were captured in this session.</Placeholder>
      ) : !selected.edits_path ? (
        <Placeholder>
          No edit log was captured for <span className="text-zinc-300">{selected.title}</span>.
        </Placeholder>
      ) : !query || query.isPending ? (
        <Spinner className="py-10" label="Loading edit log…" />
      ) : query.isError ? (
        <ErrorState
          error={query.error}
          onRetry={() => void query.refetch()}
          title="Couldn't load the edit log"
        />
      ) : (
        <LogView
          key={selected.id}
          log={query.data}
          t0={t0}
          currentTime={currentTime}
          onJump={onJump}
        />
      )}
    </Card>
  );
}

function Placeholder({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-zinc-800 px-4 py-8 text-center">
      <FileCode2 className="size-5 text-zinc-600" aria-hidden />
      <p className="text-sm text-zinc-400">{children}</p>
    </div>
  );
}

function LogView({
  log,
  t0,
  currentTime,
  onJump,
}: {
  log: EditLog;
  t0: number;
  currentTime: number;
  onJump: (t: number) => void;
}) {
  const tAbs = mediaToEpoch(currentTime, t0);

  const replay = useMemo<{ ok: true; code: string } | { ok: false; error: unknown }>(() => {
    try {
      return { ok: true, code: codeAt(log.events, tAbs) };
    } catch (error) {
      return { ok: false, error };
    }
  }, [log, tAbs]);

  const cps = useMemo(() => {
    try {
      return checkpoints(log.events, CHECKPOINT_PAUSE_MS).map((cp) => ({
        t: epochToMedia(cp.t, t0),
        code: cp.code,
      }));
    } catch {
      return [];
    }
  }, [log, t0]);

  let lastChange: number | null = null;
  for (let i = log.events.length - 1; i >= 0; i--) {
    const e = log.events[i];
    if (e && e.t <= tAbs) {
      lastChange = epochToMedia(e.t, t0);
      break;
    }
  }

  const reached = cps.filter((cp) => cp.t <= currentTime + STEP_EPSILON_S).length;
  const prev = [...cps].reverse().find((cp) => cp.t < currentTime - STEP_EPSILON_S) ?? null;
  const next = cps.find((cp) => cp.t > currentTime + STEP_EPSILON_S) ?? null;

  if (log.events.length === 0) {
    return <Placeholder>The edit log for this problem is empty.</Placeholder>;
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-zinc-500">
        <span>
          edits: {log.events.length}
          {" · "}
          {lastChange === null
            ? "no changes yet at this point"
            : `last change at ${formatMediaTime(lastChange)}`}
        </span>
        <div className="flex items-center gap-1">
          <Button
            size="sm"
            variant="ghost"
            icon={<ChevronLeft className="size-3.5" aria-hidden />}
            disabled={!prev}
            onClick={() => prev && onJump(prev.t)}
            title={
              prev ? `Previous checkpoint (${formatMediaTime(prev.t)})` : "No earlier checkpoint"
            }
          >
            Prev
          </Button>
          <span className="font-mono tabular-nums">
            {cps.length === 0 ? "—" : `${reached}/${cps.length}`}
          </span>
          <Button
            size="sm"
            variant="ghost"
            disabled={!next}
            onClick={() => next && onJump(next.t)}
            title={next ? `Next checkpoint (${formatMediaTime(next.t)})` : "No later checkpoint"}
          >
            Next
            <ChevronRight className="size-3.5" aria-hidden />
          </Button>
        </div>
      </div>

      {!replay.ok ? (
        <ErrorState error={replay.error} title="Couldn't replay the edit log at this time" />
      ) : replay.code.trim().length === 0 ? (
        <Placeholder>
          Nothing in the editor at {formatMediaTime(currentTime)}. Scrub forward or jump to the next
          checkpoint.
        </Placeholder>
      ) : (
        <div className="select-text">
          <CodeBlock code={replay.code} lang={log.language} maxHeight={440} />
        </div>
      )}
    </div>
  );
}
