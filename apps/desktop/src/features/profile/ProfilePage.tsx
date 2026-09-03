import { formatDurationHuman } from "@lare/shared";
import { ExternalLink, Lock } from "lucide-react";
import { Link } from "react-router";
import { Avatar } from "@/components/ui/Avatar";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, PageHeader } from "@/components/ui/Card";
import { ErrorState, Spinner } from "@/components/ui/States";
import { useUser } from "@/features/auth/AuthProvider";
import { profileWebUrl } from "@/lib/env";
import { openExternal } from "@/lib/open";
import { useProfileStats } from "./queries";

export function ProfilePage() {
  const { profile, session } = useUser();
  const stats = useProfileStats(profile?.handle);
  const name = profile?.display_name ?? profile?.handle ?? session.user.email ?? "You";

  return (
    <>
      <PageHeader
        title="Profile"
        actions={
          <>
            {profile?.handle ? (
              <Button
                size="sm"
                icon={<ExternalLink className="size-3.5" aria-hidden />}
                onClick={() => void openExternal(profileWebUrl(profile.handle ?? ""))}
              >
                Open on web
              </Button>
            ) : null}
            <Link
              to="/settings"
              className="rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-xs text-zinc-100 hover:bg-zinc-800"
            >
              Edit
            </Link>
          </>
        }
      />
      <Card className="flex items-start gap-4">
        <Avatar url={profile?.avatar_url} name={name} size={64} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-semibold text-zinc-50">{name}</h2>
            {profile?.handle ? <span className="text-sm text-zinc-500">@{profile.handle}</span> : null}
            {profile?.is_private ? (
              <Badge>
                <Lock className="size-3" aria-hidden />
                Private
              </Badge>
            ) : null}
          </div>
          {profile?.bio ? (
            <p className="mt-2 select-text whitespace-pre-wrap text-sm text-zinc-300">{profile.bio}</p>
          ) : (
            <p className="mt-2 text-sm text-zinc-500">No bio yet.</p>
          )}
          <p className="mt-2 text-xs text-zinc-500">{session.user.email}</p>
        </div>
      </Card>

      <div className="mt-4">
        {stats.isPending && profile?.handle ? (
          <Spinner className="py-6" />
        ) : stats.isError ? (
          <ErrorState error={stats.error} onRetry={() => void stats.refetch()} />
        ) : stats.data ? (
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            <Stat label="Followers" value={stats.data.followers} />
            <Stat label="Following" value={stats.data.following} />
            <Stat label="Posts" value={stats.data.posts ?? 0} />
            <Stat label="Problems solved" value={stats.data.problems_solved ?? 0} />
            <Stat label="Time practising" value={formatDurationHuman(stats.data.total_active_ms ?? 0)} />
          </dl>
        ) : null}
      </div>
    </>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-3">
      <dt className="text-xs text-zinc-500">{label}</dt>
      <dd className="mt-1 text-lg font-semibold text-zinc-100">{value}</dd>
    </div>
  );
}
