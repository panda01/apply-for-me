import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ScreenshotPanel from "./ScreenshotPanel";

vi.mock("../services/managedContainersApi", () => ({
  captureScreenshot: vi.fn(),
}));

import { captureScreenshot } from "../services/managedContainersApi";

beforeEach(() => {
  vi.clearAllMocks();
  // jsdom doesn't ship URL.createObjectURL; stub it so the component runs.
  if (typeof URL.createObjectURL === "undefined") {
    Object.assign(URL, { createObjectURL: vi.fn(() => "blob:mock-url") });
  }
  if (typeof URL.revokeObjectURL === "undefined") {
    Object.assign(URL, { revokeObjectURL: vi.fn() });
  }
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:mock-url");
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
});

describe("ScreenshotPanel", () => {
  it("renders an input pre-populated with google.com and a Capture button", () => {
    render(<ScreenshotPanel containerId={1} />);
    const input = screen.getByTestId("screenshot-url-input") as HTMLInputElement;
    expect(input.value).toBe("https://google.com");
    expect(screen.getByTestId("screenshot-capture-button")).toBeDefined();
  });

  it("captures a screenshot and renders the resulting image", async () => {
    const blob = new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], { type: "image/png" });
    vi.mocked(captureScreenshot).mockResolvedValue(blob);

    render(<ScreenshotPanel containerId={42} />);

    const user = userEvent.setup();
    await user.click(screen.getByTestId("screenshot-capture-button"));

    await waitFor(() => {
      expect(captureScreenshot).toHaveBeenCalledWith(42, "https://google.com", false);
      const img = screen.getByTestId("screenshot-image") as HTMLImageElement;
      expect(img.src).toContain("blob:mock-url");
    });
  });

  it("passes useProxy=true through when the checkbox is ticked", async () => {
    const blob = new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], { type: "image/png" });
    vi.mocked(captureScreenshot).mockResolvedValue(blob);

    render(<ScreenshotPanel containerId={42} />);

    const user = userEvent.setup();
    const checkbox = screen.getByTestId("screenshot-use-proxy");
    await user.click(checkbox);
    await user.click(screen.getByTestId("screenshot-capture-button"));

    await waitFor(() => {
      expect(captureScreenshot).toHaveBeenCalledWith(42, "https://google.com", true);
    });
  });

  it("shows the server's error message when the capture fails", async () => {
    vi.mocked(captureScreenshot).mockRejectedValue(new Error("Container screenshot failed: page.goto timeout"));

    render(<ScreenshotPanel containerId={1} />);

    const user = userEvent.setup();
    await user.click(screen.getByTestId("screenshot-capture-button"));

    await waitFor(() => {
      expect(screen.getByTestId("screenshot-error").textContent).toMatch(/page\.goto timeout/);
    });
    // The error alert should not also leave a stale image visible.
    expect(screen.queryByTestId("screenshot-image")).toBeNull();
  });

  it("falls back to a generic error message when the rejection is not an Error", async () => {
    vi.mocked(captureScreenshot).mockRejectedValue("string-rejection");

    render(<ScreenshotPanel containerId={1} />);

    const user = userEvent.setup();
    await user.click(screen.getByTestId("screenshot-capture-button"));

    await waitFor(() => {
      expect(screen.getByTestId("screenshot-error").textContent).toMatch(/Failed to capture screenshot/);
    });
  });

  it("requires a non-empty URL before calling the API", async () => {
    render(<ScreenshotPanel containerId={1} />);

    const user = userEvent.setup();
    const input = screen.getByTestId("screenshot-url-input");
    await user.clear(input);
    await user.click(screen.getByTestId("screenshot-capture-button"));

    expect(captureScreenshot).not.toHaveBeenCalled();
    expect(screen.getByTestId("screenshot-error").textContent).toMatch(/enter a URL/i);
  });

  it("clears the error alert when its close button is clicked", async () => {
    vi.mocked(captureScreenshot).mockRejectedValue(new Error("boom"));

    render(<ScreenshotPanel containerId={1} />);

    const user = userEvent.setup();
    await user.click(screen.getByTestId("screenshot-capture-button"));
    await waitFor(() => screen.getByTestId("screenshot-error"));

    const closeButton = screen.getByTestId("screenshot-error").querySelector("button");
    expect(closeButton).not.toBeNull();
    await user.click(closeButton!);

    expect(screen.queryByTestId("screenshot-error")).toBeNull();
  });

  it("revokes the previous object URL when a new screenshot is captured", async () => {
    const firstBlob = new Blob([new Uint8Array([1])]);
    const secondBlob = new Blob([new Uint8Array([2])]);
    const createSpy = vi.spyOn(URL, "createObjectURL")
      .mockReturnValueOnce("blob:first")
      .mockReturnValueOnce("blob:second");
    const revokeSpy = vi.spyOn(URL, "revokeObjectURL");
    vi.mocked(captureScreenshot)
      .mockResolvedValueOnce(firstBlob)
      .mockResolvedValueOnce(secondBlob);

    render(<ScreenshotPanel containerId={1} />);

    const user = userEvent.setup();
    await user.click(screen.getByTestId("screenshot-capture-button"));
    await waitFor(() => {
      const img = screen.getByTestId("screenshot-image") as HTMLImageElement;
      expect(img.src).toContain("blob:first");
    });

    await user.click(screen.getByTestId("screenshot-capture-button"));
    await waitFor(() => {
      const img = screen.getByTestId("screenshot-image") as HTMLImageElement;
      expect(img.src).toContain("blob:second");
    });

    expect(createSpy).toHaveBeenCalledTimes(2);
    expect(revokeSpy).toHaveBeenCalledWith("blob:first");
  });
});
