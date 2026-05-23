import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import Topbar from "./Topbar";

/**
 * Render Topbar inside a MemoryRouter pointed at the requested route. Topbar reads
 * the current pathname via `useLocation()` to derive its page title, so each test
 * controls which title branch fires by selecting an initial route.
 *
 * @param initialRoute Route string to seed the MemoryRouter with.
 * @param onToggleSidebar Optional toggle handler — defaults to a no-op vi.fn().
 * @returns The render result from @testing-library/react.
 */
function renderTopbarAtRoute(initialRoute: string, onToggleSidebar: () => void = vi.fn()) {
  return render(
    <MemoryRouter initialEntries={[initialRoute]}>
      <Topbar onToggleSidebar={onToggleSidebar} />
    </MemoryRouter>
  );
}

describe("Topbar getPageTitle route mapping", () => {
  it.each([
    ["/", "Add job"],
    ["/jobs", "Jobs"],
    ["/jobs/123", "Jobs"],
    ["/jobs/42/url-resolution", "URL Resolution"],
    ["/jobs/42/attempts", "Attempts"],
    ["/apply", "Dashboard"],
    ["/profiles", "Profiles"],
    ["/settings", "Settings"],
    ["/containers", "Containers"],
    ["/containers/abc123", "Containers"],
    ["/unknown-route", "Apply For Me"],
  ])("route %s renders title %s", (route, expectedTitle) => {
    renderTopbarAtRoute(route);
    expect(screen.getByText(expectedTitle)).toBeDefined();
  });
});

describe("Topbar interactions", () => {
  it("calls onToggleSidebar when the toggle icon button is clicked", () => {
    const onToggleSidebar = vi.fn();
    renderTopbarAtRoute("/jobs", onToggleSidebar);

    const toggleButton = screen.getByRole("button", { name: /toggle sidebar/i });
    fireEvent.click(toggleButton);

    expect(onToggleSidebar).toHaveBeenCalledOnce();
  });

  it("renders the visual-only search input and ⌘K hint", () => {
    renderTopbarAtRoute("/jobs");
    expect(screen.getByPlaceholderText("Search jobs, companies…")).toBeDefined();
    expect(screen.getByText("⌘ K")).toBeDefined();
  });

  it("renders the notifications icon button", () => {
    renderTopbarAtRoute("/jobs");
    expect(screen.getByRole("button", { name: /notifications/i })).toBeDefined();
  });
});
