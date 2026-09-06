import type { Post } from "@lare/supabase-types";
import { Eye } from "lucide-react";
import { useState } from "react";
import { useToast } from "@/components/toast/ToastProvider";
import { Button } from "@/components/ui/Button";
import { Card, SectionTitle } from "@/components/ui/Card";
import { Input, Label, Select, Textarea, Toggle } from "@/components/ui/Field";
import { errorMessage } from "@/lib/supabase";
import { PostMediaPanel } from "./PostMediaPanel";
import { PostPreview, usePreviewSlides } from "./PostPreview";
import { type PostDetail, useUpdatePost } from "./queries";

/**
 * Owner-only editor for a published post: the caption, who can see it, whether the demo video
 * rides along, and the photos. Photos save as soon as they are uploaded; the fields save on
 * "Save changes", the same split the web editor uses.
 */
export function PostEditPanel({
  post,
  userId,
  onDone,
}: {
  post: PostDetail;
  userId: string;
  onDone: () => void;
}) {
  const { toast } = useToast();
  const update = useUpdatePost();

  const [title, setTitle] = useState(post.title ?? "");
  const [body, setBody] = useState(post.body ?? "");
  const [visibility, setVisibility] = useState<Post["visibility"]>(post.visibility);
  const [showVideo, setShowVideo] = useState(post.show_video);
  const [coverMediaId, setCoverMediaId] = useState<string | null>(post.cover_media_id);
  const [previewing, setPreviewing] = useState(false);

  const hasVideo = Boolean(post.video_id) && post.video_kind !== "none";
  const slides = usePreviewSlides({
    postId: post.id,
    videoId: post.video_id,
    videoKind: post.video_kind,
    showVideo,
    coverMediaId,
    session: post.sessions,
  });

  const save = () => {
    update.mutate(
      { id: post.id, title, body, visibility, showVideo, coverMediaId },
      {
        onSuccess: () => {
          toast({ title: "Post updated", variant: "success" });
          onDone();
        },
        onError: (e) =>
          toast({ title: "Couldn't save", description: errorMessage(e), variant: "error" }),
      },
    );
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
      <Card className="space-y-4">
        <SectionTitle>Edit post</SectionTitle>
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
          <Label htmlFor="post-body">Caption</Label>
          <Textarea
            id="post-body"
            className="mt-1 min-h-32"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            maxLength={5000}
            placeholder="What did you learn? What was the approach?"
          />
        </div>
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
        {hasVideo ? (
          <Toggle
            id="post-show-video"
            checked={showVideo}
            onChange={setShowVideo}
            label="Show the demo video on the post"
            description="Adds the recording as the last slide of the post's carousel."
          />
        ) : null}
        <div className="flex gap-2 pt-1">
          <Button variant="primary" loading={update.isPending} onClick={save}>
            Save changes
          </Button>
          <Button
            variant="ghost"
            icon={<Eye className="size-4" aria-hidden />}
            onClick={() => setPreviewing(true)}
          >
            Preview
          </Button>
          <Button variant="ghost" disabled={update.isPending} onClick={onDone}>
            Cancel
          </Button>
        </div>
      </Card>

      <PostMediaPanel
        postId={post.id}
        userId={userId}
        coverMediaId={coverMediaId}
        onCoverChange={setCoverMediaId}
        disabled={update.isPending}
      />

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
