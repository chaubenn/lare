/**
 * The CSS aspect ratio a slide should take from the media's own pixel size, so the frame fits the
 * picture and there are no bars around it. Clamped so a phone-portrait clip does not become a
 * poster and an ultrawide one a sliver. `undefined` (size unknown, as on older uploads) means
 * "use 16:9", which is the right guess for a screen recording.
 */
export function mediaAspect(
  width: number | null | undefined,
  height: number | null | undefined,
): number | undefined {
  if (!width || !height || width <= 0 || height <= 0) return undefined;
  return Math.min(2.4, Math.max(0.8, width / height));
}
