import { useEffect, useState } from "react";
import { Card, SectionTitle } from "@/components/ui/Card";
import { Toggle } from "@/components/ui/Field";
import {
  desktopNotificationsEnabled,
  setDesktopNotificationsEnabled,
} from "@/features/notifications/desktopNotify";
import { inTauri } from "@/lib/tauri";

export function NotificationsPanel() {
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    void desktopNotificationsEnabled().then((value) => {
      if (active) setEnabled(value);
    });
    return () => {
      active = false;
    };
  }, []);

  const change = async (next: boolean) => {
    setBusy(true);
    try {
      setEnabled(await setDesktopNotificationsEnabled(next));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <SectionTitle>Notifications</SectionTitle>
      <Toggle
        id="desktop-notifications"
        checked={enabled}
        onChange={(next) => void change(next)}
        disabled={!inTauri || busy}
        label="Desktop notifications"
        description="Show a system notification for likes, comments and follows while Lare is in the background."
      />
    </Card>
  );
}
