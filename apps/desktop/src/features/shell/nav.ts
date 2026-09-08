import {
  Clapperboard,
  Inbox,
  type LucideIcon,
  Rss,
  Settings,
  SquarePen,
  User,
  Users,
} from "lucide-react";

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  /**
   * Display label for the command palette only — the sidebar deliberately does
   * not show it. The binding itself is positional (⌘N picks NAV_ITEMS[N - 1] in
   * AppShell), so reordering this list reassigns the shortcuts.
   */
  shortcut: string;
  end?: boolean;
}

export const NAV_ITEMS: NavItem[] = [
  { to: "/", label: "Feed", icon: Rss, shortcut: "⌘1", end: true },
  { to: "/drafts", label: "Drafts", icon: SquarePen, shortcut: "⌘2" },
  { to: "/sessions", label: "Sessions", icon: Inbox, shortcut: "⌘3" },
  { to: "/recordings", label: "Recordings", icon: Clapperboard, shortcut: "⌘4" },
  { to: "/profile", label: "Profile", icon: User, shortcut: "⌘5" },
  { to: "/friends", label: "Friends", icon: Users, shortcut: "⌘6" },
  { to: "/settings", label: "Settings", icon: Settings, shortcut: "⌘7" },
];
