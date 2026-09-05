import { type Distribution, userBinIndex } from "@lare/shared";
import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export interface RuntimeChartProps {
  distribution: Distribution;
  /** The user's runtime (ms) or memory (MB) to highlight. */
  userValue: number | null | undefined;
  unit: "ms" | "MB";
  height?: number;
  className?: string;
}

/**
 * LeetCode-style runtime/memory distribution histogram: percentage of accepted
 * submissions per bin, with the user's bin highlighted.
 */
export function RuntimeChart({
  distribution,
  userValue,
  unit,
  height = 160,
  className,
}: RuntimeChartProps) {
  const highlight =
    userValue === null || userValue === undefined ? -1 : userBinIndex(distribution, userValue);
  const data = distribution.bins.map((b, i) => ({ ...b, i }));
  const tickEvery = Math.max(1, Math.floor(data.length / 8));

  return (
    <div className={className} style={{ width: "100%", height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={data}
          margin={{ top: 8, right: 8, bottom: 0, left: -18 }}
          barCategoryGap={1}
        >
          <XAxis
            dataKey="value"
            tickLine={false}
            axisLine={false}
            interval={tickEvery - 1}
            tick={{ fontSize: 10, fill: "#8a8780" }}
            tickFormatter={(v: number) => `${v}${unit}`}
          />
          <YAxis
            tickLine={false}
            axisLine={false}
            width={44}
            tick={{ fontSize: 10, fill: "#8a8780" }}
            tickFormatter={(v: number) => `${v}%`}
          />
          <Tooltip
            cursor={{ fill: "rgba(255,255,255,0.04)" }}
            contentStyle={{
              background: "#161615",
              border: "1px solid #2a2a27",
              borderRadius: 8,
              fontSize: 12,
            }}
            labelFormatter={(v) => `${v} ${unit}`}
            formatter={(v) => [`${Number(v).toFixed(2)}%`, "submissions"]}
          />
          <Bar dataKey="pct" radius={[2, 2, 0, 0]} isAnimationActive={false}>
            {data.map((d) => (
              <Cell key={d.i} fill={d.i === highlight ? "#f0ece4" : "#3d3c39"} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
