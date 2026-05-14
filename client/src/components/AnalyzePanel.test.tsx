import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import AnalyzePanel from "./AnalyzePanel";

vi.mock("../services/managedContainersApi", () => ({
  analyzeUrl: vi.fn(),
}));

import { analyzeUrl } from "../services/managedContainersApi";

const positiveResult = {
  is_job_description: true,
  apply_button_present: true,
  description_signals: ["Responsibilities", "Full-time", "Remote"],
  reasoning: "Page has an Apply button and matching description sections.",
  screenshot_b64: "iVBORw0KGgo=",
};

const negativeResult = {
  is_job_description: false,
  apply_button_present: false,
  description_signals: [],
  reasoning: "No apply affordance and no description sections were found.",
  screenshot_b64: "iVBORw0KGgo=",
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("AnalyzePanel", () => {
  it("renders the URL input pre-populated with a LinkedIn URL and an Analyze button", () => {
    render(<AnalyzePanel containerId={1} />);
    const input = screen.getByTestId("analyze-url-input") as HTMLInputElement;
    expect(input.value).toContain("linkedin.com");
    expect(screen.getByTestId("analyze-button")).toBeDefined();
  });

  it("shows the success verdict, signals, reasoning, and screenshot on a positive result", async () => {
    vi.mocked(analyzeUrl).mockResolvedValue(positiveResult);

    render(<AnalyzePanel containerId={42} />);
    const user = userEvent.setup();
    await user.click(screen.getByTestId("analyze-button"));

    await waitFor(() => {
      expect(analyzeUrl).toHaveBeenCalledWith(42, expect.stringContaining("linkedin.com"), true);
      expect(screen.getByTestId("analyze-verdict-chip").textContent).toMatch(/Job description page/);
      expect(screen.getByTestId("analyze-apply-chip").textContent).toMatch(/Apply button found/);
      expect(screen.getByTestId("analyze-reasoning").textContent).toMatch(/Apply button/);
      const signals = screen.getByTestId("analyze-signals").textContent ?? "";
      expect(signals).toMatch(/Responsibilities/);
      expect(signals).toMatch(/Full-time/);
      const img = screen.getByTestId("analyze-screenshot") as HTMLImageElement;
      expect(img.src).toContain("data:image/png;base64,iVBORw0KGgo=");
    });
  });

  it("passes useProxy=false through when the checkbox is unticked", async () => {
    vi.mocked(analyzeUrl).mockResolvedValue(positiveResult);

    render(<AnalyzePanel containerId={42} />);
    const user = userEvent.setup();
    await user.click(screen.getByTestId("analyze-use-proxy"));
    await user.click(screen.getByTestId("analyze-button"));

    await waitFor(() => {
      expect(analyzeUrl).toHaveBeenCalledWith(42, expect.any(String), false);
    });
  });

  it("renders the negative verdict and hides the signals block when none were found", async () => {
    vi.mocked(analyzeUrl).mockResolvedValue(negativeResult);

    render(<AnalyzePanel containerId={1} />);
    const user = userEvent.setup();
    await user.click(screen.getByTestId("analyze-button"));

    await waitFor(() => {
      expect(screen.getByTestId("analyze-verdict-chip").textContent).toMatch(/Not a job description page/);
      expect(screen.getByTestId("analyze-apply-chip").textContent).toMatch(/No apply button/);
      expect(screen.queryByTestId("analyze-signals")).toBeNull();
    });
  });

  it("shows the server's error message when the analyze request fails", async () => {
    vi.mocked(analyzeUrl).mockRejectedValue(new Error("Container analyze failed: Agent exceeded 8 turns"));

    render(<AnalyzePanel containerId={1} />);
    const user = userEvent.setup();
    await user.click(screen.getByTestId("analyze-button"));

    await waitFor(() => {
      expect(screen.getByTestId("analyze-error").textContent).toMatch(/exceeded 8 turns/);
    });
    expect(screen.queryByTestId("analyze-result")).toBeNull();
  });

  it("falls back to a generic error message when the rejection is not an Error", async () => {
    vi.mocked(analyzeUrl).mockRejectedValue("string-rejection");

    render(<AnalyzePanel containerId={1} />);
    const user = userEvent.setup();
    await user.click(screen.getByTestId("analyze-button"));

    await waitFor(() => {
      expect(screen.getByTestId("analyze-error").textContent).toMatch(/Failed to analyze URL/);
    });
  });

  it("requires a non-empty URL before calling the API", async () => {
    render(<AnalyzePanel containerId={1} />);
    const user = userEvent.setup();
    const input = screen.getByTestId("analyze-url-input");
    await user.clear(input);
    await user.click(screen.getByTestId("analyze-button"));

    expect(analyzeUrl).not.toHaveBeenCalled();
    expect(screen.getByTestId("analyze-error").textContent).toMatch(/enter a URL/i);
  });

  it("clears the error alert when its close button is clicked", async () => {
    vi.mocked(analyzeUrl).mockRejectedValue(new Error("boom"));

    render(<AnalyzePanel containerId={1} />);
    const user = userEvent.setup();
    await user.click(screen.getByTestId("analyze-button"));
    await waitFor(() => screen.getByTestId("analyze-error"));

    const closeButton = screen.getByTestId("analyze-error").querySelector("button");
    expect(closeButton).not.toBeNull();
    await user.click(closeButton!);

    expect(screen.queryByTestId("analyze-error")).toBeNull();
  });
});
