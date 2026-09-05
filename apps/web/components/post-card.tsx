import { excerptFromHtml, formatBeats, formatDurationHuman } from "@lare/shared";
import { Clock, Lock, Play, Sparkles } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { cn } from "@/lib/cn";
import { bestAcceptedRun, sessionKindLabel } from "@/lib/post-utils";
import type { PostCardData } from "@/lib/posts";
import { cardClass } from "@/lib/styles";
import { Avatar } from "./avatar";
import { TimeAgo } from "./time-ago";
import { DifficultyBadge } from "./ui";

export function PostCard({ post }: { post: PostCardData }) {
  const author = post.profiles;
  const session = post.sessions;
  const problems = [...(session?.session_problems ?? [])].sort((a, b) =>
    a.opened_at.localeCompare(b.opened_at),
  );
  const href = `/p/${post.id}`;
  const authorName = author?.display_name || (author?.handle ? `@${author.handle}` : "Unknown");
  const excerpt = excerptFromHtml(post.body, 220);
  const when = post.published_at ?? post.created_at;
  const hasVideo = Boolean(post.video_id) && post.video_kind !== "none";

  return (
    <article className={cn(cardClass, "p-4 sm:p-5")}>
      <header className="flex items-center gap-3">
        {author?.handle ? (
          <Link href={`/u/${author.handle}`} className="shrink-0">
            <Avatar src={author.avatar_url} name={authorName} />
          </Link>
        ) : (
          <Avatar src={author?.avatar_url} name={authorName} />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2">
            {author?.handle ? (
              <Link
                href={`/u/${author.handle}`}
                className="truncate text-sm font-semibold text-zinc-100 hover:underline"
              >
                {authorName}
              </Link>
            ) : (
              <span className="text-sm font-semibold text-zinc-100">{authorName}</span>
            )}
            {author?.handle && (
              <span className="truncate text-xs text-zinc-500">@{author.handle}</span>
            )}
            {author?.is_private && (
              <span title="Private account" className="inline-flex">
                <Lock className="size-3 text-zinc-600" aria-label="Private account" />
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 text-xs text-zinc-500">
            <TimeAgo iso={when} />
            <span aria-hidden="true">·</span>
            <span>{sessionKindLabel(session?.kind)}</span>
            {post.visibility === "private" && (
              <>
                <span aria-hidden="true">·</span>
                <span className="text-zinc-400">Only me</span>
              </>
            )}
          </div>
        </div>
      </header>

      <div className="mt-3">
        <h2 className="text-lg font-semibold leading-snug text-zinc-50">
          <Link href={href} className="hover:underline">
            {post.title?.trim() || "Untitled session"}
          </Link>
        </h2>
        {excerpt && <p className="mt-1 text-sm leading-relaxed text-zinc-400">{excerpt}</p>}
      </div>

      {problems.length > 0 && (
        <ul className="mt-4 divide-y divide-zinc-800/80 rounded-xl border border-zinc-800/80 bg-zinc-950/40">
          {problems.map((problem) => {
            const best = bestAcceptedRun(problem.submissions ?? []);
            const beats = best ? formatBeats(best.beats) : null;
            return (
              <li key={problem.id} className="flex items-center gap-3 px-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium text-zinc-200">
                      {problem.title}
                    </span>
                    <DifficultyBadge difficulty={problem.difficulty} />
                  </div>
                </div>
                <div className="shrink-0 text-right text-xs">
                  {best ? (
                    <span className="text-emerald-400">
                      {best.runtimeLabel}
                      {beats && <span className="text-zinc-500"> · beats {beats}</span>}
                    </span>
                  ) : (
                    <span className="text-zinc-500">
                      {(problem.submissions?.length ?? 0) > 0 ? "Not accepted" : "No submission"}
                    </span>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {hasVideo && (
        <Link
          href={href}
          className="group relative mt-4 block aspect-video overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900"
        >
          {post.thumbnail_url ? (
            <Image
              src={post.thumbnail_url}
              alt=""
              fill
              unoptimized
              sizes="(max-width: 768px) 100vw, 768px"
              className="object-cover opacity-90 transition-opacity group-hover:opacity-100"
            />
          ) : (
            <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_rgba(245,158,11,0.15),_transparent_60%)]" />
          )}
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="inline-flex size-12 items-center justify-center rounded-full bg-zinc-950/70 text-zinc-100 ring-1 ring-white/10 backdrop-blur transition-transform group-hover:scale-105">
              <Play className="size-5 fill-current" />
            </span>
          </div>
          <span className="absolute bottom-2 left-2 rounded-md bg-zinc-950/70 px-1.5 py-0.5 text-[11px] font-medium text-zinc-200">
            {post.video_kind === "highlights" ? "Highlights" : "Full recording"}
            {post.videos && post.videos.status !== "ready" ? " · processing" : ""}
            {post.videos?.duration_ms ? ` · ${formatDurationHuman(post.videos.duration_ms)}` : ""}
          </span>
        </Link>
      )}

      <footer className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-zinc-500">
        {session && (
          <span className="inline-flex items-center gap-1">
            <Clock className="size-3.5" />
            {formatDurationHuman(session.active_ms)}
          </span>
        )}
        <span>
          {problems.length} {problems.length === 1 ? "problem" : "problems"}
        </span>
        {post.include_ai_insights && session?.kind === "interview" && (
          <span className="inline-flex items-center gap-1 text-amber-400/80">
            <Sparkles className="size-3.5" />
            AI review
          </span>
        )}
        <Link href={href} className="ml-auto text-zinc-400 hover:text-zinc-100">
          View post →
        </Link>
      </footer>
    </article>
  );
}
