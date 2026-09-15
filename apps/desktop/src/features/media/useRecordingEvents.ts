/**
 * App-level reaction to recorder events. Mounted once in the shell so pipelines start no matter
 * which page is open when a recording finishes.
 */

import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/components/toast/ToastProvider";
import { useUser } from "@/features/auth/AuthProvider";
import { errorMessage } from "@/lib/supabase";
import { useTauriEvent } from "@/lib/tauri";
import { processInterview, publishInstantDemo } from "./pipeline";
import { getRecordingMeta } from "./recordingStore";

export function useRecordingEvents(): void {
  const { userId } = useUser();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  useTauriEvent("recording:completed", (recording) => {
    void queryClient.invalidateQueries({ queryKey: ["recorder", "recordings"] });
    if (recording.purpose === "interview") {
      toast({
        title: "Mock interview recorded",
        description: "Transcribing and uploading in the background.",
      });
      processInterview({ recording, userId, queryClient })
        .then(() => {
          toast({
            title: "Interview processed",
            description: "Transcript and video are attached to your draft.",
            variant: "success",
          });
        })
        .catch((e: unknown) => {
          toast({
            title: "Interview processing failed",
            description: `${errorMessage(e)}. The local source has been kept.`,
            variant: "error",
          });
        });
      return;
    }
    // Which slot the author was filling is only known here (the recorder manifest carries the
    // post, not the slot), so read it back from the store the panel wrote it to.
    getRecordingMeta(recording.recordingId)
      .then((meta) => {
        const slot = meta?.slot ?? "main";
        return publishInstantDemo({
          recording,
          userId,
          postId: recording.postId,
          slot,
          title: slot === "demo" ? "Summary video" : "Demo video",
          queryClient,
        });
      })
      .then(() => {
        toast({
          title: "Video uploaded",
          description: "Bunny is encoding it now; the player appears when that finishes.",
          variant: "success",
        });
      })
      .catch((e: unknown) => {
        toast({
          title: "Upload failed",
          description: `${errorMessage(e)}. Retry from the draft's Media step.`,
          variant: "error",
        });
      });
  });

  useTauriEvent("recording:state", (state) => {
    if (state.state === "error" && state.message) {
      toast({ title: "Recording problem", description: state.message, variant: "error" });
    }
  });
}
