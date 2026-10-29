import assert from "node:assert/strict";
import { test } from "node:test";
import { copiesToRemove, localFileFor } from "../src/features/media/localCopyRules.ts";

const metas = [
  { recordingId: "r-ready", videoId: "v-ready", uploaded: true },
  { recordingId: "r-processing", videoId: "v-processing", uploaded: true },
  { recordingId: "r-failed", videoId: "v-failed", uploaded: true },
  { recordingId: "r-uploading", videoId: "v-uploading", uploaded: false },
  { recordingId: "r-deleted", videoId: "v-deleted", uploaded: true },
  { recordingId: "r-no-video", videoId: null, uploaded: false },
];
const recordings = [
  { recordingId: "r-processing", outputMp4: "/rec/r-processing/content/capture.mp4" },
  { recordingId: "r-uploading", outputMp4: "/rec/r-uploading/content/capture.mp4" },
  { recordingId: "r-empty", outputMp4: null },
];

test("a local copy is played only while its cloud video is not ready", () => {
  assert.equal(
    localFileFor("v-processing", "processing", metas, recordings),
    "/rec/r-processing/content/capture.mp4",
  );
  assert.equal(
    localFileFor("v-uploading", "uploading", metas, recordings),
    "/rec/r-uploading/content/capture.mp4",
  );
  assert.equal(localFileFor("v-processing", "ready", metas, recordings), null);
  assert.equal(localFileFor("v-unknown", "processing", metas, recordings), null);
  assert.equal(localFileFor("v-ready", "processing", metas, recordings), null);
});

test("only uploaded copies whose video is ready, or gone, are removed", () => {
  const statuses = {
    "v-ready": "ready",
    "v-processing": "processing",
    "v-failed": "failed",
    "v-uploading": "ready",
  };
  assert.deepEqual(copiesToRemove(metas, statuses).sort(), ["r-deleted", "r-ready"]);
});
