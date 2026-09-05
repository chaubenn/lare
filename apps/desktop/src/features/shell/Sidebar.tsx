import { cn } from "@lare/ui";
import { Wordmark } from "@lare/ui/brand";
import { Clapperboard, House, Inbox, Rss, Settings, SquarePen, User, Users } from "lucide-react";
import type { ComponentType, SVGProps } from "react";
import { NavLink } from "react-router";
import { CountBadge } from "@/components/ui/Badge";
import { useDrafts } from "@/features/drafts/queries";
import { useFollowRequests } from "@/features/requests/queries";

interface NavItem {
  to: string;
  label: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  end?: boolean;
  count?: number;
}

export function Sidebar() {
  const drafts = useDrafts();
  const requests = useFollowRequests();

  const items: NavItem[] = [
    { to: "/", label: "Feed", icon: Rss, end: true },
    { to: "/drafts", label: "Drafts", icon: SquarePen, count: drafts.data?.length ?? 0 },
    { to: "/sessions", label: "Sessions", icon: Inbox },
    { to: "/recordings", label: "Recordings", icon: Clapperboard },
    { to: "/profile", label: "Profile", icon: User },
    { to: "/friends", label: "Friends", icon: Users, count: requests.data?.length ?? 0 },
    { to: "/settings", label: "Settings", icon: Settings },
  ];

  return (
    <aside className="flex w-56 shrink-0 flex-col border-r border-zinc-800/80 bg-zinc-950">
      <div className="flex h-14 items-center px-4 text-zinc-50">
        <Wordmark markClassName="size-5" />
      </div>
      <nav aria-label="Main" className="flex-1 space-y-0.5 px-2">
        {items.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) =>
              cn(
                "flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition-colors",
                isActive
                  ? "bg-zinc-800/80 text-zinc-50"
                  : "text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100",
              )
            }
          >
            <item.icon className="size-4 shrink-0" aria-hidden />
            <span className="flex-1">{item.label}</span>
            {item.count !== undefined ? <CountBadge count={item.count} /> : null}
          </NavLink>
        ))}
      </nav>
      <div className="px-4 py-3 text-[11px] text-zinc-600">
        <House className="mr-1 inline size-3" aria-hidden />
        Hevy for LeetCode
      </div>
    </aside>
  );
}
