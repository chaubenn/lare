"use client";

import {
  MAX_POST_IMAGES,
  POST_IMAGE_MIME_TYPES,
  POST_MEDIA_BUCKET,
  postMediaPath,
  rejectPostImage,
} from "@lare/shared";
import { ChevronLeft, ChevronRight, ImagePlus, LoaderCircle, Star, Trash2 } from "lucide-react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { cn } from "@/lib/cn";
import type { PostImage } from "@/lib/posts";
import { buttonPrimary, buttonSecondary, inputClass, labelClass } from "@/lib/styles";
import { createClient } from "@/lib/supabase/client";
import {
  registerPostImage,
  removePostImage,
  reorderPostImages,
  setImageCaption,
  setPostCover,
  updatePost,
} from "./actions";

export interface PostEditorProps {
  postId: string;
  userId: string;
  title: string;
  body: string;
  visibility: "public" | "private";
  showVideo: boolean;
  includeAiInsights: boolean;
  hasVideo: boolean;
  isInterview: boolean;
  coverMediaId: string | null;
  images: PostImage[];
  onDone: () => void;
}

/**
 * The published-post editor: the caption, who can see it, whether the demo video rides along,
 * and the photo carousel (upload, order, caption, pick one as the cover).
 *
 * Files go straight from the browser to Storage — the owner-scoped policy on `{uid}/…` is the
 * gate — and a Server Action then records the row, so large uploads never pass through Next.
 */
export function PostEditor(props: PostEditorProps) {
  const router = useRouter();
  const supabase = createClient();
  const fileInput = useRef<HTMLInputElement>(null);

  const [title, setTitle] = useState(props.title);
  const [body, setBody] = useState(props.body);
  const [visibility, setVisibility] = useState(props.visibility);
  const [showVideo, setShowVideo] = useState(props.showVideo);
  const [insights, setInsights] = useState(props.includeAiInsights);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [pending, startTransition] = useTransition();

  const images = props.images;
  const busy = pending || uploading;

  function run(action: () => Promise<{ error: string | null }>, after?: () => void) {
    setError(null);
    startTransition(async () => {
      const result = await action();
      if (result?.error) {
        setError(result.error);
        return;
      }
      after?.();
      router.refresh();
    });
  }

  async function upload(files: FileList | null) {
    if (!files || files.length === 0) return;
    setError(null);
    const room = MAX_POST_IMAGES - images.length;
    if (room <= 0) {
      setError(`A post can hold ${MAX_POST_IMAGES} photos.`);
      return;
    }

    setUploading(true);
    try {
      for (const file of Array.from(files).slice(0, room)) {
        const reason = rejectPostImage(file);
        if (reason) {
          setError(reason);
          continue;
        }
        const path = postMediaPath(props.userId, props.postId, file.type);
        const { error: uploadError } = await supabase.storage
          .from(POST_MEDIA_BUCKET)
          .upload(path, file, { contentType: file.type, upsert: false });
        if (uploadError) {
          setError(uploadError.message);
          continue;
        }
        const size = await imageSize(file);
        const result = await registerPostImage(props.postId, path, size.width, size.height);
        if (result.error) {
          await supabase.storage.from(POST_MEDIA_BUCKET).remove([path]);
          setError(result.error);
        }
      }
      router.refresh();
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  function move(index: number, delta: number) {
    const next = [...images];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    const [moved] = next.splice(index, 1);
    if (!moved) return;
    next.splice(target, 0, moved);
    run(() =>
      reorderPostImages(
        props.postId,
        next.map((i) => i.id),
      ),
    );
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        run(
          () =>
            updatePost(props.postId, {
              title,
              body,
              visibility,
              show_video: showVideo,
              include_ai_insights: insights,
              cover_media_id: props.coverMediaId,
            }),
          props.onDone,
        );
      }}
      className="space-y-4 rounded-xl border border-zinc-800/80 bg-zinc-950/40 p-4"
    >
      <div>
        <label htmlFor="edit-title" className={labelClass}>
          Title
        </label>
        <input
          id="edit-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={140}
          className={`${inputClass} mt-1`}
          placeholder="Give this session a title"
        />
      </div>

      <div>
        <label htmlFor="edit-body" className={labelClass}>
          Caption
        </label>
        <textarea
          id="edit-body"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          maxLength={5000}
          rows={4}
          className={`${inputClass} mt-1 min-h-24 resize-y`}
          placeholder="What did you learn? What was the approach?"
        />
      </div>

      <div>
        <label htmlFor="edit-visibility" className={labelClass}>
          Visibility
        </label>
        <select
          id="edit-visibility"
          value={visibility}
          onChange={(e) => setVisibility(e.target.value as "public" | "private")}
          className={`${inputClass} mt-1`}
        >
          <option value="public">Followers and everyone (if your account is public)</option>
          <option value="private">Only me</option>
        </select>
      </div>

      {props.hasVideo && (
        <Check
          id="edit-show-video"
          checked={showVideo}
          onChange={setShowVideo}
          label="Show the demo video on this post"
          description="Adds the recording as the last slide of the carousel."
        />
      )}

      {props.isInterview && (
        <Check
          id="edit-insights"
          checked={insights}
          onChange={setInsights}
          label="Include AI insights"
          description="Viewers can see the interview grade, timestamped moments and suggestions."
        />
      )}

      <fieldset className="space-y-2">
        <legend className={labelClass}>Photos</legend>
        <p className="text-xs text-zinc-500">
          The first slide is your cover — pick a photo with the star, or leave it unset to use the
          generated session card. {images.length}/{MAX_POST_IMAGES} used.
        </p>

        {images.length > 0 && (
          <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {images.map((image, index) => (
              <li
                key={image.id}
                className={cn(
                  "overflow-hidden rounded-lg border bg-zinc-900/60",
                  image.id === props.coverMediaId ? "border-zinc-400" : "border-zinc-800",
                )}
              >
                <div className="relative aspect-video">
                  <Image
                    src={image.url}
                    alt={image.caption ?? ""}
                    fill
                    unoptimized
                    sizes="200px"
                    className="object-cover"
                  />
                </div>
                <div className="flex items-center gap-1 border-t border-zinc-800 px-1 py-1">
                  <IconButton
                    label={image.id === props.coverMediaId ? "Unset cover" : "Use as cover"}
                    active={image.id === props.coverMediaId}
                    disabled={busy}
                    onClick={() =>
                      run(() =>
                        setPostCover(
                          props.postId,
                          image.id === props.coverMediaId ? null : image.id,
                        ),
                      )
                    }
                  >
                    <Star
                      className={cn("size-3.5", image.id === props.coverMediaId && "fill-current")}
                    />
                  </IconButton>
                  <IconButton
                    label="Move earlier"
                    disabled={busy || index === 0}
                    onClick={() => move(index, -1)}
                  >
                    <ChevronLeft className="size-3.5" />
                  </IconButton>
                  <IconButton
                    label="Move later"
                    disabled={busy || index === images.length - 1}
                    onClick={() => move(index, 1)}
                  >
                    <ChevronRight className="size-3.5" />
                  </IconButton>
                  <IconButton
                    label="Remove photo"
                    disabled={busy}
                    danger
                    onClick={() => run(() => removePostImage(props.postId, image.id))}
                  >
                    <Trash2 className="size-3.5" />
                  </IconButton>
                </div>
                <input
                  defaultValue={image.caption ?? ""}
                  maxLength={280}
                  placeholder="Caption"
                  aria-label="Photo caption"
                  onBlur={(e) => {
                    if (e.target.value === (image.caption ?? "")) return;
                    run(() => setImageCaption(props.postId, image.id, e.target.value));
                  }}
                  className="w-full border-t border-zinc-800 bg-transparent px-2 py-1.5 text-xs text-zinc-200 placeholder:text-zinc-600 focus:outline-none"
                />
              </li>
            ))}
          </ul>
        )}

        <input
          ref={fileInput}
          type="file"
          accept={POST_IMAGE_MIME_TYPES.join(",")}
          multiple
          className="hidden"
          onChange={(e) => void upload(e.target.files)}
        />
        <button
          type="button"
          disabled={busy || images.length >= MAX_POST_IMAGES}
          onClick={() => fileInput.current?.click()}
          className={`${buttonSecondary} px-3 py-1.5 text-xs`}
        >
          {uploading ? (
            <LoaderCircle className="size-3.5 animate-spin" />
          ) : (
            <ImagePlus className="size-3.5" />
          )}
          Add photos
        </button>
      </fieldset>

      {error && (
        <p role="alert" className="text-xs text-rose-300">
          {error}
        </p>
      )}

      <div className="flex items-center gap-2">
        <button type="submit" disabled={busy} className={`${buttonPrimary} px-4 py-1.5 text-xs`}>
          {pending && <LoaderCircle className="size-3.5 animate-spin" />}
          Save changes
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={props.onDone}
          className={`${buttonSecondary} px-4 py-1.5 text-xs`}
        >
          Done
        </button>
      </div>
    </form>
  );
}

function Check({
  id,
  checked,
  onChange,
  label,
  description,
}: {
  id: string;
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
  description?: string;
}) {
  return (
    <div className="flex items-start gap-2">
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 size-4 rounded border-zinc-700 bg-zinc-900 accent-zinc-200"
      />
      <label htmlFor={id} className="text-sm text-zinc-300">
        {label}
        {description && <span className="block text-xs text-zinc-500">{description}</span>}
      </label>
    </div>
  );
}

function IconButton({
  label,
  onClick,
  disabled,
  active,
  danger,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "rounded p-1 text-zinc-400 transition-colors hover:text-zinc-100 disabled:opacity-40",
        active && "text-amber-300",
        danger && "hover:text-rose-300",
      )}
    >
      {children}
    </button>
  );
}

/** Natural pixel size, used only to keep the carousel from reflowing. */
async function imageSize(file: File): Promise<{ width: number | null; height: number | null }> {
  try {
    const bitmap = await createImageBitmap(file);
    const size = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    return size;
  } catch {
    return { width: null, height: null };
  }
}
