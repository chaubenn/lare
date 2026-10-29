/** The wizard's last step, Review & publish. Steps before it are editing, which an upload never blocks. */
export const PUBLISH_STEP = 4;

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
  if (step >= 1 && input.recording) return "Stop the recording before continuing.";
  if (step >= 2 && (!input.title.trim() || input.title.length > 140 || input.body.length > 5000)) {
    return "Add a title of 1-140 characters and keep the body under 5,000 characters.";
  }
  if (step >= 3 && !["public", "private"].includes(input.visibility))
    return "Choose a valid visibility.";
  // The upload runs in the background while you fill in the rest; only publishing waits for it.
  if (step >= PUBLISH_STEP && input.uploading)
    return "Wait for the video upload to finish before publishing.";
  return null;
}
