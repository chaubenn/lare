import { buildSessionOverview, type OverviewProblem } from "@lare/shared";
import type { Post, Video } from "@lare/supabase-types";
import type { ReactNode } from "react";
import { SectionTitle } from "@/components/ui/Card";
import type { FeedImage } from "@/features/publishing/posts/media";
import { PostCarousel } from "./PostCarousel";
import { SessionCardSlide } from "./SessionCardSlide";
import { SessionOverviewSlide } from "./SessionOverviewSlide";
import { VideoSlide } from "./VideoSlide";

/** The two `videos` embeds a post can carry, in the shape the deck reads. */
export interface SlideVideo {
  id: string;
  status: Video["status"];
  bunny_video_id: string | null;
  duration_ms: number | null;
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
  /** The author's "lead with the session card" switch; false drops the card slide. */
  include_og_card: boolean;
  thumbnail_url: string | null;
  demo_thumbnail_url: string | null;
  images: FeedImage[];
  videos: SlideVideo | null;
  /** The interview's summary clip, shown before the full recording. */
  demo_videos: SlideVideo | null;
  sessions: {
    kind: "practice" | "interview";
    active_ms: number;
    session_problems: OverviewProblem[];
  } | null;
}

/**
 * The swipe deck: the session card → the session breakdown → the interview's summary video → the
 * author's photos → the demo video or full recording, when they chose to show it.
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
  const session = post.sessions;
  const overview = buildSessionOverview(
    session?.session_problems ?? [],
    session?.active_ms ?? null,
  );
  const photos = post.images;
  const video = post.videos;
  const summary = post.demo_videos;
  const showVideo = Boolean(video) && post.video_kind !== "none" && post.show_video;
  const showSummary = Boolean(summary) && post.show_demo_video;
  // Two clips in one deck look identical without a name on them — the player's `title`
  // reaches screen readers only. With a single clip the label would state the obvious.
  const bothClips = showVideo && showSummary;
  return (
    <PostCarousel label={`${title} — media`} className={className}>
      {post.include_og_card && session ? (
        <SessionCardSlide title={title} overview={overview} kind={session.kind} />
      ) : null}
      <SessionOverviewSlide overview={overview} kind={session?.kind} />
      {showSummary && summary ? (
        <LabelledSlide label={bothClips ? "Summary" : null}>
          <VideoSlide
            videoId={summary.id}
            status={summary.status}
            bunnyVideoId={summary.bunny_video_id}
            posterUrl={post.demo_thumbnail_url}
            durationMs={summary.duration_ms}
            title={`${title} — summary`}
            className="size-full rounded-none border-0"
          />
        </LabelledSlide>
      ) : null}
      {photos.map((image) => (
        <PhotoSlide key={image.id} image={image} />
      ))}
      {showVideo && video ? (
        <LabelledSlide
          label={bothClips ? (post.video_kind === "highlights" ? "Highlights" : "Recording") : null}
        >
          <VideoSlide
            videoId={video.id}
            status={video.status}
            bunnyVideoId={video.bunny_video_id}
            posterUrl={post.thumbnail_url}
            durationMs={video.duration_ms}
            title={`${title} — ${post.video_kind === "highlights" ? "highlights" : "full recording"}`}
            className="size-full rounded-none border-0"
          />
        </LabelledSlide>
      ) : null}
    </PostCarousel>
  );
}

/**
 * A slide whose content is text, not media. It takes the height its content needs and
 * the deck sizes to it, rather than scrolling inside a frame it does not fill.
 */
export function TextSlide({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="w-full bg-[var(--surface)] px-4 pb-8 pt-4">
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
  className = "relative size-full",
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

function PhotoSlide({ image }: { image: FeedImage }) {
  return (
    <figure className="relative size-full bg-zinc-950">
      <img src={image.url} alt={image.caption ?? ""} className="size-full object-contain" />
      {image.caption && (
        <figcaption className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-zinc-950/90 to-transparent px-4 pb-6 pt-8 text-xs text-zinc-200">
          {image.caption}
        </figcaption>
      )}
    </figure>
  );
}
