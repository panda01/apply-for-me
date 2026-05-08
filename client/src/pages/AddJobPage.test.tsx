import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import AddJobPage from "./AddJobPage";

vi.mock("../services/jobListingsApi", () => ({
  createJobListing: vi.fn(),
}));

import { createJobListing } from "../services/jobListingsApi";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("AddJobPage", () => {
  it("should render the page title and form", () => {
    render(
      <MemoryRouter>
        <AddJobPage />
      </MemoryRouter>
    );

    expect(screen.getByText("Add Job", { selector: "h1" })).toBeDefined();
    expect(screen.getByLabelText(/Job Listing URL/)).toBeDefined();
    expect(screen.getByRole("button", { name: /Add Job/ })).toBeDefined();
  });

  it("should navigate to /jobs/:id after successful submission", async () => {
    const user = userEvent.setup();
    vi.mocked(createJobListing).mockResolvedValue({
      id: 42, title: "", url: "https://linkedin.com/jobs/1",
      description: "", salary: null, post_date: "", created_date: "", status: "init", live_url: null,
    });

    render(
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route path="/" element={<AddJobPage />} />
          <Route path="/jobs/:id" element={<div data-testid="job-view-page">Job View</div>} />
        </Routes>
      </MemoryRouter>
    );

    await user.type(screen.getByLabelText(/Job Listing URL/), "https://linkedin.com/jobs/1");
    await user.click(screen.getByRole("button", { name: /Add Job/ }));

    await waitFor(() => {
      expect(createJobListing).toHaveBeenCalledWith("https://linkedin.com/jobs/1");
      expect(screen.getByTestId("job-view-page")).toBeDefined();
    });
  });
});
