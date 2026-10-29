/**
 * Monaco edit logs live as gzip'd JSON in the private `session-data` bucket
 * (`{userId}/{sessionId}/{sessionProblemId}.json.gz`, written by the extension at session end).
 */
import { type EditLog, EditLogSchema } from "@lare/shared";
import { supabase } from "@/lib/supabase";

/** Download, gunzip (browser `DecompressionStream`) and validate one edit log. */
export async function fetchEditLog(path: string): Promise<EditLog> {
  const { data, error } = await supabase.storage.from("session-data").download(path);
  if (error) throw error;
  if (!data) throw new Error("The edit log could not be downloaded.");
  const text = await new Response(
    data.stream().pipeThrough(new DecompressionStream("gzip")),
  ).text();
  const log = EditLogSchema.parse(JSON.parse(text) as unknown);
  // `codeAt` expects events sorted by time; the extension writes them in order, but be defensive.
  return { ...log, events: [...log.events].sort((a, b) => a.t - b.t) };
}

/** Wall-clock epoch ms of the log's last event, or null for an empty log. */
export function lastEditAt(log: EditLog | null | undefined): number | null {
  const last = log?.events[log.events.length - 1];
  return last ? last.t : null;
}
