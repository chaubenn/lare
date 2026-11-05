import { ArrowLeft, Command, Search } from "@lare/ui/icons";
import { useLocation } from "react-router";
import { useOnline } from "@/lib/queryClient";
import { useGoBack } from "@/lib/useGoBack";
import { navItemForPath } from "./nav";
import { TopbarBlurbSlot } from "./PageBlurb";
import { drawsWindowControls, WindowControls } from "./WindowControls";

const isMac = typeof navigator !== "undefined" && /Mac/i.test(navigator.platform);

/**
 * Medesk's header: the page's name on the left and quick search on the right. It is the only
 * place a section is named. On a page inside a section (a post, a draft, a session) it also holds
 * the way back, as an arrow ahead of the name.
 */
export function Topbar({ onOpenSearch }: { onOpenSearch: () => void }) {
  const { pathname } = useLocation();
  const page = navItemForPath(pathname);
  const goBack = useGoBack(page?.to ?? "/");
  const isDetail = Boolean(page) && pathname !== page?.to;

  return (
    <header
      data-tauri-drag-region
      className="flex h-16 shrink-0 items-center justify-between gap-4 px-5"
    >
      <div className="flex min-w-0 items-center gap-4">
        {isDetail ? (
          <button
            type="button"
            onClick={goBack}
            aria-label={`Back to ${page?.label}`}
            title="Back"
            className="lare-press -ml-2 inline-flex size-9 shrink-0 items-center justify-center rounded-[var(--lare-r-2)] text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface-sunken)] hover:text-[var(--text)]"
          >
            <ArrowLeft className="size-5" aria-hidden />
          </button>
        ) : null}
        <div className="flex h-6 min-w-0 items-center gap-3 text-[var(--text)]">
          {page ? <page.icon className="size-4 shrink-0" aria-hidden /> : null}
          <span className="truncate text-lg leading-6.5 font-medium">{page?.label ?? "Lare"}</span>
        </div>
        <TopbarBlurbSlot />
      </div>

      <div className="flex shrink-0 items-center gap-3">
        <OfflineBadge />
        <button
          type="button"
          onClick={onOpenSearch}
          aria-label="Search and run commands"
          className="lare-press flex h-9 w-69 shrink-0 items-center gap-2 rounded-[var(--lare-r-2)] bg-[var(--surface-sunken)] py-1 pr-2 pl-2.5 text-left text-xs text-[var(--text-tertiary)] transition-colors hover:text-[var(--text-secondary)]"
        >
          <Search className="size-3 shrink-0" aria-hidden />
          <span className="flex-1 truncate px-1">Search pages and actions…</span>
          <span className="flex h-6 items-center justify-center gap-1 rounded-md bg-[var(--surface)] px-1.5">
            {isMac ? (
              <Command className="size-3" aria-hidden />
            ) : (
              <span className="text-xs leading-none">Ctrl</span>
            )}
            <span className="text-xs leading-none">K</span>
          </span>
        </button>
        {drawsWindowControls ? <WindowControls /> : null}
      </div>
    </header>
  );
}

/**
 * Shown only while the OS reports no connection, so a failed save or an error panel has an obvious
 * cause. Lists keep what they last loaded and refresh by themselves once the network is back.
 */
function OfflineBadge() {
  const online = useOnline();
  if (online) return null;
  return (
    <output
      title="Showing what was last loaded. Lare refreshes once you're back online."
      className="inline-flex h-7 items-center gap-2 rounded-full bg-[var(--surface-sunken)] px-3 text-xs text-[var(--text-secondary)]"
    >
      <span aria-hidden className="size-1.5 rounded-full bg-[var(--lare-status-stop)]" />
      Offline
    </output>
  );
}
