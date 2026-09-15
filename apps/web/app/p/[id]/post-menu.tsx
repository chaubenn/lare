"use client";

import { Button } from "@lare/ui/primitives";
import {
  Check,
  Film,
  History,
  Link2,
  MoreHorizontal,
  PenLine,
  Scissors,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import { FormToast } from "@/components/form-toast";
import { deletePost } from "./actions";

export interface PostMenuProps {
  postId: string;
  postSlug: string;
  isOwner: boolean;
  isDraft: boolean;
  sessionId: string | null;
  videoId: string | null;
  demoVideoId: string | null;
}

const ITEM =
  "flex w-full items-center gap-2 rounded-[var(--lare-r-2)] px-2.5 py-2 text-left text-sm text-[var(--text)] outline-none hover:bg-[color-mix(in_oklab,var(--border)_70%,transparent)] focus-visible:bg-[color-mix(in_oklab,var(--border)_70%,transparent)] disabled:opacity-50";
const ICON = "size-4 text-[var(--text-tertiary)]";

/** Everything secondary about a post in one place: the link, the owner's tools, and deletion. */
export function PostMenu(props: PostMenuProps) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
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

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1800);
    return () => clearTimeout(t);
  }, [copied]);

  async function copyLink() {
    const url = `${window.location.origin}/p/${props.postSlug}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      window.prompt("Copy this link", url);
    }
  }

  function remove() {
    setOpen(false);
    if (
      !window.confirm(
        "Delete this post? It disappears from the feed and your profile. The session stays in your account.",
      )
    )
      return;
    setError(null);
    startTransition(async () => {
      const result = await deletePost(props.postId);
      if (result?.error) setError(result.error);
    });
  }

  const close = () => setOpen(false);

  return (
    <div ref={root} className="relative">
      <FormToast error={error} />
      <Button
        type="button"
        size="sm"
        variant="ghost"
        aria-label="More actions"
        aria-haspopup="menu"
        aria-expanded={open}
        loading={pending}
        icon={
          copied ? (
            <Check className="size-4 text-[var(--lare-status-run)]" />
          ) : (
            <MoreHorizontal className="size-4" />
          )
        }
        onClick={() => setOpen((o) => !o)}
      />
      {open && (
        <div
          role="menu"
          aria-label="Post actions"
          tabIndex={-1}
          className="lare-material-regular lare-dropdown absolute right-0 top-full z-20 mt-1 w-56 rounded-[var(--lare-r-3)] border border-[var(--border)] p-1 shadow-[var(--lare-shadow-2)]"
          onKeyDown={(e) => {
            if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
            e.preventDefault();
            const items = [
              ...(root.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []),
            ];
            const at = items.indexOf(document.activeElement as HTMLElement);
            items[(at + (e.key === "ArrowDown" ? 1 : items.length - 1)) % items.length]?.focus();
          }}
        >
          <button
            type="button"
            role="menuitem"
            className={ITEM}
            onClick={() => {
              close();
              void copyLink();
            }}
          >
            <Link2 className={ICON} aria-hidden />
            Copy link
          </button>
          {props.isOwner && (
            <>
              {props.isDraft && (
                <Link
                  href={`/drafts/${props.postId}`}
                  role="menuitem"
                  className={ITEM}
                  onClick={close}
                >
                  <PenLine className={ICON} aria-hidden />
                  Continue draft
                </Link>
              )}
              {props.sessionId && (
                <Link
                  href={`/sessions/${props.sessionId}`}
                  role="menuitem"
                  className={ITEM}
                  onClick={close}
                >
                  <History className={ICON} aria-hidden />
                  Session timeline
                </Link>
              )}
              {props.videoId && (
                <Link
                  href={`/studio/${props.videoId}`}
                  role="menuitem"
                  className={ITEM}
                  onClick={close}
                >
                  <Film className={ICON} aria-hidden />
                  Trim full video
                </Link>
              )}
              {props.demoVideoId && (
                <Link
                  href={`/studio/${props.demoVideoId}`}
                  role="menuitem"
                  className={ITEM}
                  onClick={close}
                >
                  <Scissors className={ICON} aria-hidden />
                  Trim summary video
                </Link>
              )}
              <hr className="my-1 border-[var(--border)]" />
              <button
                type="button"
                role="menuitem"
                disabled={pending}
                className={`${ITEM} text-[var(--lare-danger)]`}
                onClick={remove}
              >
                <Trash2 className="size-4" aria-hidden />
                Delete post
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
