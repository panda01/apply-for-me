import { describe, it, expect } from "vitest";

import { stripTrackingParams } from "./urlSanitizerService";

describe("stripTrackingParams", () => {
  it("strips utm_* params, leaving a bare path", () => {
    const cleaned = stripTrackingParams(
      "https://x.com/job?utm_source=a&utm_medium=b",
    );

    expect(cleaned).toBe("https://x.com/job");
  });

  it("strips generic click ids like fbclid and gclid", () => {
    const withFbclid = stripTrackingParams("https://x.com/job?fbclid=abc123");
    expect(withFbclid).toBe("https://x.com/job");

    const withGclid = stripTrackingParams("https://x.com/job?gclid=xyz789");
    expect(withGclid).toBe("https://x.com/job");
  });

  it("strips LinkedIn email/instrumentation tokens but keeps the path intact", () => {
    const cleaned = stripTrackingParams(
      "https://www.linkedin.com/comm/jobs/view/4418237829/?trackingId=abc&refId=def&eid=ghi&trk=jkl",
    );

    expect(cleaned).toBe(
      "https://www.linkedin.com/comm/jobs/view/4418237829/",
    );
    expect(cleaned).not.toContain("trackingId");
    expect(cleaned).not.toContain("refId");
    expect(cleaned).not.toContain("eid");
    expect(cleaned).not.toContain("trk");
  });

  it("preserves functional params while stripping tracking ones", () => {
    const cleaned = stripTrackingParams(
      "https://boards.greenhouse.io/acme/jobs/123?gh_jid=456&utm_source=a",
    );

    expect(cleaned).toBe(
      "https://boards.greenhouse.io/acme/jobs/123?gh_jid=456",
    );
  });

  it("matches tracking keys case-insensitively", () => {
    const cleaned = stripTrackingParams("https://x.com/j?TrackingId=x");

    expect(cleaned).toBe("https://x.com/j");
    expect(cleaned.toLowerCase()).not.toContain("trackingid");
  });

  it("returns the original string unchanged when there are no tracking params", () => {
    const original = "https://x.com/job?gh_jid=456";

    expect(stripTrackingParams(original)).toBe(original);
  });

  it("returns the original string unchanged for an unparseable URL", () => {
    const original = "not a url";

    expect(stripTrackingParams(original)).toBe(original);
  });
});
