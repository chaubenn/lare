// Deno mirror of packages/shared/src/edits.ts (replay + checkpoints). Keep in sync.

export type EditChange = [number, number, string];
export interface EditEvent {
  t: number;
  v: number;
  c: EditChange[];
  full?: string;
}
export interface EditLog {
  version: number;
  slug: string;
  language?: string;
  events: EditEvent[];
}

export function applyEvent(text: string, event: EditEvent): string {
  if (event.full !== undefined) return event.full;
  const changes = [...event.c].sort((a, b) => b[0] - a[0]);
  let out = text;
  for (const [offset, length, insert] of changes) {
    if (offset > out.length) return out; // tolerate corrupt logs in the reviewer
    out = out.slice(0, offset) + insert + out.slice(offset + length);
  }
  return out;
}

export function checkpoints(events: EditEvent[], pauseMs = 20_000): { t: number; code: string }[] {
  const out: { t: number; code: string }[] = [];
  let text = "";
  for (let i = 0; i < events.length; i++) {
    const e = events[i]!;
    text = applyEvent(text, e);
    const next = events[i + 1];
    if (!next || next.t - e.t >= pauseMs) {
      const prev = out[out.length - 1];
      if (!prev || prev.code !== text) out.push({ t: e.t, code: text });
    }
  }
  return out;
}

export function lineDiff(before: string, after: string): { added: string[]; removed: string[] } {
  const count = (lines: string[]) => {
    const m = new Map<string, number>();
    for (const l of lines) m.set(l, (m.get(l) ?? 0) + 1);
    return m;
  };
  const a = count(before.split("\n"));
  const b = count(after.split("\n"));
  const added: string[] = [];
  const removed: string[] = [];
  for (const [line, n] of b) for (let i = 0; i < n - (a.get(line) ?? 0); i++) added.push(line);
  for (const [line, n] of a) for (let i = 0; i < n - (b.get(line) ?? 0); i++) removed.push(line);
  return { added, removed };
}

export async function gunzipJson<T>(bytes: Uint8Array): Promise<T> {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const stream = new Blob([copy.buffer as ArrayBuffer])
    .stream()
    .pipeThrough(new DecompressionStream("gzip"));
  const text = await new Response(stream).text();
  return JSON.parse(text) as T;
}
