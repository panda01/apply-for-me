import { describe, it, expect, vi, beforeEach } from "vitest";

// vi.hoisted shares the stub functions between the @google-cloud/storage mock
// (which the SUT constructs via `new Storage()`) and the test bodies, so each
// test can assert exactly how the GCS file handle was driven. A single shared
// `fileMock` is returned for every `.file(key)` call so the same `save`,
// `download`, `getSignedUrl`, and `delete` spies are observable here.
const { storageCtorMock, bucketMock, fileMock, saveMock, downloadMock, getSignedUrlMock, deleteMock } =
  vi.hoisted(() => {
    const saveMock = vi.fn();
    const downloadMock = vi.fn();
    const getSignedUrlMock = vi.fn();
    const deleteMock = vi.fn();
    const fileMock = vi.fn(() => ({
      save: saveMock,
      download: downloadMock,
      getSignedUrl: getSignedUrlMock,
      delete: deleteMock,
    }));
    const bucketMock = vi.fn(() => ({ file: fileMock }));
    const storageCtorMock = vi.fn(() => ({ bucket: bucketMock }));
    return { storageCtorMock, bucketMock, fileMock, saveMock, downloadMock, getSignedUrlMock, deleteMock };
  });

vi.mock("@google-cloud/storage", () => {
  // Real class so `new Storage()` in the SUT returns an object whose `.bucket`
  // is our spy. The ctor spy records construction so the singleton test can
  // assert Storage is only built once.
  class Storage {
    public bucket = bucketMock;
    public constructor() {
      storageCtorMock();
    }
  }
  return { Storage };
});

import {
  buildResumeKey,
  buildCoverLetterKey,
  uploadPdf,
  downloadObject,
  getSignedReadUrl,
  deleteObject,
  RESUME_PREFIX,
  COVER_LETTER_PREFIX,
  DOWNLOAD_URL_TTL_MS,
} from "./gcsStorageService.js";

beforeEach(() => {
  vi.clearAllMocks();
  process.env["GCS_BUCKET_NAME"] = "test-bucket";
});

describe("buildResumeKey / buildCoverLetterKey", () => {
  it("builds a resume key under the resume/ prefix ending in .pdf", () => {
    const key = buildResumeKey(123);
    expect(key.startsWith(`${RESUME_PREFIX}/123-`)).toBe(true);
    expect(key.endsWith(".pdf")).toBe(true);
  });

  it("builds a cover-letter key under the cover-letters/ prefix ending in .pdf", () => {
    const key = buildCoverLetterKey(123);
    expect(key.startsWith(`${COVER_LETTER_PREFIX}/123-`)).toBe(true);
    expect(key.endsWith(".pdf")).toBe(true);
  });

  it("produces a different resume key on each call (uuid component)", () => {
    expect(buildResumeKey(123)).not.toBe(buildResumeKey(123));
  });

  it("produces a different cover-letter key on each call (uuid component)", () => {
    expect(buildCoverLetterKey(123)).not.toBe(buildCoverLetterKey(123));
  });
});

describe("uploadPdf", () => {
  it("saves the buffer to the keyed file as a non-resumable application/pdf upload", async () => {
    saveMock.mockResolvedValue(undefined);
    const buffer = Buffer.from("%PDF-1.4 hello");

    await uploadPdf("resume/1-abc.pdf", buffer);

    expect(fileMock).toHaveBeenCalledWith("resume/1-abc.pdf");
    expect(saveMock).toHaveBeenCalledWith(buffer, {
      contentType: "application/pdf",
      resumable: false,
    });
  });
});

describe("downloadObject", () => {
  it("returns the buffer the GCS download resolves with", async () => {
    const buffer = Buffer.from("%PDF-1.4 downloaded");
    downloadMock.mockResolvedValue([buffer]);

    const result = await downloadObject("resume/1-abc.pdf");

    expect(fileMock).toHaveBeenCalledWith("resume/1-abc.pdf");
    expect(result).toBe(buffer);
  });
});

describe("getSignedReadUrl", () => {
  it("signs a v4 read URL with the default TTL and returns it", async () => {
    getSignedUrlMock.mockResolvedValue(["https://signed.example/default"]);
    const before = Date.now();

    const url = await getSignedReadUrl("resume/1-abc.pdf");

    const after = Date.now();
    expect(url).toBe("https://signed.example/default");
    expect(fileMock).toHaveBeenCalledWith("resume/1-abc.pdf");
    const callArg = getSignedUrlMock.mock.calls[0]?.[0] as {
      version: string;
      action: string;
      expires: number;
    };
    expect(callArg.version).toBe("v4");
    expect(callArg.action).toBe("read");
    // expires should be roughly now + default TTL (allow scheduling slack).
    expect(callArg.expires).toBeGreaterThanOrEqual(before + DOWNLOAD_URL_TTL_MS);
    expect(callArg.expires).toBeLessThanOrEqual(after + DOWNLOAD_URL_TTL_MS);
  });

  it("honors a custom ttlMs when computing expires", async () => {
    getSignedUrlMock.mockResolvedValue(["https://signed.example/custom"]);
    const customTtlMs = 60 * 1000;
    const before = Date.now();

    const url = await getSignedReadUrl("resume/1-abc.pdf", customTtlMs);

    const after = Date.now();
    expect(url).toBe("https://signed.example/custom");
    const callArg = getSignedUrlMock.mock.calls[0]?.[0] as { expires: number };
    expect(callArg.expires).toBeGreaterThanOrEqual(before + customTtlMs);
    expect(callArg.expires).toBeLessThanOrEqual(after + customTtlMs);
  });
});

describe("deleteObject", () => {
  it("deletes the keyed file with ignoreNotFound", async () => {
    deleteMock.mockResolvedValue(undefined);

    await deleteObject("cover-letters/9-xyz.pdf");

    expect(fileMock).toHaveBeenCalledWith("cover-letters/9-xyz.pdf");
    expect(deleteMock).toHaveBeenCalledWith({ ignoreNotFound: true });
  });
});

describe("bucket singleton", () => {
  it("constructs Storage and the bucket only once across many operations", async () => {
    // Load a fresh module copy so the lazily-constructed bucket singleton is
    // uncached: this lets us count construction precisely from zero across the
    // four operations below (the top-level import's singleton may already be
    // built by earlier tests).
    vi.resetModules();
    const freshModule = await import("./gcsStorageService.js");
    saveMock.mockResolvedValue(undefined);
    downloadMock.mockResolvedValue([Buffer.from("x")]);
    getSignedUrlMock.mockResolvedValue(["https://signed.example/s"]);
    deleteMock.mockResolvedValue(undefined);

    await freshModule.uploadPdf("resume/1-a.pdf", Buffer.from("a"));
    await freshModule.downloadObject("resume/1-a.pdf");
    await freshModule.getSignedReadUrl("resume/1-a.pdf");
    await freshModule.deleteObject("resume/1-a.pdf");

    expect(storageCtorMock).toHaveBeenCalledTimes(1);
    expect(bucketMock).toHaveBeenCalledTimes(1);
    expect(bucketMock).toHaveBeenCalledWith("test-bucket");
  });
});

describe("missing GCS_BUCKET_NAME", () => {
  it("throws an error mentioning GCS_BUCKET_NAME when the env var is unset", async () => {
    // The bucket is cached in a module-level singleton, so once constructed it
    // is reused regardless of env changes. Reset the module registry and import
    // a fresh copy AFTER deleting the env var to exercise the missing-bucket
    // throw against an uncached singleton.
    delete process.env["GCS_BUCKET_NAME"];
    vi.resetModules();
    const freshModule = await import("./gcsStorageService.js");

    await expect(freshModule.uploadPdf("resume/1-a.pdf", Buffer.from("a"))).rejects.toThrow(
      /GCS_BUCKET_NAME/
    );
  });
});
