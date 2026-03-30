import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import AddJobForm from "./AddJobForm";

vi.mock("../services/jobListingsApi", () => ({
  createJobListing: vi.fn(),
}));

import { createJobListing } from "../services/jobListingsApi";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("AddJobForm", () => {
  it("should render the form with URL input and submit button", () => {
    render(<AddJobForm onJobAdded={vi.fn()} />);

    expect(screen.getByLabelText(/Job Listing URL/)).toBeDefined();
    expect(screen.getByRole("button", { name: /Add Job/ })).toBeDefined();
  });

  it("should disable submit button when URL is empty", () => {
    render(<AddJobForm onJobAdded={vi.fn()} />);

    const submitButton = screen.getByRole("button", { name: /Add Job/ }) as HTMLButtonElement;

    expect(submitButton.disabled).toBe(true);
  });

  it("should call createJobListing and onJobAdded with the new job ID on successful submit", async () => {
    const user = userEvent.setup();
    const onJobAdded = vi.fn();
    vi.mocked(createJobListing).mockResolvedValue({
      id: 42, title: "", url: "https://linkedin.com/jobs/1",
      description: "", post_date: "", created_date: "", status: "init", live_url: null,
    });

    render(<AddJobForm onJobAdded={onJobAdded} />);

    await user.type(screen.getByLabelText(/Job Listing URL/), "https://linkedin.com/jobs/1");
    await user.click(screen.getByRole("button", { name: /Add Job/ }));

    await waitFor(() => {
      expect(createJobListing).toHaveBeenCalledWith("https://linkedin.com/jobs/1");
      expect(onJobAdded).toHaveBeenCalledWith(42);
    });

    expect(screen.getByText(/Scraping job details/)).toBeDefined();
  });

  it("should show error message when createJobListing fails", async () => {
    const user = userEvent.setup();
    vi.mocked(createJobListing).mockRejectedValue(new Error("Missing required field: url"));

    render(<AddJobForm onJobAdded={vi.fn()} />);

    await user.type(screen.getByLabelText(/Job Listing URL/), "bad-url");
    await user.click(screen.getByRole("button", { name: /Add Job/ }));

    await waitFor(() => {
      expect(screen.getByText(/Missing required field: url/)).toBeDefined();
    });
  });

  it("should show generic error message when a non-Error is thrown", async () => {
    const user = userEvent.setup();
    vi.mocked(createJobListing).mockRejectedValue("some string error");

    render(<AddJobForm onJobAdded={vi.fn()} />);

    await user.type(screen.getByLabelText(/Job Listing URL/), "https://example.com");
    await user.click(screen.getByRole("button", { name: /Add Job/ }));

    await waitFor(() => {
      expect(screen.getByText("An unexpected error occurred")).toBeDefined();
    });
  });

  it("should clear the URL input after successful submission", async () => {
    const user = userEvent.setup();
    vi.mocked(createJobListing).mockResolvedValue({
      id: 1, title: "", url: "https://linkedin.com/jobs/1",
      description: "", post_date: "", created_date: "", status: "init", live_url: null,
    });

    render(<AddJobForm onJobAdded={vi.fn()} />);

    const input = screen.getByLabelText(/Job Listing URL/) as HTMLInputElement;
    await user.type(input, "https://linkedin.com/jobs/1");
    await user.click(screen.getByRole("button", { name: /Add Job/ }));

    await waitFor(() => {
      expect(input.value).toBe("");
    });
  });
});
