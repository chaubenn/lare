import { type Distribution, formatBeats } from "@lare/shared";
import { useState } from "react";
import { cn } from "./cn";
import { RuntimeChart } from "./RuntimeChart";

export interface SubmissionStatsProps {
  runtimeMs: number | null;
  runtimeDisplay?: string | null;
  runtimePercentile: number | null;
  memoryMb: number | null;
  memoryDisplay?: string | null;
  memoryPercentile: number | null;
  runtimeDistribution: Distribution | null;
  memoryDistribution: Distribution | null;
  className?: string;
}

/**
 * The "Runtime 1219 ms · Beats 17.99% | Memory 22 MB · Beats 5.34%" header with
 * the distribution graph underneath, mirroring LeetCode's accepted-submission panel.
 */
export function SubmissionStats(props: SubmissionStatsProps) {
  const [tab, setTab] = useState<"runtime" | "memory">("runtime");
  const dist = tab === "runtime" ? props.runtimeDistribution : props.memoryDistribution;
  const userValue = tab === "runtime" ? props.runtimeMs : props.memoryMb;

  return (
    <div className={cn("rounded-xl border border-zinc-800 bg-zinc-950/60 p-3", props.className)}>
      <div className="grid grid-cols-2 gap-2">
        <StatTab
          active={tab === "runtime"}
          onClick={() => setTab("runtime")}
          label="Runtime"
          value={props.runtimeDisplay ?? (props.runtimeMs !== null ? `${props.runtimeMs} ms` : "—")}
          beats={formatBeats(props.runtimePercentile)}
        />
        <StatTab
          active={tab === "memory"}
          onClick={() => setTab("memory")}
          label="Memory"
          value={props.memoryDisplay ?? (props.memoryMb !== null ? `${props.memoryMb} MB` : "—")}
          beats={formatBeats(props.memoryPercentile)}
        />
      </div>
      {dist ? (
        <RuntimeChart
          key={tab}
          distribution={dist}
          userValue={userValue}
          unit={tab === "runtime" ? "ms" : "MB"}
          className="mt-3"
        />
      ) : (
        <div className="mt-3 flex h-24 items-center justify-center text-xs text-zinc-500">
          Distribution not available for this submission
        </div>
      )}
    </div>
  );
}

function StatTab({
  active,
  onClick,
  label,
  value,
  beats,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  value: string;
  beats: string | null;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-lg border px-3 py-2 text-left transition-colors",
        active ? "border-zinc-700 bg-zinc-900" : "border-transparent hover:bg-zinc-900/60",
      )}
    >
      <div className="text-xs text-zinc-400">{label}</div>
      <div className="mt-0.5 flex items-baseline gap-2">
        <span className="text-lg font-semibold text-zinc-100">{value}</span>
        {beats && (
          <span className="text-xs text-zinc-400">
            Beats <span className="font-semibold text-zinc-200">{beats}</span>
          </span>
        )}
      </div>
    </button>
  );
}
