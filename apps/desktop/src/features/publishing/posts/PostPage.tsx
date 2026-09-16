import { formatDurationHuman, formatLocalTimestamp, postStateOf } from "@lare/shared";
import { useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, Lock, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router";
import { AiReviewSection } from "@/components/AiReviewSection";
import { ProblemSection } from "@/components/ProblemSection";
import { Avatar } from "@/components/ui/Avatar";
import { Badge, KindBadge, PostStateBadge } from "@/components/ui/Badge";
import { Button, buttonClass } from "@/components/ui/Button";
import { Card, SectionTitle } from "@/components/ui/Card";
import { DifficultyTag } from "@/components/ui/DifficultyTag";
import { EmptyState, ErrorState, PageSpinner } from "@/components/ui/States";
import { VideoEmbed } from "@/components/VideoEmbed";
import { useUser } from "@/features/auth/AuthProvider";
import { useNotify } from "@/features/notifications/notices";
import { ProfileHoverCard } from "@/features/profile/ProfileHoverCard";
import { formatDateTime, plural } from "@/lib/format";
import { usePostMedia } from "./media";
import { CommentsSection, PostActions } from "./PostSocial";
import { type PostDetail, useInterviewReview, usePost } from "./queries";
import { useDeletePostFlow } from "./useDeletePostFlow";

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
  const _queryClient = useQueryClient();
  const review = useInterviewReview(post.sessions?.graded ? post.session_id : null);
  const media = usePostMedia(post.id);
  const mediaRows = media.data ?? [];
  const photos = mediaRows.filter((m) => m.kind !== "og");
  const author = post.profiles;
  const session = post.sessions;
  const problems = session?.session_problems ?? [];
  const name = author?.display_name ?? (author?.handle ? `@${author.handle}` : "Someone");
  const isMine = post.user_id === userId;

  return (
    <div className="grid w-full gap-x-8 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="lg:col-span-2">
        <Link
          to="/"
          className="mb-4 inline-flex items-center gap-1 rounded-[var(--lare-r-1)] text-sm text-[var(--text-secondary)] hover:text-[var(--text)] focus-visible:outline-2 focus-visible:outline-[var(--focus)]"
        >
          <ChevronLeft className="size-4" aria-hidden />
          Feed
        </Link>
      </div>

      <article className="min-w-0 space-y-6">
        <header>
          <div className="flex items-start gap-3">
            <ProfileHoverCard handle={author?.handle} className="shrink-0">
              {author?.handle ? (
                <Link to={`/u/${author.handle}`}>
                  <Avatar url={author.avatar_url} name={name} size={40} />
                </Link>
              ) : (
                <Avatar url={author?.avatar_url} name={name} size={40} />
              )}
            </ProfileHoverCard>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                <ProfileHoverCard handle={author?.handle} className="min-w-0 truncate">
                  {author?.handle ? (
                    <Link
                      to={`/u/${author.handle}`}
                      className="font-medium text-[var(--text)] hover:underline"
                    >
                      {name}
                    </Link>
                  ) : (
                    <span className="font-medium text-[var(--text)]">{name}</span>
                  )}
                </ProfileHoverCard>
                {author?.handle ? (
                  <span className="text-[var(--text-tertiary)]">@{author.handle}</span>
                ) : null}
                {post.status === "draft" ? <Badge tone="amber">Draft</Badge> : null}
                {isMine ? <PostStateBadge state={postStateOf(post)} /> : null}
                {post.visibility === "private" ? (
                  <Badge>
                    <Lock className="size-3" aria-hidden />
                    Only me
                  </Badge>
                ) : null}
              </div>
              <div className="text-xs text-[var(--text-tertiary)]">
                {post.published_at
                  ? `Published ${formatLocalTimestamp(post.published_at)}`
                  : `Created ${formatLocalTimestamp(post.created_at)}`}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {isMine ? (
                <Link to={`/posts/${post.id}/edit`} className={buttonClass("secondary", "sm")}>
                  <Pencil className="size-3.5" aria-hidden />
                  Edit post
                </Link>
              ) : null}
              <PostMenu post={post} isMine={isMine} />
            </div>
          </div>
          {post.title ? (
            <h1 className="mt-4 select-text text-2xl font-semibold text-[var(--text)]">
              {post.title}
            </h1>
          ) : null}
          {post.body ? (
            <p className="mt-3 max-w-prose select-text whitespace-pre-wrap text-sm leading-relaxed text-[var(--text-secondary)]">
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

        {post.demo_videos && (post.show_demo_video || isMine) ? (
          <section>
            <SectionTitle>Summary video</SectionTitle>
            <VideoEmbed video={post.demo_videos} />
            {!post.show_demo_video && isMine ? <HiddenNote postId={post.id} /> : null}
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
                {!post.show_video && isMine ? <HiddenNote postId={post.id} /> : null}
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
      </article>

      {session ? (
        <aside className="mt-6 min-w-0 lg:mt-0" aria-label="Session details">
          <div className="lg:sticky lg:top-0">
            <SessionPanel session={session} />
          </div>
        </aside>
      ) : null}
    </div>
  );
}

function SessionPanel({ session }: { session: NonNullable<PostDetail["sessions"]> }) {
  const problems = session.session_problems;
  const submissionCount = problems.reduce((n, p) => n + p.submissions.length, 0);
  const acceptedCount = problems.filter((p) => p.submissions.some((s) => s.accepted)).length;
  const rows = [
    { label: "Kind", value: <KindBadge kind={session.kind} /> },
    { label: "Active time", value: formatDurationHuman(session.active_ms) },
    { label: "Started", value: formatDateTime(session.started_at) },
    {
      label: "Solved",
      value: `${acceptedCount}/${problems.length} · ${plural(submissionCount, "submission")}`,
    },
  ];
  return (
    <Card>
      <SectionTitle>Session</SectionTitle>
      <dl className="divide-y divide-[var(--border)] text-sm">
        {rows.map((row) => (
          <div key={row.label} className="flex items-center justify-between gap-3 py-2">
            <dt className="text-[var(--text-tertiary)]">{row.label}</dt>
            <dd className="text-right text-[var(--text)]">{row.value}</dd>
          </div>
        ))}
      </dl>
      {problems.length > 0 ? (
        <ul className="mt-3 space-y-1.5 border-t border-[var(--border)] pt-3">
          {problems.map((p) => (
            <li key={p.id} className="flex items-center gap-2 text-sm">
              <DifficultyTag difficulty={p.difficulty} rounded />
              <span className="min-w-0 truncate text-[var(--text)]">{p.title}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </Card>
  );
}

function HiddenNote({ postId }: { postId: string }) {
  return (
    <p className="mt-2 text-xs text-[var(--text-tertiary)]">
      Hidden from the post.{" "}
      <Link
        to={`/posts/${postId}/edit`}
        className="underline underline-offset-2 hover:text-[var(--text)]"
      >
        Show it
      </Link>
    </p>
  );
}

/** Secondary actions in one place: sharing for everyone, deletion for the owner. */
function PostMenu({ post, isMine }: { post: PostDetail; isMine: boolean }) {
  const { notify } = useNotify();
  const remove = useDeletePostFlow(post.id);
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    root.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const choose = (action: () => void) => () => {
    setOpen(false);
    action();
  };

  const item =
    "flex w-full items-center gap-2 rounded-[var(--lare-r-2)] px-2.5 py-2 text-left text-sm outline-none hover:bg-[color-mix(in_oklab,var(--border)_70%,transparent)] focus-visible:bg-[color-mix(in_oklab,var(--border)_70%,transparent)] disabled:opacity-50";

  return (
    <div ref={root} className="relative">
      <Button
        size="sm"
        variant="ghost"
        aria-label="More actions"
        aria-haspopup="menu"
        aria-expanded={open}
        icon={<MoreHorizontal className="size-4" aria-hidden />}
        onClick={() => setOpen((o) => !o)}
      />
      {open ? (
        <div
          role="menu"
          aria-label="Post actions"
          tabIndex={-1}
          className="lare-material-regular lare-dropdown absolute right-0 top-full z-20 mt-1 w-48 rounded-[var(--lare-r-3)] border border-[var(--border)] p-1 shadow-[var(--lare-shadow-2)]"
          onKeyDown={(e) => {
            if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
            e.preventDefault();
            const items = [
              ...(root.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []),
            ];
            const at = items.indexOf(document.activeElement as HTMLElement);
            const next = (at + (e.key === "ArrowDown" ? 1 : items.length - 1)) % items.length;
            items[next]?.focus();
          }}
        >
          {isMine ? (
            <button
              type="button"
              role="menuitem"
              disabled={remove.isPending}
              className={`${item} text-[var(--lare-danger)]`}
              onClick={choose(() => void remove.deletePost())}
            >
              <Trash2 className="size-4" aria-hidden />
              Delete post
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
