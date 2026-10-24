import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { FieldError } from "@/components/ui/Field";
import { Spinner } from "@/components/ui/States";
import { captureAccelerator, DEFAULT_PILL_SHORTCUT, describeAccelerator } from "@/lib/shortcuts";
import { errorMessage } from "@/lib/supabase";
import { SubSection, useSettingsPatch } from "./shared";

const isMac = typeof navigator !== "undefined" && /Mac/i.test(navigator.platform);

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

export function PillShortcutSection() {
  const { settings, save } = useSettingsPatch();
  const [capturing, setCapturing] = useState(false);
  const [rejection, setRejection] = useState<string | null>(null);

  useEffect(() => {
    if (!capturing) return;
    const onKeyDown = (e: KeyboardEvent) => {
      // Everything typed while choosing is the choice, never a command for the page.
      e.preventDefault();
      e.stopPropagation();
      if (e.code === "Escape") {
        setCapturing(false);
        setRejection(null);
        return;
      }
      const result = captureAccelerator(e, isMac);
      if (result.kind === "pending") return;
      if (result.kind === "rejected") {
        setRejection(result.reason);
        return;
      }
      setCapturing(false);
      setRejection(null);
      save({ pillShortcut: result.value });
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [capturing, save]);

  const current = settings.data?.pillShortcut ?? null;
  const accelerator = current ?? DEFAULT_PILL_SHORTCUT;
  const off = current === "";

  return (
    <SubSection
      title="Hide the recorder pill"
      description="While a demo or mock interview is recording, this shortcut hides the pill and brings it back. Recording, the timer and the pill's position carry on untouched."
    >
      {settings.isPending ? (
        <Spinner className="py-4" label="Loading recording settings…" />
      ) : settings.isError ? (
        <FieldError>{errorMessage(settings.error)}</FieldError>
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex min-h-8 min-w-40 items-center text-sm text-zinc-300">
              {capturing ? (
                <span className="text-zinc-400">Press the new shortcut… (Esc to cancel)</span>
              ) : off ? (
                <span className="text-zinc-500">Off</span>
              ) : (
                <Keycaps accelerator={accelerator} />
              )}
            </div>
            <Button
              size="sm"
              variant={capturing ? "primary" : "secondary"}
              onClick={() => {
                setRejection(null);
                setCapturing((c) => !c);
              }}
            >
              {capturing ? "Cancel" : "Change"}
            </Button>
            {current !== null ? (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setCapturing(false);
                  setRejection(null);
                  save({ pillShortcut: null });
                }}
              >
                Reset to default
              </Button>
            ) : null}
            {!off ? (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setCapturing(false);
                  setRejection(null);
                  save({ pillShortcut: "" });
                }}
              >
                Turn off
              </Button>
            ) : null}
          </div>
          {rejection ? <FieldError>{rejection}</FieldError> : null}
          <p className="text-xs text-zinc-500">
            The default is {describeAccelerator(DEFAULT_PILL_SHORTCUT, isMac).join(" ")}. It is only
            claimed while a recording is running, so it never gets in the way of other apps the rest
            of the time.
          </p>
        </div>
      )}
    </SubSection>
  );
}
