/**
 * Native OS notifications for new in-app notifications, shown only while the Lare window is not
 * focused. The in-app list is the source of truth; anything that fails here is logged and dropped.
 */
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";
import { load, type Store } from "@tauri-apps/plugin-store";
import { inTauri } from "@/lib/tauri";

const KEY = "notifications.desktop";
let storePromise: Promise<Store> | null = null;
let askedThisSession = false;

function settings(): Promise<Store> {
  if (!storePromise)
    storePromise = load("settings.json", { autoSave: true, defaults: { [KEY]: true } });
  return storePromise;
}

export async function desktopNotificationsEnabled(): Promise<boolean> {
  if (!inTauri) return false;
  const store = await settings();
  return (await store.get<boolean>(KEY)) ?? true;
}

/** Saves the setting; turning it on asks for OS permission and stays off if refused. */
export async function setDesktopNotificationsEnabled(on: boolean): Promise<boolean> {
  if (!inTauri) return false;
  let next = on;
  if (on && !(await isPermissionGranted())) {
    next = (await requestPermission()) === "granted";
  }
  const store = await settings();
  await store.set(KEY, next);
  return next;
}

export async function notifyDesktop(body: string): Promise<void> {
  if (!inTauri) return;
  try {
    if (await getCurrentWindow().isFocused()) return;
    if (!(await desktopNotificationsEnabled())) return;
    let granted = await isPermissionGranted();
    if (!granted && !askedThisSession) {
      askedThisSession = true;
      granted = (await requestPermission()) === "granted";
    }
    if (granted) sendNotification({ title: "Lare", body });
  } catch (err) {
    console.warn("[notifications] desktop notification failed", err);
  }
}
