import { describe, expect, it } from "vitest";
import { avatarPath, isAvatarInputMime, rejectAvatarInput, withCacheBust } from "./avatar";

describe("isAvatarInputMime", () => {
  it("accepts jpeg, png, webp and gif", () => {
    expect(isAvatarInputMime("image/jpeg")).toBe(true);
    expect(isAvatarInputMime("image/png")).toBe(true);
    expect(isAvatarInputMime("image/webp")).toBe(true);
    expect(isAvatarInputMime("image/gif")).toBe(true);
  });

  it("rejects anything else", () => {
    expect(isAvatarInputMime("image/svg+xml")).toBe(false);
    expect(isAvatarInputMime("application/pdf")).toBe(false);
    expect(isAvatarInputMime("")).toBe(false);
  });
});

describe("rejectAvatarInput", () => {
  it("accepts a normal photo", () => {
    expect(rejectAvatarInput({ type: "image/png", size: 4_000_000 })).toBeNull();
  });

  it("rejects an unsupported type", () => {
    expect(rejectAvatarInput({ type: "image/svg+xml", size: 1000 })).toContain("JPEG, PNG");
  });

  it("rejects a file over the input size cap", () => {
    expect(rejectAvatarInput({ type: "image/png", size: 21 * 1024 * 1024 })).toContain("20 MB");
  });
});

describe("avatarPath", () => {
  it("is a fixed filename per user, so re-uploading overwrites it", () => {
    expect(avatarPath("user-123")).toBe("user-123/avatar.jpg");
    expect(avatarPath("user-123")).toBe(avatarPath("user-123"));
  });
});

describe("withCacheBust", () => {
  it("appends a version query param", () => {
    expect(withCacheBust("https://x.test/avatars/u1/avatar.jpg", 42)).toBe(
      "https://x.test/avatars/u1/avatar.jpg?v=42",
    );
  });

  it("appends with `&` when the url already has a query string", () => {
    expect(withCacheBust("https://x.test/avatar.jpg?token=abc", 42)).toBe(
      "https://x.test/avatar.jpg?token=abc&v=42",
    );
  });
});
