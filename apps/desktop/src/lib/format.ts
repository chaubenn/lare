import { formatLocalTimestamp } from "@lare/shared";

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  return formatLocalTimestamp(iso);
}

export function plural(n: number, singular: string, pluralForm = `${singular}s`): string {
  return `${n} ${n === 1 ? singular : pluralForm}`;
}

export function capitalize(s: string): string {
  return s.length === 0 ? s : s.charAt(0).toUpperCase() + s.slice(1);
}

/** "just now", "5m ago", "3h ago", "2d ago", then a short date. */
export function timeAgo(input: string | number | Date, now = Date.now()): string {
  const t = new Date(input).getTime();
  if (Number.isNaN(t)) return "—";
  const minutes = Math.floor((now - t) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(t).toLocaleDateString("en-AU", { day: "numeric", month: "short" });
}

/** List-row time: `dd/mm/yy h:mm am`, with the long local stamp as a title. */
export function formatListWhen(input: string | number | Date): { label: string; title: string } {
  const d = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(d.getTime())) return { label: "—", title: "—" };
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yy = String(d.getFullYear()).slice(-2);
  const time = d
    .toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true })
    .toLowerCase()
    .replace(/\s+/g, " ");
  return {
    label: `${dd}/${mm}/${yy} ${time}`,
    title: formatLocalTimestamp(input),
  };
}
