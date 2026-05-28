import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { SyncStepIndicator } from "./SyncStepIndicator";

describe("SyncStepIndicator", () => {
  it("renders all three step labels", () => {
    render(<SyncStepIndicator currentStep="fetching_emails" status="running" />);
    expect(screen.getByText("Fetching emails")).toBeDefined();
    expect(screen.getByText("Finding jobs in emails")).toBeDefined();
    expect(screen.getByText("Saving jobs")).toBeDefined();
  });

  it("marks the current step as active and later steps as pending while running", () => {
    render(<SyncStepIndicator currentStep="finding_jobs" status="running" />);
    expect(screen.getByTestId("sync-step-fetching_emails").getAttribute("data-state")).toBe(
      "done"
    );
    expect(screen.getByTestId("sync-step-finding_jobs").getAttribute("data-state")).toBe(
      "active"
    );
    expect(screen.getByTestId("sync-step-saving_jobs").getAttribute("data-state")).toBe(
      "pending"
    );
  });

  it("treats null currentStep + running as 'first step active'", () => {
    render(<SyncStepIndicator currentStep={null} status="running" />);
    expect(screen.getByTestId("sync-step-fetching_emails").getAttribute("data-state")).toBe(
      "active"
    );
    expect(screen.getByTestId("sync-step-finding_jobs").getAttribute("data-state")).toBe(
      "pending"
    );
  });

  it("marks every step done when status=succeeded", () => {
    render(<SyncStepIndicator currentStep={null} status="succeeded" />);
    expect(screen.getByTestId("sync-step-fetching_emails").getAttribute("data-state")).toBe(
      "done"
    );
    expect(screen.getByTestId("sync-step-finding_jobs").getAttribute("data-state")).toBe(
      "done"
    );
    expect(screen.getByTestId("sync-step-saving_jobs").getAttribute("data-state")).toBe(
      "done"
    );
  });

  it("marks the current step failed when status=failed and prior steps done", () => {
    render(<SyncStepIndicator currentStep="finding_jobs" status="failed" />);
    expect(screen.getByTestId("sync-step-fetching_emails").getAttribute("data-state")).toBe(
      "done"
    );
    expect(screen.getByTestId("sync-step-finding_jobs").getAttribute("data-state")).toBe(
      "failed"
    );
    expect(screen.getByTestId("sync-step-saving_jobs").getAttribute("data-state")).toBe(
      "pending"
    );
  });

  it("has role=status with aria-live=polite for screen readers", () => {
    const { container } = render(
      <SyncStepIndicator currentStep="fetching_emails" status="running" />
    );
    const statusRegion = container.querySelector("[data-testid='sync-step-indicator']");
    expect(statusRegion?.getAttribute("role")).toBe("status");
    expect(statusRegion?.getAttribute("aria-live")).toBe("polite");
  });
});
