export function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** "two-sum" -> "Two Sum", for when LeetCode has not told us the real title. */
export function titleFromSlug(slug: string): string {
  return slug
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export interface SingleFlight<A extends unknown[], T> {
  (...args: A): Promise<T>;
  /** A run is in flight. */
  busy(): boolean;
}

/**
 * Wrap `fn` so overlapping calls share one run: while a run is in flight every caller gets its
 * promise (and the first caller's arguments); the next call after it settles starts a new one.
 */
export function singleFlight<A extends unknown[], T>(
  fn: (...args: A) => Promise<T>,
): SingleFlight<A, T> {
  let inFlight: Promise<T> | null = null;
  const run = (...args: A): Promise<T> => {
    inFlight ??= fn(...args).finally(() => {
      inFlight = null;
    });
    return inFlight;
  };
  run.busy = () => inFlight !== null;
  return run;
}
