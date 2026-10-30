import { cn } from "@lare/ui";
import { Emblem } from "@lare/ui/brand";
import {
  Check,
  ChevronRight,
  LogOut,
  Monitor,
  Moon,
  PanelLeftClose,
  Settings,
  Sun,
  User,
} from "@lare/ui/icons";
import { useEffect, useRef, useState } from "react";
import { NavLink, useNavigate } from "react-router";
import { Avatar } from "@/components/ui/Avatar";
import { CountBadge } from "@/components/ui/Badge";
import { useAuth } from "@/features/auth/AuthProvider";
import { useNotify } from "@/features/notifications/notices";
import { useUnreadNotificationCount } from "@/features/notifications/queries";
import { useDrafts } from "@/features/publishing/drafts/queries";
import { useFollowRequests } from "@/features/requests/queries";
import { errorMessage } from "@/lib/supabase";
import { type Theme, useTheme } from "@/lib/theme";
import { ExtensionStatus } from "./ExtensionStatus";
import { NAV_GROUPS, type NavItem } from "./nav";

const COLLAPSED_KEY = "lare-sidebar-collapsed";

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSED_KEY) === "1";
  } catch {
    return false;
  }
}

/** Medesk's nav row: no fill, the active page is simply brighter and heavier. */
const ROW = "relative flex items-center rounded-lg text-base transition-colors";
const ROW_EXPANDED = "h-11 gap-2.5 py-2.5 pr-2 pl-3";
const ROW_COLLAPSED = "size-11 justify-center";

function NavRow({
  item,
  count,
  collapsed,
}: {
  item: NavItem;
  count: number | undefined;
  collapsed: boolean;
}) {
  return (
    <NavLink
      to={item.to}
      end={item.end}
      title={collapsed ? item.label : undefined}
      aria-label={collapsed ? item.label : undefined}
      className={({ isActive }) =>
        cn(
          ROW,
          collapsed ? ROW_COLLAPSED : ROW_EXPANDED,
          "lare-press",
          isActive
            ? "font-medium text-[var(--text)]"
            : "text-[var(--text-tertiary)] hover:text-[var(--text)]",
        )
      }
    >
      <item.icon className="size-5 shrink-0" aria-hidden />
      {collapsed ? null : <span className="flex-1 truncate">{item.label}</span>}
      {count !== undefined && count > 0 ? (
        collapsed ? (
          <span
            aria-hidden
            className="absolute top-1.5 right-1.5 size-2 rounded-full bg-[var(--accent)]"
          />
        ) : (
          <CountBadge count={count} />
        )
      ) : null}
    </NavLink>
  );
}

function NavSection({
  label,
  items,
  counts,
  collapsed,
  collapsible,
}: {
  label: string;
  items: NavItem[];
  counts: Partial<Record<string, number>>;
  collapsed: boolean;
  collapsible: boolean;
}) {
  const [open, setOpen] = useState(true);
  const expanded = !collapsible || open || collapsed;
  const labelClass =
    "flex h-7 w-full items-center justify-between text-[1.0625rem] font-normal text-[color-mix(in_oklab,var(--text)_70%,transparent)]";

  return (
    <section aria-label={label} className="space-y-1">
      {collapsed ? null : collapsible ? (
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
          className={cn(labelClass, "transition-colors hover:text-[var(--text)]")}
        >
          <span>{label}</span>
          <ChevronRight
            className={cn("size-4 transition-transform", open && "rotate-90")}
            aria-hidden
          />
        </button>
      ) : (
        <h2 className={labelClass}>{label}</h2>
      )}
      {expanded
        ? items.map((item) => (
            <NavRow key={item.to} item={item} count={counts[item.to]} collapsed={collapsed} />
          ))
        : null}
    </section>
  );
}

const THEME_OPTIONS: Array<{ value: Theme; label: string; icon: typeof Sun }> = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: Monitor },
];

const MENU_ITEM =
  "lare-press flex w-full items-center gap-2.5 rounded-md px-2.5 py-2.5 text-left text-sm text-[var(--text)] hover:bg-[var(--surface-sunken)] focus-visible:bg-[var(--surface-sunken)] focus-visible:outline-none disabled:opacity-50";

function AccountMenu({ collapsed }: { collapsed: boolean }) {
  const { profile, signOut } = useAuth();
  const { theme, setTheme } = useTheme();
  const { notify } = useNotify();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  const name = profile?.display_name ?? (profile?.handle ? `@${profile.handle}` : "You");

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const go = (to: string) => {
    setOpen(false);
    void navigate(to);
  };

  const doSignOut = async () => {
    setSigningOut(true);
    try {
      await signOut();
    } catch (err) {
      notify({ title: "Couldn't sign out", description: errorMessage(err), variant: "error" });
      setSigningOut(false);
    }
  };

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Account menu, ${name}`}
        title={collapsed ? name : undefined}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          ROW,
          collapsed ? ROW_COLLAPSED : "h-11 w-full gap-2.5 py-2.5 pr-2",
          "text-[var(--text-tertiary)] hover:text-[var(--text)] data-[open=true]:text-[var(--text)]",
        )}
        data-open={open}
      >
        <Avatar
          url={profile?.avatar_url}
          name={name}
          size={28}
          className="border border-[color-mix(in_oklab,var(--border)_50%,transparent)]"
        />
        {collapsed ? null : <span className="min-w-0 flex-1 truncate text-left">{name}</span>}
      </button>
      {open ? (
        <div
          role="menu"
          aria-label="Account"
          className={cn(
            "lare-material-regular lare-dropdown absolute bottom-full left-0 z-30 mb-2 w-60 origin-bottom-left rounded-xl border border-[var(--border)] p-1 shadow-[var(--lare-shadow-2)]",
          )}
        >
          <div className="px-2.5 py-2">
            <p className="truncate text-sm font-medium text-[var(--text)]">{name}</p>
            {profile?.handle ? (
              <p className="truncate text-xs text-[var(--text-tertiary)]">@{profile.handle}</p>
            ) : null}
          </div>
          <hr className="my-1 h-px border-0 bg-[var(--border)]" />
          <p className="px-2.5 pt-1 pb-0.5 text-xs text-[var(--text-tertiary)]">Appearance</p>
          {THEME_OPTIONS.map(({ value, label, icon: Icon }) => (
            <button
              key={value}
              type="button"
              role="menuitemradio"
              aria-checked={theme === value}
              className={MENU_ITEM}
              onClick={() => setTheme(value)}
            >
              <Icon className="size-4 text-[var(--text-tertiary)]" aria-hidden />
              <span className="flex-1">{label}</span>
              {theme === value ? <Check className="size-4" aria-hidden /> : null}
            </button>
          ))}
          <hr className="my-1 h-px border-0 bg-[var(--border)]" />
          <button
            type="button"
            role="menuitem"
            className={MENU_ITEM}
            onClick={() => go("/profile")}
          >
            <User className="size-4 text-[var(--text-tertiary)]" aria-hidden />
            Profile
          </button>
          <button
            type="button"
            role="menuitem"
            className={MENU_ITEM}
            onClick={() => go("/settings")}
          >
            <Settings className="size-4 text-[var(--text-tertiary)]" aria-hidden />
            Settings
          </button>
          <hr className="my-1 h-px border-0 bg-[var(--border)]" />
          <button
            type="button"
            role="menuitem"
            disabled={signingOut}
            className={cn(MENU_ITEM, "text-[var(--lare-danger)]")}
            onClick={() => void doSignOut()}
          >
            <LogOut className="size-4" aria-hidden />
            Sign out
          </button>
        </div>
      ) : null}
    </div>
  );
}

export function Sidebar() {
  const drafts = useDrafts();
  const requests = useFollowRequests();
  const unread = useUnreadNotificationCount();
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const counts: Partial<Record<string, number>> = {
    "/drafts": drafts.data?.length ?? 0,
    "/friends": requests.data?.length ?? 0,
    // What people did. The app's own alerts are toasts and never reach this badge.
    "/notifications": unread.data ?? 0,
  };

  const toggle = () =>
    setCollapsed((c) => {
      try {
        localStorage.setItem(COLLAPSED_KEY, c ? "0" : "1");
      } catch {
        // Not persisted; the rail still collapses for this session.
      }
      return !c;
    });

  return (
    <aside
      className={cn(
        "flex h-full shrink-0 flex-col bg-[var(--frame)] text-[var(--text)] transition-[width] duration-200 ease-out",
        collapsed ? "w-[5.125rem]" : "w-[17.25rem]",
      )}
    >
      {/* Same 8px inset as the content panel, so this row centres on the topbar's. The macOS
          traffic lights sit above the wordmark, not beside it. */}
      <div data-tauri-drag-region className="h-2 shrink-0" />
      <div
        data-tauri-drag-region
        className={cn(
          "flex h-16 shrink-0 items-center gap-3",
          collapsed ? "justify-center" : "justify-between px-4",
        )}
      >
        {collapsed ? null : (
          <div className="flex items-center gap-2">
            <Emblem className="size-6" />
            {/* The word and the version share one baseline; the emblem would drag it down. */}
            <span className="flex items-baseline gap-1.5">
              <span className="text-xl font-medium tracking-tight">Lare</span>
              <span className="lare-micro leading-none text-[var(--text-tertiary)]">
                v{__APP_VERSION__}
              </span>
            </span>
          </div>
        )}
        <button
          type="button"
          onClick={toggle}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className="lare-press inline-flex size-9 items-center justify-center rounded-lg text-[var(--text-tertiary)] hover:bg-[var(--surface-sunken)] hover:text-[var(--text)]"
        >
          <PanelLeftClose
            className={cn("size-5 transition-transform", collapsed && "rotate-180")}
            aria-hidden
          />
        </button>
      </div>

      <nav
        aria-label="Main"
        className={cn(
          "min-h-0 flex-1 space-y-3 overflow-y-auto py-3",
          collapsed ? "flex flex-col items-center" : "px-4",
        )}
      >
        {NAV_GROUPS.map((group) => (
          <NavSection
            key={group.label}
            label={group.label}
            items={group.items}
            counts={counts}
            collapsed={collapsed}
            collapsible={group.label !== "Overview"}
          />
        ))}
      </nav>

      <div className={cn("flex shrink-0 flex-col py-3", collapsed ? "items-center" : "px-4")}>
        <ExtensionStatus collapsed={collapsed} />
        <AccountMenu collapsed={collapsed} />
      </div>
    </aside>
  );
}
