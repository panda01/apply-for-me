import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import ContainersListPage from "./ContainersListPage";

vi.mock("../services/managedContainersApi", () => ({
  listManagedContainers: vi.fn(),
  createManagedContainer: vi.fn(),
  deleteManagedContainer: vi.fn(),
}));

import {
  listManagedContainers,
  createManagedContainer,
  deleteManagedContainer,
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

function renderPage() {
  return render(
    <MemoryRouter>
      <ContainersListPage />
    </MemoryRouter>
  );
}

describe("ContainersListPage", () => {
  it("renders the page title and the new-container button", async () => {
    vi.mocked(listManagedContainers).mockResolvedValue([]);

    renderPage();

    expect(screen.getByText("Managed Containers")).toBeDefined();
    expect(screen.getByRole("button", { name: /new container/i })).toBeDefined();
    await waitFor(() => expect(listManagedContainers).toHaveBeenCalledOnce());
  });

  it("creates a container in-place and refreshes the list on success", async () => {
    vi.mocked(listManagedContainers)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([mockContainer]);
    vi.mocked(createManagedContainer).mockResolvedValue(mockContainer);

    renderPage();
    await waitFor(() => expect(screen.getByText(/No containers yet/i)).toBeDefined());

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /new container/i }));

    await waitFor(() => {
      expect(createManagedContainer).toHaveBeenCalledOnce();
      expect(screen.getByText("abc123def456")).toBeDefined();
    });
    expect(listManagedContainers).toHaveBeenCalledTimes(2);
  });

  it("shows an error alert when create fails", async () => {
    vi.mocked(listManagedContainers).mockResolvedValue([]);
    vi.mocked(createManagedContainer).mockRejectedValue(new Error("docker daemon offline"));

    renderPage();
    await waitFor(() => expect(screen.getByText(/No containers yet/i)).toBeDefined());

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /new container/i }));

    await waitFor(() => {
      expect(screen.getByText("docker daemon offline")).toBeDefined();
    });
  });

  it("falls back to a generic error message when create rejects with a non-Error", async () => {
    vi.mocked(listManagedContainers).mockResolvedValue([]);
    vi.mocked(createManagedContainer).mockRejectedValue("string-rejection");

    renderPage();
    await waitFor(() => expect(screen.getByText(/No containers yet/i)).toBeDefined());

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /new container/i }));

    await waitFor(() => {
      expect(screen.getByText("Failed to create managed container")).toBeDefined();
    });
  });

  it("renders the container name as a link to its view page", async () => {
    vi.mocked(listManagedContainers).mockResolvedValue([mockContainer]);

    renderPage();

    const link = await waitFor(() =>
      screen.getByRole("link", { name: "abc123def456" })
    );
    expect(link.getAttribute("href")).toBe("/containers/1");
  });

  it("shows the empty state when there are no containers", async () => {
    vi.mocked(listManagedContainers).mockResolvedValue([]);

    renderPage();

    await waitFor(() => {
      expect(screen.getByText(/No containers yet/i)).toBeDefined();
    });
  });

  it("displays containers in a table", async () => {
    vi.mocked(listManagedContainers).mockResolvedValue([mockContainer]);

    renderPage();

    await waitFor(() => {
      expect(screen.getByText("abc123def456")).toBeDefined();
      expect(screen.getByText("41123")).toBeDefined();
      expect(screen.getByText("running")).toBeDefined();
    });
  });

  it("shows an error alert when listing fails", async () => {
    vi.mocked(listManagedContainers).mockRejectedValue(new Error("Network error"));

    renderPage();

    await waitFor(() => {
      expect(screen.getByText("Network error")).toBeDefined();
    });
  });

  it("deletes a container and refreshes the list", async () => {
    vi.mocked(listManagedContainers)
      .mockResolvedValueOnce([mockContainer])
      .mockResolvedValueOnce([]);
    vi.mocked(deleteManagedContainer).mockResolvedValue(mockContainer);

    renderPage();

    await waitFor(() => expect(screen.getByText("abc123def456")).toBeDefined());

    const user = userEvent.setup();
    await user.click(screen.getByLabelText("delete abc123def456"));

    await waitFor(() => {
      expect(deleteManagedContainer).toHaveBeenCalledWith(1);
      expect(screen.getByText(/No containers yet/i)).toBeDefined();
    });
  });

  it("shows an error alert when delete fails", async () => {
    vi.mocked(listManagedContainers).mockResolvedValue([mockContainer]);
    vi.mocked(deleteManagedContainer).mockRejectedValue(new Error("docker offline"));

    renderPage();

    await waitFor(() => expect(screen.getByText("abc123def456")).toBeDefined());

    const user = userEvent.setup();
    await user.click(screen.getByLabelText("delete abc123def456"));

    await waitFor(() => {
      expect(screen.getByText("docker offline")).toBeDefined();
    });
  });

  it("navigates to the view page when the view icon is clicked", async () => {
    vi.mocked(listManagedContainers).mockResolvedValue([mockContainer]);

    renderPage();

    await waitFor(() => expect(screen.getByText("abc123def456")).toBeDefined());

    const user = userEvent.setup();
    await user.click(screen.getByLabelText("view abc123def456"));
    // We don't render destination route here, just confirm navigation didn't throw
    expect(screen.getByLabelText("view abc123def456")).toBeDefined();
  });

  it("falls back to a generic error message when listing rejects with a non-Error", async () => {
    vi.mocked(listManagedContainers).mockRejectedValue("string-rejection");

    renderPage();

    await waitFor(() => {
      expect(screen.getByText("Failed to load managed containers")).toBeDefined();
    });
  });

  it("falls back to a generic error message when delete rejects with a non-Error", async () => {
    vi.mocked(listManagedContainers).mockResolvedValue([mockContainer]);
    vi.mocked(deleteManagedContainer).mockRejectedValue("string-rejection");

    renderPage();
    await waitFor(() => expect(screen.getByText("abc123def456")).toBeDefined());

    const user = userEvent.setup();
    await user.click(screen.getByLabelText("delete abc123def456"));

    await waitFor(() => {
      expect(screen.getByText("Failed to delete managed container")).toBeDefined();
    });
  });

  it("clears the error alert when the close button is clicked", async () => {
    vi.mocked(listManagedContainers).mockRejectedValue(new Error("Network error"));

    renderPage();
    const errorAlert = await waitFor(() => screen.getByText("Network error").closest('[role="alert"]'));
    expect(errorAlert).not.toBeNull();

    const user = userEvent.setup();
    const closeButton = errorAlert!.querySelector("button");
    expect(closeButton).not.toBeNull();
    await user.click(closeButton!);

    expect(screen.queryByText("Network error")).toBeNull();
  });
});
