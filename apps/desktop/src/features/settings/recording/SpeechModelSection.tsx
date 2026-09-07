import { Progress } from "@lare/ui/primitives";
import { useQueryClient } from "@tanstack/react-query";
import { Check, Download } from "lucide-react";
import { useRef, useState } from "react";
import { useToast } from "@/components/toast/ToastProvider";
import { Button } from "@/components/ui/Button";
import { FieldError } from "@/components/ui/Field";
import { useWhisperModels, whisperModelsKey } from "@/features/recording/hooks";
import { formatBytes, newJobId, recorder, type WhisperModel } from "@/lib/recorder";
import { errorMessage } from "@/lib/supabase";
import { useTauriEvent } from "@/lib/tauri";
import { type Option, SettingSelect, SubSection, useSettingsPatch } from "./shared";

const DEFAULT_MODEL: WhisperModel = "small-en";

interface DownloadState {
  jobId: string;
  label: string;
  received: number;
  total: number | null;
}

export function SpeechModelSection() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const models = useWhisperModels();
  const { settings, save } = useSettingsPatch();

  const selected: WhisperModel = settings.data?.whisperModel ?? DEFAULT_MODEL;
  const selectedModel = models.data?.find((m) => m.kind === selected);

  // The job id lives in a ref so progress events are matched even before React re-renders.
  const jobRef = useRef<string | null>(null);
  const [download, setDownload] = useState<DownloadState | null>(null);

  useTauriEvent("transcribe:progress", (payload) => {
    if (payload.stage !== "download" || payload.jobId !== jobRef.current) return;
    setDownload((prev) =>
      prev && prev.jobId === payload.jobId
        ? { ...prev, received: payload.received, total: payload.total }
        : prev,
    );
  });

  const startDownload = async () => {
    if (!selectedModel || selectedModel.downloaded || jobRef.current) return;
    const jobId = newJobId("model");
    jobRef.current = jobId;
    setDownload({ jobId, label: selectedModel.label, received: 0, total: null });
    try {
      await recorder.ensureWhisperModel(jobId, selectedModel.kind);
      await queryClient.invalidateQueries({ queryKey: whisperModelsKey });
      toast({
        title: `${selectedModel.label} model ready`,
        description: "Transcription uses it from now on.",
        variant: "success",
      });
    } catch (e) {
      toast({ title: "Model download failed", description: errorMessage(e), variant: "error" });
    } finally {
      jobRef.current = null;
      setDownload(null);
    }
  };

  const modelOptions: Option[] = (models.data ?? []).map((m) => ({
    value: m.kind,
    label: `${m.label} · ~${m.approxMb} MB${m.downloaded ? " · downloaded" : ""}`,
  }));
  const percent =
    download?.total && download.total > 0
      ? Math.min(100, Math.round((download.received / download.total) * 100))
      : null;

  return (
    <SubSection
      title="Speech model (whisper.cpp)"
      description="Transcription runs locally on this machine; models are stored in the app data folder."
    >
      {models.isError ? <FieldError>{errorMessage(models.error)}</FieldError> : null}
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-56 flex-1">
          <SettingSelect
            id="rec-whisper-model"
            label="Model"
            hint="larger is more accurate, slower"
            value={selected}
            options={modelOptions}
            disabled={!models.data || !settings.data}
            unknownLabel={(v) => v}
            onChange={(v) => {
              const kind = models.data?.find((m) => m.kind === v)?.kind;
              if (kind) save({ whisperModel: kind });
            }}
          />
        </div>
        <Button
          variant={selectedModel?.downloaded ? "secondary" : "primary"}
          icon={
            selectedModel?.downloaded ? (
              <Check className="size-4" aria-hidden />
            ) : (
              <Download className="size-4" aria-hidden />
            )
          }
          disabled={!selectedModel || selectedModel.downloaded || download !== null}
          loading={download !== null}
          onClick={() => void startDownload()}
        >
          {selectedModel?.downloaded
            ? "Downloaded"
            : download
              ? "Downloading…"
              : `Download${selectedModel ? ` (~${selectedModel.approxMb} MB)` : ""}`}
        </Button>
      </div>
      {download ? (
        <div className="mt-3">
          <div className="flex items-center justify-between gap-3 text-xs text-zinc-500">
            <span className="truncate">Downloading {download.label}…</span>
            <span className="shrink-0 tabular-nums">
              {download.total
                ? `${formatBytes(download.received)} / ${formatBytes(download.total)} · ${percent ?? 0}%`
                : formatBytes(download.received)}
            </span>
          </div>
          <Progress value={percent} label={`Downloading ${download.label}`} className="mt-1.5" />
        </div>
      ) : null}
    </SubSection>
  );
}
