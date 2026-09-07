import { useEffect, useState } from "react";
import { Outlet, useNavigate } from "react-router";
import { useDraftsRealtime } from "@/features/drafts/queries";
import { JobsTray } from "@/features/recording/JobsTray";
import { useRecordingEvents } from "@/features/recording/useRecordingEvents";
import { CommandPalette } from "./CommandPalette";
import { NAV_ITEMS } from "./nav";
import { Sidebar } from "./Sidebar";
import { StatusFooter } from "./StatusFooter";
import { UpdateBanner } from "./UpdateBanner";

export function AppShell() {
  const navigate = useNavigate();
  const [paletteOpen, setPaletteOpen] = useState(false);
  useDraftsRealtime();
  useRecordingEvents();

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
        <UpdateBanner />
        <main className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-[1360px] px-5 py-5">
            <Outlet />
          </div>
        </main>
        <JobsTray />
        <StatusFooter />
      </div>
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
    </div>
  );
}
