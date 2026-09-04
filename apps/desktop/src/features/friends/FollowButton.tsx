import { Check, Clock, UserPlus } from "lucide-react";
import { useToast } from "@/components/toast/ToastProvider";
import { Button } from "@/components/ui/Button";
import { errorMessage } from "@/lib/supabase";
import { type FollowState, useFollow, useUnfollow } from "./queries";

/**
 * Follow / Requested / Following. Private accounts land on "Requested" until they accept,
 * which is also the affordance for cancelling the request.
 */
export function FollowButton({
  targetId,
  handle,
  state,
  isPrivate,
}: {
  targetId: string;
  handle: string | null;
  state: FollowState;
  isPrivate: boolean;
}) {
  const follow = useFollow();
  const unfollow = useUnfollow();
  const { toast } = useToast();
  const pending = follow.isPending || unfollow.isPending;

  if (!handle) return null;

  const onError = (title: string) => (err: unknown) =>
    toast({ title, description: errorMessage(err), variant: "error" });

  if (state === "none") {
    return (
      <Button
        size="sm"
        variant="primary"
        loading={pending}
        icon={<UserPlus className="size-3.5" aria-hidden />}
        onClick={() =>
          follow.mutate(handle, {
            onSuccess: (next) =>
              toast({
                title: next === "pending" ? `Requested @${handle}` : `Following @${handle}`,
                variant: "success",
              }),
            onError: onError("Couldn't follow"),
          })
        }
      >
        {isPrivate ? "Request" : "Follow"}
      </Button>
    );
  }

  const isPendingRequest = state === "pending";
  return (
    <Button
      size="sm"
      loading={pending}
      title={isPendingRequest ? "Cancel request" : "Unfollow"}
      icon={
        isPendingRequest ? (
          <Clock className="size-3.5" aria-hidden />
        ) : (
          <Check className="size-3.5" aria-hidden />
        )
      }
      onClick={() =>
        unfollow.mutate(targetId, {
          onSuccess: () =>
            toast({
              title: isPendingRequest ? "Request cancelled" : `Unfollowed @${handle}`,
              variant: "success",
            }),
          onError: onError(isPendingRequest ? "Couldn't cancel request" : "Couldn't unfollow"),
        })
      }
    >
      {isPendingRequest ? "Requested" : "Following"}
    </Button>
  );
}
