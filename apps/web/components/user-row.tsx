import { Lock } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { Avatar } from "@/components/avatar";
import { FollowButton, type FollowState } from "@/components/follow-button";

export interface PersonSummary {
  id: string;
  handle: string | null;
  display_name: string | null;
  avatar_url: string | null;
  is_private: boolean;
}

export function displayNameOf(person: PersonSummary): string {
  return person.display_name || (person.handle ? `@${person.handle}` : "Someone");
}

/**
 * One person in a list on the friends tab: avatar, name, a private-account indicator and
 * whatever action fits the list (a follow button by default).
 */
export function UserRow({
  person,
  viewerId,
  followState,
  meta,
  action,
}: {
  person: PersonSummary;
  viewerId: string | null;
  /** Omit to render no follow button (e.g. rows that carry accept/decline forms instead). */
  followState?: FollowState;
  meta?: ReactNode;
  action?: ReactNode;
}) {
  const name = displayNameOf(person);
  const href = person.handle ? `/u/${person.handle}` : null;

  return (
    <li className="flex flex-wrap items-center gap-3 p-4">
      {href ? (
        <Link href={href}>
          <Avatar src={person.avatar_url} name={name} />
        </Link>
      ) : (
        <Avatar src={person.avatar_url} name={name} />
      )}

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          {href ? (
            <Link href={href} className="text-sm font-semibold text-zinc-100 hover:underline">
              {name}
            </Link>
          ) : (
            <span className="text-sm font-semibold text-zinc-100">{name}</span>
          )}
          {person.is_private && (
            <span
              className="inline-flex items-center gap-1 rounded-full border border-zinc-800 px-2 py-0.5 text-[11px] text-zinc-400"
              title="Private account — you have to request to follow"
            >
              <Lock className="size-3" />
              Private
            </span>
          )}
        </div>
        <p className="truncate text-xs text-zinc-500">
          {person.handle && <>@{person.handle}</>}
          {person.handle && meta && <> · </>}
          {meta}
        </p>
        {person.is_private && followState !== "accepted" && viewerId !== person.id && (
          <p className="mt-1 text-xs text-zinc-500">
            {followState === "pending"
              ? "Request sent — they still have to approve it."
              : "Request to follow before you can see their sessions."}
          </p>
        )}
      </div>

      <div className="shrink-0">
        {action ??
          (person.handle && followState !== undefined ? (
            <FollowButton
              targetId={person.id}
              targetHandle={person.handle}
              viewerId={viewerId}
              initialState={followState}
            />
          ) : null)}
      </div>
    </li>
  );
}
