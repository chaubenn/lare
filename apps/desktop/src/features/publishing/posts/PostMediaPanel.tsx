import { MAX_POST_IMAGES, POST_IMAGE_MIME_TYPES } from "@lare/shared";
import { cn } from "@lare/ui";
import { ChevronLeft, ChevronRight, ImagePlus, Trash2 } from "@lare/ui/icons";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Card, SectionTitle } from "@/components/ui/Card";
import { useNotify } from "@/features/notifications/notices";
import { errorMessage } from "@/lib/supabase";
import {
  type PostImage,
  usePostMedia,
  useRemovePostImage,
  useReorderPostImages,
  useSetImageCaption,
  useUploadPostImages,
} from "./media";

/**
 * The images on a post, all of them optional: paste a screenshot, drop files on the panel, or
 * choose them from the machine. Order them and caption them here.
 *
 * With none the post is just its text (plus its video, if the author adds one). Preview is where
 * you see the post as it will publish.
 */
export function PostMediaPanel({
  postId,
  userId,
  disabled,
}: {
  postId: string;
  userId: string;
  disabled?: boolean;
}) {
  const { notify } = useNotify();
  const fileInput = useRef<HTMLInputElement>(null);
  const media = usePostMedia(postId);
  const upload = useUploadPostImages(postId, userId);
  const remove = useRemovePostImage(postId);
  const reorder = useReorderPostImages(postId);
  const caption = useSetImageCaption(postId);

  // Old posts can still carry a stored `og` row from when the card was a PNG; it is never a
  // carousel photo.
  const images = (media.data ?? []).filter((i) => i.kind !== "og");
  const busy =
    Boolean(disabled) ||
    upload.isPending ||
    remove.isPending ||
    reorder.isPending ||
    caption.isPending;

  const fail = (title: string) => (e: unknown) =>
    notify({ title, description: errorMessage(e), variant: "error" });

  const move = (index: number, delta: number) => {
    const next = [...images];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    const [moved] = next.splice(index, 1);
    if (!moved) return;
    next.splice(target, 0, moved);
    reorder.mutate(
      next.map((i) => i.id),
      { onError: fail("Couldn't reorder") },
    );
  };

  const drop = (image: PostImage) => {
    remove.mutate(image, { onError: fail("Couldn't remove the image") });
  };

  const full = images.length >= MAX_POST_IMAGES;
  const add = (files: File[]) => {
    if (files.length === 0 || busy) return;
    if (full) {
      notify({ title: `A post can hold ${MAX_POST_IMAGES} images`, variant: "error" });
      return;
    }
    upload.mutate(files, { onError: fail("Couldn't add the image") });
  };

  // Paste a screenshot (or an image copied from anywhere) while this panel is on screen. Plain
  // text pastes are left alone, so the title and body fields behave as usual.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const files = Array.from(e.clipboardData?.files ?? []).filter((f) =>
        f.type.startsWith("image/"),
      );
      if (files.length === 0) return;
      e.preventDefault();
      add(files);
    };
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  });

  // Drag-and-drop. `dragenter`/`dragleave` also fire for every child, so count depth rather than
  // toggling a flag, or the highlight flickers as the pointer crosses the panel's contents.
  const [dragging, setDragging] = useState(false);
  const depth = useRef(0);
  const hasFiles = (e: React.DragEvent) => e.dataTransfer.types.includes("Files");

  return (
    <Card
      onDragEnter={(e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        depth.current += 1;
        setDragging(true);
      }}
      onDragOver={(e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
      }}
      onDragLeave={(e) => {
        if (!hasFiles(e)) return;
        depth.current = Math.max(0, depth.current - 1);
        if (depth.current === 0) setDragging(false);
      }}
      onDrop={(e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        depth.current = 0;
        setDragging(false);
        add(Array.from(e.dataTransfer.files).filter((f) => f.type.startsWith("image/")));
      }}
      className={cn(dragging && "border-[var(--border-strong)] bg-[var(--surface-sunken)]")}
    >
      <SectionTitle>Images</SectionTitle>
      <p className="text-xs text-[var(--text-tertiary)]">
        Optional. {images.length}/{MAX_POST_IMAGES} used. With no images the post is just your text,
        plus your video if you add one.
      </p>

      <input
        ref={fileInput}
        type="file"
        accept={POST_IMAGE_MIME_TYPES.join(",")}
        multiple
        className="hidden"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = "";
          add(files);
        }}
      />
      <div
        className={cn(
          "mt-3 flex flex-col items-center gap-2 rounded-[var(--lare-r-3)] border border-dashed px-4 py-5 text-center transition-colors",
          dragging
            ? "border-[var(--text-secondary)] text-[var(--text)]"
            : "border-[var(--border-strong)] text-[var(--text-tertiary)]",
        )}
      >
        <ImagePlus className="size-5" aria-hidden />
        <p className="text-sm">
          {dragging ? "Drop to add" : "Drop images here, or paste a screenshot"}
        </p>
        <Button
          size="sm"
          loading={upload.isPending}
          disabled={busy || full}
          onClick={() => fileInput.current?.click()}
        >
          Choose files
        </Button>
      </div>

      {images.length > 0 ? (
        <ul className="mt-3 grid grid-cols-2 gap-2">
          {images.map((image, index) => (
            <li
              key={image.id}
              className="overflow-hidden rounded-lg border border-zinc-800 bg-[var(--surface-raised)]"
            >
              {image.url ? (
                <img
                  src={image.url}
                  alt={image.caption ?? ""}
                  className="aspect-video w-full object-cover"
                />
              ) : (
                <div className="flex aspect-video items-center justify-center text-xs text-zinc-600">
                  Unavailable
                </div>
              )}
              <div className="flex items-center gap-0.5 border-t border-zinc-800 px-1 py-1">
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
                <IconButton label="Remove image" danger disabled={busy} onClick={() => drop(image)}>
                  <Trash2 className="size-3.5" />
                </IconButton>
              </div>
              <input
                defaultValue={image.caption ?? ""}
                maxLength={280}
                placeholder="Caption"
                aria-label="Image caption"
                disabled={busy}
                onBlur={(e) => {
                  if (e.target.value === (image.caption ?? "")) return;
                  caption.mutate(
                    { id: image.id, caption: e.target.value },
                    { onError: fail("Couldn't save the caption") },
                  );
                }}
                className="w-full border-t border-zinc-800 bg-transparent px-2 py-1.5 text-xs text-zinc-200 placeholder:text-zinc-600 focus:outline-none"
              />
            </li>
          ))}
        </ul>
      ) : null}
    </Card>
  );
}

function IconButton({
  label,
  onClick,
  disabled,
  danger,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
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
        danger && "hover:text-rose-300",
      )}
    >
      {children}
    </button>
  );
}
