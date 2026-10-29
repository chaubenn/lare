import { useEffect, useRef } from "react";

export interface Hotkey {
  key: string;
  /** Cmd on macOS, Ctrl elsewhere. */
  mod?: boolean;
  shift?: boolean;
}

function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable;
}

/**
 * Global keyboard shortcut. Shortcuts without a modifier are ignored while typing in a field so
 * plain letters never hijack text entry.
 */
export function useHotkey(hotkey: Hotkey, handler: (e: KeyboardEvent) => void): void {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;
  const { key, mod = false, shift = false } = hotkey;

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const modPressed = e.metaKey || e.ctrlKey;
      if (mod !== modPressed) return;
      if (shift !== e.shiftKey) return;
      if (e.key.toLowerCase() !== key.toLowerCase()) return;
      if (!mod && isEditable(e.target)) return;
      handlerRef.current(e);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [key, mod, shift]);
}
