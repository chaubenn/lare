/**
 * Settings → Recording: OS permissions, capture devices/resolution cap and the local whisper.cpp
 * speech model. Every change is persisted immediately through `recorder.setSettings`.
 */

import { cn } from "@lare/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  Camera,
  Check,
  Download,
  ExternalLink,
  type LucideIcon,
  Mic,
  Monitor,
  RefreshCw,
} from "lucide-react";
import { type ReactNode, useRef, useState } from "react";
import { useToast } from "@/components/toast/ToastProvider";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, SectionTitle } from "@/components/ui/Card";
import { FieldError, Label, Select } from "@/components/ui/Field";
import { Spinner } from "@/components/ui/States";
import {
  devicesKey,
  permissionsKey,
  settingsKey,
  useDevices,
  usePermissions,
  useRecorderSettings,
  useWhisperModels,
  whisperModelsKey,
} from "@/features/recording/hooks";
import {
  formatBytes,
  newJobId,
  type PermissionStatus,
  type Permissions,
  type RecorderSettings,
  recorder,
  type WhisperModel,
} from "@/lib/recorder";
import { errorMessage } from "@/lib/supabase";
import { inTauri, useTauriEvent } from "@/lib/tauri";

export function RecordingPanel() {
  return (
    <Card>
      <SectionTitle>Recording</SectionTitle>
      {inTauri ? (
        <div className="space-y-5">
          <PermissionsSection />
          <DevicesSection />
          <SpeechModelSection />
        </div>
      ) : (
        <p className="text-sm text-zinc-500">
          Recording settings are only available in the desktop app.
        </p>
      )}
    </Card>
  );
}

function SubSection({
  title,
  description,
  action,
  children,
}: {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="border-zinc-800 border-t pt-4 first:border-t-0 first:pt-0">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-medium text-zinc-200">{title}</h3>
          {description ? <p className="mt-0.5 text-xs text-zinc-500">{description}</p> : null}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

/* ----------------------------------------------------------------------------------------------
 * Permissions
 * -------------------------------------------------------------------------------------------- */

type PermissionKind = Parameters<typeof recorder.requestPermission>[0];

interface PermissionRowDef {
  key: keyof Permissions;
  which: PermissionKind;
  label: string;
  description: string;
  icon: LucideIcon;
}

const PERMISSION_ROWS: PermissionRowDef[] = [
  {
    key: "screenRecording",
    which: "screen_recording",
    label: "Screen recording",
    description: "Captures your display while you record.",
    icon: Monitor,
  },
  {
    key: "camera",
    which: "camera",
    label: "Camera",
    description: "Only used when the facecam is on.",
    icon: Camera,
  },
  {
    key: "microphone",
    which: "microphone",
    label: "Microphone",
    description: "Voice-over for demos and the transcript of mock interviews.",
    icon: Mic,
  },
];

function PermissionsSection() {
  const permissions = usePermissions();
  const macScreenPermission =
    permissions.data !== undefined && permissions.data.screenRecording !== "not_applicable";
  return (
    <SubSection
      title="Permissions"
      description="The operating system has to allow Lare to capture before a recording can start."
    >
      {permissions.isError ? <FieldError>{errorMessage(permissions.error)}</FieldError> : null}
      <ul className="divide-y divide-zinc-800 rounded-lg border border-zinc-800">
        {PERMISSION_ROWS.map((row) => (
          <PermissionRow key={row.which} row={row} status={permissions.data?.[row.key]} />
        ))}
      </ul>
      {macScreenPermission ? (
        <p className="mt-2 text-xs text-zinc-500">
          After allowing Screen Recording on macOS, quit and reopen Lare for it to take effect.
        </p>
      ) : null}
    </SubSection>
  );
}

function PermissionRow({
  row,
  status,
}: {
  row: PermissionRowDef;
  status: PermissionStatus | undefined;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const Icon = row.icon;

  const settingsUrl = useQuery({
    queryKey: ["recorder", "permission-settings-url", row.which] as const,
    enabled: inTauri,
    queryFn: () => recorder.permissionSettingsUrl(row.which),
    staleTime: Number.POSITIVE_INFINITY,
  });

  const request = useMutation({
    mutationFn: () => recorder.requestPermission(row.which),
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: permissionsKey });
      if (result === "granted") toast({ title: `${row.label} allowed`, variant: "success" });
    },
    onError: (e) =>
      toast({
        title: `Couldn't request ${row.label.toLowerCase()} access`,
        description: errorMessage(e),
        variant: "error",
      }),
  });

  const openSettings = async () => {
    const url = settingsUrl.data;
    if (!url) return;
    try {
      await openUrl(url);
    } catch (e) {
      toast({
        title: "Couldn't open System Settings",
        description: errorMessage(e),
        variant: "error",
      });
    }
  };

  // macOS only prompts once; afterwards the user has to flip the switch in System Settings.
  const showSettings = !!settingsUrl.data && (status === "denied" || status === "not_determined");

  return (
    <li className="flex flex-wrap items-center gap-3 px-3 py-2.5">
      <Icon className="size-4 shrink-0 text-zinc-500" aria-hidden />
      <div className="min-w-0 flex-1">
        <div className="text-sm text-zinc-100">{row.label}</div>
        <div className="text-xs text-zinc-500">{row.description}</div>
      </div>
      <PermissionBadge status={status} />
      {status === "not_determined" ? (
        <Button
          size="sm"
          variant="primary"
          loading={request.isPending}
          onClick={() => request.mutate()}
        >
          Allow
        </Button>
      ) : null}
      {showSettings ? (
        <Button
          size="sm"
          variant="ghost"
          icon={<ExternalLink className="size-3.5" aria-hidden />}
          onClick={() => void openSettings()}
        >
          Open System Settings
        </Button>
      ) : null}
    </li>
  );
}

function PermissionBadge({ status }: { status: PermissionStatus | undefined }) {
  switch (status) {
    case "granted":
      return <Badge tone="emerald">Granted</Badge>;
    case "denied":
      return <Badge tone="rose">Denied</Badge>;
    case "not_determined":
      return <Badge tone="amber">Not allowed yet</Badge>;
    case "not_applicable":
      return <span className="text-xs text-zinc-500">Not required on this OS</span>;
    default:
      return <span className="text-xs text-zinc-500">Checking…</span>;
  }
}

/* ----------------------------------------------------------------------------------------------
 * Settings persistence shared by the device and speech-model sections
 * -------------------------------------------------------------------------------------------- */

/** Recorder settings + a `save(patch)` that persists immediately (optimistic in the cache). */
function useSettingsPatch() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const settings = useRecorderSettings();
  const mutation = useMutation({
    mutationFn: async (patch: Partial<RecorderSettings>) => {
      const current = queryClient.getQueryData<RecorderSettings>(settingsKey);
      if (!current) throw new Error("Recording settings haven't loaded yet.");
      await recorder.setSettings({ ...current, ...patch });
    },
    onMutate: (patch) => {
      queryClient.setQueryData<RecorderSettings>(settingsKey, (prev) =>
        prev ? { ...prev, ...patch } : prev,
      );
    },
    onError: (e) =>
      toast({
        title: "Couldn't save recording settings",
        description: errorMessage(e),
        variant: "error",
      }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: settingsKey }),
  });
  return { settings, save: mutation.mutate };
}

/** `<select>` value used for `null` settings (the microphone uses "" for "no microphone"). */
const NULL_VALUE = "__default__";

interface Option {
  value: string;
  label: string;
}

function SettingSelect({
  id,
  label,
  hint,
  value,
  options,
  disabled,
  onChange,
  unknownLabel = (v) => `Unavailable (${v})`,
}: {
  id: string;
  label: string;
  hint?: ReactNode;
  /** `null` selects the option whose value is NULL_VALUE. */
  value: string | null;
  options: Option[];
  disabled?: boolean;
  onChange: (value: string | null) => void;
  /** Label for a saved value that is not in `options` (e.g. an unplugged device). */
  unknownLabel?: (value: string) => string;
}) {
  const current = value ?? NULL_VALUE;
  const unique = [...new Map(options.map((o) => [o.value, o])).values()];
  const known = unique.some((o) => o.value === current);
  return (
    <div>
      <Label htmlFor={id} hint={hint}>
        {label}
      </Label>
      <Select
        id={id}
        className="mt-1"
        value={current}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value === NULL_VALUE ? null : e.target.value)}
      >
        {unique.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
        {known ? null : <option value={current}>{unknownLabel(current)}</option>}
      </Select>
    </div>
  );
}

/* ----------------------------------------------------------------------------------------------
 * Devices
 * -------------------------------------------------------------------------------------------- */

const MAX_SIZE_OPTIONS: Option[] = [
  { value: NULL_VALUE, label: "1080p (1920 px, default)" },
  { value: "2560", label: "1440p (2560 px)" },
  { value: "3840", label: "4K (3840 px)" },
];

function DevicesSection() {
  const queryClient = useQueryClient();
  const devices = useDevices();
  const { settings, save } = useSettingsPatch();
  const d = devices.data;

  const displayOptions: Option[] = [
    { value: NULL_VALUE, label: "Primary display" },
    ...(d?.displays ?? []).map((x) => ({
      value: x.id,
      label: `${x.name} · ${x.width}×${x.height}${x.primary ? " (primary)" : ""}`,
    })),
  ];
  const micOptions: Option[] = [
    { value: NULL_VALUE, label: "System default" },
    { value: "", label: "No microphone" },
    ...(d?.microphones ?? []).map((m) => ({
      value: m.name,
      label: m.default ? `${m.name} (default)` : m.name,
    })),
  ];
  const cameraOptions: Option[] = [
    { value: NULL_VALUE, label: "First available" },
    ...(d?.cameras ?? []).map((c) => ({ value: c.id, label: c.name })),
  ];

  return (
    <SubSection
      title="Devices"
      description="What to capture. Changes apply to the next recording."
      action={
        <Button
          size="sm"
          variant="ghost"
          icon={<RefreshCw className="size-3.5" aria-hidden />}
          loading={devices.isFetching}
          onClick={() => void queryClient.invalidateQueries({ queryKey: devicesKey })}
        >
          Refresh devices
        </Button>
      }
    >
      {devices.isError ? <FieldError>{errorMessage(devices.error)}</FieldError> : null}
      {settings.isPending ? (
        <Spinner className="py-4" label="Loading recording settings…" />
      ) : settings.isError ? (
        <FieldError>{errorMessage(settings.error)}</FieldError>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          <SettingSelect
            id="rec-display"
            label="Display"
            value={settings.data.displayId}
            options={displayOptions}
            disabled={devices.isPending}
            onChange={(displayId) => save({ displayId })}
          />
          <SettingSelect
            id="rec-mic"
            label="Microphone"
            value={settings.data.micLabel}
            options={micOptions}
            disabled={devices.isPending}
            onChange={(micLabel) => save({ micLabel })}
          />
          <SettingSelect
            id="rec-camera"
            label="Camera"
            hint="facecam"
            value={settings.data.cameraId}
            options={cameraOptions}
            disabled={devices.isPending}
            onChange={(cameraId) => save({ cameraId })}
          />
          <SettingSelect
            id="rec-max-size"
            label="Instant mode resolution cap"
            hint="longest edge"
            value={
              settings.data.maxOutputSize === null ? null : String(settings.data.maxOutputSize)
            }
            options={MAX_SIZE_OPTIONS}
            unknownLabel={(v) => `Custom (${v} px)`}
            onChange={(v) => save({ maxOutputSize: v === null ? null : Number(v) })}
          />
        </div>
      )}
    </SubSection>
  );
}

/* ----------------------------------------------------------------------------------------------
 * Speech model
 * -------------------------------------------------------------------------------------------- */

const DEFAULT_MODEL: WhisperModel = "small-en";

interface DownloadState {
  jobId: string;
  label: string;
  received: number;
  total: number | null;
}

function SpeechModelSection() {
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
          <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-zinc-800">
            <div
              className={cn(
                "h-full rounded-full bg-emerald-500 transition-[width]",
                percent === null && "w-1/3 animate-pulse",
              )}
              style={percent === null ? undefined : { width: `${percent}%` }}
            />
          </div>
        </div>
      ) : null}
    </SubSection>
  );
}
