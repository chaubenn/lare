import { describe, expect, it } from "vitest";
import { postPendingState, postStateOf, postVideoSlots } from "./postState";

const base = {
  status: "published" as const,
  video_id: "v1",
  video_kind: "full" as const,
  show_video: true,
  demo_video_id: null,
  show_demo_video: true,
};

describe("postVideoSlots", () => {
  it("only counts videos the post actually shows", () => {
    expect(postVideoSlots(base, { v1: "processing" })).toEqual([{ status: "processing" }]);
    expect(postVideoSlots({ ...base, show_video: false }, { v1: "processing" })).toEqual([]);
    expect(postVideoSlots({ ...base, video_kind: "none" }, { v1: "processing" })).toEqual([]);
    expect(
      postVideoSlots({ ...base, video_id: null, demo_video_id: "d1" }, { d1: "ready" }),
    ).toEqual([{ status: "ready" }]);
    expect(postVideoSlots({ ...base, video_id: "v9" }, {})).toEqual([{ status: null }]);
  });
});

describe("postPendingState", () => {
  it("mirrors the database rule", () => {
    expect(postPendingState({ ...base, status: "draft" }, [{ status: "ready" }])).toBe("draft");
    expect(postPendingState(base, [])).toBe("live");
    expect(postPendingState(base, [{ status: "ready" }, { status: "ready" }])).toBe("live");
    expect(postPendingState(base, [{ status: "ready" }, { status: "processing" }])).toBe("pending");
    expect(postPendingState(base, [{ status: null }])).toBe("pending");
    expect(postPendingState(base, [{ status: "processing" }, { status: "failed" }])).toBe("failed");
  });

  it("reads joined video rows", () => {
    expect(postStateOf({ ...base, videos: { status: "processing" } })).toBe("pending");
    expect(postStateOf({ ...base, videos: { status: "ready" } })).toBe("live");
    expect(
      postStateOf({ ...base, demo_video_id: "d1", videos: { status: "ready" }, demo_videos: null }),
    ).toBe("pending");
  });
});
