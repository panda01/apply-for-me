import { describe, it, expect } from "vitest";
import { getStatusMeta, KNOWN_STATUSES } from "./jobStatus";

describe("getStatusMeta", () => {
  it("returns the configured meta for a known status", () => {
    const meta = getStatusMeta("init");
    expect(meta.label).toBe("Ready");
    expect(meta.variant).toBe("saved");
  });

  it("falls back to a label-as-status and saved variant for unknown statuses", () => {
    const meta = getStatusMeta("totally_made_up");
    expect(meta.label).toBe("totally_made_up");
    expect(meta.variant).toBe("saved");
  });

  it("covers every status in KNOWN_STATUSES", () => {
    for (const status of KNOWN_STATUSES) {
      const meta = getStatusMeta(status);
      expect(typeof meta.label).toBe("string");
      expect(meta.label.length).toBeGreaterThan(0);
    }
  });
});
