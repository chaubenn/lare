import { formatDurationHuman, formatRelativeTime } from "@lare/shared";
import { ArrowLeft, Copy, ExternalLink, Lock } from "lucide-react";
import { Link, useParams } from "react-router";
import { AiReviewSection } from "@/components/AiReviewSection";
import { ProblemSection } from "@/components/ProblemSection";
import { useToast } from "@/components/toast/ToastProvider";
import { VideoEmbed } from "@/components/VideoEmbed";
import { Avatar } from "@/components/ui/Avatar";
import { Badge, KindBadge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, SectionTitle } from "@/components/ui/Card";
import { EmptyState, ErrorState, PageSpinner } from "@/components/ui/States";
import { useAuth } from "@/features/auth/AuthProvider";
import { copyText } from "@/lib/clipboard";
import { postWebUrl } from "@/lib/env";
import { formatDateTime, plural } from "@/lib/format";
import { openExternal } from "@/lib/open";
import { type PostDetail, useInterviewReview, usePost } from "./queries";

export function PostPage() {
  const { id = "" } = useParams();
  const post = usePost(id);

  if (post.isPending) return <PageSpinner />;
  if (post.isError) return <ErrorState error={post.error} onRetry={() => void post.refetch()} />;
  if (!post.data) {
    return (
      <EmptyState
        title="Post not found"
        description="It may have been deleted, or you don't have access to it."
        action={
          <Link to="/" className="text-sm text-emerald-400 hover:underline">
            Back to feed
          </Link>
        }
      />
    );
  }
  return <PostView post={post.data} />;
}

function PostView({ post }: { post: PostDetail }) {
  const { userId } = useAuth();
  const { toast } = useToast();
  const review = useInterviewReview(post.session_id);
  const author = post.profiles;
  const session = post.sessions;
  const problems = session?.session_problems ?? [];
  const submissionCount = problems.reduce((n, p) => n + p.submissions.length, 0);
  const acceptedCount = problems.filter((p) => p.submissions.some((s) => s.accepted)).length;
  const name = author?.display_name ?? (author?.handle ? `@${author.handle}` : "Someone");
  const webUrl = postWebUrl(post.id);
  const isMine = post.user_id === userId;

  const copyLink = async () => {
    const ok = await copyText(webUrl);
    toast(ok ? { title: "Link copied", variant: "success" } : { title: "Couldn't copy", variant: "error" });
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <Link to="/" className="inline-flex items-center gap-1 text-sm text-zinc-400 hover:text-zinc-200">
          <ArrowLeft className="size-4" aria-hidden />
          Feed
        </Link>
        <div className="flex items-center gap-2">
          {post.status === "draft" ? <Badge tone="amber">Draft</Badge> : null}
          {post.visibility === "private" ? (
            <Badge>
              <Lock className="size-3" aria-hidden />
              Only me
            </Badge>
          ) : null}
          <Button size="sm" icon={<Copy className="size-3.5" aria-hidden />} onClick={() => void copyLink()}>
            Copy link
          </Button>
          <Button
            size="sm"
            icon={<ExternalLink className="size-3.5" aria-hidden />}
            onClick={() => void openExternal(webUrl)}
          >
            Open on web
          </Button>
        </div>
      </div>

      <header>
        <div className="flex items-center gap-3">
          <Avatar url={author?.avatar_url} name={name} size={40} />
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-sm">
              <span className="font-medium text-zinc-100">{name}</span>
              {author?.handle ? <span className="text-zinc-500">@{author.handle}</span> : null}
              {isMine ? <Badge tone="emerald">you</Badge> : null}
            </div>
            <div className="text-xs text-zinc-500">
              {post.published_at
                ? `Published ${formatRelativeTime(post.published_at)}`
                : `Created ${formatRelativeTime(post.created_at)}`}
            </div>
          </div>
        </div>
        {post.title ? (
          <h1 className="mt-4 select-text text-2xl font-semibold text-zinc-50">{post.title}</h1>
        ) : null}
        {post.body ? (
          <p className="mt-3 select-text whitespace-pre-wrap text-sm leading-relaxed text-zinc-300">
            {post.body}
          </p>
        ) : null}
      </header>

      {session ? (
        <Card>
          <SectionTitle>Session</SectionTitle>
          <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            <div>
              <dt className="text-xs text-zinc-500">Kind</dt>
              <dd className="mt-1">
                <KindBadge kind={session.kind} />
              </dd>
            </div>
            <div>
              <dt className="text-xs text-zinc-500">Active time</dt>
              <dd className="mt-1 text-zinc-100">{formatDurationHuman(session.active_ms)}</dd>
            </div>
            <div>
              <dt className="text-xs text-zinc-500">Started</dt>
              <dd className="mt-1 text-zinc-100">{formatDateTime(session.started_at)}</dd>
            </div>
            <div>
              <dt className="text-xs text-zinc-500">Problems</dt>
              <dd className="mt-1 text-zinc-100">
                {acceptedCount}/{problems.length} solved · {plural(submissionCount, "submission")}
              </dd>
            </div>
          </dl>
        </Card>
      ) : null}

      {post.video_kind !== "none" || post.videos ? (
        <section>
          <SectionTitle>
            {post.video_kind === "highlights" ? "Highlights" : "Demo video"}
          </SectionTitle>
          {post.videos ? (
            <VideoEmbed video={post.videos} />
          ) : (
            <div className="rounded-xl border border-dashed border-zinc-800 p-6 text-center text-sm text-zinc-500">
              No video attached.
            </div>
          )}
        </section>
      ) : null}

      {problems.length > 0 ? (
        <section className="space-y-3">
          <SectionTitle>Problems</SectionTitle>
          {problems.map((p) => (
            <ProblemSection key={p.id} problem={p} />
          ))}
        </section>
      ) : null}

      {review.data ? <AiReviewSection review={review.data} /> : null}
    </div>
  );
}
