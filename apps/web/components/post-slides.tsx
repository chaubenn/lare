import { buildSessionOverview, type OverviewProblem } from "@lare/shared";
import type { Post, Video } from "@lare/supabase-types";
import Image from "next/image";
import type { PostImage } from "@/lib/posts";
import { PostCarousel } from "./post-carousel";
import { SessionOverviewSlide } from "./session-overview";
import { VideoEmbed } from "./video-embed";

/** The two `videos` embeds a post can carry, in the shape the deck reads. */
export interface SlideVideo {
  id: string;
  status: Video["status"];
  bunny_video_id: string | null;
  duration_ms: number | null;
}

/**
 * Structural shape of the fields the deck reads, so the feed card (lean select) and the post
 * page (`select *`) can both hand it a row without converting anything.
 */
export interface SlidePost {
  id: string;
  video_kind: Post["video_kind"];
  show_video: boolean;
  show_demo_video: boolean;
  /** The author's "lead with the session card" switch; false drops the cover slide. */
  include_og_card: boolean;
  cover_media_id: string | null;
  cover_url: string | null;
  og_url: string | null;
  thumbnail_url: string | null;
  demo_thumbnail_url: string | null;
  images: PostImage[];
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
 * The swipe deck: cover (the author's own image, or the pre-generated session card, or the card
 * rendered on demand as a last resort) → the session breakdown → the interview's summary video →
 * the author's photos → the demo video or full recording, when they chose to show it.
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
  const photos = post.images.filter((image) => image.id !== post.cover_media_id);
  const video = post.videos;
  const summary = post.demo_videos;
  const showVideo = Boolean(video) && post.video_kind !== "none" && post.show_video;
  const showSummary = Boolean(summary) && post.show_demo_video;
  // A custom cover is the author's own image and always leads; the generated card only does so
  // while they have the session card switched on.
  const coverSrc =
    post.cover_url ?? (post.include_og_card ? (post.og_url ?? `/api/og/${post.id}`) : null);

  return (
    <PostCarousel label={`${title} — media`} className={className}>
      {coverSrc ? (
        <CoverSlide src={coverSrc} custom={Boolean(post.cover_url)} title={title} />
      ) : null}
      <SessionOverviewSlide overview={overview} kind={session?.kind} />
      {showSummary && summary ? (
        <VideoEmbed
          videoId={summary.id}
          status={summary.status}
          bunnyVideoId={summary.bunny_video_id}
          posterUrl={post.demo_thumbnail_url}
          durationMs={summary.duration_ms}
          title={`${title} — summary`}
          className="size-full rounded-none border-0"
        />
      ) : null}
      {photos.map((image) => (
        <PhotoSlide key={image.id} image={image} />
      ))}
      {showVideo && video ? (
        <VideoEmbed
          videoId={video.id}
          status={video.status}
          bunnyVideoId={video.bunny_video_id}
          posterUrl={post.thumbnail_url}
          durationMs={video.duration_ms}
          title={`${title} — ${post.video_kind === "highlights" ? "highlights" : "full recording"}`}
          className="size-full rounded-none border-0"
        />
      ) : null}
    </PostCarousel>
  );
}

function CoverSlide({ src, custom, title }: { src: string; custom: boolean; title: string }) {
  return (
    <div className="relative size-full bg-zinc-950">
      <Image
        src={src}
        alt={`${title} — session overview`}
        fill
        unoptimized
        sizes="(max-width: 768px) 100vw, 768px"
        className={custom ? "object-cover" : "object-contain"}
      />
    </div>
  );
}

function PhotoSlide({ image }: { image: PostImage }) {
  return (
    <figure className="relative size-full bg-zinc-950">
      <Image
        src={image.url}
        alt={image.caption ?? ""}
        fill
        unoptimized
        sizes="(max-width: 768px) 100vw, 768px"
        className="object-contain"
      />
      {image.caption && (
        <figcaption className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-zinc-950/90 to-transparent px-4 pb-6 pt-8 text-xs text-zinc-200">
          {image.caption}
        </figcaption>
      )}
    </figure>
  );
}
