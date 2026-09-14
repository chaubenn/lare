import { describe, expect, it } from "vitest";
import { websiteHref, websiteLabel } from "./website";

describe("websiteHref", () => {
  it("prepends https:// when there is no scheme", () => {
    expect(websiteHref("example.com")).toBe("https://example.com");
  });

  it("leaves an https:// url untouched", () => {
    expect(websiteHref("https://example.com/path")).toBe("https://example.com/path");
  });

  it("leaves a plain http:// url untouched", () => {
    expect(websiteHref("http://example.com")).toBe("http://example.com");
  });

  it("trims surrounding whitespace", () => {
    expect(websiteHref("  example.com  ")).toBe("https://example.com");
  });
});

describe("websiteLabel", () => {
  it("strips the https:// scheme for display", () => {
    expect(websiteLabel("https://example.com")).toBe("example.com");
  });

  it("strips the http:// scheme for display", () => {
    expect(websiteLabel("http://example.com")).toBe("example.com");
  });

  it("strips a single trailing slash", () => {
    expect(websiteLabel("https://example.com/")).toBe("example.com");
  });

  it("keeps a deeper path intact", () => {
    expect(websiteLabel("https://example.com/in/handle")).toBe("example.com/in/handle");
  });

  it("passes through a url with no scheme unchanged", () => {
    expect(websiteLabel("example.com")).toBe("example.com");
  });
});
