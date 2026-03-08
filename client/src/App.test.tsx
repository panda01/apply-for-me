import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import App from "./App";

vi.mock("./services/jobListingsApi", () => ({
  getJobListings: vi.fn().mockResolvedValue([]),
  createJobListing: vi.fn(),
  deleteJobListing: vi.fn(),
}));

describe("App", () => {
  it("should render the navigation menu", () => {
    render(<App />);

    expect(screen.getByText("Apply For Me")).toBeDefined();
    expect(screen.getByRole("link", { name: /Add Job/ })).toBeDefined();
    expect(screen.getByRole("link", { name: /Jobs List/ })).toBeDefined();
  });

  it("should render the Add Job page by default at root route", () => {
    render(<App />);

    expect(screen.getByText("Add Job", { selector: "h1" })).toBeDefined();
    expect(screen.getByLabelText(/Job Listing URL/)).toBeDefined();
  });
});
