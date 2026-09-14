"use client";

import { SPRING } from "@lare/ui";
import { Wordmark } from "@lare/ui/brand";
import { cn } from "@lare/ui/cn";
import { Inbox, Rss, Settings, SquarePen, User, Users } from "lucide-react";
import { motion } from "motion/react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { AvatarMenu } from "@/components/avatar-menu";
import type { SiteViewer } from "@/components/site-chrome";

export function Sidebar({ viewer, pending }: { viewer: SiteViewer; pending: number }) {
  const pathname = usePathname();
  const items = [
    { href: "/", label: "Feed", icon: Rss },
    { href: "/drafts", label: "Drafts", icon: SquarePen },
    { href: "/sessions", label: "Sessions", icon: Inbox },
    { href: viewer.handle ? `/u/${viewer.handle}` : "/onboarding", label: "Profile", icon: User },
    { href: "/friends", label: "Friends", icon: Users },
    { href: "/settings", label: "Settings", icon: Settings },
  ];
  return (
    <aside
      data-app-sidebar
      className="lare-material-thick fixed inset-y-0 left-0 z-30 hidden w-56 flex-col border-r border-[var(--border)] md:flex"
    >
      <Link href="/?landing=1" aria-label="Lare home" className="px-4 pt-8 pb-3">
        <Wordmark markClassName="size-5" />
      </Link>
      <nav aria-label="Main" className="relative flex-1 space-y-0.5 px-2">
        {items.map(({ href, label, icon: Icon }) => {
          const active =
            href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "lare-press relative flex items-center gap-2.5 rounded-[var(--lare-r-2)] px-2.5 py-2 text-sm",
                !active && "hover:bg-[var(--surface-raised)]",
              )}
            >
              {active && (
                <motion.span
                  layoutId="sidebar-active"
                  transition={SPRING.ui}
                  className="absolute inset-0 rounded-[var(--lare-r-2)] bg-[var(--surface-raised)]"
                />
              )}
              <Icon
                aria-hidden
                className={cn(
                  "relative z-10 size-4",
                  active ? "text-[var(--text)]" : "text-[var(--text-tertiary)]",
                )}
              />
              <span className="relative z-10 flex-1">{label}</span>
              {href === "/friends" && pending > 0 && (
                <span className="relative z-10 text-xs">{pending}</span>
              )}
            </Link>
          );
        })}
      </nav>
      <div className="flex items-center justify-between border-t border-[var(--border)] p-4 text-xs text-[var(--text-tertiary)]">
        <span>Web workspace</span>
        <AvatarMenu
          placement="top"
          avatarUrl={viewer.avatarUrl}
          displayName={viewer.displayName}
          handle={viewer.handle}
        />
      </div>
    </aside>
  );
}
