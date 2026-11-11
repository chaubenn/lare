import { EXTENSION_ID, WS_PORT } from "@lare/shared";
import { LogOut, RefreshCw } from "@lare/ui/icons";
import { Badge, Button, Card, SectionTitle } from "@lare/ui/primitives";
import { useEffect, useState } from "react";
import { confirm } from "@/components/ui/Confirm";
import { useUser } from "@/features/auth/AuthProvider";
import { useSignOut } from "@/features/auth/useSignOut";
import { getJobs, isActive } from "@/features/media/jobs";
import { copyText } from "@/lib/clipboard";
import { notify } from "@/lib/notices";
import { recorder } from "@/lib/recorder";
import { appVersion, inTauri } from "@/lib/tauri";
import { checkForUpdate, installUpdate, useUpdateState } from "@/lib/updater";
import { useExtensionStatus } from "@/lib/useExtensionStatus";
import { NotificationsPanel } from "./NotificationsPanel";
import { RecordingPanel } from "./recording";

export function SettingsPage() {
  return (
    <div className="space-y-4">
      <ExtensionPanel />
      <RecordingPanel />
      <NotificationsPanel />
      <AccountPanel />
    </div>
  );
}

function ExtensionPanel() {
  const { connected, port } = useExtensionStatus();
  return (
    <Card>
      <SectionTitle
        action={connected ? <Badge tone="emerald">connected</Badge> : <Badge>not connected</Badge>}
      >
        Extension
      </SectionTitle>
      <dl className="grid gap-3 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-xs text-[var(--text-tertiary)]">Chrome extension id</dt>
          <dd className="mt-1 flex items-center gap-2">
            <code className="select-text font-mono text-xs text-zinc-200">{EXTENSION_ID}</code>
            <button
              type="button"
              className="text-xs text-[var(--text-tertiary)] hover:text-zinc-300"
              onClick={() =>
                void copyText(EXTENSION_ID).then((ok) =>
                  notify(ok ? { title: "Copied" } : { title: "Couldn't copy", variant: "error" }),
                )
              }
            >
              copy
            </button>
          </dd>
        </div>
        <div>
          <dt className="text-xs text-[var(--text-tertiary)]">Local server</dt>
          <dd className="mt-1 font-mono text-xs text-zinc-200">ws://127.0.0.1:{port || WS_PORT}</dd>
        </div>
      </dl>
      <p className="mt-3 text-xs text-[var(--text-tertiary)]">
        The extension stays connected over localhost while a LeetCode tab is open. Reload the
        extension on chrome://extensions and the LeetCode tab if this still says not connected.
      </p>
    </Card>
  );
}

function AccountPanel() {
  const { signingOut, signOut } = useSignOut();
  const { session } = useUser();
  const [version, setVersion] = useState<string>("…");

  useEffect(() => {
    let active = true;
    appVersion()
      .then((v) => {
        if (active) setVersion(v);
      })
      .catch(() => {
        if (active) setVersion("unknown");
      });
    return () => {
      active = false;
    };
  }, []);

  return (
    <Card>
      <SectionTitle>Account</SectionTitle>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm">
          <div className="text-zinc-200">{session.user.email ?? session.user.id}</div>
          <div className="mt-0.5 text-xs text-[var(--text-tertiary)]">Lare desktop v{version}</div>
        </div>
        <div className="flex items-center gap-2">
          <UpdateButton />
          <Button
            variant="danger"
            size="sm"
            icon={<LogOut className="size-3.5" aria-hidden />}
            onClick={() => void signOut()}
            loading={signingOut}
          >
            Sign out
          </Button>
        </div>
      </div>
      <UpdateStatusLine />
    </Card>
  );
}

/**
 * Installing relaunches Lare, which would cut off a recording in progress and stop any upload or
 * processing partway. Refuse while recording; ask first while something is still uploading.
 */
function useInstallUpdate() {
  return async () => {
    const status = await recorder.status().catch(() => null);
    if (status && status.state !== "idle" && status.state !== "error") {
      notify({
        title: "Finish your recording first",
        description: "Installing the update relaunches Lare, which would stop the recording.",
        variant: "error",
      });
      return;
    }
    const running = getJobs().filter(isActive);
    if (running.length > 0) {
      const ok = await confirm({
        title: "Install the update now?",
        message: `Lare is still busy with ${running
          .map((job) => job.label.charAt(0).toLowerCase() + job.label.slice(1))
          .join(
            ", ",
          )}. Updating now relaunches Lare and interrupts that work; you may need to retry it from the draft afterwards.`,
        confirmLabel: "Install and relaunch",
        destructive: true,
      });
      if (!ok) return;
    }
    await installUpdate();
  };
}

function UpdateButton() {
  const state = useUpdateState();
  const install = useInstallUpdate();
  if (!inTauri) return null;
  const busy =
    state.status === "checking" || state.status === "downloading" || state.status === "installing";
  if (state.status === "available") {
    return (
      <Button variant="primary" size="sm" onClick={() => void install()}>
        Install v{state.version}
      </Button>
    );
  }
  return (
    <Button
      size="sm"
      icon={<RefreshCw className="size-3.5" aria-hidden />}
      onClick={() => void checkForUpdate()}
      loading={busy}
    >
      Check for updates
    </Button>
  );
}

function UpdateStatusLine() {
  const state = useUpdateState();
  let text: string | null = null;
  let tone = "text-[var(--text-tertiary)]";
  switch (state.status) {
    case "up-to-date":
      text = "You're on the latest version.";
      break;
    case "available":
      text = `Lare v${state.version} is available.`;
      tone = "text-sky-300";
      break;
    case "downloading":
      text =
        state.progress === null
          ? "Downloading update…"
          : `Downloading update… ${Math.round(state.progress * 100)}%`;
      break;
    case "installing":
      text = "Installing update… Lare will relaunch.";
      break;
    case "error":
      text = `Update check failed: ${state.message}`;
      tone = "text-rose-300";
      break;
    default:
      return null;
  }
  return <p className={`mt-3 text-xs ${tone}`}>{text}</p>;
}
