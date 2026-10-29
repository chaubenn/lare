import { useEffect, useState } from "react";
import { Outlet, useMatches, useNavigate } from "react-router";
import { useLocalCopyCleanup } from "@/features/media/localCopies";
import { useRecordingEvents } from "@/features/media/useRecordingEvents";
import { useNotificationStream } from "@/features/notifications/queries";
import { useNoticeSources } from "@/features/notifications/sources";
import { useDraftsRealtime } from "@/features/publishing/drafts/queries";
import { CommandPalette } from "./CommandPalette";
import { NAV_ITEMS } from "./nav";
import { PageActionsSlot } from "./PageActions";
import { Sidebar } from "./Sidebar";
import { StatusFooter } from "./StatusFooter";

export function AppShell() {
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
    <div className="flex h-full">
      <Sidebar />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div data-tauri-drag-region className="h-8 shrink-0" />
        <main className="min-h-0 flex-1 overflow-y-auto">
          <div
            className={fullWidth ? "w-full px-5 py-5" : "mx-auto w-full max-w-[1360px] px-5 py-5"}
          >
            <Outlet />
          </div>
        </main>
        <PageActionsSlot />
        <StatusFooter />
      </div>
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
    </div>
  );
}
