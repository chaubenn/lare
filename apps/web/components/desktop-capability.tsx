import { Card } from "@lare/ui/primitives";
import { GITHUB_RELEASES_URL } from "@/lib/env";

export function DesktopCapability() {
  return (
    <Card className="space-y-2 p-4 text-sm">
      <h2 className="font-medium">Local Whisper, on your desktop</h2>
      <p className="text-[var(--text-secondary)]">
        Mock interviews are recorded by the desktop app: start one from the Chrome extension's side
        panel on LeetCode while the app is open, and it records your screen, microphone and camera.
      </p>
      <p className="text-[var(--text-secondary)]">
        Whisper then transcribes the recording locally on your machine for the AI review; there is
        no cloud transcription.
      </p>
      <a
        className="inline-block underline underline-offset-4"
        href={GITHUB_RELEASES_URL}
        target="_blank"
        rel="noreferrer"
      >
        Get the desktop app
      </a>
    </Card>
  );
}
