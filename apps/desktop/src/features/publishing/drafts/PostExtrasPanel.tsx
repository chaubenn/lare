import { Card, SectionTitle, Toggle } from "@lare/ui/primitives";
import { notifyError } from "@/lib/notices";
import { type Draft, type PostExtras, useSetPostExtras } from "./queries";

/**
 * The optional extras, in one place: everything an author can choose to send along with the
 * post rather than something they have to fill in. Each switch saves on the spot.
 */
export function PostExtrasPanel({ draft }: { draft: Draft }) {
  const extras = useSetPostExtras(draft.id);
  const isInterview = draft.sessions?.kind === "interview" && draft.sessions.graded;
  // AI insights are the only extra, and only a graded mock interview has any.
  if (!isInterview) return null;

  const set = (patch: Partial<PostExtras>) =>
    extras.mutate(patch, {
      onError: (e) => notifyError("Couldn't update", e),
    });

  return (
    <Card>
      <SectionTitle>Include with the post</SectionTitle>
      <div className="mt-3 grid gap-3">
        <Toggle
          id="extras-insights"
          checked={draft.include_ai_insights}
          disabled={extras.isPending}
          onChange={(v) => set({ include_ai_insights: v })}
          label="AI insights"
          description="Viewers of the post can see the interview grade, timestamped moments and suggestions."
        />
      </div>
    </Card>
  );
}
