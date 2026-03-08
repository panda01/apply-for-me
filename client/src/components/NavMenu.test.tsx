import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import NavMenu from "./NavMenu";

/**
 * Helper to render NavMenu inside a MemoryRouter at a given route.
 * @param {string} initialPath - The route to start at
 */
function renderNavMenu(initialPath = "/") {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <NavMenu />
    </MemoryRouter>
  );
}

describe("NavMenu", () => {
  it("should render the app title", () => {
    renderNavMenu();

    expect(screen.getByText("Apply For Me")).toBeDefined();
  });

  it("should render navigation links for Add Job and Jobs List", () => {
    renderNavMenu();

    expect(screen.getByRole("link", { name: /Add Job/ })).toBeDefined();
    expect(screen.getByRole("link", { name: /Jobs List/ })).toBeDefined();
  });

  it("should highlight Add Job link when on the root route", () => {
    renderNavMenu("/");

    const addJobLink = screen.getByRole("link", { name: /Add Job/ });
    const hasOutlinedClass = addJobLink.classList.toString().includes("outlined");

    expect(hasOutlinedClass).toBe(true);
  });

  it("should highlight Jobs List link when on the /jobs route", () => {
    renderNavMenu("/jobs");

    const jobsListLink = screen.getByRole("link", { name: /Jobs List/ });
    const hasOutlinedClass = jobsListLink.classList.toString().includes("outlined");

    expect(hasOutlinedClass).toBe(true);
  });
});
