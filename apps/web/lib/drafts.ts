import { z } from "zod";

export const DraftEditSchema = z.object({
  title: z.string().max(140, "Keep the title under 140 characters."),
  body: z.string().max(5000, "Keep the body under 5000 characters."),
  visibility: z.enum(["public", "private"]),
  show_video: z.boolean(),
  show_demo_video: z.boolean(),
  include_ai_insights: z.boolean(),
  include_og_card: z.boolean(),
  og_show_ai_scores: z.boolean(),
  video_id: z.uuid().nullable(),
  demo_video_id: z.uuid().nullable(),
});
export type DraftEdit = z.infer<typeof DraftEditSchema>;

export function validateDraftStep(
  step: number,
  edit: DraftEdit,
  problemCount: number,
  hasSession: boolean,
): string | null {
  if (step === 0 && hasSession && problemCount === 0)
    return "This session has no captured problems yet. Wait for the extension to sync before continuing.";
  if (step === 1 && !hasSession && !edit.video_id)
    return "Record or attach a general video before continuing.";
  if (step === 1 && edit.video_id && edit.video_id === edit.demo_video_id)
    return "The summary must be a different video from the full recording.";
  if (step === 2 && !edit.title.trim()) return "Add a title before continuing.";
  const parsed = DraftEditSchema.safeParse(edit);
  return parsed.success ? null : (parsed.error.issues[0]?.message ?? "Check your draft details.");
}
