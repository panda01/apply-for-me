import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { List } from "@mui/material";
import JobRow from "./JobRow";
import type { JobListingResponse } from "../services/jobListingsApi";

/**
 * Builds a valid JobListingResponse with sensible defaults so tests can focus
 * on the props that matter for the case under test.
 *
 * @param {Partial<JobListingResponse>} [overrides] - Fields to override on the default fixture
 * @returns {JobListingResponse} A complete fixture
 */
function buildListing(overrides: Partial<JobListingResponse> = {}): JobListingResponse {
  return {
    id: 1,
    title: "Acme - Engineer",
    url: "https://linkedin.com/jobs/1",
    application_url: "https://acme.com/apply",
    description: "Cool job",
    company: "Acme",
    location: null,
    work_arrangement: null,
    salary: null,
    status: "init",
    live_url: null,
    post_date: "2026-03-01T00:00:00.000Z",
    created_date: "2026-03-07T00:00:00.000Z",
    resolution_in_progress: false,
    latest_resolution_log_id: null,
    ...overrides,
  };
}

describe("JobRow row-click + propagation guards", () => {
  it("invokes onClick(id) when the row body is clicked", async () => {
    const onClick = vi.fn();
    render(
      <List>
        <JobRow listing={buildListing()} onClick={onClick} />
      </List>,
    );
    const user = userEvent.setup();
    // The ListItemButton wraps the row content; clicking its text fires the handler
    await user.click(screen.getByText("Acme - Engineer"));
    expect(onClick).toHaveBeenCalledWith(1);
  });

  it("does NOT render a ListItemButton when onClick is omitted", () => {
    render(
      <List>
        <JobRow listing={buildListing()} />
      </List>,
    );
    // MUI's ListItemButton renders as a <div role="button">; absent without onClick.
    const buttons = screen.queryAllByRole("button");
    expect(buttons).toHaveLength(0);
  });

  it("stops propagation when the external URL link is clicked", async () => {
    const onClick = vi.fn();
    render(
      <List>
        <JobRow listing={buildListing()} onClick={onClick} />
      </List>,
    );
    const user = userEvent.setup();
    const link = screen.getByRole("link", { name: /linkedin\.com/i });
    await user.click(link);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("falls back to the URL as the title when title is empty", () => {
    render(
      <List>
        <JobRow listing={buildListing({ title: "" })} />
      </List>,
    );
    // The URL appears as both the secondary anchor AND the primary fallback title; getAllByText returns ≥2 nodes
    const matches = screen.getAllByText("https://linkedin.com/jobs/1");
    expect(matches.length).toBeGreaterThanOrEqual(2);
  });

  it("invokes action.onClick but NOT row onClick when the action button is clicked", async () => {
    const onClick = vi.fn();
    const actionOnClick = vi.fn();
    render(
      <List>
        <JobRow
          listing={buildListing()}
          onClick={onClick}
          action={{ label: "Apply", onClick: actionOnClick, disabled: false, isLoading: false }}
        />
      </List>,
    );
    const user = userEvent.setup();
    const button = screen.getByRole("button", { name: /apply/i });
    await user.click(button);
    expect(actionOnClick).toHaveBeenCalledWith(1);
    expect(onClick).not.toHaveBeenCalled();
  });
});
