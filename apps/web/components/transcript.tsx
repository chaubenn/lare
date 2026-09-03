import { formatDuration, type TranscriptSegment } from "@lare/shared";
import { cardClass } from "@/lib/styles";

export function Transcript({
  segments,
  language,
}: {
  segments: TranscriptSegment[];
  language: string;
}) {
  if (segments.length === 0) return null;
  return (
    <details className={`${cardClass} group`}>
      <summary className="cursor-pointer list-none px-4 py-3 text-sm font-semibold text-zinc-200 marker:content-none sm:px-5">
        <span className="mr-2 inline-block text-zinc-600 transition-transform group-open:rotate-90">
          ▸
        </span>
        Transcript
        <span className="ml-2 text-xs font-normal text-zinc-500">
          {segments.length} segments · {language}
        </span>
      </summary>
      <ol className="max-h-96 space-y-2 overflow-y-auto border-t border-zinc-800/80 px-4 py-3 text-sm sm:px-5">
        {segments.map((seg) => (
          <li key={`${seg.s}-${seg.e}`} className="flex gap-3">
            <span className="shrink-0 font-mono text-xs text-zinc-500">
              {formatDuration(seg.s)}
            </span>
            <span className="text-zinc-300">{seg.text}</span>
          </li>
        ))}
      </ol>
    </details>
  );
}
