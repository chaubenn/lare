import { formatLocalTimestamp, formatRelativeTime } from "@lare/shared";

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  return formatLocalTimestamp(iso);
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, { dateStyle: "medium" });
}

export function plural(n: number, singular: string, pluralForm = `${singular}s`): string {
  return `${n} ${n === 1 ? singular : pluralForm}`;
}

export function capitalize(s: string): string {
  return s.length === 0 ? s : s.charAt(0).toUpperCase() + s.slice(1);
}

/** Short list-row time: "2d ago", with the full local stamp available as a title. */
export function formatListWhen(input: string | number | Date): { label: string; title: string } {
  const iso = input instanceof Date ? input.toISOString() : new Date(input).toISOString();
  return { label: formatRelativeTime(iso), title: formatLocalTimestamp(input) };
}
