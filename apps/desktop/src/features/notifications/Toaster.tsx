import { cn, SPRING } from "@lare/ui";
import { CircleAlert, CircleCheck, Info, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import { Link } from "react-router";
import { dismissNotice, type Notice, useNotices } from "./notices";

/** Errors stay long enough to read the reason; the rest are confirmations. */
const LIFETIME_MS = { info: 5_000, success: 4_000, error: 8_000 } as const;

const TONE_ICON = {
  info: <Info className="size-4 shrink-0 text-[var(--lare-info)]" aria-hidden />,
  success: <CircleCheck className="size-4 shrink-0 text-[var(--lare-status-run)]" aria-hidden />,
  error: <CircleAlert className="size-4 shrink-0 text-[var(--lare-danger)]" aria-hidden />,
};

/**
 * The app's own alerts, stacked in the top-right corner under the title bar. Mounted once at the
 * root so a notice raised on the login screen shows as well as one raised in the shell.
 */
export function Toaster() {
  const notices = useNotices();
  return (
    <section
      aria-label="Alerts"
      className="pointer-events-none fixed top-10 right-4 z-50 flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-2"
    >
      <AnimatePresence initial={false}>
        {notices.map((notice) => (
          <Toast key={notice.id} notice={notice} />
        ))}
      </AnimatePresence>
    </section>
  );
}

function Toast({ notice }: { notice: Notice }) {
  const [paused, setPaused] = useState(false);

  // Restarts when the notice is raised again (createdAt moves) or the pointer leaves.
  // biome-ignore lint/correctness/useExhaustiveDependencies: createdAt is the restart signal
  useEffect(() => {
    if (paused) return;
    const timer = window.setTimeout(() => dismissNotice(notice.id), LIFETIME_MS[notice.tone]);
    return () => window.clearTimeout(timer);
  }, [notice.id, notice.tone, notice.createdAt, paused]);

  const body = (
    <>
      <span className="mt-0.5">{TONE_ICON[notice.tone]}</span>
      <div className="min-w-0 flex-1">
        <p className="text-sm text-[var(--text)]">{notice.title}</p>
        {notice.description ? (
          <p className="mt-0.5 select-text text-xs text-[var(--text-tertiary)]">
            {notice.description}
          </p>
        ) : null}
      </div>
    </>
  );
  const row = "flex min-w-0 flex-1 items-start gap-3 py-3 pl-4";

  return (
    <motion.div
      layout
      role={notice.tone === "error" ? "alert" : "status"}
      initial={{ opacity: 0, x: 24 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 24, transition: { duration: 0.15 } }}
      transition={SPRING.ui}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
      className={cn(
        "lare-material-regular pointer-events-auto flex items-start overflow-hidden rounded-[var(--lare-r-3)] border shadow-[var(--lare-shadow-2)]",
        notice.tone === "error"
          ? "border-[color-mix(in_oklab,var(--lare-danger)_40%,var(--border))]"
          : "border-[var(--border)]",
      )}
    >
      {notice.href ? (
        <Link
          to={notice.href}
          onClick={() => dismissNotice(notice.id)}
          className={cn(row, "transition-colors hover:bg-[var(--surface-raised)]")}
        >
          {body}
        </Link>
      ) : (
        <div className={row}>{body}</div>
      )}
      <button
        type="button"
        aria-label={`Dismiss: ${notice.title}`}
        title="Dismiss"
        onClick={() => dismissNotice(notice.id)}
        className="m-2 shrink-0 rounded p-1 text-[var(--text-tertiary)] transition-colors hover:text-[var(--text)]"
      >
        <X className="size-3.5" aria-hidden />
      </button>
    </motion.div>
  );
}
