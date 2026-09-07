"use client";

import { Button, Card } from "@lare/ui/primitives";
import { Eye, EyeOff, Globe, Lock, Pencil, Trash2 } from "lucide-react";
import dynamic from "next/dynamic";
import { useState, useTransition } from "react";
import { FormToast } from "@/components/form-toast";
import type { PostImage } from "@/lib/posts";
import { deletePost, setPostStatus, setPostVisibility } from "./actions";
import type { PostEditorProps } from "./post-editor";

const PostEditor = dynamic(() => import("./post-editor").then((mod) => mod.PostEditor), {
  loading: () => <p className="mt-3 text-xs text-[var(--text-tertiary)]">Loading editor…</p>,
});

export interface OwnerControlsProps {
  postId: string;
  userId: string;
  status: "draft" | "published";
  visibility: "public" | "private";
  title: string;
  body: string;
  showVideo: boolean;
  showDemoVideo: boolean;
  includeAiInsights: boolean;
  includeOgCard: boolean;
  ogShowAiScores: boolean;
  hasVideo: boolean;
  hasDemoVideo: boolean;
  isInterview: boolean;
  coverMediaId: string | null;
  images: PostImage[];
}

export function OwnerControls(props: OwnerControlsProps) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const { postId, status, visibility } = props;

  function run(action: () => Promise<{ error: string | null }>) {
    setError(null);
    startTransition(async () => {
      const result = await action();
      if (result?.error) setError(result.error);
    });
  }

  const editorProps: PostEditorProps = {
    postId,
    userId: props.userId,
    title: props.title,
    body: props.body,
    visibility,
    showVideo: props.showVideo,
    showDemoVideo: props.showDemoVideo,
    includeAiInsights: props.includeAiInsights,
    includeOgCard: props.includeOgCard,
    ogShowAiScores: props.ogShowAiScores,
    hasVideo: props.hasVideo,
    hasDemoVideo: props.hasDemoVideo,
    isInterview: props.isInterview,
    coverMediaId: props.coverMediaId,
    images: props.images,
    onDone: () => setEditing(false),
  };

  return (
    <Card className="p-3">
      <FormToast error={error} />
      <div className="flex flex-wrap items-center gap-2">
        <span className="lare-label mr-1 text-[var(--text-tertiary)]">Your post</span>
        <span className="rounded-full border border-[var(--border-strong)] px-2 py-0.5 text-[11px] text-[var(--text-secondary)]">
          {status === "published" ? "Published" : "Draft"} ·{" "}
          {visibility === "public" ? "Public" : "Only me"}
        </span>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Button
            type="button"
            size="sm"
            disabled={pending}
            onClick={() => setEditing((v) => !v)}
            aria-expanded={editing}
            icon={<Pencil className="size-3.5" />}
          >
            {editing ? "Close editor" : "Edit post"}
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={pending}
            loading={pending}
            onClick={() =>
              run(() => setPostStatus(postId, status === "published" ? "draft" : "published"))
            }
            icon={
              status === "published" ? (
                <EyeOff className="size-3.5" />
              ) : (
                <Eye className="size-3.5" />
              )
            }
          >
            {status === "published" ? "Unpublish" : "Publish"}
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={pending}
            onClick={() =>
              run(() => setPostVisibility(postId, visibility === "public" ? "private" : "public"))
            }
            icon={
              visibility === "public" ? (
                <Lock className="size-3.5" />
              ) : (
                <Globe className="size-3.5" />
              )
            }
          >
            {visibility === "public" ? "Make private" : "Make public"}
          </Button>
          <Button
            type="button"
            variant="danger"
            size="sm"
            disabled={pending}
            onClick={() => {
              if (window.confirm("Delete this post? The session data stays in your account.")) {
                run(() => deletePost(postId));
              }
            }}
            icon={<Trash2 className="size-3.5" />}
          >
            Delete
          </Button>
        </div>
      </div>

      {editing ? (
        <div className="mt-3">
          <PostEditor {...editorProps} />
        </div>
      ) : null}
    </Card>
  );
}
