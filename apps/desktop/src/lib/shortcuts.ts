/**
 * Accelerator strings for the recorder-pill shortcut, in the syntax Tauri's global-shortcut plugin
 * parses (`CommandOrControl+Space`, `Alt+Shift+H`). Kept free of React and Tauri so the capture and
 * display rules can be tested on their own.
 */

/** What the setting means when nothing has been chosen. `CommandOrControl` is Cmd on macOS. */
export const DEFAULT_PILL_SHORTCUT = "CommandOrControl+Space";

export interface KeyLike {
  code: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

const MODIFIER_CODES = /^(Meta|Control|Alt|Shift|OS)(Left|Right)$/;

/** `KeyboardEvent.code` values whose accelerator name is not just the code itself. */
const NAMED_KEYS: Record<string, string> = {
  Space: "Space",
  Enter: "Enter",
  Tab: "Tab",
  Backspace: "Backspace",
  Delete: "Delete",
  Insert: "Insert",
  Home: "Home",
  End: "End",
  PageUp: "PageUp",
  PageDown: "PageDown",
  ArrowUp: "Up",
  ArrowDown: "Down",
  ArrowLeft: "Left",
  ArrowRight: "Right",
  Minus: "-",
  Equal: "=",
  Comma: ",",
  Period: ".",
  Slash: "/",
  Semicolon: ";",
  Quote: "'",
  Backquote: "`",
  BracketLeft: "[",
  BracketRight: "]",
  Backslash: "\\",
};

function keyName(code: string): string | null {
  if (MODIFIER_CODES.test(code)) return null;
  const letter = /^Key([A-Z])$/.exec(code);
  if (letter) return letter[1] ?? null;
  const digit = /^Digit([0-9])$/.exec(code);
  if (digit) return digit[1] ?? null;
  if (/^F([1-9]|1[0-9]|2[0-4])$/.test(code)) return code;
  return NAMED_KEYS[code] ?? null;
}

export type CaptureResult =
  | { kind: "pending" }
  | { kind: "rejected"; reason: string }
  | { kind: "accelerator"; value: string };

/**
 * Turns the key press the user just made into an accelerator. Pressing a modifier on its own is
 * `pending` (they are still building the chord). A chord needs a non-Shift modifier so a global
 * shortcut can never swallow ordinary typing; function keys are the one exception.
 */
export function captureAccelerator(e: KeyLike, mac: boolean): CaptureResult {
  const key = keyName(e.code);
  if (key === null) {
    return MODIFIER_CODES.test(e.code)
      ? { kind: "pending" }
      : { kind: "rejected", reason: "That key can't be used in a shortcut." };
  }
  const mods: string[] = [];
  if (e.metaKey) mods.push(mac ? "Command" : "Super");
  if (e.ctrlKey) mods.push("Control");
  if (e.altKey) mods.push("Alt");
  const hasChordModifier = mods.length > 0;
  if (e.shiftKey) mods.push("Shift");
  if (!hasChordModifier && !/^F\d+$/.test(key)) {
    return {
      kind: "rejected",
      reason: `Hold ${mac ? "⌘, ⌃ or ⌥" : "Ctrl or Alt"} together with the key.`,
    };
  }
  return { kind: "accelerator", value: [...mods, key].join("+") };
}

const MAC_SYMBOLS: Record<string, string> = {
  commandorcontrol: "⌘",
  cmdorctrl: "⌘",
  command: "⌘",
  cmd: "⌘",
  super: "⌘",
  meta: "⌘",
  control: "⌃",
  ctrl: "⌃",
  alt: "⌥",
  option: "⌥",
  shift: "⇧",
};

const OTHER_NAMES: Record<string, string> = {
  commandorcontrol: "Ctrl",
  cmdorctrl: "Ctrl",
  command: "Win",
  cmd: "Win",
  super: "Win",
  meta: "Win",
  control: "Ctrl",
  ctrl: "Ctrl",
  alt: "Alt",
  option: "Alt",
  shift: "Shift",
};

/** The keycaps to draw for an accelerator on this platform, e.g. `["⌘", "Space"]`. */
export function describeAccelerator(accelerator: string, mac: boolean): string[] {
  const names = mac ? MAC_SYMBOLS : OTHER_NAMES;
  return accelerator
    .split("+")
    .filter((part) => part.length > 0)
    .map((part) => names[part.toLowerCase()] ?? (part.length === 1 ? part.toUpperCase() : part));
}
