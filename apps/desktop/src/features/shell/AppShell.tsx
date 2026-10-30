import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Outlet, useLocation, useMatches, useNavigate, useNavigationType } from "react-router";
import { useLocalCopyCleanup } from "@/features/media/localCopies";
import { useRecordingEvents } from "@/features/media/useRecordingEvents";
import { useNotificationStream } from "@/features/notifications/queries";
import { useNoticeSources } from "@/features/notifications/sources";
import { useDraftsRealtime } from "@/features/publishing/drafts/queries";
import { CommandPalette } from "./CommandPalette";
import { NAV_ITEMS } from "./nav";
import { PageActionsSlot } from "./PageActions";
import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";

/**
 * Where each history entry was scrolled to, by react-router location key. The app scrolls inside
 * `<main>` rather than the window, so the router's own scroll restoration never sees it.
 */
const scrollPositions = new Map<string, number>();

/**
 * Put `<main>` back where it was when you step back to a page, and at the top when you arrive on
 * a new one. A page that is still loading (a feed whose posts have not rendered yet) has no height
 * to scroll to, so keep trying as its content grows, and stop the moment the reader scrolls.
 */
function useScrollRestoration(main: React.RefObject<HTMLElement | null>) {
  const { key } = useLocation();
  const navigationType = useNavigationType();

  useLayoutEffect(() => {
    const el = main.current;
    if (!el) return;
    const target = navigationType === "POP" ? (scrollPositions.get(key) ?? 0) : 0;
    el.scrollTop = target;
    if (target === 0) return;

    const content = el.firstElementChild;
    const apply = () => {
      if (el.scrollHeight - el.clientHeight >= target) {
        el.scrollTop = target;
        stop();
      }
    };
    const observer = new ResizeObserver(apply);
    const timeout = window.setTimeout(stop, 3000);
    function stop() {
      observer.disconnect();
      window.clearTimeout(timeout);
      el?.removeEventListener("wheel", stop);
      el?.removeEventListener("touchstart", stop);
      el?.removeEventListener("keydown", stop);
    }
    if (content) observer.observe(content);
    el.addEventListener("wheel", stop, { passive: true });
    el.addEventListener("touchstart", stop, { passive: true });
    el.addEventListener("keydown", stop);
    return stop;
  }, [key, navigationType, main]);

  return (scrollTop: number) => scrollPositions.set(key, scrollTop);
}

export function AppShell() {
  const main = useRef<HTMLElement>(null);
  const rememberScroll = useScrollRestoration(main);
  const navigate = useNavigate();
  const [paletteOpen, setPaletteOpen] = useState(false);
  // Pages with their own side rail (the draft editor) start at the sidebar instead of centring.
  const fullWidth = useMatches().some(
    (match) => (match.handle as { fullWidth?: boolean } | undefined)?.fullWidth,
  );
  useDraftsRealtime();
  useNotificationStream();
  // Jobs, the updater and OS permissions all report to the Notifications page now.
  useNoticeSources();
  useRecordingEvents();
  useLocalCopyCleanup();

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.shiftKey || e.altKey) return;
      if (e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((open) => !open);
        return;
      }
      const index = Number.parseInt(e.key, 10) - 1;
      const target = NAV_ITEMS[index];
      if (!target) return;
      e.preventDefault();
      void navigate(target.to);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [navigate]);

  return (
    <div className="flex h-full bg-[var(--frame)]">
      <Sidebar />
      {/* Medesk's inset panel: the page sits on its own rounded surface inside the frame. */}
      <div className="flex min-w-0 flex-1 flex-col py-2 pr-2">
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl bg-[var(--surface)]">
          <Topbar onOpenSearch={() => setPaletteOpen(true)} />
          <main
            ref={main}
            onScroll={(e) => rememberScroll(e.currentTarget.scrollTop)}
            className="min-h-0 flex-1 overflow-y-auto"
          >
            <div
              className={
                fullWidth ? "w-full px-5 pt-3 pb-5" : "mx-auto w-full max-w-[1360px] px-5 pt-3 pb-5"
              }
            >
              <Outlet />
            </div>
          </main>
          <PageActionsSlot />
        </div>
      </div>
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
    </div>
  );
}
