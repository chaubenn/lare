import { useQuery } from "@tanstack/react-query";
import { relaunch } from "@tauri-apps/plugin-process";
import { RotateCcw } from "lucide-react";
import { type ReactNode, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { PageSpinner } from "@/components/ui/States";
import { WindowScreen } from "@/components/ui/WindowScreen";
import { usePermissions, useRecorderSettings, useWhisperModels } from "@/features/media/hooks";
import { PermissionsSection } from "@/features/settings/recording/PermissionsSection";
import { SpeechModelSection } from "@/features/settings/recording/SpeechModelSection";
import { appVersion, inTauri } from "@/lib/tauri";

const DISMISSED_KEY = "lare:setup-dismissed-version";

function dismissedVersion(): string | null {
  try {
    return localStorage.getItem(DISMISSED_KEY);
  } catch {
    return null;
  }
}

/**
 * First launch, and again after an update while something is still missing: macOS ties capture
 * permissions to the app's signature, so an update can quietly revoke them. Skipping is remembered
 * per app version, so the step never nags twice for the same build.
 */
export function SetupGate({ children }: { children: ReactNode }) {
  const version = useQuery({
    queryKey: ["app-version"],
    enabled: inTauri,
    queryFn: appVersion,
    staleTime: Number.POSITIVE_INFINITY,
  });
  const permissions = usePermissions();
  const models = useWhisperModels();
  const settings = useRecorderSettings();
  const [dismissed, setDismissed] = useState(dismissedVersion);

  if (!inTauri) return children;
  // Never lock someone out of the app because a status check failed.
  if (version.isError || permissions.isError || models.isError || settings.isError) return children;
  if (!version.data || !permissions.data || !models.data || !settings.data)
    return <PageSpinner label="Checking recording setup…" />;
  if (dismissed === version.data) return children;

  const missingPermission = Object.values(permissions.data).some(
    (status) => status !== "granted" && status !== "not_applicable",
  );
  const selected = settings.data.whisperModel ?? "small-en";
  const missingModel = !models.data.some((m) => m.kind === selected && m.downloaded);
  if (!missingPermission && !missingModel) return children;

  const done = () => {
    try {
      localStorage.setItem(DISMISSED_KEY, version.data);
    } catch {
      // Storage unavailable: the step simply shows again next launch.
    }
    setDismissed(version.data);
  };
  return <SetupPage onDone={done} macOs={permissions.data.screenRecording !== "not_applicable"} />;
}

function SetupPage({ onDone, macOs }: { onDone: () => void; macOs: boolean }) {
  return (
    <WindowScreen className="max-w-xl space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Set up recording</h1>
        <p className="mt-1 text-sm text-zinc-400">
          Lare needs your permission to record demos and mock interviews, and a local speech model
          to transcribe them. Anything you skip can be done later in Settings → Recording.
        </p>
      </div>
      <Card>
        <div className="space-y-5">
          <PermissionsSection />
          <SpeechModelSection />
        </div>
      </Card>
      <div className="flex flex-wrap items-center justify-between gap-3">
        {macOs ? (
          <Button
            variant="ghost"
            icon={<RotateCcw className="size-4" aria-hidden />}
            onClick={() => void relaunch()}
          >
            Quit &amp; reopen Lare
          </Button>
        ) : (
          <span />
        )}
        <div className="flex gap-2">
          <Button variant="ghost" onClick={onDone}>
            Skip for now
          </Button>
          <Button variant="primary" onClick={onDone}>
            Done
          </Button>
        </div>
      </div>
    </WindowScreen>
  );
}
