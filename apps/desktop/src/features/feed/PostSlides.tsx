import type { Post, Video } from "@lare/supabase-types";
import type { ReactNode } from "react";
import { SectionTitle } from "@/components/ui/Card";
import type { FeedImage } from "@/features/publishing/posts/media";
import { PostCarousel } from "./PostCarousel";
import { VideoSlide } from "./VideoSlide";

/** The two `videos` embeds a post can carry, in the shape the deck reads. */
export interface SlideVideo {
  id: string;
  status: Video["status"];
  bunny_video_id: string | null;
  duration_ms: number | null;
  width: number | null;
  height: number | null;
}

/**
 * Structural shape of the fields the deck reads, so the feed card and the profile's posts
 * can both hand it a row without converting anything. Mirrors the web feed's SlidePost.
 */
export interface SlidePost {
  id: string;
  video_kind: Post["video_kind"];
  show_video: boolean;
  show_demo_video: boolean;
  thumbnail_url: string | null;
  demo_thumbnail_url: string | null;
  images: FeedImage[];
  videos: SlideVideo | null;
  /** The interview's summary clip, shown before the full recording. */
  demo_videos: SlideVideo | null;
}

/** What the deck will show, in order. Everything here is something the author chose to add. */
function deckContents(post: SlidePost) {
  const summary = post.demo_videos && post.show_demo_video ? post.demo_videos : null;
  const video = post.videos && post.video_kind !== "none" && post.show_video ? post.videos : null;
  return { summary, photos: post.images, video };
}

/**
 * Whether the post has any media to show. A post with none is just its text — no frame, no
 * placeholder — so callers skip the deck's wrapper too.
 */
export function postHasSlides(post: SlidePost): boolean {
  const { summary, photos, video } = deckContents(post);
  return Boolean(summary) || photos.length > 0 || Boolean(video);
}

/**
 * The swipe deck: the interview's summary video → the author's images → the demo video or full
 * recording, when they chose to show it. All of it is optional. One clip and no images is a deck
 * of one slide: just the video.
 */
export function PostSlides({
  post,
  title,
  className,
}: {
  post: SlidePost;
  title: string;
  className?: string;
}) {
  const { summary, photos, video } = deckContents(post);
  // Two clips in one deck look identical without a name on them — the player's `title`
  // reaches screen readers only. With a single clip the label would state the obvious.
  const bothClips = Boolean(summary) && Boolean(video);
  return (
    <PostCarousel label={`${title} — media`} className={className}>
      {summary ? (
        <LabelledSlide label={bothClips ? "Summary" : null}>
          <VideoSlide
            videoId={summary.id}
            status={summary.status}
            bunnyVideoId={summary.bunny_video_id}
            posterUrl={post.demo_thumbnail_url}
            durationMs={summary.duration_ms}
            width={summary.width}
            height={summary.height}
            title={`${title} — summary`}
            className="w-full rounded-none border-0"
            fill
          />
        </LabelledSlide>
      ) : null}
      {photos.map((image) => (
        <PhotoSlide key={image.id} image={image} />
      ))}
      {video ? (
        <LabelledSlide
          label={bothClips ? (post.video_kind === "highlights" ? "Highlights" : "Recording") : null}
        >
          <VideoSlide
            videoId={video.id}
            status={video.status}
            bunnyVideoId={video.bunny_video_id}
            posterUrl={post.thumbnail_url}
            durationMs={video.duration_ms}
            width={video.width}
            height={video.height}
            title={`${title} — ${post.video_kind === "highlights" ? "highlights" : "full recording"}`}
            className="w-full rounded-none border-0"
            fill
          />
        </LabelledSlide>
      ) : null}
    </PostCarousel>
  );
}

/**
 * A slide whose content is text, not media. It fills the deck's fixed frame and sits on the
 * deck's own background; if the text is taller than the frame, the slide scrolls.
 */
export function TextSlide({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-h-full w-full px-4 py-4">
      <SectionTitle>{label}</SectionTitle>
      {children}
    </div>
  );
}

/**
 * Names a slide in its top-left corner. Wrapping here rather than inside VideoSlide
 * means the label survives every player state — ready, still processing, or a local
 * preview of a clip that has not uploaded yet.
 */
export function LabelledSlide({
  label,
  children,
  className = "relative h-full w-full",
}: {
  label: string | null;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      {children}
      {label ? (
        <span className="lare-label pointer-events-none absolute left-3 top-3 z-10 rounded-[var(--lare-r-1)] bg-[color-mix(in_oklab,var(--lare-ink)_72%,transparent)] px-2 py-1 text-[var(--text)] ring-1 ring-[var(--border)] backdrop-blur">
          {label}
        </span>
      ) : null}
    </div>
  );
}

/**
 * An image slide, with the author's caption laid over the foot of it when there is one. It fills
 * the deck's fixed frame and the picture is fitted inside it.
 */
export function PhotoSlide({ image }: { image: FeedImage }) {
  return (
    <figure className="relative h-full w-full bg-[var(--surface-sunken)]">
      <img src={image.url} alt={image.caption ?? ""} className="size-full object-contain" />
      {image.caption && (
        <figcaption className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent px-4 pb-6 pt-8 text-xs text-zinc-100">
          {image.caption}
        </figcaption>
      )}
    </figure>
  );
}
