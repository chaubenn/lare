import {
  Bell,
  type IconComponent,
  Inbox,
  Rss,
  Settings,
  SquarePen,
  Trophy,
  User,
  Users,
} from "@lare/ui/icons";
import { routePrefixes, routes } from "@/lib/routes";

export interface NavItem {
  to: string;
  label: string;
  icon: IconComponent;
  /**
   * Accelerator shown in the command palette only — the sidebar deliberately does
   * not show it, and the palette draws it as ⌘N or Ctrl+N. The binding itself is
   * positional (⌘N picks NAV_ITEMS[N - 1] in AppShell), so reordering this list
   * reassigns the shortcuts.
   */
  shortcut: string;
  end?: boolean;
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

/**
 * Sidebar sections. The groups are contiguous slices of one ordered list, so the positional
 * ⌘N bindings (NAV_ITEMS[N - 1]) read top to bottom exactly as the sidebar does.
 */
export const NAV_GROUPS: NavGroup[] = [
  {
    label: "Overview",
    items: [{ to: routes.feed, label: "Feed", icon: Rss, shortcut: "CmdOrCtrl+1", end: true }],
  },
  {
    label: "Create",
    items: [
      { to: routes.drafts, label: "Drafts", icon: SquarePen, shortcut: "CmdOrCtrl+2" },
      { to: routes.sessions, label: "Sessions", icon: Inbox, shortcut: "CmdOrCtrl+3" },
    ],
  },
  {
    label: "Community",
    items: [
      { to: routes.friends, label: "Friends", icon: Users, shortcut: "CmdOrCtrl+4" },
      { to: routes.leaderboard, label: "Leaderboard", icon: Trophy, shortcut: "CmdOrCtrl+5" },
    ],
  },
  {
    label: "Account",
    items: [
      { to: routes.profile, label: "Profile", icon: User, shortcut: "CmdOrCtrl+6" },
      { to: routes.notifications, label: "Notifications", icon: Bell, shortcut: "CmdOrCtrl+7" },
      { to: routes.settings, label: "Settings", icon: Settings, shortcut: "CmdOrCtrl+8" },
    ],
  },
];

export const NAV_ITEMS: NavItem[] = NAV_GROUPS.flatMap((group) => group.items);

/** Routes that live under a sidebar section without being a section's own path. */
const SECTION_PREFIXES: Array<[prefix: string, to: string]> = [
  [routePrefixes.posts, routes.feed],
  [routePrefixes.users, routes.friends],
  [routes.legacyRequests, routes.friends],
];

/** The sidebar item a pathname belongs to (for the topbar title and the active state). */
export function navItemForPath(pathname: string): NavItem | undefined {
  const exact = NAV_ITEMS.find((item) =>
    item.to === routes.feed
      ? pathname === routes.feed
      : pathname === item.to || pathname.startsWith(`${item.to}/`),
  );
  if (exact) return exact;
  const section = SECTION_PREFIXES.find(([prefix]) => pathname.startsWith(prefix));
  return section ? NAV_ITEMS.find((item) => item.to === section[1]) : undefined;
}
