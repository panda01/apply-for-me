import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import AddJobForm from "./AddJobForm";

vi.mock("../services/jobListingsApi", () => ({
  createJobListing: vi.fn(),
}));

vi.mock("../services/managedContainersApi", () => ({
  listManagedContainers: vi.fn(),
}));

import { createJobListing } from "../services/jobListingsApi";
import { listManagedContainers } from "../services/managedContainersApi";

beforeEach(() => {
  vi.clearAllMocks();
  // Default: pretend a running container exists so the warning is hidden in legacy tests.
  vi.mocked(listManagedContainers).mockResolvedValue([
    { id: 1, name: "test", dockerId: "abc", hostPort: 41000, wgConfigName: null, status: "running", created_date: "2026-03-07T00:00:00.000Z" },
  ]);
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
      description: "", company: null, location: null, work_arrangement: null, application_url: null, salary: null, post_date: "", created_date: "", status: "init", live_url: null,
      resolution_in_progress: false, latest_resolution_log_id: null,
    });

    render(<AddJobForm onJobAdded={onJobAdded} />);

    await user.type(screen.getByLabelText(/Job Listing URL/), "https://linkedin.com/jobs/1");
    await user.click(screen.getByRole("button", { name: /Add Job/ }));

    await waitFor(() => {
      expect(createJobListing).toHaveBeenCalledWith("https://linkedin.com/jobs/1");
      expect(onJobAdded).toHaveBeenCalledWith(42);
    });

    expect(screen.getByText(/Job saved successfully/)).toBeDefined();
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
      description: "", company: null, location: null, work_arrangement: null, application_url: null, salary: null, post_date: "", created_date: "", status: "init", live_url: null,
      resolution_in_progress: false, latest_resolution_log_id: null,
    });

    render(<AddJobForm onJobAdded={vi.fn()} />);

    const input = screen.getByLabelText(/Job Listing URL/) as HTMLInputElement;
    await user.type(input, "https://linkedin.com/jobs/1");
    await user.click(screen.getByRole("button", { name: /Add Job/ }));

    await waitFor(() => {
      expect(input.value).toBe("");
    });
  });

  it("shows a warning when no managed container is running", async () => {
    vi.mocked(listManagedContainers).mockResolvedValue([]);

    render(<AddJobForm onJobAdded={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByTestId("no-container-warning")).toBeDefined();
    });
  });

  it("shows a warning when all managed containers are non-running", async () => {
    vi.mocked(listManagedContainers).mockResolvedValue([
      { id: 1, name: "stopped-one", dockerId: "abc", hostPort: 41000, wgConfigName: null, status: "stopped", created_date: "2026-03-07T00:00:00.000Z" },
    ]);

    render(<AddJobForm onJobAdded={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByTestId("no-container-warning")).toBeDefined();
    });
  });

  it("does not show the warning when at least one container is running", async () => {
    render(<AddJobForm onJobAdded={vi.fn()} />);

    // Wait one tick for the effect to settle, then assert the warning isn't there.
    await waitFor(() => {
      expect(screen.getByLabelText(/Job Listing URL/)).toBeDefined();
    });
    expect(screen.queryByTestId("no-container-warning")).toBeNull();
  });

  it("silently tolerates a listManagedContainers failure (no warning shown)", async () => {
    vi.mocked(listManagedContainers).mockRejectedValue(new Error("API down"));

    render(<AddJobForm onJobAdded={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByLabelText(/Job Listing URL/)).toBeDefined();
    });
    expect(screen.queryByTestId("no-container-warning")).toBeNull();
  });
});
