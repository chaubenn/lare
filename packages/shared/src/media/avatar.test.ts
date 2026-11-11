import { describe, expect, it } from "vitest";
import { avatarPath, rejectAvatarInput, withCacheBust } from "./avatar";

describe("rejectAvatarInput", () => {
  it("accepts a normal photo", () => {
    expect(rejectAvatarInput({ type: "image/png", size: 4_000_000 })).toBeNull();
  });

  it("accepts jpeg, png, webp and gif, and nothing else", () => {
    for (const type of ["image/jpeg", "image/png", "image/webp", "image/gif"]) {
      expect(rejectAvatarInput({ type, size: 1000 })).toBeNull();
    }
    for (const type of ["image/svg+xml", "application/pdf", ""]) {
      expect(rejectAvatarInput({ type, size: 1000 })).toContain("JPEG, PNG");
    }
  });

  it("rejects a file over the input size cap", () => {
    expect(rejectAvatarInput({ type: "image/png", size: 21 * 1024 * 1024 })).toContain("20 MB");
  });
});

describe("avatarPath", () => {
  it("is a fixed filename per user, so re-uploading overwrites it", () => {
    expect(avatarPath("user-123")).toBe("user-123/avatar.jpg");
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
