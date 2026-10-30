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

export interface NavItem {
  to: string;
  label: string;
  icon: IconComponent;
  /**
   * Display label for the command palette only — the sidebar deliberately does
   * not show it. The binding itself is positional (⌘N picks NAV_ITEMS[N - 1] in
   * AppShell), so reordering this list reassigns the shortcuts.
   */
  shortcut: string;
  end?: boolean;
}

export interface NavGroup {
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
    items: [{ to: "/", label: "Feed", icon: Rss, shortcut: "⌘1", end: true }],
  },
  {
    label: "Create",
    items: [
      { to: "/drafts", label: "Drafts", icon: SquarePen, shortcut: "⌘2" },
      { to: "/sessions", label: "Sessions", icon: Inbox, shortcut: "⌘3" },
    ],
  },
  {
    label: "Community",
    items: [
      { to: "/friends", label: "Friends", icon: Users, shortcut: "⌘4" },
      { to: "/leaderboard", label: "Leaderboard", icon: Trophy, shortcut: "⌘5" },
    ],
  },
  {
    label: "Account",
    items: [
      { to: "/profile", label: "Profile", icon: User, shortcut: "⌘6" },
      { to: "/notifications", label: "Notifications", icon: Bell, shortcut: "⌘7" },
      { to: "/settings", label: "Settings", icon: Settings, shortcut: "⌘8" },
    ],
  },
];

export const NAV_ITEMS: NavItem[] = NAV_GROUPS.flatMap((group) => group.items);

/** Routes that live under a sidebar section without being a section's own path. */
const SECTION_PREFIXES: Array<[prefix: string, to: string]> = [
  ["/posts", "/"],
  ["/u/", "/friends"],
  ["/requests", "/friends"],
];

/** The sidebar item a pathname belongs to (for the topbar title and the active state). */
export function navItemForPath(pathname: string): NavItem | undefined {
  const exact = NAV_ITEMS.find((item) =>
    item.to === "/" ? pathname === "/" : pathname === item.to || pathname.startsWith(`${item.to}/`),
  );
  if (exact) return exact;
  const section = SECTION_PREFIXES.find(([prefix]) => pathname.startsWith(prefix));
  return section ? NAV_ITEMS.find((item) => item.to === section[1]) : undefined;
}
