import { cn, SPRING } from "@lare/ui";
import { Emblem, Wordmark } from "@lare/ui/brand";
import { motion } from "motion/react";
import { NavLink } from "react-router";
import { CountBadge } from "@/components/ui/Badge";
import { useDrafts } from "@/features/drafts/queries";
import { useFollowRequests } from "@/features/requests/queries";
import { NAV_ITEMS } from "./nav";

export function Sidebar() {
  const drafts = useDrafts();
  const requests = useFollowRequests();
  const counts: Partial<Record<string, number>> = {
    "/drafts": drafts.data?.length ?? 0,
    "/friends": requests.data?.length ?? 0,
  };

  return (
    <aside className="lare-material-thick flex h-full w-56 shrink-0 flex-col border-r border-[var(--border)]">
      <div data-tauri-drag-region className="flex items-center px-4 pt-8 pb-3 text-[var(--text)]">
        <Wordmark markClassName="size-5" />
      </div>
      <nav aria-label="Main" className="relative flex-1 space-y-0.5 px-2">
        {NAV_ITEMS.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) =>
              cn(
                "lare-press relative flex items-center gap-2.5 rounded-[var(--lare-r-2)] px-2.5 py-2 text-sm",
                !isActive && "hover:bg-[color-mix(in_oklab,var(--surface-raised)_45%,transparent)]",
              )
            }
          >
            {({ isActive }) => (
              <>
                {isActive ? (
                  <motion.span
                    layoutId="sidebar-active"
                    className="absolute inset-0 rounded-[var(--lare-r-2)] bg-[var(--surface-raised)]"
                    transition={SPRING.ui}
                  />
                ) : null}
                <item.icon
                  className={cn(
                    "relative z-10 size-4 shrink-0",
                    isActive ? "text-[var(--text)]" : "text-[var(--text-tertiary)]",
                  )}
                  aria-hidden
                />
                <span
                  className={cn(
                    "relative z-10 flex-1",
                    isActive ? "text-[var(--text)]" : "text-[var(--text-secondary)]",
                  )}
                >
                  {item.label}
                </span>
                <span className="relative z-10 flex items-center gap-1.5">
                  {counts[item.to] !== undefined ? (
                    <CountBadge count={counts[item.to] ?? 0} />
                  ) : null}
                  <span className="lare-micro text-[var(--text-tertiary)]">{item.shortcut}</span>
                </span>
              </>
            )}
          </NavLink>
        ))}
      </nav>
      <div className="px-4 py-3 text-[var(--text-tertiary)]">
        <Emblem className="mr-1.5 inline size-3 align-[-1px]" />
        <span className="lare-micro">v{__APP_VERSION__}</span>
      </div>
    </aside>
  );
}
