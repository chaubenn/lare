import type { SolvedActivity } from "@lare/shared";
import { ActivityChart } from "@lare/ui";

/** Profile activity: weekly solve bars. Kept as ActivityGrid so existing imports stay put. */
export function ActivityGrid({ activity }: { activity: SolvedActivity }) {
  return <ActivityChart activity={activity} />;
}
