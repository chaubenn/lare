export interface StatItem {
  label: string;
  value: number | string;
  /** Makes the whole cell a button (the follower / following lists open a modal). */
  onClick?: () => void;
}

export function StatStrip({ items }: { items: StatItem[] }) {
  return (
    <dl className="grid grid-cols-3 gap-px overflow-hidden rounded-xl border border-zinc-800 bg-zinc-800 sm:grid-cols-5">
      {items.map((item) => (
        <div key={item.label} className="relative bg-zinc-950 px-3 py-2.5">
          <dt className="text-[10px] uppercase tracking-wider text-zinc-500">{item.label}</dt>
          <dd className="mt-0.5 text-base font-semibold tabular-nums text-zinc-100">
            {item.value}
          </dd>
          {/* Stretched over the cell rather than wrapping it: a `dl` may only contain `dt`,
              `dd` and grouping `div`s, so the button cannot be an ancestor of them. */}
          {item.onClick ? (
            <button
              type="button"
              onClick={item.onClick}
              aria-label={`${item.label}: ${item.value}`}
              className="absolute inset-0 rounded-none transition-colors hover:bg-zinc-100/5 focus-visible:outline focus-visible:-outline-offset-2 focus-visible:outline-zinc-500"
            />
          ) : null}
        </div>
      ))}
    </dl>
  );
}
