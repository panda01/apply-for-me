import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import JobAttemptsPage from "./JobAttemptsPage";

vi.mock("../services/jobListingsApi", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/jobListingsApi")>();
  return {
    ...actual,
    getJobAttempts: vi.fn(),
    applyToJob: vi.fn(),
  };
});

import { getJobAttempts, applyToJob, ApplicationAttemptOutcome } from "../services/jobListingsApi";

const baseJob = {
  id: 1,
  title: "Acme - Engineer",
  url: "https://linkedin.com/jobs/1",
  application_url: "https://acme.com/apply",
  description: "Build cool stuff",
  company: null,
  location: null,
  salary: null,
  status: "applied" as const,
  live_url: null,
  post_date: "2026-03-01T00:00:00.000Z",
  created_date: "2026-03-07T00:00:00.000Z",
  resolution_in_progress: false,
  latest_resolution_log_id: null,
};

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/jobs/:id/attempts" element={<JobAttemptsPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  // jsdom doesn't expose Storage by default; stub a minimal in-memory localStorage
  // so the page's profile-id read/write paths execute under test.
  const storage: Record<string, string> = {};
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => (key in storage ? storage[key] : null),
      setItem: (key: string, value: string) => { storage[key] = value; },
      removeItem: (key: string) => { delete storage[key]; },
      clear: () => { for (const k of Object.keys(storage)) delete storage[k]; },
    },
  });
});

describe("JobAttemptsPage", () => {
  it("renders the job header + outcome chip for each attempt", async () => {
    vi.mocked(getJobAttempts).mockResolvedValue({
      ...baseJob,
      attempts: [
        {
          id: 10,
          job_listing_id: 1,
          end_response: ApplicationAttemptOutcome.Applied,
          has_submission_screenshot: true,
          step_logs: [],
          created_date: "2026-05-21T00:00:00.000Z",
        },
      ],
    });

    renderAt("/jobs/1/attempts");

    await waitFor(() => {
      expect(screen.getByText("Acme - Engineer")).toBeDefined();
    });
    // "Applied" appears as both the job status chip and the attempt outcome chip
    expect(screen.getAllByText("Applied").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByTestId("attempt-row-10")).toBeDefined();
    expect(screen.getByTestId("attempt-thumbnail-10")).toBeDefined();
  });

  it("renders the empty state when there are no attempts", async () => {
    vi.mocked(getJobAttempts).mockResolvedValue({ ...baseJob, attempts: [] });

    renderAt("/jobs/1/attempts");

    await waitFor(() => {
      expect(screen.getByText("No attempts yet for this job.")).toBeDefined();
    });
  });

  it("does NOT render the Apply button when status is not init or error_applying", async () => {
    vi.mocked(getJobAttempts).mockResolvedValue({ ...baseJob, status: "applied", attempts: [] });

    renderAt("/jobs/1/attempts");

    await waitFor(() => {
      expect(screen.getByText("Acme - Engineer")).toBeDefined();
    });
    expect(screen.queryByTestId("job-attempts-apply-button")).toBeNull();
  });

  it("renders the Apply button when status is init and application_url is set", async () => {
    vi.mocked(getJobAttempts).mockResolvedValue({ ...baseJob, status: "init", attempts: [] });

    renderAt("/jobs/1/attempts");

    await waitFor(() => {
      expect(screen.getByTestId("job-attempts-apply-button")).toBeDefined();
    });
    expect(applyToJob).not.toHaveBeenCalled();
  });

  it("renders the API error in an Alert when fetch fails", async () => {
    vi.mocked(getJobAttempts).mockRejectedValue(new Error("Job listing not found"));

    renderAt("/jobs/1/attempts");

    await waitFor(() => {
      expect(screen.getByText("Job listing not found")).toBeDefined();
    });
  });

  it("uses the generic message when fetch rejects with a non-Error value", async () => {
    vi.mocked(getJobAttempts).mockRejectedValue("string-not-error");

    renderAt("/jobs/1/attempts");

    await waitFor(() => {
      expect(screen.getByText("Failed to load job attempts")).toBeDefined();
    });
  });

  it("renders an invalid-ID error when the URL param is non-numeric", async () => {
    renderAt("/jobs/abc/attempts");

    await waitFor(() => {
      expect(screen.getByText("Invalid job listing ID")).toBeDefined();
    });
    expect(getJobAttempts).not.toHaveBeenCalled();
  });

  it("renders the Failed outcome chip when end_response=failed", async () => {
    vi.mocked(getJobAttempts).mockResolvedValue({
      ...baseJob,
      attempts: [
        { id: 10, job_listing_id: 1, end_response: ApplicationAttemptOutcome.Failed, has_submission_screenshot: false, step_logs: [], created_date: "2026-05-21T00:00:00.000Z" },
      ],
    });
    renderAt("/jobs/1/attempts");
    await waitFor(() => {
      expect(screen.getByText("Failed")).toBeDefined();
    });
  });

  it("renders the Closed Listing outcome chip when end_response=closed_listing", async () => {
    vi.mocked(getJobAttempts).mockResolvedValue({
      ...baseJob,
      attempts: [
        { id: 10, job_listing_id: 1, end_response: ApplicationAttemptOutcome.ClosedListing, has_submission_screenshot: false, step_logs: [], created_date: "2026-05-21T00:00:00.000Z" },
      ],
    });
    renderAt("/jobs/1/attempts");
    await waitFor(() => {
      expect(screen.getByText("Closed Listing")).toBeDefined();
    });
  });

  it("renders the Captcha Blocked outcome chip when end_response=captcha_blocked", async () => {
    vi.mocked(getJobAttempts).mockResolvedValue({
      ...baseJob,
      attempts: [
        { id: 10, job_listing_id: 1, end_response: ApplicationAttemptOutcome.CaptchaBlocked, has_submission_screenshot: false, step_logs: [], created_date: "2026-05-21T00:00:00.000Z" },
      ],
    });
    renderAt("/jobs/1/attempts");
    await waitFor(() => {
      expect(screen.getByText("Captcha Blocked")).toBeDefined();
    });
  });

  it("renders the Stuck outcome chip when end_response=stuck", async () => {
    vi.mocked(getJobAttempts).mockResolvedValue({
      ...baseJob,
      attempts: [
        { id: 10, job_listing_id: 1, end_response: ApplicationAttemptOutcome.Stuck, has_submission_screenshot: false, step_logs: [], created_date: "2026-05-21T00:00:00.000Z" },
      ],
    });
    renderAt("/jobs/1/attempts");
    await waitFor(() => {
      expect(screen.getByText("Stuck")).toBeDefined();
    });
  });

  it("clicking Apply with no stored profile shows the missing-profile actionable error", async () => {
    const userEvent = (await import("@testing-library/user-event")).default;
    window.localStorage.removeItem("afm:selectedApplicationProfileId");
    vi.mocked(getJobAttempts).mockResolvedValue({ ...baseJob, status: "init", attempts: [] });

    renderAt("/jobs/1/attempts");
    await waitFor(() => {
      expect(screen.getByTestId("job-attempts-apply-button")).toBeDefined();
    });

    const user = userEvent.setup();
    await user.click(screen.getByTestId("job-attempts-apply-button"));

    await waitFor(() => {
      expect(screen.getByText(/Pick an application profile/)).toBeDefined();
    });
    expect(applyToJob).not.toHaveBeenCalled();
  });

  it("clicking Apply with a stored profile invokes applyToJob and refreshes", async () => {
    const userEvent = (await import("@testing-library/user-event")).default;
    window.localStorage.setItem("afm:selectedApplicationProfileId", "7");
    vi.mocked(getJobAttempts).mockResolvedValue({ ...baseJob, status: "init", attempts: [] });
    vi.mocked(applyToJob).mockResolvedValue({ ...baseJob, status: "applying" });

    renderAt("/jobs/1/attempts");
    await waitFor(() => {
      expect(screen.getByTestId("job-attempts-apply-button")).toBeDefined();
    });

    const user = userEvent.setup();
    await user.click(screen.getByTestId("job-attempts-apply-button"));

    await waitFor(() => {
      expect(applyToJob).toHaveBeenCalledWith(1, 7);
    });
    // getJobAttempts is called once on mount + once after the apply
    expect(getJobAttempts).toHaveBeenCalledTimes(2);
  });

  it("dismisses the action error alert when its close button is clicked", async () => {
    const userEvent = (await import("@testing-library/user-event")).default;
    window.localStorage.removeItem("afm:selectedApplicationProfileId");
    vi.mocked(getJobAttempts).mockResolvedValue({ ...baseJob, status: "init", attempts: [] });

    renderAt("/jobs/1/attempts");
    await waitFor(() => {
      expect(screen.getByTestId("job-attempts-apply-button")).toBeDefined();
    });
    const user = userEvent.setup();
    await user.click(screen.getByTestId("job-attempts-apply-button"));
    await waitFor(() => {
      expect(screen.getByText(/Pick an application profile/)).toBeDefined();
    });

    // MUI renders the Alert's close button with aria-label "Close" by default.
    await user.click(screen.getByRole("button", { name: /close/i }));
    await waitFor(() => {
      expect(screen.queryByText(/Pick an application profile/)).toBeNull();
    });
  });

  it("renders 'Untitled' header and 'Unknown' post date when those fields are empty", async () => {
    vi.mocked(getJobAttempts).mockResolvedValue({
      ...baseJob,
      title: "",
      post_date: "",
      attempts: [],
    });
    renderAt("/jobs/1/attempts");
    await waitFor(() => {
      expect(screen.getByText("Untitled")).toBeDefined();
    });
    expect(screen.getByText("Unknown")).toBeDefined();
  });

  it("renders salary when present and singular 'step' when stepCount=1", async () => {
    vi.mocked(getJobAttempts).mockResolvedValue({
      ...baseJob,
      salary: "$100k",
      attempts: [
        { id: 10, job_listing_id: 1, end_response: ApplicationAttemptOutcome.Applied, has_submission_screenshot: false,
          step_logs: [
            { stepNumber: 1, phase: 1, phaseLabel: "Opening job URL", url: "https://x", nextGoal: "Navigate", actions: [], screenshotSaved: false, captchaDetected: false, stuckDetected: false, timestamp: "t" },
          ],
          created_date: "2026-05-21T00:00:00.000Z" },
      ],
    });
    renderAt("/jobs/1/attempts");
    await waitFor(() => {
      expect(screen.getByText("$100k")).toBeDefined();
    });
    expect(screen.getByText("1 step", { exact: false })).toBeDefined();
  });

  it("shows an error Alert when applyToJob rejects", async () => {
    const userEvent = (await import("@testing-library/user-event")).default;
    window.localStorage.setItem("afm:selectedApplicationProfileId", "7");
    vi.mocked(getJobAttempts).mockResolvedValue({ ...baseJob, status: "init", attempts: [] });
    vi.mocked(applyToJob).mockRejectedValue(new Error("Boom"));

    renderAt("/jobs/1/attempts");
    await waitFor(() => {
      expect(screen.getByTestId("job-attempts-apply-button")).toBeDefined();
    });

    const user = userEvent.setup();
    await user.click(screen.getByTestId("job-attempts-apply-button"));

    await waitFor(() => {
      expect(screen.getByText("Boom")).toBeDefined();
    });
  });

  it("uses the generic message when applyToJob rejects with a non-Error value", async () => {
    const userEvent = (await import("@testing-library/user-event")).default;
    window.localStorage.setItem("afm:selectedApplicationProfileId", "7");
    vi.mocked(getJobAttempts).mockResolvedValue({ ...baseJob, status: "init", attempts: [] });
    vi.mocked(applyToJob).mockRejectedValue("string-not-error");

    renderAt("/jobs/1/attempts");
    await waitFor(() => {
      expect(screen.getByTestId("job-attempts-apply-button")).toBeDefined();
    });

    const user = userEvent.setup();
    await user.click(screen.getByTestId("job-attempts-apply-button"));

    await waitFor(() => {
      expect(screen.getByText("Failed to start application")).toBeDefined();
    });
  });
});
