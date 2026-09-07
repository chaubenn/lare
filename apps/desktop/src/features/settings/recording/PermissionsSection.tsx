import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Camera, ExternalLink, type LucideIcon, Mic, Monitor } from "lucide-react";
import { useToast } from "@/components/toast/ToastProvider";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { FieldError } from "@/components/ui/Field";
import { permissionsKey, usePermissions } from "@/features/recording/hooks";
import { type PermissionStatus, type Permissions, recorder } from "@/lib/recorder";
import { errorMessage } from "@/lib/supabase";
import { inTauri } from "@/lib/tauri";
import { SubSection } from "./shared";

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

export function PermissionsSection() {
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
      if (result === "granted") {
        toast({ title: `${row.label} allowed`, variant: "success" });
      } else if (row.which === "screen_recording") {
        // macOS only shows the screen-recording prompt once and reports "denied" until the app is
        // switched on in System Settings; the request above is what adds Lare to that list.
        toast({
          title: "Turn on Lare in System Settings",
          description:
            "Lare is now listed under Privacy & Security → Screen & System Audio Recording. Switch it on, then quit and reopen Lare.",
        });
      }
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
      await recorder.openPermissionSettings(row.which);
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
  // Screen recording has no "not determined" state on macOS: it reads as denied until the app has
  // asked once and been switched on, so the request button must be available while denied too.
  const showAllow =
    status === "not_determined" || (row.which === "screen_recording" && status === "denied");

  return (
    <li className="flex flex-wrap items-center gap-3 px-3 py-2.5">
      <Icon className="size-4 shrink-0 text-zinc-500" aria-hidden />
      <div className="min-w-0 flex-1">
        <div className="text-sm text-zinc-100">{row.label}</div>
        <div className="text-xs text-zinc-500">{row.description}</div>
      </div>
      <PermissionBadge status={status} />
      {showAllow ? (
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
