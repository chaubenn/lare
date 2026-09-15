"use client";

import { difficultySplit, parseSolvedSkills, type SolvedSkills, topicStats } from "@lare/shared";
import type { Profile } from "@lare/supabase-types";
import { Lock } from "lucide-react";
import Link from "next/link";
import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Avatar } from "@/components/avatar";
import { FollowButton, type FollowState } from "@/components/follow-button";
import { type ProfileStats, parseProfileStats } from "@/lib/parse";
import { createClient } from "@/lib/supabase/client";

const OPEN_DELAY_MS = 350;
const CLOSE_DELAY_MS = 150;
const CARD_WIDTH = 296;
const GAP = 8;

const DIFF = [
  { key: "easy", color: "var(--lare-diff-easy)" },
  { key: "medium", color: "var(--lare-diff-medium)" },
  { key: "hard", color: "var(--lare-diff-hard)" },
] as const;

interface Preview {
  profile: Profile | null;
  stats: ProfileStats | null;
  skills: SolvedSkills | null;
  follow: FollowState;
}

// One fetch per handle per page load; hovering the same person again is instant.
const previews = new Map<string, Promise<Preview>>();

function loadPreview(handle: string, viewerId: string | null): Promise<Preview> {
  const key = `${viewerId ?? ""}:${handle}`;
  let pending = previews.get(key);
  if (!pending) {
    pending = (async () => {
      const supabase = createClient();
      const { data: profile } = await supabase
        .from("profiles")
        .select("*")
        .eq("handle", handle)
        .maybeSingle();
      const [statsRes, skillsRes, followRes] = await Promise.all([
        supabase.rpc("profile_stats", { target_handle: handle }),
        supabase.rpc("solved_skills", { target_handle: handle }),
        viewerId && profile && profile.id !== viewerId
          ? supabase
              .from("follows")
              .select("status")
              .eq("follower_id", viewerId)
              .eq("followee_id", profile.id)
              .maybeSingle()
          : Promise.resolve({ data: null }),
      ]);
      return {
        profile: profile ?? null,
        stats: parseProfileStats(statsRes.data),
        // Missing until the solved_skills migration is applied; the card simply omits skills.
        skills: skillsRes.error ? null : parseSolvedSkills(skillsRes.data),
        follow: followRes.data?.status ?? "none",
      };
    })();
    pending.catch(() => previews.delete(key));
    previews.set(key, pending);
  }
  return pending;
}

/**
 * Hovering (or focusing) a person's name or avatar previews their profile: who they are, how much
 * they solve and at what difficulty, and a follow button, without leaving the page.
 */
export function ProfileHoverCard({
  handle,
  viewerId,
  children,
  className,
}: {
  handle: string | null | undefined;
  viewerId: string | null;
  children: ReactNode;
  className?: string;
}) {
  const anchor = useRef<HTMLSpanElement>(null);
  const timer = useRef<number | undefined>(undefined);
  const [rect, setRect] = useState<DOMRect | null>(null);

  const clear = () => window.clearTimeout(timer.current);
  const openSoon = () => {
    clear();
    timer.current = window.setTimeout(() => {
      if (anchor.current) setRect(anchor.current.getBoundingClientRect());
    }, OPEN_DELAY_MS);
  };
  const closeSoon = () => {
    clear();
    timer.current = window.setTimeout(() => setRect(null), CLOSE_DELAY_MS);
  };

  useEffect(() => {
    if (!rect) return;
    const close = () => setRect(null);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("keydown", onKey);
    // The card is positioned against the viewport, so any scroll would leave it behind.
    window.addEventListener("scroll", close, true);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", close, true);
    };
  }, [rect]);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  if (!handle) return <span className={className}>{children}</span>;

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: listens for hover and focus on the link inside it; the link is the control.
    <span
      ref={anchor}
      className={className}
      onPointerEnter={(e) => e.pointerType === "mouse" && openSoon()}
      onPointerLeave={(e) => e.pointerType === "mouse" && closeSoon()}
      onFocus={openSoon}
      onBlur={closeSoon}
    >
      {children}
      {rect
        ? createPortal(
            <FloatingCard anchor={rect} onPointerEnter={clear} onPointerLeave={closeSoon}>
              <ProfilePreview handle={handle} viewerId={viewerId} />
            </FloatingCard>,
            document.body,
          )
        : null}
    </span>
  );
}

function FloatingCard({
  anchor,
  children,
  onPointerEnter,
  onPointerLeave,
}: {
  anchor: DOMRect;
  children: ReactNode;
  onPointerEnter: () => void;
  onPointerLeave: () => void;
}) {
  const card = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  // Below the anchor when it fits, otherwise above; always inside the window. Re-measured when
  // the content loads and the card grows.
  useLayoutEffect(() => {
    const el = card.current;
    if (!el) return;
    const place = () => {
      const height = el.offsetHeight;
      const below = anchor.bottom + GAP;
      const top =
        below + height > window.innerHeight - GAP
          ? Math.max(GAP, anchor.top - GAP - height)
          : below;
      const left = Math.min(
        Math.max(GAP, anchor.left),
        Math.max(GAP, window.innerWidth - CARD_WIDTH - GAP),
      );
      setPos({ top, left });
    };
    place();
    const observer = new ResizeObserver(place);
    observer.observe(el);
    return () => observer.disconnect();
  }, [anchor]);

  return (
    <div
      ref={card}
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
      style={{
        width: CARD_WIDTH,
        top: pos?.top ?? anchor.bottom + GAP,
        left: pos?.left ?? anchor.left,
        visibility: pos ? "visible" : "hidden",
      }}
      className="lare-material-regular lare-dropdown fixed z-50 origin-top-left rounded-[var(--lare-r-4)] border border-[var(--border)] p-4 text-left shadow-[var(--lare-shadow-2)]"
    >
      {children}
    </div>
  );
}

function ProfilePreview({ handle, viewerId }: { handle: string; viewerId: string | null }) {
  const [data, setData] = useState<Preview | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    loadPreview(handle, viewerId).then(
      (next) => live && setData(next),
      () => live && setFailed(true),
    );
    return () => {
      live = false;
    };
  }, [handle, viewerId]);

  if (failed || (data && !data.profile)) {
    return <p className="text-sm text-[var(--text-secondary)]">This profile isn't available.</p>;
  }
  if (!data?.profile) {
    return (
      <div className="flex items-center gap-3" aria-busy>
        <span className="lare-skel size-12 rounded-full" />
        <span className="flex-1 space-y-2">
          <span className="lare-skel block h-3 w-2/3 rounded" />
          <span className="lare-skel block h-3 w-1/3 rounded" />
        </span>
      </div>
    );
  }

  const { profile: person, stats, skills } = data;
  const name = person.display_name || `@${handle}`;
  const visible = stats?.visible ?? false;
  const solved = skills?.visible ? skills : null;
  const split = solved ? difficultySplit(solved) : null;
  const splitTotal = split ? split.easy + split.medium + split.hard : 0;
  const topics = solved ? topicStats(solved).slice(0, 3) : [];

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <Link href={`/u/${handle}`} className="shrink-0">
          <Avatar src={person.avatar_url} name={name} />
        </Link>
        <div className="min-w-0">
          <Link
            href={`/u/${handle}`}
            className="block truncate text-sm font-semibold text-[var(--text)] hover:underline"
          >
            {name}
          </Link>
          <p className="flex items-center gap-1 truncate text-xs text-[var(--text-secondary)]">
            @{handle}
            {person.is_private ? (
              <>
                <span aria-hidden>·</span>
                <Lock className="size-3" aria-hidden />
                Private
              </>
            ) : null}
          </p>
        </div>
      </div>

      {person.bio ? (
        <p className="line-clamp-2 text-sm leading-snug text-[var(--text)]">{person.bio}</p>
      ) : null}

      <dl className="grid grid-cols-4 gap-2 border-y border-[var(--border)] py-2.5">
        <Stat label="Solved" value={visible ? stats?.problems_solved : undefined} />
        <Stat label="Posts" value={visible ? stats?.posts : undefined} />
        <Stat label="Followers" value={stats?.followers} />
        <Stat label="Following" value={stats?.following} />
      </dl>

      {split && splitTotal > 0 ? (
        <div>
          <div className="flex h-1.5 gap-0.5 overflow-hidden rounded-full" aria-hidden>
            {DIFF.map((d) =>
              split[d.key] > 0 ? (
                <span key={d.key} style={{ flexGrow: split[d.key], background: d.color }} />
              ) : null,
            )}
          </div>
          <p className="mt-1.5 text-xs tabular-nums text-[var(--text-secondary)]">
            {split.easy} easy · {split.medium} medium · {split.hard} hard
          </p>
          {topics.length > 0 ? (
            <ul className="mt-2 flex flex-wrap gap-1.5" aria-label="Top topics">
              {topics.map((t) => (
                <li
                  key={t.slug}
                  className="rounded-full border border-[var(--border)] px-2 py-0.5 text-xs text-[var(--text-secondary)]"
                >
                  {t.name}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : !visible && stats ? (
        <p className="text-xs text-[var(--text-secondary)]">Follow to see what they're solving.</p>
      ) : null}

      <div className="flex items-center justify-between gap-2">
        <Link
          href={`/u/${handle}`}
          className="text-xs text-[var(--text-secondary)] hover:text-[var(--text)] hover:underline"
        >
          View profile
        </Link>
        <FollowButton
          targetId={person.id}
          targetHandle={handle}
          viewerId={viewerId}
          initialState={data.follow}
        />
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number | undefined }) {
  return (
    <div className="min-w-0">
      <dt className="truncate text-[11px] text-[var(--text-tertiary)]">{label}</dt>
      <dd className="text-sm font-semibold tabular-nums text-[var(--text)]">
        {value === undefined ? "—" : value}
      </dd>
    </div>
  );
}
