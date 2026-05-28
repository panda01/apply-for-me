import { describe, it, expect } from "vitest";
import {
  parsePageSummary,
  isJobDescriptionPage,
  firstApplyButtonHref,
  parseHaikuFields,
  buildExtractionPrompt,
  deriveFallbackTitle,
  type PageSummary,
} from "./agent.js";

/**
 * Builds a PageSummary with empty defaults, overriding only the fields a given
 * test cares about — keeps the heuristic-gate cases readable.
 *
 * @param {Partial<PageSummary>} overrides - Fields to override on the empty base
 * @returns {PageSummary} A fully-populated summary
 */
function makeSummary(overrides: Partial<PageSummary>): PageSummary {
  const base: PageSummary = {
    url: "https://jobs.example.com/1",
    title: "",
    headings: [],
    buttons: [],
    applyButtons: [],
    hasApplicationForm: false,
    mainText: "",
    salaryMatches: [],
    employmentTypes: [],
    worksite: [],
    experienceMarkers: [],
  };
  return { ...base, ...overrides };
}

describe("parsePageSummary", () => {
  it("parses a well-formed summary JSON into typed fields", () => {
    const json = JSON.stringify({
      url: "https://x.com/1",
      title: "Engineer",
      headings: ["Responsibilities"],
      buttons: ["Apply"],
      applyButtons: [{ label: "Apply", href: "https://x.com/apply" }],
      mainText: "Body",
      salaryMatches: ["$100k"],
      employmentTypes: ["Full-time"],
      worksite: ["Remote"],
      experienceMarkers: ["Senior"],
    });
    const parsed = parsePageSummary(json);
    expect(parsed.title).toBe("Engineer");
    expect(parsed.applyButtons).toEqual([{ label: "Apply", href: "https://x.com/apply" }]);
    expect(parsed.salaryMatches).toEqual(["$100k"]);
  });

  it("returns an empty summary for malformed JSON", () => {
    expect(parsePageSummary("{not json")).toEqual(makeSummary({ url: "" }));
  });

  it("returns an empty summary when the JSON is not an object", () => {
    expect(parsePageSummary("42")).toEqual(makeSummary({ url: "" }));
  });

  it("drops non-string array entries and non-object apply buttons defensively", () => {
    const json = JSON.stringify({
      headings: ["ok", 5, null],
      applyButtons: ["bad", { label: "Apply", href: "https://x/apply" }, 7],
    });
    const parsed = parsePageSummary(json);
    expect(parsed.headings).toEqual(["ok"]);
    expect(parsed.applyButtons).toEqual([{ label: "Apply", href: "https://x/apply" }]);
  });
});

describe("isJobDescriptionPage", () => {
  it("classifies as a posting when an apply affordance and >=2 Class B signals are present", () => {
    const verdict = isJobDescriptionPage(makeSummary({
      applyButtons: [{ label: "Apply now", href: "https://x/apply" }],
      headings: ["Responsibilities"],
      salaryMatches: ["$120k"],
    }));
    expect(verdict.isJobDescription).toBe(true);
    expect(verdict.applyAffordancePresent).toBe(true);
    expect(verdict.classBSignals).toEqual(["Job sections", "Salary"]);
  });

  it("detects the apply affordance from a general button label when applyButtons is empty", () => {
    const verdict = isJobDescriptionPage(makeSummary({
      buttons: ["Easy Apply"],
      employmentTypes: ["Contract"],
      worksite: ["Hybrid"],
    }));
    expect(verdict.applyAffordancePresent).toBe(true);
    expect(verdict.isJobDescription).toBe(true);
  });

  it("is NOT a posting when there is no apply affordance, even with many Class B signals", () => {
    const verdict = isJobDescriptionPage(makeSummary({
      headings: ["Requirements"],
      salaryMatches: ["$120k"],
      worksite: ["Remote"],
    }));
    expect(verdict.applyAffordancePresent).toBe(false);
    expect(verdict.isJobDescription).toBe(false);
  });

  it("is NOT a posting when there are fewer than 2 Class B signals", () => {
    const verdict = isJobDescriptionPage(makeSummary({
      applyButtons: [{ label: "Apply", href: "https://x/apply" }],
      salaryMatches: ["$120k"],
    }));
    expect(verdict.classBSignals).toEqual(["Salary"]);
    expect(verdict.isJobDescription).toBe(false);
  });

  it("treats a CV-upload / contact application form as an apply affordance", () => {
    const verdict = isJobDescriptionPage(makeSummary({
      hasApplicationForm: true,
      salaryMatches: ["$120k"],
      worksite: ["Remote"],
    }));
    expect(verdict.applyAffordancePresent).toBe(true);
    expect(verdict.isJobDescription).toBe(true);
  });

  it("treats a textual salary mention in mainText as the Salary signal", () => {
    const verdict = isJobDescriptionPage(makeSummary({
      applyButtons: [{ label: "Apply", href: "https://x/a" }],
      mainText: "Competitive salary based on experience",
      worksite: ["Remote"],
    }));
    expect(verdict.classBSignals).toContain("Salary");
    expect(verdict.isJobDescription).toBe(true);
  });

  it("treats a benefit-style heading as the Job sections signal", () => {
    const verdict = isJobDescriptionPage(makeSummary({
      applyButtons: [{ label: "Apply", href: "https://x/a" }],
      headings: ["Working with us means"],
      experienceMarkers: ["Senior"],
    }));
    expect(verdict.classBSignals).toContain("Job sections");
    expect(verdict.isJobDescription).toBe(true);
  });
});

describe("firstApplyButtonHref", () => {
  it("returns the first absolute http(s) apply-button href", () => {
    const summary = makeSummary({
      applyButtons: [
        { label: "Apply", href: "/relative" },
        { label: "Apply", href: "https://acme.com/apply" },
      ],
    });
    expect(firstApplyButtonHref(summary)).toBe("https://acme.com/apply");
  });

  it("returns null when no apply button has an absolute http(s) href", () => {
    const summary = makeSummary({ applyButtons: [{ label: "Apply", href: "javascript:void(0)" }] });
    expect(firstApplyButtonHref(summary)).toBeNull();
  });
});

describe("parseHaikuFields", () => {
  it("trims fields and nulls blank salary/post_date", () => {
    const fields = parseHaikuFields({
      title: "  Engineer  ",
      company: " Acme ",
      salary: "   ",
      post_date: "",
      work_arrangement: " remote ",
    });
    expect(fields).toEqual({
      title: "Engineer",
      company: "Acme",
      salary: null,
      post_date: null,
      work_arrangement: "remote",
      location: "",
    });
  });

  it("keeps non-blank salary/post_date verbatim (after trim)", () => {
    const fields = parseHaikuFields({ salary: " $100k ", post_date: " 2 days ago " });
    expect(fields.salary).toBe("$100k");
    expect(fields.post_date).toBe("2 days ago");
  });

  it("returns empty fields for non-object input", () => {
    expect(parseHaikuFields(null)).toEqual({
      title: "",
      company: "",
      salary: null,
      post_date: null,
      work_arrangement: "",
      location: "",
    });
  });

  it("extracts and trims the location field", () => {
    const fields = parseHaikuFields({ location: "  Remote  " });
    expect(fields.location).toBe("Remote");
  });
});

describe("buildExtractionPrompt", () => {
  it("surfaces the heuristic tokens and the capped main text", () => {
    const prompt = buildExtractionPrompt(makeSummary({
      title: "Senior Engineer",
      salaryMatches: ["$120k"],
      mainText: "We are hiring",
    }));
    expect(prompt).toContain("Page title: Senior Engineer");
    expect(prompt).toContain("Salary regex matches: $120k");
    expect(prompt).toContain("We are hiring");
  });

  it("renders '(none)' for empty token lists", () => {
    const prompt = buildExtractionPrompt(makeSummary({ title: "x" }));
    expect(prompt).toContain("Worksite tokens: (none)");
  });
});

describe("deriveFallbackTitle", () => {
  it("returns the first non-empty heading", () => {
    const title = deriveFallbackTitle(makeSummary({
      headings: ["Senior React Engineer", "Responsibilities"],
    }));
    expect(title).toBe("Senior React Engineer");
  });

  it("returns an empty string when there are no headings", () => {
    expect(deriveFallbackTitle(makeSummary({ headings: [] }))).toBe("");
  });
});
