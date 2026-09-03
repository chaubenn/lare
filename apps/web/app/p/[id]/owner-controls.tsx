"use client";

import { Eye, EyeOff, Globe, LoaderCircle, Lock, Trash2 } from "lucide-react";
import { useState, useTransition } from "react";
import { buttonDanger, buttonSecondary } from "@/lib/styles";
import { deletePost, setPostStatus, setPostVisibility } from "./actions";

export function OwnerControls({
  postId,
  status,
  visibility,
}: {
  postId: string;
  status: "draft" | "published";
  visibility: "public" | "private";
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function run(action: () => Promise<{ error: string | null }>) {
    setError(null);
    startTransition(async () => {
      const result = await action();
      if (result?.error) setError(result.error);
    });
  }

  const small = `${buttonSecondary} px-3 py-1.5 text-xs`;

  return (
    <div className="rounded-xl border border-zinc-800/80 bg-zinc-900/40 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="mr-1 text-xs font-medium uppercase tracking-wide text-zinc-500">
          Your post
        </span>
        <span className="rounded-full border border-zinc-700 px-2 py-0.5 text-[11px] text-zinc-300">
          {status === "published" ? "Published" : "Draft"} ·{" "}
          {visibility === "public" ? "Public" : "Only me"}
        </span>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              run(() => setPostStatus(postId, status === "published" ? "draft" : "published"))
            }
            className={small}
          >
            {status === "published" ? (
              <EyeOff className="size-3.5" />
            ) : (
              <Eye className="size-3.5" />
            )}
            {status === "published" ? "Unpublish" : "Publish"}
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              run(() => setPostVisibility(postId, visibility === "public" ? "private" : "public"))
            }
            className={small}
          >
            {visibility === "public" ? (
              <Lock className="size-3.5" />
            ) : (
              <Globe className="size-3.5" />
            )}
            {visibility === "public" ? "Make private" : "Make public"}
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() => {
              if (window.confirm("Delete this post? The session data stays in your account.")) {
                run(() => deletePost(postId));
              }
            }}
            className={`${buttonDanger} px-3 py-1.5 text-xs`}
          >
            <Trash2 className="size-3.5" />
            Delete
          </button>
          {pending && <LoaderCircle className="size-4 animate-spin text-zinc-500" />}
        </div>
      </div>
      {error && (
        <p role="alert" className="mt-2 text-xs text-rose-300">
          {error}
        </p>
      )}
    </div>
  );
}
