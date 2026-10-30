// The grading criteria the AI review uses when the user has not written their own. Mirrors
// DEFAULT_REVIEW_CRITERIA in packages/shared/src/session/ai-review.ts, which the desktop app shows
// as the starting point. Keep the two identical.

export const DEFAULT_REVIEW_CRITERIA = [
  "Grade fairly and specifically.",
  "Scores are 0-100.",
  "If there is no transcript, score communication 0 and say why in the rationale.",
  "Speed considers total active time versus difficulty.",
  "Correctness reflects submissions (accepted, attempts, testcases).",
  "Keep the summary to 3-5 sentences.",
].join("\n");

export const REVIEW_CRITERIA_MAX_LENGTH = 2000;
