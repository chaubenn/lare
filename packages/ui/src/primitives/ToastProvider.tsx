"use client";

import { CircleAlert, CircleCheck, Info, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from "react";
import { cn } from "../cn";
import { SPRING } from "../motion";
import { Button } from "./Button";

export type ToastVariant = "info" | "success" | "error";

export interface ToastOptions {
  title: string;
  description?: string;
  variant?: ToastVariant;
  /** ms; defaults to 4000 (errors 6000). */
  duration?: number;
}

interface ToastItem extends Required<Pick<ToastOptions, "title" | "variant">> {
  id: number;
  description?: string;
}

interface ToastApi {
  toast: (opts: ToastOptions) => void;
  success: (title: string, description?: string) => void;
  error: (title: string, description?: string) => void;
  dismiss: (id: number) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used inside <ToastProvider>");
  return ctx;
}

const ICONS: Record<ToastVariant, ReactNode> = {
  info: <Info className="size-4 text-[var(--lare-info)]" aria-hidden />,
  success: <CircleCheck className="size-4 text-[var(--text-secondary)]" aria-hidden />,
  error: <CircleAlert className="size-4 text-[var(--lare-danger)]" aria-hidden />,
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(1);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: number) => {
    const t = timers.current.get(id);
    if (t) clearTimeout(t);
    timers.current.delete(id);
    setItems((list) => list.filter((i) => i.id !== id));
  }, []);

  const toast = useCallback(
    (opts: ToastOptions) => {
      const id = nextId.current++;
      const variant = opts.variant ?? "info";
      const item: ToastItem = { id, title: opts.title, description: opts.description, variant };
      setItems((list) => [...list.slice(-3), item]);
      const duration = opts.duration ?? (variant === "error" ? 6000 : 4000);
      timers.current.set(
        id,
        setTimeout(() => dismiss(id), duration),
      );
    },
    [dismiss],
  );

  const api = useMemo<ToastApi>(
    () => ({
      toast,
      success: (title, description) => toast({ title, description, variant: "success" }),
      error: (title, description) => toast({ title, description, variant: "error" }),
      dismiss,
    }),
    [toast, dismiss],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed right-4 bottom-10 z-50 flex w-80 flex-col gap-2"
      >
        <AnimatePresence initial={false}>
          {items.map((item) => (
            <ToastCard key={item.id} item={item} onDismiss={() => dismiss(item.id)} />
          ))}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
}

function ToastCard({ item, onDismiss }: { item: ToastItem; onDismiss: () => void }) {
  const startX = useRef<number | null>(null);
  const last = useRef({ x: 0, t: 0 });

  return (
    <motion.div
      role="status"
      layout
      initial={{ opacity: 0, y: 16, scale: 0.97, filter: "blur(4px)" }}
      animate={{ opacity: 1, y: 0, scale: 1, filter: "blur(0px)" }}
      exit={{ opacity: 0, x: 48, filter: "blur(4px)" }}
      transition={SPRING.ui}
      drag="x"
      dragConstraints={{ left: 0, right: 160 }}
      dragElastic={0.12}
      onDragStart={(_, info) => {
        startX.current = info.point.x;
        last.current = { x: info.point.x, t: performance.now() };
      }}
      onDrag={(_, info) => {
        last.current = { x: info.point.x, t: performance.now() };
      }}
      onDragEnd={(_, info) => {
        const dt = Math.max(1, performance.now() - last.current.t);
        const vx = info.velocity.x;
        if (info.offset.x > 72 || vx > 600) onDismiss();
        void dt;
      }}
      className={cn(
        "lare-material-regular pointer-events-auto flex items-start gap-3 rounded-[var(--lare-r-4)] border p-3 shadow-[var(--lare-shadow-1)]",
        item.variant === "error"
          ? "border-[color-mix(in_oklab,var(--lare-danger)_30%,transparent)]"
          : "border-[var(--border)]",
      )}
    >
      <span className="mt-0.5">{ICONS[item.variant]}</span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-[var(--text)]">{item.title}</p>
        {item.description ? (
          <p className="mt-0.5 break-words text-xs text-[var(--text-secondary)]">
            {item.description}
          </p>
        ) : null}
      </div>
      <Button
        variant="ghost"
        size="icon"
        aria-label="Dismiss"
        tooltip="Dismiss"
        tooltipAlign="end"
        onClick={onDismiss}
      >
        <X className="size-4" aria-hidden />
      </Button>
    </motion.div>
  );
}
