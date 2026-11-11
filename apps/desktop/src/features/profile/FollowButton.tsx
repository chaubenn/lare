import { Check, Clock, UserPlus } from "@lare/ui/icons";
import { Button } from "@lare/ui/primitives";
import { notify, notifyError } from "@/lib/notices";
import { type FollowState, useFollow, useUnfollow } from "./follows";

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
  const pending = follow.isPending || unfollow.isPending;

  if (!handle) return null;

  const onError = (title: string) => (err: unknown) => notifyError(title, err);

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
              notify({
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
            notify({
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
