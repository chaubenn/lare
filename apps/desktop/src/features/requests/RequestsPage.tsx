import { formatRelativeTime } from "@lare/shared";
import { Check, UserPlus, X } from "lucide-react";
import { useToast } from "@/components/toast/ToastProvider";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { PageHeader } from "@/components/ui/Card";
import { EmptyState, ErrorState, PageSpinner } from "@/components/ui/States";
import { errorMessage } from "@/lib/supabase";
import { type FollowRequest, useFollowRequests, useRespondToRequest } from "./queries";

export function RequestsPage() {
  const requests = useFollowRequests();
  return (
    <>
      <PageHeader
        title="Follow requests"
        subtitle="People who want to follow your private account."
      />
      {requests.isPending ? (
        <PageSpinner />
      ) : requests.isError ? (
        <ErrorState error={requests.error} onRetry={() => void requests.refetch()} />
      ) : requests.data.length === 0 ? (
        <EmptyState
          icon={<UserPlus className="size-8" aria-hidden />}
          title="No pending requests"
          description="Requests only appear when your account is private. Public accounts accept follows automatically."
        />
      ) : (
        <ul className="divide-y divide-zinc-800/80 rounded-xl border border-zinc-800">
          {requests.data.map((r) => (
            <li key={r.follower_id}>
              <RequestRow request={r} />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function RequestRow({ request }: { request: FollowRequest }) {
  const respond = useRespondToRequest();
  const { toast } = useToast();
  const p = request.profiles;
  const name = p?.display_name ?? (p?.handle ? `@${p.handle}` : "Unknown user");

  const act = (accept: boolean) => {
    respond.mutate(
      { follower: request.follower_id, accept },
      {
        onSuccess: () =>
          toast({ title: accept ? `Accepted ${name}` : `Declined ${name}`, variant: "success" }),
        onError: (err) =>
          toast({
            title: "Couldn't update request",
            description: errorMessage(err),
            variant: "error",
          }),
      },
    );
  };

  return (
    <div className="flex items-center gap-3 p-4">
      <Avatar url={p?.avatar_url} name={name} size={36} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium text-zinc-100">{name}</div>
        <div className="text-xs text-zinc-500">
          {p?.handle ? `@${p.handle} · ` : ""}
          requested {formatRelativeTime(request.created_at)}
        </div>
      </div>
      <Button
        size="sm"
        variant="primary"
        icon={<Check className="size-3.5" aria-hidden />}
        onClick={() => act(true)}
        disabled={respond.isPending}
      >
        Accept
      </Button>
      <Button
        size="sm"
        icon={<X className="size-3.5" aria-hidden />}
        onClick={() => act(false)}
        disabled={respond.isPending}
      >
        Decline
      </Button>
    </div>
  );
}
