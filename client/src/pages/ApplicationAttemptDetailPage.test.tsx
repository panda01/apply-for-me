import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import ApplicationAttemptDetailPage from "./ApplicationAttemptDetailPage";

vi.mock("../services/jobListingsApi", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/jobListingsApi")>();
  return {
    ...actual,
    getApplicationAttempt: vi.fn(),
  };
});

import { getApplicationAttempt, ApplicationAttemptOutcome } from "../services/jobListingsApi";

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/applications/:id" element={<ApplicationAttemptDetailPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ApplicationAttemptDetailPage", () => {
  it("renders the attempt header, screenshot, and step log when has_submission_screenshot=true", async () => {
    vi.mocked(getApplicationAttempt).mockResolvedValue({
      id: 10,
      job_listing_id: 1,
      end_response: ApplicationAttemptOutcome.Applied,
      has_submission_screenshot: true,
      step_logs: [
        { stepNumber: 1, phase: 1, phaseLabel: "Opening job URL", url: "https://x", nextGoal: "Navigate", actions: [], screenshotSaved: true, captchaDetected: false, stuckDetected: false, timestamp: "2026-05-21T00:00:00.000Z" },
      ],
      created_date: "2026-05-21T00:00:00.000Z",
      job_listing: { id: 1, title: "Acme - Engineer", url: "https://x" },
    });

    renderAt("/applications/10?jobId=1");

    await waitFor(() => {
      expect(screen.getByText("Attempt #10")).toBeDefined();
    });
    expect(screen.getByTestId("attempt-submission-screenshot")).toBeDefined();
    expect(screen.getByTestId("attempt-step-1")).toBeDefined();
    expect(screen.getByTestId("attempt-step-1-screenshot")).toBeDefined();
  });

  it("shows the no-screenshot fallback when has_submission_screenshot=false", async () => {
    vi.mocked(getApplicationAttempt).mockResolvedValue({
      id: 11,
      job_listing_id: 1,
      end_response: ApplicationAttemptOutcome.Failed,
      has_submission_screenshot: false,
      step_logs: [],
      created_date: "2026-05-21T00:00:00.000Z",
      job_listing: { id: 1, title: "Acme", url: "https://x" },
    });

    renderAt("/applications/11?jobId=1");

    await waitFor(() => {
      expect(screen.getByTestId("attempt-submission-screenshot-empty")).toBeDefined();
    });
    expect(screen.queryByTestId("attempt-submission-screenshot")).toBeNull();
  });

  it("renders the step log empty state when step_logs is empty", async () => {
    vi.mocked(getApplicationAttempt).mockResolvedValue({
      id: 12,
      job_listing_id: 1,
      end_response: ApplicationAttemptOutcome.Failed,
      has_submission_screenshot: false,
      step_logs: [],
      created_date: "2026-05-21T00:00:00.000Z",
      job_listing: { id: 1, title: "Acme", url: "https://x" },
    });

    renderAt("/applications/12?jobId=1");

    await waitFor(() => {
      expect(screen.getByText("No step log recorded for this attempt.")).toBeDefined();
    });
  });

  it("renders the missing-jobId error when the query param is absent", async () => {
    renderAt("/applications/10");

    await waitFor(() => {
      expect(screen.getByText(/Missing jobId/)).toBeDefined();
    });
    expect(getApplicationAttempt).not.toHaveBeenCalled();
  });

  it("renders an invalid-attempt-ID error when the URL param is non-numeric", async () => {
    renderAt("/applications/abc?jobId=1");

    await waitFor(() => {
      expect(screen.getByText("Invalid attempt ID in the URL")).toBeDefined();
    });
    expect(getApplicationAttempt).not.toHaveBeenCalled();
  });

  it("renders the API error in an Alert when fetch fails", async () => {
    vi.mocked(getApplicationAttempt).mockRejectedValue(new Error("Application attempt not found"));

    renderAt("/applications/999?jobId=1");

    await waitFor(() => {
      expect(screen.getByText("Application attempt not found")).toBeDefined();
    });
  });

  it("renders the Failed outcome chip when end_response=failed", async () => {
    vi.mocked(getApplicationAttempt).mockResolvedValue({
      id: 20, job_listing_id: 1, end_response: ApplicationAttemptOutcome.Failed, has_submission_screenshot: false,
      step_logs: [], created_date: "2026-05-21T00:00:00.000Z", job_listing: { id: 1, title: "Acme", url: "https://x" },
    });
    renderAt("/applications/20?jobId=1");
    await waitFor(() => {
      expect(screen.getByText("Failed")).toBeDefined();
    });
  });

  it("renders the Closed Listing outcome chip when end_response=closed_listing", async () => {
    vi.mocked(getApplicationAttempt).mockResolvedValue({
      id: 21, job_listing_id: 1, end_response: ApplicationAttemptOutcome.ClosedListing, has_submission_screenshot: false,
      step_logs: [], created_date: "2026-05-21T00:00:00.000Z", job_listing: { id: 1, title: "Acme", url: "https://x" },
    });
    renderAt("/applications/21?jobId=1");
    await waitFor(() => {
      expect(screen.getByText("Closed Listing")).toBeDefined();
    });
  });

  it("renders the Captcha Blocked outcome chip when end_response=captcha_blocked", async () => {
    vi.mocked(getApplicationAttempt).mockResolvedValue({
      id: 22, job_listing_id: 1, end_response: ApplicationAttemptOutcome.CaptchaBlocked, has_submission_screenshot: false,
      step_logs: [], created_date: "2026-05-21T00:00:00.000Z", job_listing: { id: 1, title: "Acme", url: "https://x" },
    });
    renderAt("/applications/22?jobId=1");
    await waitFor(() => {
      expect(screen.getByText("Captcha Blocked")).toBeDefined();
    });
  });

  it("renders the Stuck outcome chip when end_response=stuck", async () => {
    vi.mocked(getApplicationAttempt).mockResolvedValue({
      id: 23, job_listing_id: 1, end_response: ApplicationAttemptOutcome.Stuck, has_submission_screenshot: false,
      step_logs: [], created_date: "2026-05-21T00:00:00.000Z", job_listing: { id: 1, title: "Acme", url: "https://x" },
    });
    renderAt("/applications/23?jobId=1");
    await waitFor(() => {
      expect(screen.getByText("Stuck")).toBeDefined();
    });
  });

  it("falls back to the no-screenshot text when the submission img errors", async () => {
    vi.mocked(getApplicationAttempt).mockResolvedValue({
      id: 40, job_listing_id: 1, end_response: ApplicationAttemptOutcome.Applied, has_submission_screenshot: true,
      step_logs: [], created_date: "2026-05-21T00:00:00.000Z", job_listing: { id: 1, title: "Acme", url: "https://x" },
    });
    renderAt("/applications/40?jobId=1");
    await waitFor(() => {
      expect(screen.getByTestId("attempt-submission-screenshot")).toBeDefined();
    });
    fireEvent.error(screen.getByTestId("attempt-submission-screenshot"));
    await waitFor(() => {
      expect(screen.getByTestId("attempt-submission-screenshot-empty")).toBeDefined();
    });
  });

  it("hides a per-step screenshot when its img errors", async () => {
    vi.mocked(getApplicationAttempt).mockResolvedValue({
      id: 41, job_listing_id: 1, end_response: ApplicationAttemptOutcome.Applied, has_submission_screenshot: false,
      step_logs: [
        { stepNumber: 5, phase: 4, phaseLabel: "Reviewing application", url: "https://x", nextGoal: "Review", actions: [], screenshotSaved: true, captchaDetected: false, stuckDetected: false, timestamp: "t" },
      ],
      created_date: "2026-05-21T00:00:00.000Z", job_listing: { id: 1, title: "Acme", url: "https://x" },
    });
    renderAt("/applications/41?jobId=1");
    await waitFor(() => {
      expect(screen.getByTestId("attempt-step-5-screenshot")).toBeDefined();
    });
    fireEvent.error(screen.getByTestId("attempt-step-5-screenshot"));
    await waitFor(() => {
      expect(screen.queryByTestId("attempt-step-5-screenshot")).toBeNull();
    });
  });

  it("renders the parent job's URL as the header fallback when title is empty", async () => {
    vi.mocked(getApplicationAttempt).mockResolvedValue({
      id: 50, job_listing_id: 1, end_response: ApplicationAttemptOutcome.Applied, has_submission_screenshot: false,
      step_logs: [], created_date: "2026-05-21T00:00:00.000Z",
      job_listing: { id: 1, title: "", url: "https://example.com/jobs/no-title" },
    });
    renderAt("/applications/50?jobId=1");
    await waitFor(() => {
      expect(screen.getByText("https://example.com/jobs/no-title")).toBeDefined();
    });
  });

  it("falls back to the generic message when fetch rejects with a non-Error value", async () => {
    vi.mocked(getApplicationAttempt).mockRejectedValue("string-not-error");
    renderAt("/applications/60?jobId=1");
    await waitFor(() => {
      expect(screen.getByText("Failed to load attempt")).toBeDefined();
    });
  });

  it("renders captcha/stuck chips on step rows when those flags are set", async () => {
    vi.mocked(getApplicationAttempt).mockResolvedValue({
      id: 30, job_listing_id: 1, end_response: ApplicationAttemptOutcome.CaptchaBlocked, has_submission_screenshot: false,
      step_logs: [
        { stepNumber: 1, phase: 3, phaseLabel: "Filling out form", url: "https://x", nextGoal: "Type", actions: ["type"], screenshotSaved: false, captchaDetected: true, stuckDetected: true, timestamp: "t" },
      ],
      created_date: "2026-05-21T00:00:00.000Z", job_listing: { id: 1, title: "Acme", url: "https://x" },
    });
    renderAt("/applications/30?jobId=1");
    await waitFor(() => {
      expect(screen.getByText("CAPTCHA")).toBeDefined();
    });
    expect(screen.getByText("Stuck")).toBeDefined();
  });
});
