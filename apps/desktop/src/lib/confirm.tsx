import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";

export interface ConfirmOptions {
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel?: string;
  /** Red confirm button, for deleting or clearing something. */
  destructive?: boolean;
}

interface Pending extends ConfirmOptions {
  resolve: (ok: boolean) => void;
}

let show: ((pending: Pending) => void) | null = null;

/**
 * Ask before doing something, in the app's own dialog rather than the system one, which on
 * Windows is a grey Win32 box that looks nothing like the app. Resolves `false` on Cancel,
 * Escape, the close button or a backdrop click. Needs `<ConfirmHost />` mounted once.
 */
export function confirm(options: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    if (!show) {
      resolve(window.confirm(options.message));
      return;
    }
    show({ ...options, resolve });
  });
}

export function ConfirmHost() {
  const [pending, setPending] = useState<Pending | null>(null);
  // The modal animates out after `open` drops, so keep the text until then.
  const [shown, setShown] = useState<Pending | null>(null);

  useEffect(() => {
    show = (next) => {
      setPending((prev) => {
        prev?.resolve(false);
        return next;
      });
      setShown(next);
    };
    return () => {
      show = null;
    };
  }, []);

  const settle = (ok: boolean) => {
    pending?.resolve(ok);
    setPending(null);
  };

  return (
    <Modal open={pending !== null} onClose={() => settle(false)} title={shown?.title ?? ""}>
      <p className="px-4 pt-4 text-sm text-pretty whitespace-pre-line text-[var(--text-secondary)]">
        {shown?.message}
      </p>
      <div className="flex justify-end gap-2 px-4 pt-5 pb-4">
        <Button variant="ghost" onClick={() => settle(false)}>
          {shown?.cancelLabel ?? "Cancel"}
        </Button>
        <Button variant={shown?.destructive ? "danger" : "primary"} onClick={() => settle(true)}>
          {shown?.confirmLabel}
        </Button>
      </div>
    </Modal>
  );
}
