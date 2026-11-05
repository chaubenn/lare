import { formatDurationHuman } from "@lare/shared";
import { CircleAlert, RefreshCw, Trash2 } from "@lare/ui/icons";
import { useState } from "react";
import { Link } from "react-router";
import { Button } from "@/components/ui/Button";
import { Card, SectionTitle } from "@/components/ui/Card";
import type { RecordingWithMeta } from "@/features/media/hooks";
import { useRecoveryActions, useUnfinishedInterviews } from "@/features/media/recovery";
import { useNotify } from "@/features/notifications/notices";
import { confirm } from "@/lib/confirm";
import { formatDateTime, plural } from "@/lib/format";
import { errorMessage } from "@/lib/supabase";

/**
 * Sessions page: interviews recorded on this computer that never finished uploading (Lare quit
 * mid-interview, crashed, or the upload failed). Hidden when there are none.
 */
export function UnfinishedInterviews() {
  const { list } = useUnfinishedInterviews();
  if (list.length === 0) return null;
  return (
    <Card className="mb-6">
      <SectionTitle>{plural(list.length, "interview")} didn't finish uploading</SectionTitle>
      <p className="mb-3 text-sm text-[var(--text-secondary)]">
        These recordings are still on this computer. Retry to upload them to their drafts, or
        discard ones you don't need.
      </p>
      <ul className="divide-y divide-[var(--border)]">
        {list.map((recording) => (
          <li key={recording.recordingId} className="py-2.5 first:pt-0 last:pb-0">
            <UnfinishedInterviewRow recording={recording} showSessionLink />
          </li>
        ))}
      </ul>
    </Card>
  );
}

/** One take: when it was recorded, why it stopped, and Retry / Discard. */
export function UnfinishedInterviewRow({
  recording,
  showSessionLink = false,
}: {
  recording: RecordingWithMeta;
  showSessionLink?: boolean;
}) {
  const { retryUpload, discard } = useRecoveryActions();
  const { notify } = useNotify();
  const [busy, setBusy] = useState<"retry" | "discard" | null>(null);

  const doRetry = async () => {
    setBusy("retry");
    try {
      await retryUpload(recording);
    } catch {
      // The job reports its own failure as a notice, with the reason.
    } finally {
      setBusy(null);
    }
  };

  const doDiscard = async () => {
    const ok = await confirm({
      title: "Discard recording",
      message:
        "Delete this interview recording from this computer? It was never uploaded, so it can't be recovered afterwards. The session stays in your account.",
      confirmLabel: "Discard",
      cancelLabel: "Keep",
      destructive: true,
    });
    if (!ok) return;
    setBusy("discard");
    try {
      await discard(recording);
      notify({ title: "Recording discarded" });
    } catch (e) {
      notify({ title: "Couldn't discard it", description: errorMessage(e), variant: "error" });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="min-w-0 flex-1">
        <p className="text-sm text-[var(--text)]">
          Mock interview · {formatDateTime(new Date(recording.startedAt).toISOString())}
          {recording.recordedMs > 0 ? (
            <span className="text-[var(--text-tertiary)]">
              {" "}
              · {formatDurationHuman(recording.recordedMs)}
            </span>
          ) : null}
        </p>
        <p className="truncate text-xs text-[var(--text-tertiary)]" title={recording.error ?? ""}>
          {recording.error ? `Last attempt failed: ${recording.error}` : "Not uploaded yet"}
          {showSessionLink && recording.sessionId ? (
            <>
              <span aria-hidden> · </span>
              <Link
                to={`/sessions/${recording.sessionId}`}
                className="underline underline-offset-2 hover:text-[var(--text)]"
              >
                Open session
              </Link>
            </>
          ) : null}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Button
          size="sm"
          variant="secondary"
          icon={<RefreshCw className="size-3.5" aria-hidden />}
          loading={busy === "retry"}
          disabled={busy !== null || !recording.sessionId}
          tooltip={recording.sessionId ? false : "This recording isn't linked to a session."}
          onClick={() => void doRetry()}
        >
          Retry upload
        </Button>
        <Button
          size="sm"
          variant="ghost"
          icon={<Trash2 className="size-3.5" aria-hidden />}
          loading={busy === "discard"}
          disabled={busy !== null}
          onClick={() => void doDiscard()}
        >
          Discard
        </Button>
      </div>
    </div>
  );
}

/**
 * Session page, when transcription failed: transcribe the local take again, or settle for the
 * video alone (which lets Lare clean the take up once its upload is processed).
 */
export function TranscriptionRetry({ recording }: { recording: RecordingWithMeta }) {
  const { retryTranscription, keepVideoOnly } = useRecoveryActions();
  const [busy, setBusy] = useState<"retry" | "keep" | null>(null);

  const doRetry = async () => {
    setBusy("retry");
    try {
      await retryTranscription(recording);
    } catch {
      // The job reports its own failure as a notice, with the reason.
    } finally {
      setBusy(null);
    }
  };

  const doKeep = async () => {
    const ok = await confirm({
      title: "Keep as video only",
      message:
        "Stop offering to transcribe this interview? It stays video only, without a transcript or AI review.",
      confirmLabel: "Keep video only",
      cancelLabel: "Cancel",
    });
    if (!ok) return;
    setBusy("keep");
    try {
      await keepVideoOnly(recording);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex flex-col items-center gap-3 rounded-[var(--lare-r-2)] border border-dashed border-[var(--border)] px-4 py-6 text-center">
      <CircleAlert className="size-6 text-[var(--lare-danger)]" aria-hidden />
      <div className="max-w-md">
        <p className="text-sm text-[var(--text)]">Transcription failed</p>
        <p className="mt-1 select-text text-xs text-[var(--text-tertiary)]">
          {recording.transcribeError}
        </p>
        <p className="mt-2 text-sm text-zinc-400">
          The recording is still on this computer, so it can be transcribed again. Once it is, you
          can generate the AI review.
        </p>
      </div>
      <div className="flex items-center gap-2">
        <Button
          variant="primary"
          icon={<RefreshCw className="size-4" aria-hidden />}
          loading={busy === "retry"}
          disabled={busy !== null}
          onClick={() => void doRetry()}
        >
          {busy === "retry" ? "Transcribing…" : "Retry transcription"}
        </Button>
        <Button variant="ghost" disabled={busy !== null} onClick={() => void doKeep()}>
          Keep as video only
        </Button>
      </div>
    </div>
  );
}
