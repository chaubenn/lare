import { useQueryClient } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { FieldError } from "@/components/ui/Field";
import { Spinner } from "@/components/ui/States";
import { devicesKey, useDevices } from "@/features/recording/hooks";
import { errorMessage } from "@/lib/supabase";
import { NULL_VALUE, type Option, SettingSelect, SubSection, useSettingsPatch } from "./shared";

const MAX_SIZE_OPTIONS: Option[] = [
  { value: NULL_VALUE, label: "1080p (1920 px, default)" },
  { value: "2560", label: "1440p (2560 px)" },
  { value: "3840", label: "4K (3840 px)" },
];

export function DevicesSection() {
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
