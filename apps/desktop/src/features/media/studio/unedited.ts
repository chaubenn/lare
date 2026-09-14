import type { StudioEdit } from "../../../lib/recorder";

/** Raw video is reusable only when there are no separate tracks or visual edits to compose. */
export function canUseRawVideo(
  edit: StudioEdit,
  hasCamera: boolean,
  hasMic: boolean,
  clipCount: number,
): boolean {
  return (
    clipCount === 1 &&
    !hasCamera &&
    !hasMic &&
    edit.segments.length === 0 &&
    edit.padding === 0 &&
    edit.aspectRatio === null
  );
}
