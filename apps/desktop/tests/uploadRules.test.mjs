import assert from "node:assert/strict";
import { test } from "node:test";
import { reusableUpload } from "../src/features/media/uploadRules.ts";

const NOW = 1_700_000_000_000;
/** An upload target whose TUS signature runs out `ms` after NOW. */
const target = (ms) => ({
  tus: { headers: { AuthorizationExpire: String(Math.floor((NOW + ms) / 1000)) } },
});
const HOUR = 3_600_000;

test("a target made for this file is used again while Bunny still accepts it", () => {
  const upload = target(HOUR);
  const meta = { upload, uploadPath: "/takes/a.mp4", uploaded: false };
  assert.equal(reusableUpload(meta, "/takes/a.mp4", NOW), upload);
});

test("a live capture's target has no file yet and fits whichever file the take becomes", () => {
  const upload = target(HOUR);
  assert.equal(reusableUpload({ upload, uploaded: false }, "/takes/a.mp4", NOW), upload);
});

test("a target made for another file is not reused", () => {
  const meta = { upload: target(HOUR), uploadPath: "/takes/a.mp4", uploaded: false };
  assert.equal(reusableUpload(meta, "/takes/b.mp4", NOW), null);
});

test("a target that already received the whole file is not reused", () => {
  const meta = { upload: target(HOUR), uploadPath: "/takes/a.mp4", uploaded: true };
  assert.equal(reusableUpload(meta, "/takes/a.mp4", NOW), null);
});

test("a target about to expire, or with no readable expiry, is replaced", () => {
  const path = "/takes/a.mp4";
  assert.equal(reusableUpload({ upload: target(30_000), uploaded: false }, path, NOW), null);
  assert.equal(reusableUpload({ upload: target(-HOUR), uploaded: false }, path, NOW), null);
  assert.equal(
    reusableUpload({ upload: { tus: { headers: {} } }, uploaded: false }, path, NOW),
    null,
  );
});

test("a recording with nothing on record gets a new target", () => {
  assert.equal(reusableUpload(null, "/takes/a.mp4", NOW), null);
  assert.equal(reusableUpload({ uploaded: false }, "/takes/a.mp4", NOW), null);
});
