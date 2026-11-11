/**
 * The secret that pairs this install with the Chrome extension (migration 0032, `ws_server.rs`).
 * Kept here so the local server can admit the extension offline; published to the signed-in
 * user's `bridge_secrets` row so the extension, signed in as the same user, can read it. A new
 * secret is drawn on every sign-out, so whoever was paired before has to look it up again.
 */
import { supabase } from "@/lib/supabase";
import { setBridgeKey } from "@/lib/tauri";

const STORAGE_KEY = "lare:extension-pairing";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SECRET = /^[0-9a-f]{64}$/;

interface LocalPairing {
  installId: string;
  secret: string;
}

function randomSecret(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}

function read(): LocalPairing | null {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
    const { installId, secret } = (value ?? {}) as Partial<LocalPairing>;
    if (typeof installId === "string" && UUID.test(installId) && typeof secret === "string")
      return { installId, secret: SECRET.test(secret) ? secret : randomSecret() };
  } catch {
    // unreadable: start over
  }
  return null;
}

function write(pairing: LocalPairing): LocalPairing {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(pairing));
  return pairing;
}

function current(): LocalPairing {
  return write(read() ?? { installId: crypto.randomUUID(), secret: randomSecret() });
}

/** Signed in: the local server checks the extension against this secret, which it can read. */
export async function pairExtension(userId: string): Promise<void> {
  const { installId, secret } = current();
  await setBridgeKey({ userId, installId, secret });
  const { error } = await supabase
    .from("bridge_secrets")
    .upsert({ user_id: userId, install_id: installId, secret });
  if (error) throw error;
}

/** Signed out: nothing pairs until the next sign-in, which publishes a fresh secret. */
export async function unpairExtension(): Promise<void> {
  await setBridgeKey(null);
  const installId = read()?.installId ?? crypto.randomUUID();
  write({ installId, secret: randomSecret() });
}

/** Before signing out on purpose, while the session can still delete this install's row. */
export async function forgetExtensionPairing(userId: string): Promise<void> {
  const pairing = read();
  if (!pairing) return;
  const { error } = await supabase
    .from("bridge_secrets")
    .delete()
    .eq("user_id", userId)
    .eq("install_id", pairing.installId);
  if (error) throw error;
}
