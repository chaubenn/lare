import { Button, FieldError } from "@lare/ui/primitives";
import { useEffect, useState } from "react";
import { Spinner } from "@/components/ui/States";
import { errorMessage } from "@/lib/errors";
import type { RecorderSettings } from "@/lib/recorder";
import {
  captureAccelerator,
  DEFAULT_CAMERA_SHORTCUT,
  DEFAULT_PILL_SHORTCUT,
  describeAccelerator,
  isMac,
} from "@/lib/shortcuts";
import { SubSection, useSettingsPatch } from "./shared";

type ShortcutKey = "pillShortcut" | "cameraShortcut";

const SHORTCUTS: { key: ShortcutKey; label: string; fallback: string; other: ShortcutKey }[] = [
  {
    key: "pillShortcut",
    label: "Recorder pill",
    fallback: DEFAULT_PILL_SHORTCUT,
    other: "cameraShortcut",
  },
  {
    key: "cameraShortcut",
    label: "Facecam",
    fallback: DEFAULT_CAMERA_SHORTCUT,
    other: "pillShortcut",
  },
];

/** The keys a setting stands for: its default when unset, nothing when turned off. */
function effective(settings: RecorderSettings, key: ShortcutKey): string | null {
  const saved = settings[key];
  const fallback = SHORTCUTS.find((s) => s.key === key)?.fallback ?? null;
  return saved === "" ? null : (saved ?? fallback);
}

function Keycaps({ accelerator }: { accelerator: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      {describeAccelerator(accelerator, isMac).map((cap) => (
        <kbd
          key={cap}
          className="rounded border border-zinc-700 bg-zinc-800 px-1.5 py-0.5 font-mono text-xs text-zinc-200"
        >
          {cap}
        </kbd>
      ))}
    </span>
  );
}

export function ShortcutsSection() {
  const { settings, save } = useSettingsPatch();
  const [capturing, setCapturing] = useState<ShortcutKey | null>(null);
  const [rejection, setRejection] = useState<{ key: ShortcutKey; reason: string } | null>(null);

  useEffect(() => {
    if (!capturing || !settings.data) return;
    const data = settings.data;
    const other = SHORTCUTS.find((s) => s.key === capturing)?.other;
    const onKeyDown = (e: KeyboardEvent) => {
      // Everything typed while choosing is the choice, never a command for the page.
      e.preventDefault();
      e.stopPropagation();
      if (e.code === "Escape") {
        setCapturing(null);
        setRejection(null);
        return;
      }
      const result = captureAccelerator(e, isMac);
      if (result.kind === "pending") return;
      if (result.kind === "rejected") {
        setRejection({ key: capturing, reason: result.reason });
        return;
      }
      if (other && effective(data, other) === result.value) {
        setRejection({
          key: capturing,
          reason: `Already used for the ${other === "pillShortcut" ? "recorder pill" : "facecam"}.`,
        });
        return;
      }
      setCapturing(null);
      setRejection(null);
      save({ [capturing]: result.value });
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [capturing, settings.data, save]);

  return (
    <SubSection title="Shortcuts" description="Hide and show these while recording.">
      {settings.isPending ? (
        <Spinner className="py-4" label="Loading recording settings…" />
      ) : settings.isError ? (
        <FieldError>{errorMessage(settings.error)}</FieldError>
      ) : (
        <div className="space-y-3">
          {SHORTCUTS.map(({ key, label }) => {
            const saved = settings.data?.[key] ?? null;
            const keys = settings.data ? effective(settings.data, key) : null;
            const isCapturing = capturing === key;
            const pick = (value: string | null) => {
              setCapturing(null);
              setRejection(null);
              save({ [key]: value });
            };
            return (
              <div key={key}>
                <div className="flex flex-wrap items-center gap-3">
                  <span className="w-28 shrink-0 text-sm text-zinc-300">{label}</span>
                  <div className="flex min-h-8 min-w-40 items-center text-sm text-zinc-300">
                    {isCapturing ? (
                      <span className="text-zinc-400">Press keys… (Esc to cancel)</span>
                    ) : keys ? (
                      <Keycaps accelerator={keys} />
                    ) : (
                      <span className="text-[var(--text-tertiary)]">Off</span>
                    )}
                  </div>
                  <Button
                    size="sm"
                    variant={isCapturing ? "primary" : "secondary"}
                    onClick={() => {
                      setRejection(null);
                      setCapturing(isCapturing ? null : key);
                    }}
                  >
                    {isCapturing ? "Cancel" : "Change"}
                  </Button>
                  {saved !== null ? (
                    <Button size="sm" variant="ghost" onClick={() => pick(null)}>
                      Reset
                    </Button>
                  ) : null}
                  {keys ? (
                    <Button size="sm" variant="ghost" onClick={() => pick("")}>
                      Turn off
                    </Button>
                  ) : null}
                </div>
                {rejection?.key === key ? <FieldError>{rejection.reason}</FieldError> : null}
              </div>
            );
          })}
        </div>
      )}
    </SubSection>
  );
}
