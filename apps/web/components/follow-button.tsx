"use client";

import { Check, Clock, LoaderCircle, UserPlus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { buttonPrimary, buttonSecondary } from "@/lib/styles";
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
        className={`${buttonSecondary} px-3 py-1.5 text-xs`}
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

  const spinner = pending ? <LoaderCircle className="size-3.5 animate-spin" /> : null;

  return (
    <div className="flex flex-col items-end gap-1">
      {state === "none" && (
        <button
          type="button"
          onClick={follow}
          disabled={pending}
          className={`${buttonPrimary} px-3 py-1.5 text-xs`}
        >
          {spinner ?? <UserPlus className="size-3.5" />}
          Follow
        </button>
      )}
      {state === "pending" && (
        <button
          type="button"
          onClick={unfollow}
          disabled={pending}
          title="Cancel request"
          className={`${buttonSecondary} group px-3 py-1.5 text-xs`}
        >
          {spinner ?? <Clock className="size-3.5" />}
          <span className="group-hover:hidden">Requested</span>
          <span className="hidden group-hover:inline">Cancel request</span>
        </button>
      )}
      {state === "accepted" && (
        <button
          type="button"
          onClick={unfollow}
          disabled={pending}
          className={`${buttonSecondary} group px-3 py-1.5 text-xs hover:border-rose-500/40 hover:text-rose-300`}
        >
          {spinner ?? <Check className="size-3.5 group-hover:hidden" />}
          <span className="group-hover:hidden">Following</span>
          <span className="hidden group-hover:inline">Unfollow</span>
        </button>
      )}
      {error && (
        <p role="alert" className="text-xs text-rose-300">
          {error}
        </p>
      )}
    </div>
  );
}
