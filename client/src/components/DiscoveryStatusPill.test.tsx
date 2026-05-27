import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import DiscoveryStatusPill from "./DiscoveryStatusPill";

/**
 * Builds a reusable `DiscoveredJobReference` fixture for the duplicateOf /
 * importedAs props. Tests override individual fields as needed.
 *
 * @param {object} [overrides] - Per-test overrides
 * @returns {{ jobListingId: number; title: string; status: string }} Fixture
 */
function buildReference(
  overrides: Partial<{ jobListingId: number; title: string; status: string }> = {}
): { jobListingId: number; title: string; status: string } {
  return {
    jobListingId: 100,
    title: "Acme Engineer",
    status: "init",
    ...overrides,
  };
}

describe("DiscoveryStatusPill", () => {
  it("renders the 'New' pill when status is pending and no references are set", () => {
    render(
      <DiscoveryStatusPill
        status="pending"
        duplicateOf={null}
        importedAs={null}
        onViewExisting={vi.fn()}
      />
    );
    expect(screen.getByText("New")).toBeDefined();
  });

  it("renders the 'Imported' pill when status is imported and links to the imported listing", () => {
    const onViewExisting = vi.fn();
    render(
      <DiscoveryStatusPill
        status="imported"
        duplicateOf={null}
        importedAs={buildReference({ jobListingId: 42, status: "applied" })}
        onViewExisting={onViewExisting}
      />
    );
    expect(screen.getByText("Imported")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: /applied/ }));
    expect(onViewExisting).toHaveBeenCalledWith(42);
  });

  it("renders the 'Imported' pill without the inner link when importedAs is null", () => {
    render(
      <DiscoveryStatusPill
        status="imported"
        duplicateOf={null}
        importedAs={null}
        onViewExisting={vi.fn()}
      />
    );
    expect(screen.getByText("Imported")).toBeDefined();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("renders the 'Duplicate' pill when duplicateOf is set (and status is not imported)", () => {
    const onViewExisting = vi.fn();
    render(
      <DiscoveryStatusPill
        status="duplicate"
        duplicateOf={buildReference({ jobListingId: 7, status: "init" })}
        importedAs={null}
        onViewExisting={onViewExisting}
      />
    );
    expect(screen.getByText("Duplicate")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: /init/ }));
    expect(onViewExisting).toHaveBeenCalledWith(7);
  });

  it("imported takes precedence over duplicateOf when both are set", () => {
    render(
      <DiscoveryStatusPill
        status="imported"
        duplicateOf={buildReference({ jobListingId: 7 })}
        importedAs={buildReference({ jobListingId: 42 })}
        onViewExisting={vi.fn()}
      />
    );
    expect(screen.getByText("Imported")).toBeDefined();
    expect(screen.queryByText("Duplicate")).toBeNull();
  });

  it("dismissed takes precedence over everything else", () => {
    render(
      <DiscoveryStatusPill
        status="dismissed"
        duplicateOf={buildReference()}
        importedAs={buildReference()}
        onViewExisting={vi.fn()}
      />
    );
    expect(screen.getByText("Dismissed")).toBeDefined();
    expect(screen.queryByText("Imported")).toBeNull();
    expect(screen.queryByText("Duplicate")).toBeNull();
  });

  it("inner-link click stops propagation so the row's own click handlers don't fire", () => {
    const rowClick = vi.fn();
    const onViewExisting = vi.fn();
    render(
      <div onClick={rowClick}>
        <DiscoveryStatusPill
          status="imported"
          duplicateOf={null}
          importedAs={buildReference({ jobListingId: 42 })}
          onViewExisting={onViewExisting}
        />
      </div>
    );
    fireEvent.click(screen.getByRole("button"));
    expect(onViewExisting).toHaveBeenCalledWith(42);
    expect(rowClick).not.toHaveBeenCalled();
  });
});
