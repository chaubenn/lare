import { useMutation } from "@tanstack/react-query";
import { ask } from "@tauri-apps/plugin-dialog";
import { MonitorX } from "lucide-react";
import { useToast } from "@/components/toast/ToastProvider";
import { Button } from "@/components/ui/Button";
import { usePermissions } from "@/features/recording/hooks";
import { recorder } from "@/lib/recorder";
import { errorMessage } from "@/lib/supabase";
import { SubSection } from "./shared";

/**
 * macOS keeps a ScreenCaptureKit session open for a process that was killed before it could stop
 * one, so Control Center goes on showing Lare as sharing the screen — with nothing listed, and a
 * Stop Sharing button that talks to the dead process. Lare releases the capture on every ordinary
 * exit now; this is the way out when something got killed anyway.
 */
export function ScreenSharingSection() {
  const permissions = usePermissions();
  const { toast } = useToast();
  const clear = useMutation({
    mutationFn: async () => {
      const ok = await ask(
        "This releases the screen, camera and microphone, and restarts the macOS service that owns screen-capture sessions.\n\nAny other app that is recording or sharing its screen right now will stop too.",
        { title: "Clear the screen-sharing indicator?", kind: "warning", okLabel: "Clear" },
      );
      if (!ok) return false;
      await recorder.clearScreenSharing();
      return true;
    },
    onSuccess: (cleared) => {
      if (!cleared) return;
      toast({
        title: "Screen sharing cleared",
        description: "The indicator in the menu bar should be gone.",
        variant: "success",
      });
    },
    onError: (e) =>
      toast({
        title: "Couldn't clear screen sharing",
        description: errorMessage(e),
        variant: "error",
      }),
  });

  // macOS is the only platform that gates (and indicates) screen recording this way.
  if (permissions.data && permissions.data.screenRecording === "not_applicable") return null;

  return (
    <SubSection
      title="Screen sharing"
      description="Lare stops capturing when it quits. If it was force-quit or crashed mid-recording, macOS can keep showing it as sharing your screen — clear that here."
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
      <p className="text-xs text-zinc-500">
        Other apps recording or sharing their screen will stop as well.
      </p>
    </SubSection>
  );
}
