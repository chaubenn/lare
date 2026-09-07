import { formatDurationHuman, parseSolvedActivity } from "@lare/shared";
import type { Profile } from "@lare/supabase-types";
import { ActivityChart } from "@lare/ui/ActivityChart";
import { Card, Container, Tooltip } from "@lare/ui/primitives";
import { Lock } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { Avatar } from "@/components/avatar";
import { FollowButton, type FollowState } from "@/components/follow-button";
import { PostCard } from "@/components/post-card";
import { PostCardSkeleton } from "@/components/skeleton";
import { type ProfileStats, parseProfileStats } from "@/lib/parse";
import { fetchUserPosts } from "@/lib/posts";
import { createClient } from "@/lib/supabase/server";
import { getViewer } from "@/lib/viewer";

type Params = { params: Promise<{ handle: string }> };

const HANDLE_PATH_RE = /^[a-z0-9_]{1,40}$/;

function normaliseHandle(raw: string): string | null {
  let handle: string;
  try {
    handle = decodeURIComponent(raw).replace(/^@/, "").toLowerCase();
  } catch {
    return null;
  }
  return HANDLE_PATH_RE.test(handle) ? handle : null;
}

async function loadProfile(handle: string): Promise<Profile | null> {
  const supabase = await createClient();
  const { data } = await supabase.from("profiles").select("*").eq("handle", handle).maybeSingle();
  return data ?? null;
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const handle = normaliseHandle((await params).handle);
  if (!handle) return { title: "Profile" };
  const profile = await loadProfile(handle);
  if (!profile?.handle) return { title: "Profile", robots: { index: false } };
  const name = profile.display_name || `@${profile.handle}`;
  return {
    title: `${name} (@${profile.handle})`,
    description: profile.bio ?? `${name} on Lare`,
    robots: profile.is_private ? { index: false } : undefined,
  };
}

export default async function ProfilePage({ params }: Params) {
  const handle = normaliseHandle((await params).handle);
  if (!handle) notFound();

  const [profile, viewer] = await Promise.all([loadProfile(handle), getViewer()]);
  if (!profile?.handle) notFound();

  const supabase = await createClient();
  const isSelf = viewer?.id === profile.id;
  const [statsRes, activityRes, followRes] = await Promise.all([
    supabase.rpc("profile_stats", { target_handle: profile.handle }),
    supabase.rpc("solved_activity", { target_handle: profile.handle }),
    viewer && !isSelf
      ? supabase
          .from("follows")
          .select("status")
          .eq("follower_id", viewer.id)
          .eq("followee_id", profile.id)
          .maybeSingle()
      : Promise.resolve(null),
  ]);
  const stats = parseProfileStats(statsRes.data);
  const activity = parseSolvedActivity(activityRes.data);
  const followState: FollowState = followRes?.data?.status ?? "none";
  const visible = stats?.visible ?? isSelf;
  const name = profile.display_name || `@${profile.handle}`;

  return (
    <Container width="page" className="space-y-4">
      <header className="flex flex-wrap items-start gap-4">
        <Avatar src={profile.avatar_url} name={name} size="md" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="lare-heading text-[var(--text)]">{name}</h1>
            {profile.is_private && (
              <Tooltip label="Private account">
                <span className="inline-flex items-center gap-1 rounded-full border border-[var(--border)] px-2 py-0.5 text-[11px] text-[var(--text-tertiary)]">
                  <Lock className="size-3" />
                  Private
                </span>
              </Tooltip>
            )}
          </div>
          <p className="text-sm text-zinc-500">@{profile.handle}</p>
          {profile.bio && (
            <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-zinc-300">
              {profile.bio}
            </p>
          )}
        </div>
        <div className="shrink-0">
          <FollowButton
            targetId={profile.id}
            targetHandle={profile.handle}
            viewerId={viewer?.id ?? null}
            initialState={followState}
          />
        </div>
      </header>

      <Stats stats={stats} />

      {visible && activity?.visible && <ActivityChart activity={activity} />}

      <section aria-label="Posts">
        {visible ? (
          <Suspense
            fallback={
              <div className="space-y-4">
                <PostCardSkeleton />
                <PostCardSkeleton />
              </div>
            }
          >
            <ProfilePosts userId={profile.id} isSelf={isSelf} viewerId={viewer?.id ?? null} />
          </Suspense>
        ) : (
          <Card className="px-6 py-10 text-center">
            <Lock className="mx-auto size-6 text-zinc-600" />
            <h2 className="mt-3 text-base font-semibold text-zinc-100">This account is private</h2>
            <p className="mt-1 text-sm text-zinc-400">
              {followState === "pending"
                ? "Your follow request is waiting for approval."
                : "Request to follow, and their sessions and solved-problem activity appear here once they accept."}
            </p>
          </Card>
        )}
      </section>
    </Container>
  );
}

function Stats({ stats }: { stats: ProfileStats | null }) {
  if (!stats) return null;
  const items: Array<{ label: string; value: string }> = [
    { label: "Followers", value: String(stats.followers) },
    { label: "Following", value: String(stats.following) },
  ];
  if (stats.visible) {
    if (stats.posts !== undefined) items.push({ label: "Posts", value: String(stats.posts) });
    if (stats.problems_solved !== undefined)
      items.push({ label: "Solved", value: String(stats.problems_solved) });
    if (stats.total_active_ms !== undefined)
      items.push({ label: "Time", value: formatDurationHuman(stats.total_active_ms) });
  }
  return (
    <dl className="grid grid-cols-3 gap-px overflow-hidden rounded-xl border border-zinc-800 bg-zinc-800 sm:grid-cols-5">
      {items.map((item) => (
        <div key={item.label} className="bg-zinc-950 px-3 py-2.5">
          <dt className="text-[10px] uppercase tracking-wider text-zinc-500">{item.label}</dt>
          <dd className="mt-0.5 text-base font-semibold tabular-nums text-zinc-100">
            {item.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

async function ProfilePosts({
  userId,
  isSelf,
  viewerId,
}: {
  userId: string;
  isSelf: boolean;
  viewerId: string | null;
}) {
  const supabase = await createClient();
  const posts = await fetchUserPosts(supabase, userId);
  if (posts.length === 0) {
    return (
      <Card className="px-6 py-10 text-center text-sm text-[var(--text-secondary)]">
        {isSelf ? "You haven't published a session yet." : "No published sessions yet."}
      </Card>
    );
  }
  return (
    <div className="space-y-4">
      {posts.map((post) => (
        <PostCard key={post.id} post={post} viewerId={viewerId} />
      ))}
    </div>
  );
}
