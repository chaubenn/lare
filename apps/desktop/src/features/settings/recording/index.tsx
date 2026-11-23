/**
 * Settings → Recording: OS permissions, capture devices/resolution cap, the pill and facecam hotkeys
 * and the local whisper.cpp speech model. Every change is persisted immediately through
 * `recorder.setSettings`.
 */

import { Card, SectionTitle } from "@lare/ui/primitives";
import { inTauri } from "@/lib/tauri";
import { DevicesSection } from "./DevicesSection";
import { PermissionsSection } from "./PermissionsSection";
import { ScreenSharingSection } from "./ScreenSharingSection";
import { ShortcutsSection } from "./ShortcutsSection";
import { SpeechModelSection } from "./SpeechModelSection";

export function RecordingPanel() {
  return (
    <Card>
      <SectionTitle>Recording</SectionTitle>
      {inTauri ? (
        <div className="space-y-5">
          <PermissionsSection />
          <ScreenSharingSection />
          <DevicesSection />
          <ShortcutsSection />
          <SpeechModelSection />
        </div>
      ) : (
        <p className="text-sm text-[var(--text-tertiary)]">
          Recording settings are only available in the desktop app.
        </p>
      )}
    </Card>
  );
}
