import { describe, expect, it } from "vitest";
import { decodeAppToExt, pairingTranscript } from "./protocol";

describe("pairing handshake", () => {
  it("signs the same transcript as the desktop app", () => {
    // Pinned by `pairing_transcript_matches_the_extension` in ws_server.rs as well.
    expect(pairingTranscript("app", "u1", "aa", "bb")).toBe("lare-bridge/1\napp\nu1\naa\nbb");
  });

  it("decodes the app's challenge and its refusal for a bad proof", () => {
    expect(
      decodeAppToExt(
        JSON.stringify({ type: "auth.challenge", installId: "i", nonce: "n", proof: "p" }),
      ),
    ).toEqual({ type: "auth.challenge", installId: "i", nonce: "n", proof: "p" });
    expect(
      decodeAppToExt(JSON.stringify({ type: "error", code: "auth_failed", message: "no" })),
    ).toMatchObject({ code: "auth_failed" });
  });
});
