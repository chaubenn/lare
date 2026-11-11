/** Length limits of what an author types. */
export const POST_TITLE_MAX = 140;
export const POST_BODY_MAX = 5000;
export const COMMENT_MAX = 2000;
export const IMAGE_CAPTION_MAX = 280;

/**
 * The draft wizard's steps, in order. Each step's rule also holds on every step after it, and
 * `publish` is the last: the ones before it are editing, which an upload never blocks.
 */
export const DRAFT_STEP = { problems: 0, media: 1, details: 2, extras: 3, publish: 4 } as const;

export function draftStepError(
  step: number,
  input: {
    title: string;
    body: string;
    recording: boolean;
    uploading: boolean;
    visibility: string;
  },
): string | null {
  // A general video does not require a LeetCode problem; text-only posts need no video.
  if (step >= DRAFT_STEP.media && input.recording) return "Stop the recording before continuing.";
  if (
    step >= DRAFT_STEP.details &&
    (!input.title.trim() ||
      input.title.length > POST_TITLE_MAX ||
      input.body.length > POST_BODY_MAX)
  ) {
    return `Add a title of 1-${POST_TITLE_MAX} characters and keep the body under ${POST_BODY_MAX.toLocaleString("en-US")} characters.`;
  }
  if (step >= DRAFT_STEP.extras && !["public", "private"].includes(input.visibility))
    return "Choose a valid visibility.";
  // The upload runs in the background while you fill in the rest; only publishing waits for it.
  if (step >= DRAFT_STEP.publish && input.uploading)
    return "Wait for the video upload to finish before publishing.";
  return null;
}
