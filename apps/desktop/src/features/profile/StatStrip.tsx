export interface StatItem {
  label: string;
  value: number | string;
  /** Makes the whole cell a button (the follower / following lists open a modal). */
  onClick?: () => void;
}

/** A row of counts under the profile identity. Cells are separated by hairlines, not boxes. */
export function StatStrip({ items }: { items: StatItem[] }) {
  return (
    <dl className="grid grid-cols-3 divide-[var(--border)] sm:grid-cols-5 sm:divide-x">
      {items.map((item) => (
        // Column-reversed so the number reads first while `dt` still precedes `dd` in the DOM.
        <div key={item.label} className="relative flex flex-col-reverse px-4 py-3 sm:first:pl-0">
          <dt className="mt-0.5 text-xs text-[var(--text-secondary)]">{item.label}</dt>
          <dd className="text-lg font-semibold leading-tight tabular-nums text-[var(--text)]">
            {item.value}
          </dd>
          {/* Stretched over the cell rather than wrapping it: a `dl` may only contain `dt`,
              `dd` and grouping `div`s, so the button cannot be an ancestor of them. */}
          {item.onClick ? (
            <button
              type="button"
              onClick={item.onClick}
              aria-label={`${item.label}: ${item.value}`}
              className="absolute inset-y-1 inset-x-1 rounded-[var(--lare-r-2)] transition-colors hover:bg-[color-mix(in_oklab,var(--text)_6%,transparent)] focus-visible:outline-2 focus-visible:outline-[var(--focus)]"
            />
          ) : null}
        </div>
      ))}
    </dl>
  );
}
