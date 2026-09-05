import { cn } from "@lare/ui";
import { CircleAlert, CircleCheck, Info, X } from "lucide-react";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from "react";
import { Tooltip } from "@/components/ui/Tooltip";

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
  info: <Info className="size-4 text-sky-400" aria-hidden />,
  success: <CircleCheck className="size-4 text-zinc-300" aria-hidden />,
  error: <CircleAlert className="size-4 text-rose-400" aria-hidden />,
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
        {items.map((item) => (
          <div
            key={item.id}
            role="status"
            className={cn(
              "lare-toast-in pointer-events-auto flex items-start gap-3 rounded-xl border bg-zinc-900 p-3 shadow-lg shadow-black/40",
              item.variant === "error" ? "border-rose-500/30" : "border-zinc-800",
            )}
          >
            <span className="mt-0.5">{ICONS[item.variant]}</span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-zinc-100">{item.title}</p>
              {item.description ? (
                <p className="mt-0.5 break-words text-xs text-zinc-400">{item.description}</p>
              ) : null}
            </div>
            <Tooltip label="Dismiss" align="end">
              <button
                type="button"
                aria-label="Dismiss"
                onClick={() => dismiss(item.id)}
                className="rounded p-0.5 text-zinc-500 hover:text-zinc-200"
              >
                <X className="size-4" aria-hidden />
              </button>
            </Tooltip>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
