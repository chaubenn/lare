"use client";

import { codeAt, type EditLog, EditLogSchema, formatDuration } from "@lare/shared";
import { CodeBlock } from "@lare/ui/CodeBlock";
import { Button, Card } from "@lare/ui/primitives";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

export function CodeTimeline({
  path,
  title,
  startedAt,
}: {
  path: string | null;
  title: string;
  startedAt: string;
}) {
  const [log, setLog] = useState<EditLog | null>(null);
  const [index, setIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  async function load() {
    if (!path) return;
    setLoading(true);
    setError(null);
    try {
      const { data, error } = await createClient().storage.from("session-data").download(path);
      if (error) throw error;
      const text = await new Response(
        data.stream().pipeThrough(new DecompressionStream("gzip")),
      ).text();
      const parsed = EditLogSchema.parse(JSON.parse(text));
      setLog({ ...parsed, events: [...parsed.events].sort((a, b) => a.t - b.t) });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load the edit log.");
    } finally {
      setLoading(false);
    }
  }
  const event = log?.events[index];
  let code = "";
  let replayError: string | null = null;
  try {
    if (log && event) code = codeAt(log.events, event.t);
  } catch {
    replayError =
      "This edit log could not be replayed. Your submission code is still available above.";
  }
  return (
    <Card className="space-y-3 p-4">
      <h3 className="text-sm font-medium">Code edit timeline: {title}</h3>
      {!path ? (
        <p className="text-sm text-[var(--text-tertiary)]">
          No editor changes were captured for this problem.
        </p>
      ) : !log ? (
        <Button type="button" loading={loading} onClick={() => void load()}>
          {error ? "Retry edit log" : "Load private edit log"}
        </Button>
      ) : log.events.length === 0 ? (
        <p className="text-sm">This edit log is empty.</p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <Button
              type="button"
              size="sm"
              disabled={index === 0}
              onClick={() => setIndex(index - 1)}
            >
              Previous edit
            </Button>
            <span>
              {index + 1} / {log.events.length} edits
            </span>
            <Button
              type="button"
              size="sm"
              disabled={index === log.events.length - 1}
              onClick={() => setIndex(index + 1)}
            >
              Next edit
            </Button>
          </div>
          <label className="block text-sm">
            Editor time:{" "}
            {event ? formatDuration(Math.max(0, event.t - Date.parse(startedAt))) : "0:00"}
            <input
              className="mt-2 w-full"
              type="range"
              min={0}
              max={Math.max(0, log.events.length - 1)}
              value={index}
              onChange={(e) => setIndex(Number(e.target.value))}
            />
          </label>
          {replayError ? (
            <p role="alert">{replayError}</p>
          ) : (
            <CodeBlock code={code || " "} lang={log.language} maxHeight={440} />
          )}
        </>
      )}
      {error && (
        <p role="alert" className="text-sm text-rose-300">
          {error}
        </p>
      )}
    </Card>
  );
}
