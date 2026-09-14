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
  if (step >= 1 && input.uploading) return "Wait for the video upload before continuing.";
  if (step >= 2 && (!input.title.trim() || input.title.length > 140 || input.body.length > 5000)) {
    return "Add a title of 1-140 characters and keep the body under 5,000 characters.";
  }
  if (step >= 3 && !["public", "private"].includes(input.visibility))
    return "Choose a valid visibility.";
  return null;
}
