import {
  type DifficultySplit,
  difficultySplit,
  type SkillArea,
  type SolvedSkills,
  skillAreas,
  topicStats,
} from "@lare/shared";
import { useMemo } from "react";

const DIFF = [
  { key: "easy", label: "Easy", color: "var(--lare-diff-easy)" },
  { key: "medium", label: "Medium", color: "var(--lare-diff-medium)" },
  { key: "hard", label: "Hard", color: "var(--lare-diff-hard)" },
] as const;

/**
 * What someone is good at, from the problems they have solved: a radar over six skill areas,
 * the Easy / Medium / Hard split, and their strongest topics, each bar split by difficulty.
 */
export function SkillsPanel({ skills, className }: { skills: SolvedSkills; className?: string }) {
  const split = useMemo(() => difficultySplit(skills), [skills]);
  const areas = useMemo(() => skillAreas(skills), [skills]);
  const topics = useMemo(() => topicStats(skills).slice(0, 6), [skills]);

  return (
    <section
      aria-labelledby="skills-heading"
      className={`@container flex flex-col rounded-[var(--lare-r-4)] border border-[var(--border)] bg-[var(--surface-raised)] p-5 ${className ?? ""}`}
    >
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="skills-heading" className="text-sm font-semibold text-[var(--text)]">
          Skills
        </h2>
        <p className="text-xs text-[var(--text-secondary)]">
          From {split.total} solved problem{split.total === 1 ? "" : "s"}
        </p>
      </div>

      {split.total === 0 ? (
        <p className="mt-6 text-sm text-[var(--text-secondary)]">
          No accepted solutions yet. Solve problems with the Lare extension and your topics show up
          here.
        </p>
      ) : (
        <>
          <div className="mt-2 grid items-center gap-4 @sm:grid-cols-[minmax(0,1fr)_minmax(0,9.5rem)]">
            <Radar areas={areas} />
            <Difficulty split={split} />
          </div>

          <div className="mt-4 border-t border-[var(--border)] pt-4">
            <h3 className="mb-3 text-xs font-medium text-[var(--text-secondary)]">Top topics</h3>
            <ul className="space-y-2.5">
              {topics.map((t) => (
                <li
                  key={t.slug}
                  className="grid grid-cols-[minmax(0,8.5rem)_minmax(0,1fr)_2rem] items-center gap-3"
                >
                  <span className="truncate text-sm text-[var(--text)]" title={t.name}>
                    {t.name}
                  </span>
                  <span
                    className="flex h-2 overflow-hidden rounded-full bg-[var(--surface)]"
                    title={`${t.easy} easy · ${t.medium} medium · ${t.hard} hard`}
                  >
                    <span
                      className="flex h-full"
                      style={{ width: `${(t.total / (topics[0]?.total ?? 1)) * 100}%` }}
                    >
                      {DIFF.map((d) =>
                        t[d.key] > 0 ? (
                          <span
                            key={d.key}
                            className="h-full"
                            style={{ flexGrow: t[d.key], background: d.color }}
                          />
                        ) : null,
                      )}
                    </span>
                  </span>
                  <span className="text-right text-sm tabular-nums text-[var(--text-secondary)]">
                    {t.total}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </>
      )}
    </section>
  );
}

function Difficulty({ split }: { split: DifficultySplit }) {
  return (
    <div>
      <div className="flex h-2.5 gap-0.5 overflow-hidden rounded-full" aria-hidden>
        {DIFF.map((d) =>
          split[d.key] > 0 ? (
            <span key={d.key} style={{ flexGrow: split[d.key], background: d.color }} />
          ) : null,
        )}
      </div>
      <dl className="mt-3 space-y-2">
        {DIFF.map((d) => (
          <div key={d.key} className="flex items-center justify-between gap-3 text-sm">
            <dt className="flex items-center gap-2 text-[var(--text-secondary)]">
              <span className="size-2 rounded-full" style={{ background: d.color }} aria-hidden />
              {d.label}
            </dt>
            <dd className="font-semibold tabular-nums text-[var(--text)]">{split[d.key]}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/** Six-axis radar; each vertex is that area's problems solved against the strongest area. */
function Radar({ areas }: { areas: SkillArea[] }) {
  const size = 200;
  const c = size / 2;
  const r = 70;
  const point = (i: number, scale: number) => {
    const angle = -Math.PI / 2 + (i * 2 * Math.PI) / areas.length;
    return [c + Math.cos(angle) * r * scale, c + Math.sin(angle) * r * scale] as const;
  };
  const ring = (scale: number) => areas.map((_, i) => point(i, scale).join(",")).join(" ");
  // A little floor so a zero area still reads as a shape rather than collapsing to the centre.
  const shape = areas.map((a, i) => point(i, 0.08 + a.share * 0.92).join(",")).join(" ");

  return (
    <svg
      viewBox={`-72 -6 ${size + 144} ${size + 12}`}
      className="mx-auto w-full max-w-[19rem]"
      role="img"
      aria-label={areas.map((a) => `${a.label}: ${a.solved}`).join(", ")}
    >
      {[1 / 3, 2 / 3, 1].map((s) => (
        <polygon key={s} points={ring(s)} fill="none" stroke="var(--border)" strokeWidth={1} />
      ))}
      {areas.map((a, i) => {
        const [x, y] = point(i, 1);
        return <line key={a.key} x1={c} y1={c} x2={x} y2={y} stroke="var(--border)" />;
      })}
      <polygon
        points={shape}
        fill="color-mix(in oklab, var(--accent) 22%, transparent)"
        stroke="var(--accent)"
        strokeWidth={1.5}
        strokeLinejoin="round"
      />
      {areas.map((a, i) => {
        const [x, y] = point(i, 0.08 + a.share * 0.92);
        return <circle key={a.key} cx={x} cy={y} r={2.5} fill="var(--accent)" />;
      })}
      {areas.map((a, i) => {
        const [x, y] = point(i, 1.2);
        const anchor = Math.abs(x - c) < 4 ? "middle" : x > c ? "start" : "end";
        return (
          <text
            key={a.key}
            x={x}
            y={y}
            textAnchor={anchor}
            dominantBaseline="middle"
            fontSize={10}
            fill="var(--text-secondary)"
          >
            {a.label}
            <tspan fill="var(--text)" fontWeight={600}>
              {` ${a.solved}`}
            </tspan>
          </text>
        );
      })}
    </svg>
  );
}
