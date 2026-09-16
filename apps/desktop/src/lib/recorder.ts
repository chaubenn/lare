/**
 * Typed wrappers for the recording/upload/transcription commands in
 * src-tauri/src/commands.rs and the events they emit. Shapes mirror the Rust structs
 * (serde camelCase).
 */

import { invoke } from "@tauri-apps/api/core";
import { inTauri } from "./tauri";

export type RecordingMode = "instant";
export type RecordingState = "idle" | "starting" | "recording" | "paused" | "stopping" | "error";
export type Purpose = "interview" | "demo";
export type PermissionStatus = "granted" | "denied" | "not_determined" | "not_applicable";
export type WhisperModel = "tiny-en" | "base-en" | "small-en" | "medium-en";

export interface DisplayInfo {
  id: string;
  name: string;
  primary: boolean;
  width: number;
  height: number;
  refreshRate: number;
}
export interface CameraInfo {
  id: string;
  name: string;
}
export interface MicrophoneInfo {
  name: string;
  default: boolean;
}
export interface Devices {
  displays: DisplayInfo[];
  cameras: CameraInfo[];
  microphones: MicrophoneInfo[];
}

export interface Permissions {
  screenRecording: PermissionStatus;
  camera: PermissionStatus;
  microphone: PermissionStatus;
}

export interface RecorderSettings {
  displayId: string | null;
  /** null = system default microphone; "" = no microphone. */
  micLabel: string | null;
  cameraId: string | null;
  whisperModel: WhisperModel | null;
  maxOutputSize: number | null;
}

export interface RecorderStatus {
  state: RecordingState;
  recordingId: string | null;
  sessionId: string | null;
  purpose: Purpose | null;
  mode: RecordingMode | null;
  startedAt: number | null;
  projectPath: string | null;
  postId: string | null;
  message: string | null;
  /**
   * Media captured so far, excluding paused stretches — the length of the video you will get,
   * as of the moment this payload was built. `null` when nothing is recording.
   */
  recordedMs: number | null;
}

export interface CompletedRecording {
  recordingId: string;
  sessionId: string | null;
  purpose: Purpose;
  mode: RecordingMode;
  projectPath: string;
  outputMp4: string | null;
  startedAt: number;
  endedAt: number;
  postId: string | null;
  facecam: boolean;
  /** Captured length in ms, excluding pauses. `endedAt - startedAt` for recovered recordings. */
  recordedMs: number;
}

export interface DemoStart {
  mode: RecordingMode;
  postId: string | null;
  facecam: boolean;
  mic: boolean;
}

export interface MediaInfo {
  durationMs: number | null;
  width: number | null;
  height: number | null;
  hasAudio: boolean;
}

export interface TusCredentials {
  endpoint: string;
  headers: Record<string, string>;
  metadata: { filetype: string; title: string };
}
/** Response of the `bunny-create-upload` Edge Function. */
export interface CreateUploadResponse {
  videoId: string;
  bunnyVideoId: string;
  libraryId: number;
  tus: TusCredentials;
}
export interface UploadJob {
  jobId: string;
  path: string;
  tus: TusCredentials;
  resumeUrl?: string | null;
}
export interface UploadResult {
  uploadUrl: string;
  sizeBytes: number;
}

export interface TranscriptSegment {
  s: number;
  e: number;
  text: string;
}
export interface TranscribeResult {
  model: WhisperModel;
  segments: TranscriptSegment[];
  vtt: string;
}
export interface WhisperModelStatus {
  kind: WhisperModel;
  label: string;
  approxMb: number;
  downloaded: boolean;
}

/** Events emitted by the Rust side for long jobs (all keyed by jobId). */
export interface RecorderEvents {
  "recording:state": RecorderStatus;
  "recording:completed": CompletedRecording;
  /** Whether the facecam preview window should be holding the webcam open. */
  "camera:active": boolean;
  "upload:progress": { jobId: string; uploaded: number; total: number };
  "transcribe:progress":
    | { stage: "download"; jobId: string; received: number; total: number | null }
    | { stage: "decoding"; jobId: string }
    | { stage: "transcribing"; jobId: string; percent: number };
}

function notInTauri(): never {
  throw new Error("Recording is only available in the desktop app.");
}

export const recorder = {
  listDevices: () => (inTauri ? invoke<Devices>("list_devices") : notInTauri()),
  checkPermissions: () => (inTauri ? invoke<Permissions>("check_permissions") : notInTauri()),
  requestPermission: (which: "screen_recording" | "camera" | "microphone") =>
    invoke<PermissionStatus>("request_permission", { which }),
  permissionSettingsUrl: (which: "screen_recording" | "camera" | "microphone") =>
    invoke<string | null>("permission_settings_url", { which }),
  openPermissionSettings: (which: "screen_recording" | "camera" | "microphone") =>
    invoke<void>("open_permission_settings", { which }),
  /** Clears a screen-recording grant that an update invalidated, then re-requests it. */
  resetScreenRecordingPermission: () =>
    invoke<PermissionStatus>("reset_screen_recording_permission"),
  /** Loopback URL the webview can play a local recording from (see src-tauri/src/preview.rs). */
  previewUrl: (path: string) => invoke<string>("preview_url", { path }),
  settings: () => invoke<RecorderSettings>("recorder_settings"),
  setSettings: (settings: RecorderSettings) => invoke<void>("set_recorder_settings", { settings }),

  status: () => invoke<RecorderStatus>("recorder_status"),
  start: (req: DemoStart) => invoke<RecorderStatus>("recording_start", { req }),
  pause: () => invoke<RecorderStatus>("recording_pause"),
  resume: () => invoke<RecorderStatus>("recording_resume"),
  stop: () => invoke<CompletedRecording>("recording_stop"),
  cancel: () => invoke<void>("recording_cancel"),
  /**
   * Release the screen/camera/microphone and clear a capture session macOS is still crediting to
   * Lare after a hard kill. Restarts `replayd` on macOS, so any *other* app's screen recording
   * stops too — always confirm before calling.
   */
  clearScreenSharing: () => invoke<void>("clear_screen_sharing"),
  list: () => invoke<CompletedRecording[]>("recordings_list"),
  delete: (recordingId: string) => invoke<void>("recording_delete", { recordingId }),

  openRecorderWindow: () => invoke<void>("open_recorder_window"),
  hideRecorderWindow: () => invoke<void>("hide_recorder_window"),
  openCameraWindow: () => invoke<void>("open_camera_window"),
  hideCameraWindow: () => invoke<void>("hide_camera_window"),
  resizeCameraWindow: (size: number) => invoke<void>("resize_camera_window", { size }),
  focusMain: () => invoke<void>("focus_main"),

  mediaInfo: (path: string) => invoke<MediaInfo>("media_info", { path }),
  makeThumbnail: (req: { videoPath: string; atMs?: number; maxWidth?: number; output?: string }) =>
    invoke<string>("make_thumbnail", { req }),
  upload: (job: UploadJob) => invoke<UploadResult>("upload_to_bunny", { job }),
  prepareUpload: (tus: TusCredentials) => invoke<string>("prepare_bunny_upload", { tus }),
  rememberUpload: (path: string, uploadUrl: string) =>
    invoke<void>("remember_upload", { path, uploadUrl }),

  whisperModels: () => invoke<WhisperModelStatus[]>("whisper_models"),
  ensureWhisperModel: (jobId: string, model: WhisperModel) =>
    invoke<string>("ensure_whisper_model", { jobId, model }),
  transcribe: (job: { jobId: string; input: string; model?: WhisperModel | null }) =>
    invoke<TranscribeResult>("transcribe_recording", { job }),

  readFileBytes: async (path: string): Promise<Uint8Array> => {
    const buf = await invoke<ArrayBuffer>("read_file_bytes", { path });
    return new Uint8Array(buf);
  },
  deleteFile: (path: string) => invoke<void>("delete_file", { path }),
  pathExists: (path: string) => invoke<boolean>("path_exists", { path }),
};

let jobCounter = 0;
/** Unique id for a long-running job (used to correlate progress events). */
export function newJobId(prefix = "job"): string {
  jobCounter += 1;
  return `${prefix}-${Date.now().toString(36)}-${jobCounter}`;
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}
