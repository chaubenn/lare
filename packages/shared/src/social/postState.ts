/**
 * Whether a published post is visible to other people yet. Mirrors `private.post_videos_ready`
 * in migration 0018: a post waits until every video it shows has finished processing. Only the
 * author ever sees a pending post, so this is for their badges, not for access control.
 */

export type PostState = "draft" | "live" | "pending" | "failed";

type VideoStatus = "created" | "uploading" | "uploaded" | "processing" | "ready" | "failed";

export interface PostVideoColumns {
  status: "draft" | "published";
  video_id: string | null;
  video_kind: "none" | "full" | "highlights";
  show_video: boolean;
  demo_video_id: string | null;
  show_demo_video: boolean;
}

export interface PostVideoSlot {
  /** `null` when the video row is not known (not loaded, or deleted). */
  status: VideoStatus | null;
}

/** The videos a post shows, with their statuses looked up by id. Hidden videos don't count. */
export function postVideoSlots(
  post: PostVideoColumns,
  statuses: Readonly<Record<string, VideoStatus | null | undefined>>,
): PostVideoSlot[] {
  const slots: PostVideoSlot[] = [];
  if (post.video_id && post.show_video && post.video_kind !== "none")
    slots.push({ status: statuses[post.video_id] ?? null });
  if (post.demo_video_id && post.show_demo_video)
    slots.push({ status: statuses[post.demo_video_id] ?? null });
  return slots;
}

export function postPendingState(
  post: Pick<PostVideoColumns, "status">,
  slots: PostVideoSlot[],
): PostState {
  if (post.status !== "published") return "draft";
  if (slots.some((slot) => slot.status === "failed")) return "failed";
  if (slots.some((slot) => slot.status !== "ready")) return "pending";
  return "live";
}

/** State of a post row with its joined `videos` / `demo_videos` statuses. */
export function postStateOf(
  post: PostVideoColumns & {
    videos?: { status: VideoStatus } | null;
    demo_videos?: { status: VideoStatus } | null;
  },
): PostState {
  const statuses: Record<string, VideoStatus> = {};
  if (post.video_id && post.videos) statuses[post.video_id] = post.videos.status;
  if (post.demo_video_id && post.demo_videos)
    statuses[post.demo_video_id] = post.demo_videos.status;
  return postPendingState(post, postVideoSlots(post, statuses));
}

/** Author-facing copy for a post that is not live yet; `null` for live posts and drafts. */
export function describePostState(state: PostState): string | null {
  if (state === "pending") return "Pending: visible to others once its video finishes processing";
  if (state === "failed") return "Not visible: a video failed to process. Replace or hide it.";
  return null;
}
