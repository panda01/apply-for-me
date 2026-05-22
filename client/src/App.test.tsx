import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

/**
 * Minimal in-memory localStorage stand-in. The configured jsdom environment
 * does not expose a real Storage implementation, so we stub one onto window
 * BEFORE importing App — AppShell reads `afm:sidebar` during its useState
 * initializer, so the stub must exist before the first render runs.
 */
const inMemoryStorage = new Map<string, string>();
Object.defineProperty(window, "localStorage", {
  configurable: true,
  value: {
    getItem: (key: string): string | null => inMemoryStorage.get(key) ?? null,
    setItem: (key: string, value: string): void => { inMemoryStorage.set(key, value); },
    removeItem: (key: string): void => { inMemoryStorage.delete(key); },
    clear: (): void => { inMemoryStorage.clear(); },
    key: (index: number): string | null => Array.from(inMemoryStorage.keys())[index] ?? null,
    get length(): number { return inMemoryStorage.size; },
  },
});

vi.mock("./services/jobListingsApi", () => ({
  getJobListings: vi.fn().mockResolvedValue([]),
  createJobListing: vi.fn(),
  deleteJobListing: vi.fn(),
}));

vi.mock("./services/managedContainersApi", () => ({
  listManagedContainers: vi.fn().mockResolvedValue([]),
}));

import App from "./App";

describe("App", () => {
  /**
   * Verifies the AppShell + Sidebar are rendered at the root route. The
   * sidebar's "Apply" brand text and the workspace nav links should all be
   * visible regardless of the active route.
   */
  it("should render the AppShell sidebar with brand and nav links", () => {
    render(<App />);

    // Sidebar brand text (was "Apply For Me" pre-rewrite, now just "Apply").
    expect(screen.getByText("Apply")).toBeDefined();
    // Workspace section + nav rows (rendered as <Link>, so anchor role).
    expect(screen.getByRole("link", { name: /Dashboard/ })).toBeDefined();
    expect(screen.getByRole("link", { name: /Jobs/ })).toBeDefined();
    expect(screen.getByRole("link", { name: /Add job/i })).toBeDefined();
    expect(screen.getByRole("link", { name: /Profiles/ })).toBeDefined();
    expect(screen.getByRole("link", { name: /Containers/ })).toBeDefined();
  });

  /**
   * Verifies the Add Job page is mounted at the root route. The AddJobForm's
   * URL field must be present and the page's h1 heading should still read
   * "Add Job".
   */
  it("should render the Add Job page by default at root route", () => {
    render(<App />);

    expect(screen.getByText("Add Job", { selector: "h1" })).toBeDefined();
    expect(screen.getByLabelText(/Job Listing URL/)).toBeDefined();
  });
});
