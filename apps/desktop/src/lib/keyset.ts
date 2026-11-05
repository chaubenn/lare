/**
 * Keyset ("seek") pagination for newest-first lists ordered by `<column> desc, id desc`.
 *
 * Offsets drift when rows are added while you page (a new notification would push the next page
 * down by one and repeat a row), and a timestamp alone can skip rows written in the same
 * transaction. The id breaks those ties.
 */

export interface KeysetCursor {
  /** The ordering column's value on the last row of the previous page. */
  at: string;
  id: string;
}

/**
 * PostgREST `or` filter for the rows after `cursor`. Values are double-quoted because timestamps
 * contain `:` and `.`, which the filter grammar otherwise reads as separators.
 */
export function keysetFilter(column: string, cursor: KeysetCursor): string {
  const at = JSON.stringify(cursor.at);
  const id = JSON.stringify(cursor.id);
  return `${column}.lt.${at},and(${column}.eq.${at},id.lt.${id})`;
}

/**
 * The cursor for the page after `rows`, or `undefined` when this page came back short (the end).
 * `rows` is the raw page, before any parsing that might drop rows.
 */
export function nextCursor<T extends { id: string }>(
  rows: readonly T[],
  pageSize: number,
  at: (row: T) => string | null,
): KeysetCursor | undefined {
  if (rows.length < pageSize) return undefined;
  const last = rows[rows.length - 1];
  const value = last ? at(last) : null;
  return last && value ? { at: value, id: last.id } : undefined;
}
