import type { Post } from "@lare/supabase-types";
import { ChevronLeft, Eye, Trash2 } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { Button } from "@/components/ui/Button";
import { Card, PageHeader, SectionTitle } from "@/components/ui/Card";
import { Input, Label, Select, Textarea, Toggle } from "@/components/ui/Field";
import { EmptyState, ErrorState, PageSpinner } from "@/components/ui/States";
import { useUser } from "@/features/auth/AuthProvider";
import { useNotify } from "@/features/notifications/notices";
import { errorMessage } from "@/lib/supabase";
import { PostMediaPanel } from "./PostMediaPanel";
import { PostPreview, usePreviewSlides } from "./PostPreview";
import { type PostDetail, usePost, useUpdatePost } from "./queries";
import { useDeletePostFlow } from "./useDeletePostFlow";

/** `/posts/:id/edit`: the owner's editor, on its own page rather than stacked above the post. */
export function PostEditPage() {
  const { id = "" } = useParams();
  const { userId } = useUser();
  const post = usePost(id);

  if (post.isPending) return <PageSpinner />;
  if (post.isError) return <ErrorState error={post.error} onRetry={() => void post.refetch()} />;
  if (!post.data || post.data.user_id !== userId) {
    return (
      <EmptyState
        title="You can't edit this post"
        description="It may have been deleted, or it belongs to someone else."
        action={
          <Link to={`/posts/${id}`} className="text-sm text-zinc-200 underline underline-offset-2">
            Back to the post
          </Link>
        }
      />
    );
  }
  return <PostEditor post={post.data} userId={userId} />;
}

/**
 * The caption, who can see it, whether the videos ride along, and the photos. Photos save as soon
 * as they are uploaded; the fields save on "Save changes", the same split the web editor uses.
 */
function PostEditor({ post, userId }: { post: PostDetail; userId: string }) {
  const { notify } = useNotify();
  const navigate = useNavigate();
  const update = useUpdatePost();
  const remove = useDeletePostFlow(post.id);
  const busy = update.isPending || remove.isPending;
  const postHref = `/posts/${post.id}`;

  const [title, setTitle] = useState(post.title ?? "");
  const [body, setBody] = useState(post.body ?? "");
  const [visibility, setVisibility] = useState<Post["visibility"]>(post.visibility);
  const [showVideo, setShowVideo] = useState(post.show_video);
  const [showDemoVideo, setShowDemoVideo] = useState(post.show_demo_video);
  const [previewing, setPreviewing] = useState(false);

  const hasVideo = Boolean(post.video_id) && post.video_kind !== "none";
  const hasDemoVideo = Boolean(post.demo_video_id);
  const slides = usePreviewSlides({
    postId: post.id,
    videoId: post.video_id,
    videoKind: post.video_kind,
    showVideo,
    demoVideoId: post.demo_video_id,
    showDemoVideo,
    includeOgCard: post.include_og_card,
    session: post.sessions,
  });

  const save = () => {
    update.mutate(
      { id: post.id, title, body, visibility, showVideo, showDemoVideo },
      {
        onSuccess: () => {
          notify({ title: "Post updated", variant: "success" });
          void navigate(postHref);
        },
        onError: (e) =>
          notify({ title: "Couldn't save", description: errorMessage(e), variant: "error" }),
      },
    );
  };

  return (
    <div className="grid w-full gap-x-8 gap-y-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="min-w-0 lg:col-span-2">
        <Link
          to={postHref}
          className="mb-3 inline-flex items-center gap-1 rounded-[var(--lare-r-1)] text-sm text-[var(--text-secondary)] hover:text-[var(--text)] focus-visible:outline-2 focus-visible:outline-[var(--focus)]"
        >
          <ChevronLeft className="size-4" aria-hidden />
          Post
        </Link>
        <PageHeader
          title="Edit post"
          subtitle={post.title?.trim() || "Untitled session"}
          actions={
            <>
              <Button
                variant="ghost"
                icon={<Eye className="size-4" aria-hidden />}
                onClick={() => setPreviewing(true)}
              >
                Preview
              </Button>
              <Button variant="ghost" disabled={busy} onClick={() => void navigate(postHref)}>
                Cancel
              </Button>
              <Button variant="primary" loading={update.isPending} disabled={busy} onClick={save}>
                Save changes
              </Button>
            </>
          }
        />
      </div>

      <div className="min-w-0 space-y-4">
        <Card className="space-y-4">
          <SectionTitle>Caption</SectionTitle>
          <div>
            <Label htmlFor="post-title">Title</Label>
            <Input
              id="post-title"
              className="mt-1"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={140}
              placeholder="Give this session a title"
            />
          </div>
          <div>
            <Label htmlFor="post-body" hint={`${body.length}/5000`}>
              Caption
            </Label>
            <Textarea
              id="post-body"
              className="mt-1 min-h-48"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              maxLength={5000}
              placeholder="What did you learn? What was the approach?"
            />
          </div>
        </Card>

        <Card className="space-y-4">
          <SectionTitle>Audience and videos</SectionTitle>
          <div>
            <Label htmlFor="post-visibility">Visibility</Label>
            <Select
              id="post-visibility"
              className="mt-1"
              value={visibility}
              onChange={(e) => setVisibility(e.target.value as Post["visibility"])}
            >
              <option value="public">Followers and everyone (if your account is public)</option>
              <option value="private">Only me</option>
            </Select>
          </div>
          {hasDemoVideo ? (
            <Toggle
              id="post-show-summary-video"
              checked={showDemoVideo}
              onChange={setShowDemoVideo}
              label="Show the summary video on the post"
              description="Adds the debrief clip to the carousel, ahead of the full recording."
            />
          ) : null}
          {hasVideo ? (
            <Toggle
              id="post-show-video"
              checked={showVideo}
              onChange={setShowVideo}
              label="Show the demo video on the post"
              description="Adds the recording as the last slide of the post's carousel."
            />
          ) : null}
        </Card>

        <Card className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <SectionTitle className="mb-0.5">Delete post</SectionTitle>
            <p className="text-sm text-[var(--text-secondary)]">
              Removes it from the feed and your profile, with its likes and comments. The session
              stays in your account.
            </p>
          </div>
          <Button
            variant="danger"
            icon={<Trash2 className="size-4" aria-hidden />}
            loading={remove.isPending}
            disabled={busy}
            onClick={() => void remove.deletePost()}
          >
            Delete post
          </Button>
        </Card>
      </div>

      <div className="min-w-0">
        <div className="lg:sticky lg:top-0">
          <PostMediaPanel postId={post.id} userId={userId} disabled={busy} />
        </div>
      </div>

      {previewing && (
        <PostPreview
          title={title}
          body={body}
          visibility={visibility}
          when={post.published_at ?? post.created_at}
          published
          slides={slides}
          onClose={() => setPreviewing(false)}
        />
      )}
    </div>
  );
}
