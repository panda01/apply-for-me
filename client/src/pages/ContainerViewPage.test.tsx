import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import ContainerViewPage from "./ContainerViewPage";

vi.mock("../services/managedContainersApi", () => ({
  getManagedContainer: vi.fn(),
  deleteManagedContainer: vi.fn(),
  pingManagedContainerHealth: vi.fn(),
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
});
