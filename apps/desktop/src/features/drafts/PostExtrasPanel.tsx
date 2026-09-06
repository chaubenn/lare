import { useToast } from "@/components/toast/ToastProvider";
import { Card, SectionTitle } from "@/components/ui/Card";
import { Toggle } from "@/components/ui/Field";
import { errorMessage } from "@/lib/supabase";
import { type Draft, type PostExtras, useSetPostExtras } from "./queries";

/**
 * The optional extras, in one place: everything an author can choose to send along with the
 * post rather than something they have to fill in. Each switch saves on the spot — the session
 * card is regenerated (or removed) to match, so the Photos panel and the preview stay honest.
 */
export function PostExtrasPanel({ draft }: { draft: Draft }) {
  const { toast } = useToast();
  const extras = useSetPostExtras(draft.id);
  const isInterview = draft.sessions?.kind === "interview";

  const set = (patch: Partial<PostExtras>) =>
    extras.mutate(patch, {
      onError: (e) =>
        toast({ title: "Couldn't update", description: errorMessage(e), variant: "error" }),
    });

  return (
    <Card>
      <SectionTitle>Include with the post</SectionTitle>
      <div className="mt-3 grid gap-3">
        {isInterview ? (
          <Toggle
            id="extras-insights"
            checked={draft.include_ai_insights}
            disabled={extras.isPending}
            onChange={(v) => set({ include_ai_insights: v })}
            label="AI insights"
            description="Viewers of the post can see the interview grade, timestamped moments and suggestions."
          />
        ) : null}
        <Toggle
          id="extras-og-card"
          checked={draft.include_og_card}
          disabled={extras.isPending}
          onChange={(v) => set({ include_og_card: v })}
          label="Session card"
          description="Leads the post and is what a shared link unfurls to. Off: the post opens on the session breakdown."
        />
        <Toggle
          id="extras-og-scores"
          checked={draft.og_show_ai_scores}
          disabled={extras.isPending || !draft.include_og_card || !isInterview}
          onChange={(v) => set({ og_show_ai_scores: v })}
          label="AI scores on the session card"
          description={
            isInterview
              ? "Draws the overall grade and the five skill percentages on the card."
              : "Only mock interviews are graded."
          }
        />
      </div>
    </Card>
  );
}
