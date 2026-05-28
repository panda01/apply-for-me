import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./smartProxyScraperService.js", () => ({
  extractLinksViaContainer: vi.fn(),
}));

import { extractLinksViaContainer } from "./smartProxyScraperService.js";
import { buildFuzzyMatchText, harvestCareersPage } from "./careersPageHarvesterService.js";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("buildFuzzyMatchText", () => {
  it("combines text and accessibleName when they differ", () => {
    const result = buildFuzzyMatchText({ href: "https://x", text: "Senior", accessibleName: "Senior Engineer" });
    expect(result).toBe("Senior Senior Engineer");
  });

  it("returns text alone when accessibleName matches it", () => {
    const result = buildFuzzyMatchText({ href: "https://x", text: "Senior", accessibleName: "Senior" });
    expect(result).toBe("Senior");
  });

  it("falls back to accessibleName when text is empty", () => {
    const result = buildFuzzyMatchText({ href: "https://x", text: "", accessibleName: "Apply now" });
    expect(result).toBe("Apply now");
  });

  it("returns text when accessibleName is empty", () => {
    const result = buildFuzzyMatchText({ href: "https://x", text: "Engineer", accessibleName: "" });
    expect(result).toBe("Engineer");
  });

  it("returns empty string when both fields are blank", () => {
    expect(buildFuzzyMatchText({ href: "https://x", text: "", accessibleName: "" })).toBe("");
  });
});

describe("harvestCareersPage", () => {
  it("deduplicates by href and returns the top scored hrefs", async () => {
    vi.mocked(extractLinksViaContainer).mockResolvedValue({
      url: "https://acme.com/careers",
      links: [
        { href: "https://acme.com/jobs/swe", text: "Software Engineer", accessibleName: "Software Engineer" },
        { href: "https://acme.com/jobs/swe", text: "Software Engineer", accessibleName: "Software Engineer" },
        { href: "https://acme.com/about", text: "About Us", accessibleName: "About" },
      ],
    });

    const result = await harvestCareersPage(41010, "https://acme.com/careers", "Software Engineer");

    expect(result.careersPageUrl).toBe("https://acme.com/careers");
    expect(result.rawLinkCount).toBe(3);
    // Only one unique href above the fuzzy threshold should remain.
    expect(result.topHrefs.length).toBeGreaterThan(0);
    expect(result.topHrefs[0]?.href).toBe("https://acme.com/jobs/swe");
    expect(result.topHrefs[0]?.score).toBeGreaterThan(0.5);
  });

  it("returns an empty topHrefs list when no link meets the fuzzy threshold", async () => {
    vi.mocked(extractLinksViaContainer).mockResolvedValue({
      url: "https://acme.com/careers",
      links: [
        { href: "https://acme.com/login", text: "Sign in", accessibleName: "Login" },
        { href: "https://acme.com/about", text: "About Us", accessibleName: "About" },
      ],
    });

    const result = await harvestCareersPage(41010, "https://acme.com/careers", "Software Engineer");

    expect(result.rawLinkCount).toBe(2);
    expect(result.topHrefs).toEqual([]);
  });

  it("returns an empty topHrefs list when the container returns no links", async () => {
    vi.mocked(extractLinksViaContainer).mockResolvedValue({ url: "https://acme.com/careers", links: [] });

    const result = await harvestCareersPage(41010, "https://acme.com/careers", "Software Engineer");

    expect(result.rawLinkCount).toBe(0);
    expect(result.topHrefs).toEqual([]);
  });

  it("propagates errors from extractLinksViaContainer", async () => {
    vi.mocked(extractLinksViaContainer).mockRejectedValue(new Error("container unreachable"));

    await expect(
      harvestCareersPage(41010, "https://acme.com/careers", "Software Engineer")
    ).rejects.toThrow("container unreachable");
  });
});
