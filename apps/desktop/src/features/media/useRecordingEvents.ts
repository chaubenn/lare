/**
 * App-level reaction to recorder events. Mounted once in the shell so pipelines start no matter
 * which page is open when a recording finishes.
 */

import { useQueryClient } from "@tanstack/react-query";
import { useUser } from "@/features/auth/AuthProvider";
import { useNotify } from "@/features/notifications/notices";
import { errorMessage } from "@/lib/supabase";
import { useTauriEvent } from "@/lib/tauri";
import { localCopiesKey } from "./localCopies";
import { processInterview, publishInstantDemo } from "./pipeline";
import { getRecordingMeta } from "./recordingStore";

export function useRecordingEvents(): void {
  const { userId } = useUser();
  const queryClient = useQueryClient();
  const { notify } = useNotify();

  useTauriEvent("recording:completed", (recording) => {
    void queryClient.invalidateQueries({ queryKey: ["recorder", "recordings"] });
    // A take that finished is playable from disk before it is uploaded.
    void queryClient.invalidateQueries({ queryKey: localCopiesKey });
    if (recording.purpose === "interview") {
      notify({
        title: "Mock interview recorded",
        description: "Watch it in the draft now; it transcribes and uploads in the background.",
      });
      processInterview({ recording, userId, queryClient })
        .then(() => {
          notify({
            title: "Interview processed",
            description: "Transcript and video are attached to your draft.",
            variant: "success",
          });
        })
        .catch((e: unknown) => {
          notify({
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
        notify({
          title: "Video uploaded",
          description: "Others can watch it once it finishes processing.",
          variant: "success",
        });
      })
      .catch((e: unknown) => {
        notify({
          title: "Upload failed",
          description: `${errorMessage(e)}. Retry from the draft's Media step.`,
          variant: "error",
        });
      });
  });

  useTauriEvent("recording:state", (state) => {
    if (state.state === "error" && state.message) {
      notify({ title: "Recording problem", description: state.message, variant: "error" });
    }
  });
}
