import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../prismaClient.js", () => ({
  default: {
    managedContainer: {
      findFirst: vi.fn(),
    },
  },
}));

import prisma from "../prismaClient.js";
import {
  findFirstRunningContainer,
  scrapeJobViaContainer,
  extractLinksViaContainer,
} from "./smartProxyScraperService.js";

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("findFirstRunningContainer", () => {
  it("returns the row from prisma.managedContainer.findFirst", async () => {
    vi.mocked(prisma.managedContainer.findFirst).mockResolvedValue({ id: 7, hostPort: 41010 } as never);

    const result = await findFirstRunningContainer();

    expect(result).toEqual({ id: 7, hostPort: 41010 });
    expect(prisma.managedContainer.findFirst).toHaveBeenCalledWith({
      where: { status: "running" },
      orderBy: { id: "asc" },
      select: { id: true, hostPort: true },
    });
  });

  it("returns null when no row is found", async () => {
    vi.mocked(prisma.managedContainer.findFirst).mockResolvedValue(null);
    expect(await findFirstRunningContainer()).toBeNull();
  });
});

describe("scrapeJobViaContainer", () => {
  const fixtureResponse = {
    is_job_description: true,
    apply_button_present: true,
    description_signals: ["Responsibilities"],
    reasoning: "ok",
    screenshot_b64: "iVBORw0KGgo=",
    title: "Software Engineer",
    company: "Acme",
    description: "Build cool things",
    salary: "$120k",
    post_date: "2026-03-01",
    apply_button_url: "https://acme.com/apply",
  };

  it("POSTs to the container's /analyze endpoint and returns the parsed subset", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(fixtureResponse),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await scrapeJobViaContainer(41010, "https://linkedin.com/jobs/1");

    expect(result).toEqual({
      title: "Software Engineer",
      company: "Acme",
      description: "Build cool things",
      salary: "$120k",
      post_date: "2026-03-01",
      apply_button_url: "https://acme.com/apply",
      is_job_description: true,
      reasoning: "ok",
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:41010/analyze",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ url: "https://linkedin.com/jobs/1", useProxy: true }),
      })
    );
  });

  it("forwards a useProxy=false override when supplied", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(fixtureResponse),
    });
    vi.stubGlobal("fetch", fetchMock);

    await scrapeJobViaContainer(41010, "https://example.com/job", false);

    const bodyArg = (fetchMock.mock.calls[0][1] as { body: string }).body;
    expect(JSON.parse(bodyArg)).toEqual({ url: "https://example.com/job", useProxy: false });
  });

  it("throws a descriptive error when the container returns a non-2xx JSON error body", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
      json: () => Promise.resolve({ error: "container crashed" }),
    }));

    await expect(scrapeJobViaContainer(41010, "https://example.com")).rejects.toThrow(/container crashed/);
  });

  it("falls back to status text when the non-2xx response has no JSON error body", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      statusText: "Service Unavailable",
      json: () => Promise.reject(new Error("non-json")),
    }));

    await expect(scrapeJobViaContainer(41010, "https://example.com")).rejects.toThrow(/503 Service Unavailable/);
  });
});

describe("extractLinksViaContainer", () => {
  it("POSTs to /extract-links and returns the parsed body", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ url: "https://acme.com/careers", links: [{ href: "https://acme.com/jobs/1", text: "SWE", accessibleName: "SWE" }] }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await extractLinksViaContainer(41010, "https://acme.com/careers");

    expect(result.links).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:41010/extract-links",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ url: "https://acme.com/careers", useProxy: true }),
      })
    );
  });

  it("forwards useProxy, waitForSelector, and timeoutMs overrides when provided", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ url: "https://x", links: [] }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await extractLinksViaContainer(41010, "https://x", {
      useProxy: false,
      waitForSelector: "#jobs",
      timeoutMs: 5000,
    });

    const bodyArg = (fetchMock.mock.calls[0][1] as { body: string }).body;
    expect(JSON.parse(bodyArg)).toEqual({
      url: "https://x",
      useProxy: false,
      waitForSelector: "#jobs",
      timeoutMs: 5000,
    });
  });

  it("throws a descriptive error when the container returns a non-2xx JSON error body", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
      json: () => Promise.resolve({ error: "playwright crashed" }),
    }));

    await expect(extractLinksViaContainer(41010, "https://x")).rejects.toThrow(/playwright crashed/);
  });

  it("falls back to status text when the non-2xx response has no JSON error body", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      statusText: "Service Unavailable",
      json: () => Promise.reject(new Error("non-json")),
    }));

    await expect(extractLinksViaContainer(41010, "https://x")).rejects.toThrow(/503 Service Unavailable/);
  });
});
