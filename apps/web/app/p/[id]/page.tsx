import { excerptFromHtml, formatDurationHuman } from "@lare/shared";
import { Clock, ListChecks, Lock } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { type ReactNode, Suspense } from "react";
import { Avatar } from "@/components/avatar";
import { CopyLinkButton } from "@/components/copy-link-button";
import { InterviewReview } from "@/components/interview-review";
import { ProblemSection } from "@/components/problem-section";
import { Skeleton } from "@/components/skeleton";
import { TimeAgo } from "@/components/time-ago";
import { Transcript } from "@/components/transcript";
import { VideoEmbed } from "@/components/video-embed";
import { parseTranscriptSegments, toReviewView } from "@/lib/parse";
import { sessionKindLabel } from "@/lib/post-utils";
import { getPostDetail } from "@/lib/posts";
import { createClient } from "@/lib/supabase/server";
import { getViewer } from "@/lib/viewer";
import { OwnerControls } from "./owner-controls";

type Params = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { id } = await params;
  const post = await getPostDetail(id);
  if (!post) return { title: "Post", robots: { index: false, follow: false } };

  const title = post.title?.trim() || "Untitled session";
  const problems = post.sessions?.session_problems.length ?? 0;
  const duration = post.sessions ? formatDurationHuman(post.sessions.active_ms) : null;
  const byline = post.profiles.handle ? ` by @${post.profiles.handle}` : "";
  const fallback = `${problems} ${problems === 1 ? "problem" : "problems"}${
    duration ? ` in ${duration}` : ""
  }${byline}`;
  const description = excerptFromHtml(post.body, 160) || fallback;

  return {
    title,
    description,
    robots: post.visibility === "public" ? undefined : { index: false, follow: false },
    openGraph: {
      title,
      description,
      type: "article",
      publishedTime: post.published_at ?? undefined,
      images: [{ url: `/api/og/${post.id}`, width: 1200, height: 630, alt: title }],
    },
    twitter: { card: "summary_large_image", title, description, images: [`/api/og/${post.id}`] },
  };
}

export default async function PostPage({ params }: Params) {
  const { id } = await params;
  const post = await getPostDetail(id);
  if (!post) notFound();

  const viewer = await getViewer();
  const isOwner = viewer?.id === post.user_id;
  const author = post.profiles;
  const session = post.sessions;
  const problems = [...(session?.session_problems ?? [])].sort((a, b) =>
    a.opened_at.localeCompare(b.opened_at),
  );
  const authorName = author.display_name || (author.handle ? `@${author.handle}` : "Unknown");
  const title = post.title?.trim() || "Untitled session";
  const showVideo = post.video_kind !== "none" && post.videos !== null;

  return (
    <article className="space-y-6">
      {isOwner && (
        <OwnerControls postId={post.id} status={post.status} visibility={post.visibility} />
      )}

      <header>
        <div className="flex items-center gap-3">
          {author.handle ? (
            <Link href={`/u/${author.handle}`}>
              <Avatar src={author.avatar_url} name={authorName} />
            </Link>
          ) : (
            <Avatar src={author.avatar_url} name={authorName} />
          )}
          <div className="min-w-0">
            <div className="flex flex-wrap items-baseline gap-x-2">
              {author.handle ? (
                <Link
                  href={`/u/${author.handle}`}
                  className="font-semibold text-zinc-100 hover:underline"
                >
                  {authorName}
                </Link>
              ) : (
                <span className="font-semibold text-zinc-100">{authorName}</span>
              )}
              {author.handle && <span className="text-sm text-zinc-500">@{author.handle}</span>}
              {author.is_private && (
                <span title="Private account" className="inline-flex">
                  <Lock className="size-3 text-zinc-600" aria-label="Private account" />
                </span>
              )}
            </div>
            <p className="text-xs text-zinc-500">
              {post.published_at ? (
                <>
                  Published <TimeAgo iso={post.published_at} />
                </>
              ) : (
                "Draft"
              )}
            </p>
          </div>
          <div className="ml-auto">
            <CopyLinkButton path={`/p/${post.id}`} />
          </div>
        </div>

        <h1 className="mt-5 text-2xl font-bold leading-tight text-zinc-50 sm:text-3xl">{title}</h1>
        {post.body?.trim() && (
          <p className="mt-3 whitespace-pre-wrap text-[15px] leading-relaxed text-zinc-300">
            {post.body}
          </p>
        )}

        <dl className="mt-4 flex flex-wrap gap-2 text-xs">
          <SummaryChip label={sessionKindLabel(session?.kind)} />
          {session && (
            <SummaryChip
              icon={<Clock className="size-3.5" />}
              label={formatDurationHuman(session.active_ms)}
              title="Active time"
            />
          )}
          <SummaryChip
            icon={<ListChecks className="size-3.5" />}
            label={`${problems.length} ${problems.length === 1 ? "problem" : "problems"}`}
          />
          {post.visibility === "private" && (
            <SummaryChip icon={<Lock className="size-3.5" />} label="Only me" />
          )}
        </dl>
      </header>

      {showVideo && post.videos && (
        <section aria-label="Video">
          <VideoEmbed
            libraryId={post.videos.library_id}
            bunnyVideoId={post.videos.bunny_video_id}
            status={post.videos.status}
            title={`${title} — ${post.video_kind === "highlights" ? "highlights" : "full recording"}`}
          />
        </section>
      )}

      {problems.length > 0 ? (
        <div className="space-y-4">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-400">Problems</h2>
          {problems.map((problem, i) => (
            <ProblemSection key={problem.id} problem={problem} index={i} />
          ))}
        </div>
      ) : (
        <p className="text-sm text-zinc-500">No problems were recorded in this session.</p>
      )}

      {session && (
        <Suspense fallback={<Skeleton className="h-24 w-full" />}>
          <SessionInsights sessionId={session.id} />
        </Suspense>
      )}
    </article>
  );
}

function SummaryChip({ icon, label, title }: { icon?: ReactNode; label: string; title?: string }) {
  return (
    <div
      title={title}
      className="inline-flex items-center gap-1.5 rounded-full border border-zinc-800 bg-zinc-900/60 px-2.5 py-1 text-zinc-300"
    >
      {icon}
      <dd>{label}</dd>
    </div>
  );
}

/**
 * Transcript + AI review. RLS returns nothing unless the post has `include_ai_insights`
 * (or the viewer owns it), so absence of data simply renders nothing.
 */
async function SessionInsights({ sessionId }: { sessionId: string }) {
  const supabase = await createClient();
  const [reviewRes, transcriptRes] = await Promise.all([
    supabase.from("interview_reviews").select("*").eq("session_id", sessionId).maybeSingle(),
    supabase.from("transcripts").select("*").eq("session_id", sessionId).maybeSingle(),
  ]);
  const review = reviewRes.data ? toReviewView(reviewRes.data) : null;
  const segments = transcriptRes.data ? parseTranscriptSegments(transcriptRes.data.segments) : [];
  if (!review && segments.length === 0) return null;

  return (
    <div className="space-y-4">
      {review && <InterviewReview review={review} />}
      {transcriptRes.data && segments.length > 0 && (
        <Transcript segments={segments} language={transcriptRes.data.language} />
      )}
    </div>
  );
}
