import { describe, expect, it } from "vitest";
import { formatLocalTimestamp } from "./format";

describe("formatLocalTimestamp", () => {
  const utc = "2026-09-12T00:50:00.000Z";

  it("renders the same instant in the viewer's timezone", () => {
    expect(formatLocalTimestamp(utc, "Australia/Brisbane")).toBe(
      "12th September 2026, 10:50am",
    );
    expect(formatLocalTimestamp(utc, "Australia/Perth")).toBe("12th September 2026, 8:50am");
  });

  it("uses ordinal suffixes", () => {
    expect(formatLocalTimestamp("2026-09-01T00:00:00.000Z", "UTC")).toBe(
      "1st September 2026, 12:00am",
    );
    expect(formatLocalTimestamp("2026-09-02T12:00:00.000Z", "UTC")).toBe(
      "2nd September 2026, 12:00pm",
    );
    expect(formatLocalTimestamp("2026-09-03T12:05:00.000Z", "UTC")).toBe(
      "3rd September 2026, 12:05pm",
    );
    expect(formatLocalTimestamp("2026-09-11T12:00:00.000Z", "UTC")).toBe(
      "11th September 2026, 12:00pm",
    );
  });

  it("returns an em dash for invalid input", () => {
    expect(formatLocalTimestamp("not-a-date")).toBe("—");
  });
});
