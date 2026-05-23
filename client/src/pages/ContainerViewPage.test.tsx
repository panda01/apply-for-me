import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import ContainerViewPage from "./ContainerViewPage";

vi.mock("../services/managedContainersApi", () => ({
  getManagedContainer: vi.fn(),
  deleteManagedContainer: vi.fn(),
  pingManagedContainerHealth: vi.fn(),
  captureScreenshot: vi.fn(),
  analyzeUrl: vi.fn(),
}));

import {
  getManagedContainer,
  deleteManagedContainer,
  pingManagedContainerHealth,
} from "../services/managedContainersApi";

const mockContainer = {
  id: 1,
  name: "abc123def456",
  dockerId: "docker-id-1",
  hostPort: 41123,
  wgConfigName: "us-nyc-wg-301",
  status: "running",
  created_date: "2026-05-07T00:00:00.000Z",
};

beforeEach(() => {
  vi.clearAllMocks();
});

function renderPage(initialPath = "/containers/1") {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route path="/containers/:id" element={<ContainerViewPage />} />
        <Route path="/containers" element={<div>Containers list page</div>} />
      </Routes>
    </MemoryRouter>
  );
}

describe("ContainerViewPage", () => {
  it("loads and displays container details", async () => {
    vi.mocked(getManagedContainer).mockResolvedValue(mockContainer);

    renderPage();

    await waitFor(() => {
      expect(screen.getByTestId("container-name").textContent).toBe("abc123def456");
      expect(screen.getByTestId("container-host-port").textContent).toBe("41123");
    });
  });

  it("shows an error message when load fails", async () => {
    vi.mocked(getManagedContainer).mockRejectedValue(new Error("Managed container not found"));

    renderPage();

    await waitFor(() => {
      expect(screen.getByText("Managed container not found")).toBeDefined();
    });
  });

  it("shows an error when the URL id is not a number", async () => {
    renderPage("/containers/not-a-number");

    await waitFor(() => {
      expect(screen.getByText("Invalid container ID")).toBeDefined();
    });
  });

  it("pings the health endpoint and renders the result", async () => {
    vi.mocked(getManagedContainer).mockResolvedValue(mockContainer);
    vi.mocked(pingManagedContainerHealth).mockResolvedValue({ status: "ok", name: "abc123def456" });

    renderPage();
    await waitFor(() => screen.getByTestId("container-name"));

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /ping health/i }));

    await waitFor(() => {
      expect(pingManagedContainerHealth).toHaveBeenCalledWith(1);
      expect(screen.getByTestId("ping-status").textContent).toBe("ok");
      expect(screen.getByTestId("ping-name").textContent).toBe("abc123def456");
    });
  });

  it("shows an error alert when health check fails", async () => {
    vi.mocked(getManagedContainer).mockResolvedValue(mockContainer);
    vi.mocked(pingManagedContainerHealth).mockRejectedValue(new Error("Container unreachable: ECONNREFUSED"));

    renderPage();
    await waitFor(() => screen.getByTestId("container-name"));

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /ping health/i }));

    await waitFor(() => {
      expect(screen.getByTestId("ping-error").textContent).toMatch(/ECONNREFUSED/);
    });
  });

  it("deletes the container and navigates back to the list", async () => {
    vi.mocked(getManagedContainer).mockResolvedValue(mockContainer);
    vi.mocked(deleteManagedContainer).mockResolvedValue(mockContainer);

    renderPage();
    await waitFor(() => screen.getByTestId("container-name"));

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /delete/i }));

    await waitFor(() => {
      expect(deleteManagedContainer).toHaveBeenCalledWith(1);
      expect(screen.getByText("Containers list page")).toBeDefined();
    });
  });

  it("shows an error alert when delete fails", async () => {
    vi.mocked(getManagedContainer).mockResolvedValue(mockContainer);
    vi.mocked(deleteManagedContainer).mockRejectedValue(new Error("docker offline"));

    renderPage();
    await waitFor(() => screen.getByTestId("container-name"));

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /delete/i }));

    await waitFor(() => {
      expect(screen.getByText("docker offline")).toBeDefined();
    });
  });

  it("falls back to a generic error message when fetch rejects with a non-Error", async () => {
    vi.mocked(getManagedContainer).mockRejectedValue("string-rejection");

    renderPage();

    await waitFor(() => {
      expect(screen.getByText("Failed to load managed container")).toBeDefined();
    });
  });

  it("falls back to a generic error message when ping rejects with a non-Error", async () => {
    vi.mocked(getManagedContainer).mockResolvedValue(mockContainer);
    vi.mocked(pingManagedContainerHealth).mockRejectedValue("string-rejection");

    renderPage();
    await waitFor(() => screen.getByTestId("container-name"));

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /ping health/i }));

    await waitFor(() => {
      expect(screen.getByTestId("ping-error").textContent).toMatch(/Health check failed/);
    });
  });

  it("falls back to a generic error message when delete rejects with a non-Error", async () => {
    vi.mocked(getManagedContainer).mockResolvedValue(mockContainer);
    vi.mocked(deleteManagedContainer).mockRejectedValue("string-rejection");

    renderPage();
    await waitFor(() => screen.getByTestId("container-name"));

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /delete/i }));

    await waitFor(() => {
      expect(screen.getByText("Failed to delete managed container")).toBeDefined();
    });
  });

  it("clears the load-error alert when the close button is clicked", async () => {
    vi.mocked(getManagedContainer).mockRejectedValue(new Error("boom"));

    renderPage();
    const errorAlert = await waitFor(() => screen.getByText("boom").closest('[role="alert"]'));
    expect(errorAlert).not.toBeNull();

    const user = userEvent.setup();
    const closeButton = errorAlert!.querySelector("button");
    expect(closeButton).not.toBeNull();
    await user.click(closeButton!);

    expect(screen.queryByText("boom")).toBeNull();
  });

  it("clears the ping error when the alert close button is clicked", async () => {
    vi.mocked(getManagedContainer).mockResolvedValue(mockContainer);
    vi.mocked(pingManagedContainerHealth).mockRejectedValue(new Error("Container unreachable"));

    renderPage();
    await waitFor(() => screen.getByTestId("container-name"));

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /ping health/i }));
    await waitFor(() => screen.getByTestId("ping-error"));

    const closeButton = screen.getByTestId("ping-error").querySelector("button");
    expect(closeButton).not.toBeNull();
    await user.click(closeButton!);

    expect(screen.queryByTestId("ping-error")).toBeNull();
  });

  it("auto-pings on mount and updates the status chip to the success result without a manual click", async () => {
    vi.mocked(getManagedContainer).mockResolvedValue(mockContainer);
    vi.mocked(pingManagedContainerHealth).mockResolvedValue({ status: "ok", name: "abc123def456" });

    renderPage();

    await waitFor(() => {
      const chip = screen.getByTestId("container-status-chip");
      expect(chip.textContent).toBe("ok");
      expect(chip.className).toMatch(/colorSuccess/);
    });
    // The auto-ping happened without the user clicking the button.
    expect(pingManagedContainerHealth).toHaveBeenCalledWith(1);
  });

  it("renders the auto-ping failure as a red 'unhealthy' chip and does NOT show the error Alert", async () => {
    vi.mocked(getManagedContainer).mockResolvedValue(mockContainer);
    vi.mocked(pingManagedContainerHealth).mockRejectedValue(new Error("Container unreachable: ECONNREFUSED"));

    renderPage();

    await waitFor(() => {
      const chip = screen.getByTestId("container-status-chip");
      expect(chip.textContent).toBe("unhealthy");
      expect(chip.className).toMatch(/colorError/);
    });
    // Auto-ping failures stay silent in the Alert area to avoid implying the
    // container is broken before the user explicitly retried.
    expect(screen.queryByTestId("ping-error")).toBeNull();
  });

  it("shows the spinner + 'Checking...' loading state in the chip while a manual ping is in flight", async () => {
    vi.mocked(getManagedContainer).mockResolvedValue(mockContainer);
    // First call: auto-ping. Resolves immediately so we can settle into idle state.
    // Second call: manual ping. Held open by a deferred promise so we can observe the loading state.
    vi.mocked(pingManagedContainerHealth)
      .mockResolvedValueOnce({ status: "ok", name: "abc123def456" });
    let resolveManualPing: ((value: { status: string; name: string }) => void) | undefined;
    const pendingManualPingPromise = new Promise<{ status: string; name: string }>((resolveFn) => {
      resolveManualPing = resolveFn;
    });
    vi.mocked(pingManagedContainerHealth).mockReturnValueOnce(pendingManualPingPromise);

    renderPage();
    // Wait for auto-ping to settle into "ok" so we know the loading state we see next is from the click, not the auto-ping.
    await waitFor(() => {
      expect(screen.getByTestId("container-status-chip").textContent).toBe("ok");
    });

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /ping health/i }));

    await waitFor(() => {
      const chip = screen.getByTestId("container-status-chip");
      expect(chip.textContent).toBe("Checking...");
      expect(screen.getByTestId("container-status-spinner")).toBeDefined();
    });

    // Resolve the pending ping so the test cleans up.
    expect(resolveManualPing).toBeDefined();
    resolveManualPing!({ status: "ok", name: "abc123def456" });
    await waitFor(() => {
      expect(screen.getByTestId("container-status-chip").textContent).toBe("ok");
    });
  });

  it("shows BOTH the error Alert and a red 'unhealthy' chip when a manual ping fails", async () => {
    vi.mocked(getManagedContainer).mockResolvedValue(mockContainer);
    vi.mocked(pingManagedContainerHealth).mockRejectedValue(new Error("Container unreachable: ECONNREFUSED"));

    renderPage();
    // Wait for the auto-ping failure to render the red chip silently.
    await waitFor(() => {
      expect(screen.getByTestId("container-status-chip").textContent).toBe("unhealthy");
    });
    // Before any manual click, the Alert is NOT shown.
    expect(screen.queryByTestId("ping-error")).toBeNull();

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /ping health/i }));

    await waitFor(() => {
      expect(screen.getByTestId("ping-error").textContent).toMatch(/ECONNREFUSED/);
      const chip = screen.getByTestId("container-status-chip");
      expect(chip.textContent).toBe("unhealthy");
      expect(chip.className).toMatch(/colorError/);
    });
  });

  it("renders '—' for WireGuard config when the record has no wgConfigName", async () => {
    vi.mocked(getManagedContainer).mockResolvedValue({
      ...mockContainer,
      wgConfigName: null,
    });

    renderPage();

    await waitFor(() => {
      expect(screen.getByTestId("container-wg-config").textContent).toBe("—");
    });
  });

  it("shows an Invalid container ID alert when the URL :id param is non-numeric", async () => {
    renderPage("/containers/not-a-number");

    await waitFor(() => {
      expect(screen.getByText("Invalid container ID")).toBeDefined();
    });
    expect(getManagedContainer).not.toHaveBeenCalled();
  });
});
