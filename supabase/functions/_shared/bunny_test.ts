import { mapWebhookStatus } from "./bunny.ts";

Deno.test("first finished resolution is playable, non-video events do not change state", () => {
  for (const [input, expected] of [
    [0, "processing"],
    [1, "processing"],
    [2, "processing"],
    [3, "ready"],
    [4, "ready"],
    [5, "failed"],
    [6, "uploading"],
    [7, "uploaded"],
    [8, "failed"],
    [9, null],
    [10, null],
  ] as const) {
    if (mapWebhookStatus(input) !== expected) throw new Error(`Wrong mapping for ${input}`);
  }
});
