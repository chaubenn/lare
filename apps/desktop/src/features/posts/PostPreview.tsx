import { formatLocalTimestamp } from "@lare/shared";
import type { Post, Video } from "@lare/supabase-types";
import { Lock, X } from "lucide-react";
import { useEffect } from "react";
import { Avatar } from "@/components/ui/Avatar";
import { useUser } from "@/features/auth/AuthProvider";
import { PostSlides, type SlidePost, type SlideVideo } from "@/features/feed/PostSlides";
import { usePostMedia } from "@/features/posts/media";
import { useVideo } from "@/features/recording/hooks";

/**
 * How the post will look once it is published, drawn from what is in the editor right now
 * rather than what has been saved: the same header, caption and swipe deck the feed renders.
 * The first slide is the session card — the image link unfurls and the feed cover use — so
 * this is also where an author checks their OG image before publishing.
 */
export function PostPreview({
  title,
  body,
  visibility,
  when,
  published,
  slides,
  onClose,
}: {
  title: string;
  body: string;
  visibility: Post["visibility"];
  /** Timestamp shown under the author, exactly as the feed card shows it. */
  when: string;
  published: boolean;
  slides: SlidePost;
  onClose: () => void;
}) {
  const { profile } = useUser();
  const name = profile?.display_name ?? (profile?.handle ? `@${profile.handle}` : "You");
  const shown = title.trim() || "Untitled session";

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto p-4 sm:p-8">
      <button
        type="button"
        aria-label="Close preview"
        onClick={onClose}
        className="fixed inset-0 cursor-default bg-zinc-950/80 backdrop-blur-sm"
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-label="Post preview"
        className="relative mx-auto w-full max-w-xl space-y-3"
      >
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-zinc-100">Preview</h2>
            <p className="text-xs text-zinc-500">
              {published
                ? "How this post looks in the feed."
                : "How this post will look once you publish it."}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close preview"
            className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-1.5 text-zinc-400 transition-colors hover:text-zinc-100"
          >
            <X className="size-4" />
          </button>
        </div>

        <article className="overflow-hidden rounded-2xl border border-zinc-800/80 bg-zinc-900/40">
          <header className="flex items-center gap-3 p-4 pb-3 sm:px-5">
            <Avatar url={profile?.avatar_url} name={name} size={40} />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline gap-x-2">
                <span className="truncate text-sm font-semibold text-zinc-100">{name}</span>
                {profile?.handle && profile.display_name && (
                  <span className="truncate text-xs text-zinc-500">@{profile.handle}</span>
                )}
              </div>
              <div className="flex items-center gap-2 text-xs text-zinc-500">
                <span>{formatLocalTimestamp(when)}</span>
                {visibility === "private" && (
                  <>
                    <span aria-hidden>·</span>
                    <span className="inline-flex items-center gap-1 text-zinc-400">
                      <Lock className="size-3" aria-hidden />
                      Only me
                    </span>
                  </>
                )}
              </div>
            </div>
          </header>

          <div className="px-4 sm:px-5">
            <h3 className="text-base font-semibold leading-snug text-zinc-50">{shown}</h3>
            {body.trim() && (
              <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-zinc-400">
                {body.trim()}
              </p>
            )}
          </div>

          <div className="p-4 pt-3 sm:px-5">
            <PostSlides post={slides} title={shown} />
          </div>
        </article>

        {slides.include_og_card && !slides.og_url && !slides.cover_url && (
          <p className="text-xs text-zinc-500">
            No session card yet — use the refresh button on the session card in Photos to generate
            one. Publishing always regenerates it.
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * The slide deck for a post being edited: the photos and session card as they are stored right
 * now, combined with the cover and show-video choices sitting unsaved in the editor. Both
 * editors build their preview from this, so what you see is what publishing produces.
 */
export function usePreviewSlides({
  postId,
  videoId,
  videoKind,
  showVideo,
  demoVideoId,
  showDemoVideo,
  includeOgCard,
  coverMediaId,
  session,
}: {
  postId: string;
  videoId: string | null;
  videoKind: Post["video_kind"];
  showVideo: boolean;
  demoVideoId: string | null;
  showDemoVideo: boolean;
  includeOgCard: boolean;
  coverMediaId: string | null;
  session: SlidePost["sessions"];
}): SlidePost {
  const media = usePostMedia(postId);
  const video = useVideo(videoId);
  const demo = useVideo(demoVideoId);

  const rows = media.data ?? [];
  const images = rows.flatMap((row) =>
    row.kind !== "og" && row.url ? [{ id: row.id, url: row.url, caption: row.caption }] : [],
  );

  return {
    id: postId,
    video_kind: videoKind,
    show_video: showVideo,
    show_demo_video: showDemoVideo,
    include_og_card: includeOgCard,
    cover_media_id: coverMediaId,
    // Null when the cover is the session card (or unset): the deck falls back to `og_url`.
    cover_url: images.find((image) => image.id === coverMediaId)?.url ?? null,
    og_url: rows.find((row) => row.kind === "og")?.url ?? null,
    thumbnail_url: null,
    demo_thumbnail_url: null,
    images,
    videos: toSlideVideo(video.data),
    demo_videos: toSlideVideo(demo.data),
    sessions: session,
  };
}

function toSlideVideo(clip: Video | null | undefined): SlideVideo | null {
  return clip
    ? {
        id: clip.id,
        status: clip.status,
        bunny_video_id: clip.bunny_video_id,
        duration_ms: clip.duration_ms,
      }
    : null;
}
