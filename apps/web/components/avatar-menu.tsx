"use client";

import { ChevronDown, LogOut, Settings, User } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { signOut } from "@/app/auth/actions";
import { Avatar } from "./avatar";

export function AvatarMenu({
  avatarUrl,
  displayName,
  handle,
}: {
  avatarUrl: string | null;
  displayName: string | null;
  handle: string | null;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const name = displayName || (handle ? `@${handle}` : "Account");

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 rounded-full border border-transparent p-0.5 pr-1.5 hover:border-zinc-800 hover:bg-zinc-900"
      >
        <Avatar src={avatarUrl} name={name} size="sm" />
        <ChevronDown className="size-3.5 text-zinc-500" />
        <span className="sr-only">Open account menu</span>
      </button>

      {open && (
        <div className="lare-dropdown absolute right-0 z-20 mt-2 w-56 overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950 shadow-xl shadow-black/40">
          <div className="border-b border-zinc-800 px-3 py-2.5">
            <p className="truncate text-sm font-medium text-zinc-100">{name}</p>
            {handle && <p className="truncate text-xs text-zinc-500">@{handle}</p>}
          </div>
          <nav className="flex flex-col p-1 text-sm">
            <Link
              href={handle ? `/u/${handle}` : "/onboarding"}
              onClick={() => setOpen(false)}
              className="flex items-center gap-2 rounded-lg px-2.5 py-2 text-zinc-300 hover:bg-zinc-900 hover:text-zinc-100"
            >
              <User className="size-4 text-zinc-500" />
              My profile
            </Link>
            <Link
              href="/settings"
              onClick={() => setOpen(false)}
              className="flex items-center gap-2 rounded-lg px-2.5 py-2 text-zinc-300 hover:bg-zinc-900 hover:text-zinc-100"
            >
              <Settings className="size-4 text-zinc-500" />
              Settings
            </Link>
            <form action={signOut}>
              <button
                type="submit"
                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-zinc-300 hover:bg-zinc-900 hover:text-zinc-100"
              >
                <LogOut className="size-4 text-zinc-500" />
                Sign out
              </button>
            </form>
          </nav>
        </div>
      )}
    </div>
  );
}
