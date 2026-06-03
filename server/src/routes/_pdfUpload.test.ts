import { describe, it, expect } from "vitest";
import express from "express";
import type { Request, Response } from "express";
import request from "supertest";

import { runSinglePdfUpload, isPdfBuffer, MAX_PDF_BYTES, PDF_FORM_FIELD } from "./_pdfUpload.js";

/**
 * Builds a tiny express app whose single POST route exercises
 * runSinglePdfUpload end-to-end: on success it echoes the accepted file's
 * original name; on failure runSinglePdfUpload has already written the 400.
 * @returns {express.Express} An express app with a POST /upload route
 */
function buildUploadApp(): express.Express {
  const app = express();
  app.post("/upload", async (req: Request, res: Response) => {
    const ok = await runSinglePdfUpload(req, res);
    if (!ok) {
      return;
    }
    res.json({ name: req.file?.originalname });
  });
  return app;
}

describe("isPdfBuffer", () => {
  it("returns true for a buffer beginning with the PDF signature", () => {
    expect(isPdfBuffer(Buffer.from("%PDF-1.4 some content"))).toBe(true);
  });

  it("returns false for a buffer too short to contain the signature", () => {
    expect(isPdfBuffer(Buffer.from("%PD"))).toBe(false);
  });

  it("returns false for a buffer with a non-PDF signature", () => {
    expect(isPdfBuffer(Buffer.from("NOTPDF"))).toBe(false);
  });
});

describe("runSinglePdfUpload", () => {
  it("accepts a PDF upload and populates req.file", async () => {
    const app = buildUploadApp();

    const response = await request(app)
      .post("/upload")
      .attach(PDF_FORM_FIELD, Buffer.from("%PDF-1.4 hi"), {
        filename: "r.pdf",
        contentType: "application/pdf",
      });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ name: "r.pdf" });
  });

  it("rejects a non-PDF mimetype with a 400 and a clear error", async () => {
    const app = buildUploadApp();

    const response = await request(app)
      .post("/upload")
      .attach(PDF_FORM_FIELD, Buffer.from("just text"), {
        filename: "notes.txt",
        contentType: "text/plain",
      });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe("Only PDF files are allowed");
  });

  it("rejects a PDF larger than MAX_PDF_BYTES with a 400 mentioning the limit", async () => {
    const app = buildUploadApp();

    const response = await request(app)
      .post("/upload")
      .attach(PDF_FORM_FIELD, Buffer.alloc(MAX_PDF_BYTES + 10), {
        filename: "big.pdf",
        contentType: "application/pdf",
      });

    expect(response.status).toBe(400);
    expect(response.body.error).toContain(String(MAX_PDF_BYTES));
  });
});
