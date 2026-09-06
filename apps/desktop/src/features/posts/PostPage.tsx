import { formatDurationHuman, formatLocalTimestamp } from "@lare/shared";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Copy, ExternalLink, Lock, Pencil } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router";
import { AiReviewSection } from "@/components/AiReviewSection";
import { ProblemSection } from "@/components/ProblemSection";
import { useToast } from "@/components/toast/ToastProvider";
import { Avatar } from "@/components/ui/Avatar";
import { Badge, KindBadge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, SectionTitle } from "@/components/ui/Card";
import { EmptyState, ErrorState, PageSpinner } from "@/components/ui/States";
import { VideoEmbed } from "@/components/VideoEmbed";
import { useUser } from "@/features/auth/AuthProvider";
import { copyText } from "@/lib/clipboard";
import { postWebUrl } from "@/lib/env";
import { formatDateTime, plural } from "@/lib/format";
import { openExternal } from "@/lib/open";
import { postMediaKey, requestOgSnapshot, usePostMedia } from "./media";
import { PostEditPanel } from "./PostEditPanel";
import { CommentsSection, PostActions } from "./PostSocial";
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
          <Link to="/" className="text-sm text-zinc-200 underline underline-offset-2">
            Back to feed
          </Link>
        }
      />
    );
  }
  return <PostView post={post.data} />;
}

function PostView({ post }: { post: PostDetail }) {
  // The route lives under RequireAuth, so the viewer is always signed in here.
  const { userId } = useUser();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const review = useInterviewReview(post.session_id);
  const media = usePostMedia(post.id);
  const [editing, setEditing] = useState(false);
  const mediaRows = media.data ?? [];
  const ogImage = mediaRows.find((m) => m.kind === "og") ?? null;
  const photos = mediaRows.filter((m) => m.kind !== "og");
  // Every published post carries a pre-generated session card; make one if this post lacks it.
  const needsOg = post.status === "published" && media.isSuccess && !ogImage;
  useEffect(() => {
    if (!needsOg) return;
    void requestOgSnapshot(post.id).then(() =>
      queryClient.invalidateQueries({ queryKey: postMediaKey(post.id) }),
    );
  }, [needsOg, post.id, queryClient]);
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
    toast(
      ok
        ? { title: "Link copied", variant: "success" }
        : { title: "Couldn't copy", variant: "error" },
    );
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <Link
          to="/"
          className="inline-flex items-center gap-1 text-sm text-zinc-400 hover:text-zinc-200"
        >
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
          {isMine ? (
            <Button
              size="sm"
              icon={<Pencil className="size-3.5" aria-hidden />}
              onClick={() => setEditing((v) => !v)}
              aria-expanded={editing}
            >
              {editing ? "Close editor" : "Edit post"}
            </Button>
          ) : null}
          <Button
            size="sm"
            icon={<Copy className="size-3.5" aria-hidden />}
            onClick={() => void copyLink()}
          >
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

      {editing && isMine ? (
        <PostEditPanel post={post} userId={userId} onDone={() => setEditing(false)} />
      ) : null}

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
                ? `Published ${formatLocalTimestamp(post.published_at)}`
                : `Created ${formatLocalTimestamp(post.created_at)}`}
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
        <div className="mt-3">
          <PostActions
            postId={post.id}
            userId={userId}
            likeCount={post.like_count}
            commentCount={post.comment_count}
          />
        </div>
      </header>

      {ogImage?.url ? (
        <section>
          <SectionTitle>Session card</SectionTitle>
          <img
            src={ogImage.url}
            alt="Session overview card"
            className="w-full rounded-xl border border-zinc-800"
          />
        </section>
      ) : null}

      {photos.length > 0 ? (
        <section>
          <SectionTitle>Photos</SectionTitle>
          <ul className="grid gap-3 sm:grid-cols-2">
            {photos.map((image) =>
              image.url ? (
                <li key={image.id} className="overflow-hidden rounded-xl border border-zinc-800">
                  <img
                    src={image.url}
                    alt={image.caption ?? ""}
                    className="aspect-video w-full object-cover"
                  />
                  {image.caption ? (
                    <p className="border-t border-zinc-800 px-3 py-2 text-xs text-zinc-400">
                      {image.caption}
                    </p>
                  ) : null}
                </li>
              ) : null,
            )}
          </ul>
        </section>
      ) : null}

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

      {post.demo_videos && (post.show_demo_video || isMine) ? (
        <section>
          <SectionTitle>Summary video</SectionTitle>
          <VideoEmbed video={post.demo_videos} />
          {!post.show_demo_video && isMine ? (
            <p className="mt-2 text-xs text-zinc-500">
              Hidden from the post — turn it back on with "Edit post".
            </p>
          ) : null}
        </section>
      ) : null}

      {(post.video_kind !== "none" || post.videos) && (post.show_video || isMine) ? (
        <section>
          <SectionTitle>
            {post.video_kind === "highlights" ? "Highlights" : "Demo video"}
          </SectionTitle>
          {post.videos ? (
            <>
              <VideoEmbed video={post.videos} />
              {!post.show_video && isMine ? (
                <p className="mt-2 text-xs text-zinc-500">
                  Hidden from the post — turn it back on with "Edit post".
                </p>
              ) : null}
            </>
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

      <CommentsSection postId={post.id} userId={userId} isPostOwner={isMine} />
    </div>
  );
}
