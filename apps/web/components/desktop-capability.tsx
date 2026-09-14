import { Card } from "@lare/ui/primitives";
import { GITHUB_RELEASES_URL } from "@/lib/env";

export function DesktopCapability() {
  return (
    <Card className="space-y-2 p-4 text-sm">
      <h2 className="font-medium">Local Whisper, on your desktop</h2>
      <p className="text-[var(--text-secondary)]">
        Web interviews are ungraded: video only, with Transcript &amp; AI review off. The Chrome
        extension always captures interviews, including screen, microphone and camera. Start an
        ungraded interview from its side panel on LeetCode.
      </p>
      <p className="text-[var(--text-secondary)]">
        For a graded interview, run the desktop app and enable Transcript &amp; AI review in the
        extension. Whisper transcribes locally on your machine; there is no cloud transcription.
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
