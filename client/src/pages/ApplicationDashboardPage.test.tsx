import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import ApplicationDashboardPage from "./ApplicationDashboardPage";

/**
 * Minimal in-memory localStorage stand-in. The configured jsdom environment
 * does not expose a real Storage implementation, so we stub one onto window
 * before the component under test is imported indirectly via React's render.
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

const mockGetJobListings = vi.fn();
const mockApplyToJob = vi.fn();
const mockStartBatchApply = vi.fn();
const mockGetBatchApplyStatus = vi.fn();
const mockListApplicationProfiles = vi.fn();

vi.mock("../services/jobListingsApi", () => ({
  getJobListings: (...args: unknown[]) => mockGetJobListings(...args),
  applyToJob: (...args: unknown[]) => mockApplyToJob(...args),
  startBatchApply: (...args: unknown[]) => mockStartBatchApply(...args),
  getBatchApplyStatus: (...args: unknown[]) => mockGetBatchApplyStatus(...args),
}));

vi.mock("../services/applicationProfilesApi", () => ({
  listApplicationProfiles: (...args: unknown[]) => mockListApplicationProfiles(...args),
  WORK_AUTHORIZATION_LABELS: {},
}));

/**
 * Fixture for an ApplicationProfile row returned by listApplicationProfiles.
 * Used to seed the picker so the Apply/Apply All buttons are enabled in tests
 * that exercise the button flow.
 */
const mockProfile = {
  id: 7,
  name: "Default",
  firstName: "Khalah",
  middleName: null,
  lastName: "Jones-Golden",
  email: "khasan222@gmail.com",
  phone: "13479770736",
  github: null,
  linkedin: null,
  website: null,
  resumeUrl: null,
  coverLetterUrl: null,
  workAuthorization: null,
  desiredSalaryMin: null,
  created_date: "2026-05-21T00:00:00.000Z",
  updated_date: "2026-05-21T00:00:00.000Z",
};

const mockInitListing = {
  id: 1,
  title: "Test Company - Software Engineer",
  url: "https://linkedin.com/jobs/view/123",
  application_url: null,
  description: "Test description",
  salary: null,
  status: "init",
  live_url: null,
  post_date: "2026-03-01T00:00:00.000Z",
  created_date: "2026-03-07T00:00:00.000Z",
};

const mockApplyingListing = {
  ...mockInitListing,
  id: 2,
  status: "applying",
  live_url: "https://live.browser-use.com/session123",
};

const mockAppliedListing = {
  ...mockInitListing,
  id: 3,
  status: "applied",
};

const mockErrorListing = {
  ...mockInitListing,
  id: 4,
  status: "error_applying",
};

const mockClosedListing = {
  ...mockInitListing,
  id: 5,
  status: "closed",
};

const mockBatchStatus = {
  isRunning: false,
  currentJobId: null,
  completed: [],
  errors: [],
  totalJobs: 0,
  remaining: 0,
};

/**
 * Helper to render the dashboard with MemoryRouter.
 */
function renderDashboard() {
  return render(
    <MemoryRouter>
      <ApplicationDashboardPage />
    </MemoryRouter>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  mockGetJobListings.mockResolvedValue([]);
  mockGetBatchApplyStatus.mockResolvedValue(mockBatchStatus);
  mockListApplicationProfiles.mockResolvedValue([mockProfile]);
});

describe("ApplicationDashboardPage", () => {
  it("should show loading spinner initially", () => {
    mockGetJobListings.mockReturnValue(new Promise(() => {}));
    mockGetBatchApplyStatus.mockReturnValue(new Promise(() => {}));
    renderDashboard();

    expect(screen.getByRole("progressbar")).toBeDefined();
  });

  it("should display the page title", async () => {
    renderDashboard();

    await waitFor(() => {
      expect(screen.getByText("Application Dashboard")).toBeDefined();
    });
  });

  it("should show init jobs in Ready to Apply section", async () => {
    mockGetJobListings.mockResolvedValue([mockInitListing]);
    renderDashboard();

    await waitFor(() => {
      expect(screen.getByText("Ready to Apply (1)")).toBeDefined();
      expect(screen.getByText("Test Company - Software Engineer")).toBeDefined();
    });
  });

  it("should show applied jobs in Applied section", async () => {
    mockGetJobListings.mockResolvedValue([mockAppliedListing]);
    renderDashboard();

    await waitFor(() => {
      expect(screen.getByText("Applied (1)")).toBeDefined();
    });
  });

  it("should show closed jobs in Closed section without Retry button", async () => {
    mockGetJobListings.mockResolvedValue([mockClosedListing]);
    renderDashboard();

    await waitFor(() => {
      expect(screen.getByText("Closed (1)")).toBeDefined();
      expect(screen.getByText("Closed", { selector: ".MuiChip-label" })).toBeDefined();
    });

    // No Retry button for closed jobs
    expect(screen.queryByText("Retry")).toBeNull();
  });

  it("should show error jobs in Errors section with Retry button", async () => {
    mockGetJobListings.mockResolvedValue([mockErrorListing]);
    renderDashboard();

    await waitFor(() => {
      expect(screen.getByText("Errors (1)")).toBeDefined();
      expect(screen.getByText("Retry")).toBeDefined();
    });
  });

  it("should show live iframe when a job is applying with live_url", async () => {
    mockGetJobListings.mockResolvedValue([mockApplyingListing]);
    renderDashboard();

    await waitFor(() => {
      const iframe = screen.getByTitle("Browser Use Live View");
      expect(iframe).toBeDefined();
      expect(iframe.getAttribute("src")).toBe("https://live.browser-use.com/session123");
    });
  });

  it("should show waiting message when applying without live_url", async () => {
    mockGetJobListings.mockResolvedValue([{ ...mockApplyingListing, live_url: null }]);
    renderDashboard();

    await waitFor(() => {
      expect(screen.getByText("Waiting for browser session to start...")).toBeDefined();
    });
  });

  it("should show error alert when listing fetch fails", async () => {
    mockGetJobListings.mockRejectedValue(new Error("Network error"));
    renderDashboard();

    await waitFor(() => {
      expect(screen.getByText("Network error")).toBeDefined();
    });
  });

  it("should call applyToJob with the selected profile when Apply button is clicked", async () => {
    mockGetJobListings.mockResolvedValue([mockInitListing]);
    mockApplyToJob.mockResolvedValue({ ...mockInitListing, status: "applying" });
    renderDashboard();

    await waitFor(() => {
      expect(screen.getByText("Apply")).toBeDefined();
    });
    await waitFor(() => {
      const applyButton = screen.getByText("Apply").closest("button");
      expect(applyButton?.hasAttribute("disabled")).toBe(false);
    });

    await userEvent.click(screen.getByText("Apply"));

    expect(mockApplyToJob).toHaveBeenCalledWith(1, 7);
  });

  it("should call startBatchApply with the selected profile when Apply to All is clicked", async () => {
    mockGetJobListings.mockResolvedValue([mockInitListing]);
    mockStartBatchApply.mockResolvedValue({ message: "Started", totalJobs: 1 });
    renderDashboard();

    await waitFor(() => {
      expect(screen.getByText("Apply to All")).toBeDefined();
    });
    await waitFor(() => {
      const applyAllButton = screen.getByText("Apply to All").closest("button");
      expect(applyAllButton?.hasAttribute("disabled")).toBe(false);
    });

    await userEvent.click(screen.getByText("Apply to All"));

    expect(mockStartBatchApply).toHaveBeenCalledWith(7);
  });

  it("should show batch progress bar when batch is running", async () => {
    mockGetJobListings.mockResolvedValue([mockApplyingListing]);
    mockGetBatchApplyStatus.mockResolvedValue({
      isRunning: true,
      currentJobId: 2,
      completed: [1],
      errors: [],
      totalJobs: 3,
      remaining: 1,
    });
    renderDashboard();

    await waitFor(() => {
      expect(screen.getByText(/Batch Progress/)).toBeDefined();
      expect(screen.getByText("1 remaining")).toBeDefined();
    });
  });

  it("should show summary chips at the bottom including closed count", async () => {
    mockGetJobListings.mockResolvedValue([mockInitListing, mockAppliedListing, mockErrorListing, mockClosedListing]);
    renderDashboard();

    await waitFor(() => {
      expect(screen.getByText("1 Ready")).toBeDefined();
      expect(screen.getByText("0 In Progress")).toBeDefined();
      expect(screen.getByText("1 Applied")).toBeDefined();
      expect(screen.getByText("1 Errors")).toBeDefined();
      expect(screen.getByText("1 Closed")).toBeDefined();
    });
  });

  it("should disable Apply to All when no init jobs exist", async () => {
    mockGetJobListings.mockResolvedValue([mockAppliedListing]);
    renderDashboard();

    await waitFor(() => {
      const applyAllButton = screen.getByText("Apply to All");
      expect(applyAllButton.closest("button")?.hasAttribute("disabled")).toBe(true);
    });
  });

  it("should show action error when apply fails", async () => {
    mockGetJobListings.mockResolvedValue([mockInitListing]);
    mockApplyToJob.mockRejectedValue(new Error("Application failed"));
    renderDashboard();

    await waitFor(() => {
      expect(screen.getByText("Apply")).toBeDefined();
    });

    await userEvent.click(screen.getByText("Apply"));

    await waitFor(() => {
      expect(screen.getByText("Application failed")).toBeDefined();
    });
  });

  it("should show no jobs message when init list is empty", async () => {
    mockGetJobListings.mockResolvedValue([]);
    renderDashboard();

    await waitFor(() => {
      expect(screen.getByText("No jobs ready to apply to.")).toBeDefined();
    });
  });

  it("should show generic error when non-Error is thrown from getJobListings", async () => {
    mockGetJobListings.mockRejectedValue("string error");
    renderDashboard();

    await waitFor(() => {
      expect(screen.getByText("Failed to load job listings")).toBeDefined();
    });
  });

  it("should show generic error when non-Error is thrown from applyToJob", async () => {
    mockGetJobListings.mockResolvedValue([mockInitListing]);
    mockApplyToJob.mockRejectedValue("string error");
    renderDashboard();

    await waitFor(() => {
      expect(screen.getByText("Apply")).toBeDefined();
    });

    await userEvent.click(screen.getByText("Apply"));

    await waitFor(() => {
      expect(screen.getByText("Failed to start application")).toBeDefined();
    });
  });

  it("should clear polling interval when no jobs are actively applying", async () => {
    // First render with an applying job to start the polling interval
    mockGetJobListings.mockResolvedValue([mockApplyingListing]);
    renderDashboard();

    await waitFor(() => {
      expect(screen.getByText(/Applying to/)).toBeDefined();
    });

    // Now the poll interval is active. When fetchListings fires, return no applying jobs
    // so the next useEffect run triggers the clearInterval branch (lines 70-73).
    mockGetJobListings.mockResolvedValue([mockAppliedListing]);

    // Wait for the polling cycle to fire and re-render with non-applying data
    await waitFor(() => {
      expect(screen.queryByText(/Applying to/)).toBeNull();
    }, { timeout: 5000 });
  });

  it("should clear action error message when close button is clicked", async () => {
    mockGetJobListings.mockResolvedValue([mockInitListing]);
    mockApplyToJob.mockRejectedValue(new Error("Application failed"));
    renderDashboard();

    await waitFor(() => {
      expect(screen.getByText("Apply")).toBeDefined();
    });

    await userEvent.click(screen.getByText("Apply"));

    await waitFor(() => {
      expect(screen.getByText("Application failed")).toBeDefined();
    });

    // Click the close button on the action error alert (line 149: onClose handler)
    const closeButton = screen.getByRole("button", { name: "Close" });
    await userEvent.click(closeButton);

    await waitFor(() => {
      expect(screen.queryByText("Application failed")).toBeNull();
    });
  });

  it("should call applyToJob when Retry button on error job is clicked", async () => {
    mockGetJobListings.mockResolvedValue([mockErrorListing]);
    mockApplyToJob.mockResolvedValue({ ...mockErrorListing, status: "applying" });
    renderDashboard();

    await waitFor(() => {
      expect(screen.getByText("Retry")).toBeDefined();
    });
    await waitFor(() => {
      const retryButton = screen.getByText("Retry").closest("button");
      expect(retryButton?.hasAttribute("disabled")).toBe(false);
    });

    await userEvent.click(screen.getByText("Retry"));

    expect(mockApplyToJob).toHaveBeenCalledWith(4, 7);
  });

  it("surfaces a fetch error when listApplicationProfiles rejects", async () => {
    mockListApplicationProfiles.mockRejectedValue(new Error("Profiles backend down"));
    renderDashboard();

    await waitFor(() => {
      expect(screen.getByText("Profiles backend down")).toBeDefined();
    });
  });

  it("surfaces a generic error when listApplicationProfiles rejects with a non-Error", async () => {
    mockListApplicationProfiles.mockRejectedValue("string failure");
    renderDashboard();

    await waitFor(() => {
      expect(screen.getByText("Failed to load application profiles")).toBeDefined();
    });
  });

  it("shows the empty-state CTA when there are no application profiles", async () => {
    mockListApplicationProfiles.mockResolvedValue([]);
    mockGetJobListings.mockResolvedValue([mockInitListing]);
    renderDashboard();

    await waitFor(() => {
      expect(screen.getByText("No application profiles yet.")).toBeDefined();
      expect(screen.getByRole("link", { name: /Create application profile/ })).toBeDefined();
    });
  });

  it("disables Apply and Apply to All while no profile is selected", async () => {
    mockListApplicationProfiles.mockResolvedValue([]);
    mockGetJobListings.mockResolvedValue([mockInitListing]);
    renderDashboard();

    await waitFor(() => {
      expect(screen.getByText("Apply to All")).toBeDefined();
    });
    const applyAllButton = screen.getByText("Apply to All").closest("button");
    expect(applyAllButton?.hasAttribute("disabled")).toBe(true);

    const applyButton = screen.getByText("Apply").closest("button");
    expect(applyButton?.hasAttribute("disabled")).toBe(true);
  });

  it("changes the selected profile when the user picks a different option", async () => {
    const secondProfile = { ...mockProfile, id: 99, name: "Backup" };
    mockListApplicationProfiles.mockResolvedValue([secondProfile, mockProfile]);
    mockGetJobListings.mockResolvedValue([mockInitListing]);
    mockApplyToJob.mockResolvedValue({ ...mockInitListing, status: "applying" });
    renderDashboard();

    // First profile in the list (id=99) is auto-selected as the initial value.
    // Switch to the second (id=7) via the combobox to exercise the onChange handler.
    await waitFor(() => {
      expect(screen.getByRole("combobox", { name: /Application profile/ })).toBeDefined();
    });
    await userEvent.click(screen.getByRole("combobox", { name: /Application profile/ }));
    await userEvent.click(screen.getByRole("option", { name: /Default/ }));

    await waitFor(() => {
      const applyButton = screen.getByText("Apply").closest("button");
      expect(applyButton?.hasAttribute("disabled")).toBe(false);
    });
    await userEvent.click(screen.getByText("Apply"));
    expect(mockApplyToJob).toHaveBeenCalledWith(1, 7);
  });

  it("restores the previously selected profile from localStorage", async () => {
    const secondProfile = { ...mockProfile, id: 99, name: "Backup" };
    mockListApplicationProfiles.mockResolvedValue([mockProfile, secondProfile]);
    mockGetJobListings.mockResolvedValue([mockInitListing]);
    window.localStorage.setItem("afm:selectedApplicationProfileId", "99");
    mockApplyToJob.mockResolvedValue({ ...mockInitListing, status: "applying" });
    renderDashboard();

    await waitFor(() => {
      expect(screen.getByText("Apply")).toBeDefined();
    });
    await waitFor(() => {
      const applyButton = screen.getByText("Apply").closest("button");
      expect(applyButton?.hasAttribute("disabled")).toBe(false);
    });
    await userEvent.click(screen.getByText("Apply"));
    expect(mockApplyToJob).toHaveBeenCalledWith(1, 99);
  });

  it("should show generic error when non-Error is thrown from startBatchApply", async () => {
    mockGetJobListings.mockResolvedValue([mockInitListing]);
    mockStartBatchApply.mockRejectedValue("string error");
    renderDashboard();

    await waitFor(() => {
      expect(screen.getByText("Apply to All")).toBeDefined();
    });

    await userEvent.click(screen.getByText("Apply to All"));

    await waitFor(() => {
      expect(screen.getByText("Failed to start batch application")).toBeDefined();
    });
  });
});
