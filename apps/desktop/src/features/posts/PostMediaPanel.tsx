import { MAX_POST_IMAGES, POST_IMAGE_MIME_TYPES } from "@lare/shared";
import { cn } from "@lare/ui";
import { ChevronLeft, ChevronRight, ImagePlus, Star, Trash2 } from "lucide-react";
import { useRef } from "react";
import { useToast } from "@/components/toast/ToastProvider";
import { Button } from "@/components/ui/Button";
import { Card, SectionTitle } from "@/components/ui/Card";
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
 * The photo half of a post: add pictures, order them, caption them, and pick which one is the
 * cover. Without a cover the post falls back to the generated session card, which is also what
 * links unfurl to.
 */
export function PostMediaPanel({
  postId,
  userId,
  coverMediaId,
  onCoverChange,
  disabled,
}: {
  postId: string;
  userId: string;
  coverMediaId: string | null;
  onCoverChange: (mediaId: string | null) => void;
  disabled?: boolean;
}) {
  const { toast } = useToast();
  const fileInput = useRef<HTMLInputElement>(null);
  const media = usePostMedia(postId);
  const upload = useUploadPostImages(postId, userId);
  const remove = useRemovePostImage(postId);
  const reorder = useReorderPostImages(postId);
  const caption = useSetImageCaption(postId);

  const images = media.data ?? [];
  const busy =
    Boolean(disabled) ||
    upload.isPending ||
    remove.isPending ||
    reorder.isPending ||
    caption.isPending;

  const fail = (title: string) => (e: unknown) =>
    toast({ title, description: errorMessage(e), variant: "error" });

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
    remove.mutate(image, {
      onSuccess: () => {
        if (image.id === coverMediaId) onCoverChange(null);
      },
      onError: fail("Couldn't remove the photo"),
    });
  };

  return (
    <Card>
      <SectionTitle>Photos</SectionTitle>
      <p className="text-xs text-zinc-500">
        {images.length}/{MAX_POST_IMAGES} used. Star a photo to make it the cover; otherwise the
        generated session card leads the post.
      </p>

      {images.length > 0 ? (
        <ul className="mt-3 grid grid-cols-2 gap-2">
          {images.map((image, index) => (
            <li
              key={image.id}
              className={cn(
                "overflow-hidden rounded-lg border bg-zinc-900/60",
                image.id === coverMediaId ? "border-zinc-400" : "border-zinc-800",
              )}
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
                  label={image.id === coverMediaId ? "Unset cover" : "Use as cover"}
                  active={image.id === coverMediaId}
                  disabled={busy}
                  onClick={() => onCoverChange(image.id === coverMediaId ? null : image.id)}
                >
                  <Star className={cn("size-3.5", image.id === coverMediaId && "fill-current")} />
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
                <IconButton label="Remove photo" danger disabled={busy} onClick={() => drop(image)}>
                  <Trash2 className="size-3.5" />
                </IconButton>
              </div>
              <input
                defaultValue={image.caption ?? ""}
                maxLength={280}
                placeholder="Caption"
                aria-label="Photo caption"
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

      <input
        ref={fileInput}
        type="file"
        accept={POST_IMAGE_MIME_TYPES.join(",")}
        multiple
        className="hidden"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = "";
          if (files.length === 0) return;
          upload.mutate(files, { onError: fail("Couldn't add the photo") });
        }}
      />
      <Button
        className="mt-3"
        size="sm"
        icon={<ImagePlus className="size-3.5" aria-hidden />}
        loading={upload.isPending}
        disabled={busy || images.length >= MAX_POST_IMAGES}
        onClick={() => fileInput.current?.click()}
      >
        Add photos
      </Button>
    </Card>
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
