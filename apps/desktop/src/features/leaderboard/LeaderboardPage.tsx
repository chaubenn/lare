import { leaderboardWeekLabel } from "@lare/shared";
import { useNavigate, useSearchParams } from "react-router";
import { PageHeader } from "@/components/ui/Card";
import { SegmentedTabs } from "@/components/ui/SegmentedTabs";
import { FriendsLeaderboard } from "./FriendsLeaderboard";
import { GlobalLeaderboard } from "./GlobalLeaderboard";
import { useGlobalLeaderboard, useWeeklyLeaderboard, type WeekOffset } from "./queries";

const SCOPES = [
  { key: "friends", label: "Friends" },
  { key: "global", label: "Global" },
] as const;
type Scope = (typeof SCOPES)[number]["key"];

type Week = "this" | "last";

const WEEKS: Array<{ key: Week; label: string }> = [
  { key: "this", label: "This week" },
  { key: "last", label: "Last week" },
];

const SUBTITLES: Record<Scope, string> = {
  friends: "You and the people you follow, by problems solved.",
  global: "Everyone on Lare, by problems solved.",
};

/** Weekly rankings: the people you follow, or everyone with a public account. */
export function LeaderboardPage() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const raw = params.get("scope");
  const scope: Scope = SCOPES.some((s) => s.key === raw) ? (raw as Scope) : "friends";
  const week: Week = params.get("week") === "last" ? "last" : "this";
  const offset: WeekOffset = week === "this" ? 0 : -1;

  const update = (next: { scope?: Scope; week?: Week }) =>
    setParams({ scope: next.scope ?? scope, week: next.week ?? week }, { replace: true });

  return (
    <div className="mx-auto w-full max-w-3xl">
      <PageHeader title="Leaderboard" subtitle={SUBTITLES[scope]} />
      <div className="mb-4 space-y-3">
        <SegmentedTabs
          label="Leaderboard scope"
          value={scope}
          onChange={(key) => update({ scope: key })}
          items={[...SCOPES]}
        />
        <div className="flex flex-wrap items-center justify-between gap-3">
          <SegmentedTabs
            label="Leaderboard week"
            value={week}
            onChange={(key) => update({ week: key })}
            items={WEEKS}
          />
          <WeekLabel scope={scope} offset={offset} />
        </div>
      </div>
      {scope === "friends" ? (
        <FriendsLeaderboard weekOffset={offset} onFind={() => void navigate("/friends?tab=find")} />
      ) : (
        <GlobalLeaderboard weekOffset={offset} />
      )}
    </div>
  );
}

/** The date range of the board on screen; shares its query with the board body. */
function WeekLabel({ scope, offset }: { scope: Scope; offset: WeekOffset }) {
  return scope === "friends" ? <FriendsWeek offset={offset} /> : <GlobalWeek offset={offset} />;
}

function FriendsWeek({ offset }: { offset: WeekOffset }) {
  return <WeekRange offset={offset} board={useWeeklyLeaderboard(offset).data} />;
}

function GlobalWeek({ offset }: { offset: WeekOffset }) {
  return <WeekRange offset={offset} board={useGlobalLeaderboard(offset).data} />;
}

function WeekRange({
  offset,
  board,
}: {
  offset: WeekOffset;
  board: { week_start: string; week_end: string } | null | undefined;
}) {
  if (!board) return null;
  return (
    <p className="text-xs text-[var(--text-secondary)]">
      {leaderboardWeekLabel(offset, board.week_start, board.week_end)}
    </p>
  );
}
