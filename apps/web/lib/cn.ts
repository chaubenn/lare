/**
 * Class-name joiner for Server Components. `@lare/ui` exports the same helper, but its index
 * also re-exports hook-based components, so it can only be imported from client modules.
 */
export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}
