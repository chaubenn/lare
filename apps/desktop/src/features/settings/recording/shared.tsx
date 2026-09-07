import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useToast } from "@/components/toast/ToastProvider";
import { Label, Select } from "@/components/ui/Field";
import { settingsKey, useRecorderSettings } from "@/features/recording/hooks";
import { type RecorderSettings, recorder } from "@/lib/recorder";
import { errorMessage } from "@/lib/supabase";

export function SubSection({
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

/** Recorder settings + a `save(patch)` that persists immediately (optimistic in the cache). */
export function useSettingsPatch() {
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
export const NULL_VALUE = "__default__";

export interface Option {
  value: string;
  label: string;
}

export function SettingSelect({
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
