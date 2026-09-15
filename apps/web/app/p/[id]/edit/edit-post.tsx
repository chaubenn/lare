"use client";

import { Button, Card } from "@lare/ui/primitives";
import { Eye, EyeOff, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { FormToast } from "@/components/form-toast";
import { deletePost, setPostStatus } from "../actions";
import { PostEditor, type PostEditorProps } from "../post-editor";

/** The editor page's client half: the form, then publishing status and deletion below it. */
export function EditPost({
  postSlug,
  status,
  ...editor
}: Omit<PostEditorProps, "onDone"> & { postSlug: string; status: "draft" | "published" }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function run(action: () => Promise<{ error: string | null }>) {
    setError(null);
    startTransition(async () => {
      const result = await action();
      if (result?.error) setError(result.error);
    });
  }

  return (
    <div className="space-y-4">
      <FormToast error={error} />
      <PostEditor {...editor} onDone={() => router.push(`/p/${postSlug}`)} />

      <Card className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-[var(--text)]">
            {status === "published" ? "Published" : "Draft"}
          </h2>
          <p className="text-sm text-[var(--text-secondary)]">
            {status === "published"
              ? "Unpublishing takes it off the feed and your profile until you publish it again."
              : "Only you can see a draft. Publish it to put it on the feed."}
          </p>
        </div>
        <Button
          type="button"
          disabled={pending}
          onClick={() =>
            run(() => setPostStatus(editor.postId, status === "published" ? "draft" : "published"))
          }
          icon={status === "published" ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
        >
          {status === "published" ? "Unpublish" : "Publish"}
        </Button>
      </Card>

      <Card className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-[var(--text)]">Delete post</h2>
          <p className="text-sm text-[var(--text-secondary)]">
            Removes it from the feed and your profile, with its likes and comments. The session
            stays in your account.
          </p>
        </div>
        <Button
          type="button"
          variant="danger"
          disabled={pending}
          onClick={() => {
            if (window.confirm("Delete this post? The session stays in your account.")) {
              run(() => deletePost(editor.postId));
            }
          }}
          icon={<Trash2 className="size-4" />}
        >
          Delete post
        </Button>
      </Card>
    </div>
  );
}
