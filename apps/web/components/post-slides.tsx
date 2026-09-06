import { buildSessionOverview, type OverviewProblem } from "@lare/shared";
import type { Post, Video } from "@lare/supabase-types";
import Image from "next/image";
import type { PostImage } from "@/lib/posts";
import { PostCarousel } from "./post-carousel";
import { SessionOverviewSlide } from "./session-overview";
import { VideoEmbed } from "./video-embed";

/**
 * Structural shape of the fields the deck reads, so the feed card (lean select) and the post
 * page (`select *`) can both hand it a row without converting anything.
 */
export interface SlidePost {
  id: string;
  video_kind: Post["video_kind"];
  show_video: boolean;
  cover_media_id: string | null;
  cover_url: string | null;
  thumbnail_url: string | null;
  images: PostImage[];
  videos: {
    id: string;
    status: Video["status"];
    bunny_video_id: string | null;
    duration_ms: number | null;
  } | null;
  sessions: {
    kind: "practice" | "interview";
    active_ms: number;
    session_problems: OverviewProblem[];
  } | null;
}

/**
 * The swipe deck: cover (the author's own image, or the generated session card) → the session
 * breakdown → the author's photos → the demo video when they chose to show it.
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
  const showVideo = Boolean(video) && post.video_kind !== "none" && post.show_video;

  return (
    <PostCarousel label={`${title} — media`} className={className}>
      <CoverSlide
        src={post.cover_url ?? `/api/og/${post.id}`}
        custom={Boolean(post.cover_url)}
        title={title}
      />
      <SessionOverviewSlide overview={overview} kind={session?.kind} />
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
