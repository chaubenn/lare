import { Lock, Users } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { SegmentedTabs } from "@/components/ui/SegmentedTabs";
import { EmptyState, ErrorState, Spinner } from "@/components/ui/States";
import { useUser } from "@/features/auth/AuthProvider";
import { useFollowStates } from "@/features/friends/queries";
import { UserRow } from "@/features/friends/UserRow";
import { type FollowListKind, useFollowList } from "./queries";

const TABS: Array<{ key: FollowListKind; label: string }> = [
  { key: "followers", label: "Followers" },
  { key: "following", label: "Following" },
];

/**
 * The people behind a profile's follower / following counts, as a modal off the stat strip —
 * the same place and the same two tabs Instagram puts them. Works on any profile the viewer can
 * see, their own included; a private account they do not follow shows the counts but not the
 * names, which is what the RPC enforces.
 */
export function FollowListModal({
  handle,
  name,
  kind,
  onKindChange,
  onClose,
}: {
  handle: string | null | undefined;
  /** Display name of whoever's lists these are, for the modal title. */
  name: string;
  /** Which tab is showing; `null` closes the modal. */
  kind: FollowListKind | null;
  onKindChange: (kind: FollowListKind) => void;
  onClose: () => void;
}) {
  const open = kind !== null;
  const list = useFollowList(handle, kind ?? "followers", open);
  const people = list.data?.people ?? [];
  const { userId } = useUser();
  // Drives Follow / Requested / Following on each row, exactly as the friends tab does.
  const states = useFollowStates(people.map((person) => person.id));

  return (
    <Modal open={open} onClose={onClose} title={name}>
      <div className="border-b border-zinc-800 px-3 py-3">
        <SegmentedTabs
          label="Follower lists"
          value={kind ?? "followers"}
          onChange={onKindChange}
          items={TABS}
        />
      </div>

      {list.isPending ? (
        <Spinner className="py-10" />
      ) : list.isError ? (
        <div className="p-3">
          <ErrorState error={list.error} onRetry={() => void list.refetch()} />
        </div>
      ) : !list.data?.visible ? (
        <div className="p-3">
          <EmptyState
            icon={<Lock className="size-8" aria-hidden />}
            title="This account is private"
            description="Follow them to see who they follow and who follows them."
          />
        </div>
      ) : people.length === 0 ? (
        <div className="p-3">
          <EmptyState
            icon={<Users className="size-8" aria-hidden />}
            title={kind === "followers" ? "No followers yet" : "Not following anyone yet"}
          />
        </div>
      ) : (
        <div className="divide-y divide-zinc-900">
          {people.map((person) => (
            <UserRow
              key={person.id}
              person={person}
              // No follow button against yourself.
              state={person.id === userId ? undefined : (states.data?.[person.id] ?? "none")}
            />
          ))}
        </div>
      )}
    </Modal>
  );
}
