"use client";

import { Button, buttonClass, FieldError } from "@lare/ui/primitives";
import { Check, Clock, UserPlus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { FormToast } from "@/components/form-toast";
import { createClient } from "@/lib/supabase/client";

export type FollowState = "none" | "pending" | "accepted";

export function FollowButton({
  targetId,
  targetHandle,
  viewerId,
  initialState,
}: {
  targetId: string;
  targetHandle: string;
  viewerId: string | null;
  initialState: FollowState;
}) {
  const router = useRouter();
  const [state, setState] = useState<FollowState>(initialState);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (!viewerId) {
    return (
      <Link
        href={`/login?next=${encodeURIComponent(`/u/${targetHandle}`)}`}
        className={buttonClass("secondary", "sm")}
      >
        <UserPlus className="size-3.5" />
        Sign in to follow
      </Link>
    );
  }
  if (viewerId === targetId) return null;
  const me: string = viewerId;

  function follow() {
    setError(null);
    startTransition(async () => {
      const supabase = createClient();
      const { data, error } = await supabase.rpc("request_follow", { target_handle: targetHandle });
      if (error) {
        setError(error.message);
        return;
      }
      setState(data === "accepted" ? "accepted" : "pending");
      router.refresh();
    });
  }

  function unfollow() {
    setError(null);
    startTransition(async () => {
      const supabase = createClient();
      const { error } = await supabase
        .from("follows")
        .delete()
        .eq("follower_id", me)
        .eq("followee_id", targetId);
      if (error) {
        setError(error.message);
        return;
      }
      setState("none");
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <FormToast error={error} />
      {state === "none" && (
        <Button
          type="button"
          variant="primary"
          size="sm"
          onClick={follow}
          loading={pending}
          icon={<UserPlus className="size-3.5" />}
        >
          Follow
        </Button>
      )}
      {state === "pending" && (
        <Button
          type="button"
          size="sm"
          onClick={unfollow}
          loading={pending}
          tooltip="Cancel request"
          icon={<Clock className="size-3.5" />}
          className="group"
        >
          <span className="group-hover:hidden">Requested</span>
          <span className="hidden group-hover:inline">Cancel request</span>
        </Button>
      )}
      {state === "accepted" && (
        <Button
          type="button"
          size="sm"
          onClick={unfollow}
          loading={pending}
          icon={<Check className="size-3.5 group-hover:hidden" />}
          className="group hover:border-[color-mix(in_oklab,var(--lare-danger)_40%,transparent)] hover:text-[var(--lare-danger)]"
        >
          <span className="group-hover:hidden">Following</span>
          <span className="hidden group-hover:inline">Unfollow</span>
        </Button>
      )}
      <FieldError>{error}</FieldError>
    </div>
  );
}
