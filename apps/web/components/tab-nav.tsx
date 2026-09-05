import Link from "next/link";
import { cn } from "@/lib/cn";

export interface TabItem {
  key: string;
  label: string;
  href: string;
  badge?: number;
}

/**
 * Segmented link bar used by the feed scope switch and the friends tab. Plain links so the
 * pages stay server-rendered and the current tab is shareable.
 */
export function TabNav({
  items,
  active,
  label,
}: {
  items: TabItem[];
  active: string;
  label: string;
}) {
  return (
    <nav
      aria-label={label}
      className="inline-flex items-center gap-1 rounded-xl border border-zinc-800/80 bg-zinc-900/40 p-1"
    >
      {items.map((item) => {
        const current = item.key === active;
        return (
          <Link
            key={item.key}
            href={item.href}
            aria-current={current ? "page" : undefined}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-[background-color,color] duration-(--tabs-dur) ease-(--tabs-ease)",
              current
                ? "bg-zinc-100 text-zinc-950"
                : "text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100",
            )}
          >
            {item.label}
            {item.badge !== undefined && item.badge > 0 && (
              <span
                className={cn(
                  "inline-flex min-w-5 items-center justify-center rounded-full px-1.5 py-0.5 text-[11px] font-semibold leading-none",
                  current
                    ? "bg-zinc-900 text-zinc-100"
                    : "lare-badge-pop bg-zinc-100 text-zinc-950",
                )}
              >
                {item.badge > 99 ? "99+" : item.badge}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
