import { describe, it, expect } from "vitest";

import { getEmailLabelColor } from "./senderColorPalette.js";

describe("getEmailLabelColor", () => {
  it("returns the LinkedIn color for an exact linkedin.com host", () => {
    expect(getEmailLabelColor("jobs@linkedin.com")).toBe("#0a66c2");
  });

  it("returns the Wellfound color for an exact wellfound.com host", () => {
    expect(getEmailLabelColor("hi@wellfound.com")).toBe("#21c55d");
  });

  it("returns the Indeed color for an exact indeed.com host", () => {
    expect(getEmailLabelColor("alerts@indeed.com")).toBe("#2557a7");
  });

  it("returns the ZipRecruiter color for an exact ziprecruiter.com host", () => {
    expect(getEmailLabelColor("noreply@ziprecruiter.com")).toBe("#1f7da3");
  });

  it("returns the Glassdoor color for an exact glassdoor.com host", () => {
    expect(getEmailLabelColor("alerts@glassdoor.com")).toBe("#0caa41");
  });

  it("matches subdomains by suffix (jobs.linkedin.com → LinkedIn color)", () => {
    expect(getEmailLabelColor("noreply@jobs.linkedin.com")).toBe("#0a66c2");
  });

  it("matches deep subdomains by suffix (jobs-noreply.linkedin.com → LinkedIn color)", () => {
    expect(getEmailLabelColor("alerts@m.email.indeed.com")).toBe("#2557a7");
  });

  it("returns null for an unknown sender domain", () => {
    expect(getEmailLabelColor("someone@example.com")).toBeNull();
  });

  it("returns null when the input has no @ sign", () => {
    expect(getEmailLabelColor("not-an-email")).toBeNull();
  });

  it("does NOT match adversarial suffixes like linkedin.com.evil.example", () => {
    expect(getEmailLabelColor("x@linkedin.com.evil.example")).toBeNull();
  });

  it("is case-insensitive in the host portion", () => {
    expect(getEmailLabelColor("Jobs@LinkedIn.COM")).toBe("#0a66c2");
  });
});
