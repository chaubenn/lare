"use client";

import { Card } from "@lare/ui/primitives";
import { useState } from "react";
import { PendingButton } from "@/components/pending-button";
import { createDraft } from "./actions";

export function TrackedProblems({
  problems,
}: {
  problems: {
    id: string;
    title: string;
    difficulty: string | null;
    submissions: { accepted: boolean }[];
  }[];
}) {
  const [selected, setSelected] = useState<string[]>([]);
  return (
    <Card className="space-y-3 p-4">
      <h2 className="font-medium">Tracked practice problems</h2>
      <form action={createDraft} className="space-y-3">
        <input type="hidden" name="source" value="tracked" />
        {problems.map((p) => (
          <label key={p.id} className="flex items-center gap-3 text-sm">
            <input
              type="checkbox"
              name="problem"
              value={p.id}
              checked={selected.includes(p.id)}
              onChange={(e) =>
                setSelected(
                  e.target.checked ? [...selected, p.id] : selected.filter((id) => id !== p.id),
                )
              }
            />
            <span>
              {p.title}{" "}
              <span className="text-[var(--text-tertiary)]">
                {p.difficulty} / {p.submissions.length} submissions /{" "}
                {p.submissions.some((s) => s.accepted) ? "Solved" : "Practicing"}
              </span>
            </span>
          </label>
        ))}
        <fieldset disabled={!selected.length}>
          <PendingButton size="sm">
            Create draft from {selected.length} selected problems
          </PendingButton>
        </fieldset>
      </form>
    </Card>
  );
}
