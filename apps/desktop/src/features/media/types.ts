/**
 * Which of a post's two video slots a take belongs to. `main` is the demo video of a practice
 * post and the full take of an interview (`video_id` + `video_kind`); `demo` is the short summary
 * clip an author records about the session, which plays before the full take (`demo_video_id`).
 */
export type VideoSlot = "main" | "demo";
