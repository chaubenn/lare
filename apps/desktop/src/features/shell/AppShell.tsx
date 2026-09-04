import { useEffect } from "react";
import { Outlet, useNavigate } from "react-router";
import { useDraftsRealtime } from "@/features/drafts/queries";
import { JobsTray } from "@/features/recording/JobsTray";
import { useRecordingEvents } from "@/features/recording/useRecordingEvents";
import { Sidebar } from "./Sidebar";
import { StatusFooter } from "./StatusFooter";

/** Cmd/Ctrl + digit jumps between sections (same order as the sidebar). */
const SECTION_SHORTCUTS = [
  "/",
  "/drafts",
  "/sessions",
  "/recordings",
  "/profile",
  "/friends",
  "/settings",
];

export function AppShell() {
  const navigate = useNavigate();
  useDraftsRealtime();
  useRecordingEvents();

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.shiftKey || e.altKey) return;
      const index = Number.parseInt(e.key, 10) - 1;
      const target = SECTION_SHORTCUTS[index];
      if (target === undefined) return;
      e.preventDefault();
      void navigate(target);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [navigate]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex min-h-0 flex-1">
        <Sidebar />
        <main className="min-w-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-4xl px-8 py-8">
            <Outlet />
          </div>
        </main>
      </div>
      <JobsTray />
      <StatusFooter />
    </div>
  );
}
