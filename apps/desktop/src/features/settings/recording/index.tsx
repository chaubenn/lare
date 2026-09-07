/**
 * Settings → Recording: OS permissions, capture devices/resolution cap and the local whisper.cpp
 * speech model. Every change is persisted immediately through `recorder.setSettings`.
 */

import { Card, SectionTitle } from "@/components/ui/Card";
import { inTauri } from "@/lib/tauri";
import { DevicesSection } from "./DevicesSection";
import { PermissionsSection } from "./PermissionsSection";
import { ScreenSharingSection } from "./ScreenSharingSection";
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
