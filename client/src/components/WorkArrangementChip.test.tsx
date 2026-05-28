import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import WorkArrangementChip from "./WorkArrangementChip";

describe("WorkArrangementChip", () => {
  it("renders a chip labelled 'Remote' for value='remote'", () => {
    render(<WorkArrangementChip value="remote" />);

    expect(screen.getByText("Remote")).toBeDefined();
  });

  it("renders a chip labelled 'On-Site' for value='on_site'", () => {
    render(<WorkArrangementChip value="on_site" />);

    expect(screen.getByText("On-Site")).toBeDefined();
  });

  it("renders a chip labelled 'Hybrid' for value='hybrid'", () => {
    render(<WorkArrangementChip value="hybrid" />);

    expect(screen.getByText("Hybrid")).toBeDefined();
  });

  it("renders nothing when value is null", () => {
    const { container } = render(<WorkArrangementChip value={null} />);

    // The component returns null for an unknown arrangement, so nothing is
    // mounted: the render container stays empty and none of the known labels
    // appear anywhere in the document.
    expect(container.childElementCount).toBe(0);
    expect(screen.queryByText("Remote")).toBeNull();
    expect(screen.queryByText("On-Site")).toBeNull();
    expect(screen.queryByText("Hybrid")).toBeNull();
  });
});
