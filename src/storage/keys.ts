/**
 * Generic key-layout helpers. Products keep their own layouts (`whk/…`, `aud/…`); these are the
 * pieces every layout reuses:
 *
 * - {@link encodeSegment} / {@link decodeSegment} escape a free-form segment so `/` and `~` cannot
 *   break the layout;
 * - {@link lastSegment} reads a key's trailing segment back (decoded);
 * - {@link padMillis} and {@link sortableLeaf} / {@link parseSortableLeaf} build zero-padded
 *   `<millis>~<id>` leaves whose lexicographic order is chronological on every backend.
 *
 * @module
 */

/**
 * Escape a free-form key segment: `encodeURIComponent`, plus `~` → `%7E` (`~` is the separator of
 * {@link sortableLeaf}).
 */
export const encodeSegment = (segment: string): string =>
  encodeURIComponent(segment).replace(/~/g, "%7E");

/** Reverse {@link encodeSegment} (also decodes plain `encodeURIComponent` output). */
export const decodeSegment = (segment: string): string => decodeURIComponent(segment);

/** The trailing `/`-separated segment of `key`, decoded with {@link decodeSegment}. */
export const lastSegment = (key: string): string =>
  decodeSegment(key.slice(key.lastIndexOf("/") + 1));

/**
 * Zero-pad epoch milliseconds (default 13 digits, enough until the year 2286) so the
 * lexicographic order of the strings is the numeric order. Negative values clamp to 0 and
 * fractions are truncated.
 */
export const padMillis = (ms: number, width = 13): string =>
  String(Math.max(0, Math.trunc(ms))).padStart(width, "0");

/**
 * A sortable leaf `<padded millis>~<id>`: listing a prefix and sorting the keys yields them in time
 * order (ties broken by `id`). The `id` is used verbatim, so it must not contain `/`; encode
 * free-form ids with {@link encodeSegment} first.
 */
export const sortableLeaf = (ms: number, id: string, width = 13): string =>
  `${padMillis(ms, width)}~${id}`;

/**
 * Parse a {@link sortableLeaf} (or a key ending in one) back into `{ ms, id }`. Returns `null` when
 * the trailing segment has no `~`, the millis are not a number, or the id is empty. The id is
 * returned verbatim (not decoded).
 */
export function parseSortableLeaf(keyOrLeaf: string): { ms: number; id: string } | null {
  const leaf = keyOrLeaf.slice(keyOrLeaf.lastIndexOf("/") + 1);
  const sep = leaf.indexOf("~");
  if (sep <= 0) return null;
  const ms = Number(leaf.slice(0, sep));
  const id = leaf.slice(sep + 1);
  if (!Number.isFinite(ms) || id.length === 0) return null;
  return { ms, id };
}
