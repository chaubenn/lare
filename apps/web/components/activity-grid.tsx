"use client";

import type { SolvedActivity } from "@lare/shared";
import { ActivityChart } from "@lare/ui";

export function ActivityGrid({ activity }: { activity: SolvedActivity }) {
  return <ActivityChart activity={activity} />;
}
