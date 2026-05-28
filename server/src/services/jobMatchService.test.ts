import { describe, it, expect } from "vitest";
import {
  isSameJob,
  evaluateJobMatch,
  normalizeForMatch,
  tokenizeDescription,
  computeOverlapRatio,
  MIN_DESCRIPTION_TOKEN_OVERLAP_RATIO,
} from "./jobMatchService.js";

describe("normalizeForMatch", () => {
  it("lowercases and trims", () => {
    expect(normalizeForMatch("  Hello World  ")).toBe("hello world");
  });

  it("strips punctuation but keeps unicode letters", () => {
    expect(normalizeForMatch("Senior Engineer, II!!")).toBe("senior engineer ii");
  });

  it("collapses internal whitespace", () => {
    expect(normalizeForMatch("a   b\tc\nd")).toBe("a b c d");
  });

  it("returns an empty string for input with only punctuation", () => {
    expect(normalizeForMatch("---!!!")).toBe("");
  });
});

describe("tokenizeDescription", () => {
  it("returns an empty set for empty input", () => {
    expect(tokenizeDescription("").size).toBe(0);
  });

  it("removes stop words and short tokens", () => {
    const tokens = tokenizeDescription("We are hiring a Senior Engineer for our codebase");
    // "we","are","a","for","our" → stop words; <3 chars stripped
    expect(tokens.has("hiring")).toBe(true);
    expect(tokens.has("senior")).toBe(true);
    expect(tokens.has("engineer")).toBe(true);
    expect(tokens.has("codebase")).toBe(true);
    expect(tokens.has("we")).toBe(false);
    expect(tokens.has("are")).toBe(false);
  });

  it("dedupes", () => {
    const tokens = tokenizeDescription("Engineer engineer Engineer ENGINEER");
    expect(tokens.size).toBe(1);
    expect(tokens.has("engineer")).toBe(true);
  });
});

describe("computeOverlapRatio", () => {
  it("returns 0 when the first set is empty", () => {
    expect(computeOverlapRatio(new Set(), new Set(["a"]))).toBe(0);
  });

  it("returns 1 when the first set is a subset of the second", () => {
    expect(computeOverlapRatio(new Set(["a", "b"]), new Set(["a", "b", "c"]))).toBe(1);
  });

  it("returns 0.5 for half-overlap", () => {
    expect(computeOverlapRatio(new Set(["a", "b"]), new Set(["a", "x"]))).toBe(0.5);
  });

  it("is asymmetric — denominator is the FIRST set's size", () => {
    expect(computeOverlapRatio(new Set(["a"]), new Set(["a", "b", "c", "d", "e"]))).toBe(1);
    expect(computeOverlapRatio(new Set(["a", "b", "c", "d", "e"]), new Set(["a"]))).toBe(0.2);
  });
});

describe("isSameJob", () => {
  it("rejects when title is empty after normalization", () => {
    expect(isSameJob({
      originalTitle: "  ",
      originalDescription: "anything",
      candidateTitle: "Software Engineer",
      candidateDescription: "anything",
    })).toBe(false);
  });

  it("rejects when candidate title is empty after normalization", () => {
    expect(isSameJob({
      originalTitle: "Software Engineer",
      originalDescription: "anything",
      candidateTitle: " --- ",
      candidateDescription: "anything",
    })).toBe(false);
  });

  it("rejects when normalized titles don't match", () => {
    expect(isSameJob({
      originalTitle: "Software Engineer",
      originalDescription: "x y z",
      candidateTitle: "Product Manager",
      candidateDescription: "x y z",
    })).toBe(false);
  });

  it("accepts when titles match and descriptions overlap above threshold", () => {
    const original = "We are looking for an engineer to build distributed systems with kafka and rust";
    const candidate = "Engineer for distributed systems with kafka and rust, building reliable backend services";
    expect(isSameJob({
      originalTitle: "Software Engineer",
      originalDescription: original,
      candidateTitle: "software engineer",
      candidateDescription: candidate,
    })).toBe(true);
  });

  it("rejects when titles match but descriptions diverge", () => {
    expect(isSameJob({
      originalTitle: "Software Engineer",
      originalDescription: "distributed systems kafka rust",
      candidateTitle: "Software Engineer",
      candidateDescription: "frontend react design tokens accessibility",
    })).toBe(false);
  });

  it("normalizes punctuation when comparing titles", () => {
    expect(isSameJob({
      originalTitle: "Senior Engineer (Platform)",
      originalDescription: "distributed kafka rust backend reliability latency throughput services",
      candidateTitle: "Senior Engineer Platform",
      candidateDescription: "distributed kafka rust backend reliability latency throughput services scalability",
    })).toBe(true);
  });
});

describe("MIN_DESCRIPTION_TOKEN_OVERLAP_RATIO export", () => {
  it("is a number between 0 and 1", () => {
    expect(typeof MIN_DESCRIPTION_TOKEN_OVERLAP_RATIO).toBe("number");
    expect(MIN_DESCRIPTION_TOKEN_OVERLAP_RATIO).toBeGreaterThan(0);
    expect(MIN_DESCRIPTION_TOKEN_OVERLAP_RATIO).toBeLessThan(1);
  });
});

describe("evaluateJobMatch", () => {
  it("returns matched=false with 'original title is empty' when original title is empty after normalization", () => {
    const v = evaluateJobMatch({
      originalTitle: "   ",
      originalDescription: "x",
      candidateTitle: "Software Engineer",
      candidateDescription: "x",
    });
    expect(v.matched).toBe(false);
    expect(v.reason).toMatch(/original title is empty/);
  });

  it("returns matched=false with 'candidate title is empty' when candidate title is empty after normalization", () => {
    const v = evaluateJobMatch({
      originalTitle: "Software Engineer",
      originalDescription: "x",
      candidateTitle: "!!",
      candidateDescription: "x",
    });
    expect(v.matched).toBe(false);
    expect(v.reason).toMatch(/candidate title is empty/);
  });

  it("returns matched=false with 'title mismatch' reason when normalized titles differ", () => {
    const v = evaluateJobMatch({
      originalTitle: "Software Engineer",
      originalDescription: "x",
      candidateTitle: "Data Scientist",
      candidateDescription: "x",
    });
    expect(v.matched).toBe(false);
    expect(v.reason).toMatch(/title mismatch/);
  });

  it("returns matched=true when the candidate title is contained in the original title (containment)", () => {
    const v = evaluateJobMatch({
      originalTitle: "Full Stack Engineer - Senior",
      originalDescription: "react node typescript backend",
      candidateTitle: "Full Stack Engineer",
      candidateDescription: "react node typescript backend",
    });
    expect(v.matched).toBe(true);
  });

  it("returns matched=true when the original title is contained in the candidate title (containment)", () => {
    const v = evaluateJobMatch({
      originalTitle: "Software Engineer",
      originalDescription: "react node typescript backend",
      candidateTitle: "Senior Software Engineer",
      candidateDescription: "react node typescript backend",
    });
    expect(v.matched).toBe(true);
  });

  it("returns matched=false with 'title mismatch' reason when containment would break a word boundary", () => {
    const v = evaluateJobMatch({
      originalTitle: "Engineer",
      originalDescription: "react node typescript backend",
      candidateTitle: "Engineering Manager",
      candidateDescription: "react node typescript backend",
    });
    expect(v.matched).toBe(false);
    expect(v.reason).toMatch(/title mismatch/);
  });

  it("returns matched=true and skips the overlap check when the original description has no usable tokens", () => {
    const v = evaluateJobMatch({
      originalTitle: "Full Stack Engineer - Senior",
      originalDescription: "",
      candidateTitle: "Full Stack Engineer",
      candidateDescription: "anything here",
    });
    expect(v.matched).toBe(true);
    expect(v.reason).toMatch(/skip/i);
  });

  it("returns matched=false with the overlap percentage in the reason when descriptions diverge", () => {
    const v = evaluateJobMatch({
      originalTitle: "Software Engineer",
      originalDescription: "distributed kafka rust backend reliability latency throughput services scalability",
      candidateTitle: "Software Engineer",
      candidateDescription: "frontend react design tokens accessibility",
    });
    expect(v.matched).toBe(false);
    expect(v.reason).toMatch(/\d+% below \d+% threshold/);
  });

  it("returns matched=true with the overlap percentage in the reason when match succeeds", () => {
    const v = evaluateJobMatch({
      originalTitle: "Software Engineer",
      originalDescription: "distributed kafka rust backend reliability latency throughput services",
      candidateTitle: "software engineer",
      candidateDescription: "distributed kafka rust backend reliability latency throughput services scalability",
    });
    expect(v.matched).toBe(true);
    expect(v.reason).toMatch(/\d+% >= \d+%/);
  });
});
