/**
 * App-level reaction to recorder events. Mounted once in the shell so pipelines start no matter
 * which page is open when a recording finishes.
 */

import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router";
import { useToast } from "@/components/toast/ToastProvider";
import { useUser } from "@/features/auth/AuthProvider";
import { errorMessage } from "@/lib/supabase";
import { useTauriEvent } from "@/lib/tauri";
import { processInterview, publishInstantDemo } from "./pipeline";

export function useRecordingEvents(): void {
  const { userId } = useUser();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { toast } = useToast();

  useTauriEvent("recording:completed", (recording) => {
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
            description: `${errorMessage(e)} — retry from Recordings.`,
            variant: "error",
          });
        });
      return;
    }
    if (recording.mode === "instant") {
      publishInstantDemo({
        recording,
        userId,
        postId: recording.postId,
        title: "Demo video",
        queryClient,
      })
        .then(() => {
          toast({
            title: "Demo video uploaded",
            description: "Bunny is encoding it now; the player appears when that finishes.",
            variant: "success",
          });
        })
        .catch((e: unknown) => {
          toast({
            title: "Upload failed",
            description: `${errorMessage(e)} — retry from Recordings.`,
            variant: "error",
          });
        });
      return;
    }
    // Studio: hand over to the editor.
    void navigate(`/studio/${recording.recordingId}`);
  });

  useTauriEvent("recording:state", (state) => {
    if (state.state === "error" && state.message) {
      toast({ title: "Recording problem", description: state.message, variant: "error" });
    }
  });
}
