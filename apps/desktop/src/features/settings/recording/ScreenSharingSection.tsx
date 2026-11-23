import { MonitorX } from "@lare/ui/icons";
import { Button } from "@lare/ui/primitives";
import { useMutation } from "@tanstack/react-query";
import { confirm } from "@/components/ui/Confirm";
import { usePermissions } from "@/features/media/hooks";
import { notify, notifyError } from "@/lib/notices";
import { recorder } from "@/lib/recorder";
import { SubSection } from "./shared";

/**
 * macOS keeps a ScreenCaptureKit session open for a process that was killed before it could stop
 * one, so Control Center goes on showing Lare as sharing the screen — with nothing listed, and a
 * Stop Sharing button that talks to the dead process. Lare releases the capture on every ordinary
 * exit now; this is the way out when something got killed anyway.
 */
export function ScreenSharingSection() {
  const permissions = usePermissions();
  const clear = useMutation({
    mutationFn: async () => {
      const ok = await confirm({
        title: "Clear the screen-sharing indicator?",
        message:
          "Releases the screen, camera and microphone.\n\nAny other app recording or sharing its screen will stop too.",
        confirmLabel: "Clear",
        destructive: true,
      });
      if (!ok) return false;
      await recorder.clearScreenSharing();
      return true;
    },
    onSuccess: (cleared) => {
      if (!cleared) return;
      notify({
        title: "Screen sharing cleared",
        description: "The indicator in the menu bar should be gone.",
        variant: "success",
      });
    },
    onError: (e) => notifyError("Couldn't clear screen sharing", e),
  });

  // macOS is the only platform that gates (and indicates) screen recording this way.
  if (permissions.data && permissions.data.screenRecording === "not_applicable") return null;

  return (
    <SubSection
      title="Screen sharing"
      description="If Lare crashed mid-recording and macOS still shows it sharing your screen, clear it here."
      action={
        <Button
          size="sm"
          variant="ghost"
          icon={<MonitorX className="size-3.5" aria-hidden />}
          loading={clear.isPending}
          onClick={() => clear.mutate()}
        >
          Clear screen sharing
        </Button>
      }
    >
      <p className="text-xs text-[var(--text-tertiary)]">
        This also stops other apps that are sharing their screen.
      </p>
    </SubSection>
  );
}
