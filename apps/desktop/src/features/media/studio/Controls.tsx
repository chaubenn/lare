import { formatDuration } from "@lare/shared";
import { cn } from "@lare/ui";
import { Plus, Scissors, Sparkles } from "lucide-react";
import type { Dispatch, SetStateAction } from "react";
import { Button } from "@/components/ui/Button";
import { Card, SectionTitle } from "@/components/ui/Card";
import { Label, Select, Toggle } from "@/components/ui/Field";
import type { Corner, StudioEdit, StudioProjectInfo } from "@/lib/recorder";
import { hexToRgb, rgbToHex } from "./ranges";

const CORNERS: { value: Corner; label: string }[] = [
  { value: "top-left", label: "Top left" },
  { value: "top-right", label: "Top right" },
  { value: "bottom-left", label: "Bottom left" },
  { value: "bottom-right", label: "Bottom right" },
];

function stamp(seconds: number): string {
  return formatDuration(seconds * 1000);
}

export function StudioToolbar({
  current,
  duration,
  markIn,
  hasReview,
  hasSegments,
  onTrimStart,
  onTrimEnd,
  onCut,
  onAddRange,
  onHighlights,
  onKeepEverything,
}: {
  current: number;
  duration: number;
  markIn: number | null;
  hasReview: boolean;
  hasSegments: boolean;
  onTrimStart: () => void;
  onTrimEnd: () => void;
  onCut: () => void;
  onAddRange: () => void;
  onHighlights: () => void;
  onKeepEverything: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="font-mono text-xs text-zinc-400">
        {stamp(current)} / {stamp(duration)}
      </span>
      <span className="mx-1 text-zinc-700" aria-hidden>
        |
      </span>
      <Button size="sm" onClick={onTrimStart} title="Start the video at the playhead">
        Trim start
      </Button>
      <Button size="sm" onClick={onTrimEnd} title="End the video at the playhead">
        Trim end
      </Button>
      <Button
        size="sm"
        icon={<Scissors className="size-3.5" aria-hidden />}
        onClick={onCut}
        title="Split the range at the playhead"
      >
        Split
      </Button>
      <Button
        size="sm"
        icon={<Plus className="size-3.5" aria-hidden />}
        onClick={onAddRange}
        title="Mark an in point, then an out point, to keep a range"
        className={cn(markIn !== null && "border-emerald-500/50 text-emerald-300")}
      >
        {markIn === null ? "Mark in" : `Mark out (${stamp(markIn)} →)`}
      </Button>
      {hasReview ? (
        <Button
          size="sm"
          icon={<Sparkles className="size-3.5" aria-hidden />}
          onClick={onHighlights}
          title="Keep 30 s around each AI moment"
        >
          AI highlights
        </Button>
      ) : null}
      {hasSegments ? (
        <Button size="sm" variant="ghost" onClick={onKeepEverything}>
          Keep everything
        </Button>
      ) : null}
    </div>
  );
}

export function StudioControls({
  edit,
  setEdit,
  info,
  cameraFailed,
  micFailed,
}: {
  edit: StudioEdit;
  setEdit: Dispatch<SetStateAction<StudioEdit>>;
  info: StudioProjectInfo;
  cameraFailed: boolean;
  micFailed: boolean;
}) {
  return (
    <>
      <Card className="space-y-3">
        <SectionTitle>Facecam</SectionTitle>
        {info.cameraPath ? (
          <>
            <Toggle
              id="studio-cam-hide"
              checked={!edit.camera.hide}
              onChange={(v) => setEdit((e) => ({ ...e, camera: { ...e.camera, hide: !v } }))}
              label="Show facecam"
            />
            <div className={cn(edit.camera.hide && "pointer-events-none opacity-50", "space-y-3")}>
              <div>
                <Label htmlFor="studio-cam-pos">Position</Label>
                <Select
                  id="studio-cam-pos"
                  className="mt-1"
                  value={edit.camera.position}
                  onChange={(e) =>
                    setEdit((s) => ({
                      ...s,
                      camera: { ...s.camera, position: e.target.value as Corner },
                    }))
                  }
                >
                  {CORNERS.map((c) => (
                    <option key={c.value} value={c.value}>
                      {c.label}
                    </option>
                  ))}
                </Select>
              </div>
              <RangeField
                id="studio-cam-size"
                label={`Size · ${Math.round(edit.camera.size)}%`}
                min={15}
                max={60}
                value={edit.camera.size}
                onChange={(v) => setEdit((s) => ({ ...s, camera: { ...s.camera, size: v } }))}
              />
              <RangeField
                id="studio-cam-round"
                label={`Rounding · ${Math.round(edit.camera.rounding)}%`}
                min={0}
                max={100}
                value={edit.camera.rounding}
                onChange={(v) => setEdit((s) => ({ ...s, camera: { ...s.camera, rounding: v } }))}
              />
              <Toggle
                id="studio-cam-aspect"
                checked={edit.camera.keepAspect}
                onChange={(v) => setEdit((s) => ({ ...s, camera: { ...s.camera, keepAspect: v } }))}
                label="Keep camera aspect ratio"
                description="Off = square crop."
              />
              <Toggle
                id="studio-cam-mirror"
                checked={edit.camera.mirror}
                onChange={(v) => setEdit((s) => ({ ...s, camera: { ...s.camera, mirror: v } }))}
                label="Mirror"
              />
            </div>
          </>
        ) : (
          <p className="text-sm text-zinc-500">
            No camera track was recorded. Turn on facecam before you start the next take.
          </p>
        )}
        {cameraFailed ? (
          <p className="text-xs text-rose-400">Could not play the camera file in preview.</p>
        ) : null}
        {micFailed ? (
          <p className="text-xs text-rose-400">Could not play the microphone track.</p>
        ) : !info.micPath ? (
          <p className="text-xs text-zinc-500">
            No microphone track — leave mic on when you record, or this preview stays silent.
          </p>
        ) : null}
      </Card>

      <Card className="space-y-3">
        <SectionTitle>Frame</SectionTitle>
        <div>
          <Label htmlFor="studio-aspect">Aspect ratio</Label>
          <Select
            id="studio-aspect"
            className="mt-1"
            value={edit.aspectRatio ?? "source"}
            onChange={(e) =>
              setEdit((s) => ({
                ...s,
                aspectRatio:
                  e.target.value === "source"
                    ? null
                    : (e.target.value as NonNullable<StudioEdit["aspectRatio"]>),
              }))
            }
          >
            <option value="source">Same as recording</option>
            <option value="wide">Wide 16:9</option>
            <option value="vertical">Vertical 9:16</option>
            <option value="square">Square 1:1</option>
            <option value="classic">Classic 4:3</option>
            <option value="tall">Tall 3:4</option>
          </Select>
        </div>
        <RangeField
          id="studio-padding"
          label={`Padding · ${Math.round(edit.padding)}%`}
          min={0}
          max={30}
          value={edit.padding}
          onChange={(v) => setEdit((s) => ({ ...s, padding: v }))}
        />
        <div>
          <Label htmlFor="studio-bg">Background</Label>
          <div className="mt-1 flex items-center gap-2">
            <Select
              id="studio-bg"
              value={edit.background.kind}
              onChange={(e) =>
                setEdit((s) => ({
                  ...s,
                  background:
                    e.target.value === "wallpaper"
                      ? { kind: "wallpaper" }
                      : { kind: "color", rgb: [0, 0, 0] },
                }))
              }
            >
              <option value="color">Solid colour</option>
              <option value="wallpaper">Cap wallpaper</option>
            </Select>
            {edit.background.kind === "color" ? (
              <input
                type="color"
                aria-label="Background colour"
                value={rgbToHex(edit.background.rgb)}
                onChange={(e) =>
                  setEdit((s) => ({
                    ...s,
                    background: { kind: "color", rgb: hexToRgb(e.target.value) },
                  }))
                }
                className="h-9 w-12 cursor-pointer rounded-lg border border-zinc-800 bg-zinc-900"
              />
            ) : null}
          </div>
        </div>
        <p className="text-xs text-zinc-500">
          Padding and aspect changes show only in the rendered video.
        </p>
      </Card>
    </>
  );
}

function RangeField({
  id,
  label,
  min,
  max,
  value,
  onChange,
}: {
  id: string;
  label: string;
  min: number;
  max: number;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div>
      <Label htmlFor={id}>{label}</Label>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={1}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-1 w-full accent-emerald-500"
      />
    </div>
  );
}
