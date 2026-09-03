import { Check, Inbox, X } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Avatar } from "@/components/avatar";
import { PendingButton } from "@/components/pending-button";
import { TimeAgo } from "@/components/time-ago";
import { buttonDanger, buttonPrimary, cardClass } from "@/lib/styles";
import { createClient } from "@/lib/supabase/server";
import { requireViewer } from "@/lib/viewer";
import { acceptFollowRequest, declineFollowRequest } from "./actions";

export const metadata: Metadata = { title: "Follow requests" };

export default async function RequestsPage() {
  const viewer = await requireViewer("/requests");
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("follows")
    .select(
      "follower_id, created_at, profiles!follows_follower_id_fkey(handle, display_name, avatar_url)",
    )
    .eq("followee_id", viewer.id)
    .eq("status", "pending")
    .order("created_at", { ascending: false });
  if (error) throw new Error(`Couldn't load requests: ${error.message}`);
  const requests = data ?? [];

  return (
    <div>
      <div className="mb-5">
        <h1 className="text-xl font-semibold text-zinc-50">Follow requests</h1>
        <p className="mt-1 text-sm text-zinc-400">
          {viewer.profile.is_private
            ? "People who asked to follow you. Accepted followers can see your public posts."
            : "Your account is public, so new followers are accepted automatically."}
        </p>
      </div>

      {requests.length === 0 ? (
        <div className={`${cardClass} px-6 py-12 text-center`}>
          <Inbox className="mx-auto size-8 text-zinc-600" />
          <p className="mt-3 text-sm text-zinc-400">No pending requests.</p>
        </div>
      ) : (
        <ul className={`${cardClass} divide-y divide-zinc-800/80`}>
          {requests.map((req) => {
            const p = req.profiles;
            const name = p.display_name || (p.handle ? `@${p.handle}` : "Someone");
            return (
              <li key={req.follower_id} className="flex flex-wrap items-center gap-3 p-4">
                {p.handle ? (
                  <Link href={`/u/${p.handle}`}>
                    <Avatar src={p.avatar_url} name={name} />
                  </Link>
                ) : (
                  <Avatar src={p.avatar_url} name={name} />
                )}
                <div className="min-w-0 flex-1">
                  {p.handle ? (
                    <Link
                      href={`/u/${p.handle}`}
                      className="text-sm font-semibold text-zinc-100 hover:underline"
                    >
                      {name}
                    </Link>
                  ) : (
                    <span className="text-sm font-semibold text-zinc-100">{name}</span>
                  )}
                  <p className="text-xs text-zinc-500">
                    {p.handle && <>@{p.handle} · </>}
                    requested <TimeAgo iso={req.created_at} />
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <form action={acceptFollowRequest}>
                    <input type="hidden" name="follower" value={req.follower_id} />
                    <PendingButton className={`${buttonPrimary} px-3 py-1.5 text-xs`}>
                      <Check className="size-3.5" />
                      Accept
                    </PendingButton>
                  </form>
                  <form action={declineFollowRequest}>
                    <input type="hidden" name="follower" value={req.follower_id} />
                    <PendingButton className={`${buttonDanger} px-3 py-1.5 text-xs`}>
                      <X className="size-3.5" />
                      Decline
                    </PendingButton>
                  </form>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
