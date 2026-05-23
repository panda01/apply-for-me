import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import Sidebar from "./Sidebar";

/**
 * Render Sidebar at a chosen pathname so we can observe which nav item ends up
 * with `data-active="true"`. The MemoryRouter is the simplest way to control
 * the path Sidebar reads via `useLocation()`.
 *
 * @param pathname Initial pathname for the router.
 * @returns The render result from @testing-library/react.
 */
function renderSidebarAtPath(pathname: string) {
  return render(
    <MemoryRouter initialEntries={[pathname]}>
      <Sidebar />
    </MemoryRouter>
  );
}

describe("Sidebar nav item active state", () => {
  it("marks /jobs as active for an exact /jobs match", () => {
    const { container } = renderSidebarAtPath("/jobs");
    const jobsLink = container.querySelector('a[href="/jobs"]');
    expect(jobsLink?.getAttribute("data-active")).toBe("true");
  });

  it("keeps /jobs active when on a nested /jobs/:id route", () => {
    const { container } = renderSidebarAtPath("/jobs/42");
    const jobsLink = container.querySelector('a[href="/jobs"]');
    expect(jobsLink?.getAttribute("data-active")).toBe("true");
  });

  it("keeps /jobs active on /jobs/:id/url-resolution as well", () => {
    const { container } = renderSidebarAtPath("/jobs/42/url-resolution");
    const jobsLink = container.querySelector('a[href="/jobs"]');
    expect(jobsLink?.getAttribute("data-active")).toBe("true");
  });

  it("marks /containers as active on /containers and nested ids", () => {
    const { container } = renderSidebarAtPath("/containers/some-id");
    const containersLink = container.querySelector('a[href="/containers"]');
    expect(containersLink?.getAttribute("data-active")).toBe("true");
  });

  it("does not mark /jobs active for /profiles", () => {
    const { container } = renderSidebarAtPath("/profiles");
    const jobsLink = container.querySelector('a[href="/jobs"]');
    expect(jobsLink?.getAttribute("data-active")).toBe("false");
  });

  it("does not mark /containers active for an unrelated route", () => {
    const { container } = renderSidebarAtPath("/settings");
    const containersLink = container.querySelector('a[href="/containers"]');
    expect(containersLink?.getAttribute("data-active")).toBe("false");
  });

  it("renders the brand, all three section headings, and the user block", () => {
    const { container } = renderSidebarAtPath("/jobs");
    expect(container.querySelector(".sb-brand")).not.toBeNull();
    expect(container.querySelectorAll(".sb-section").length).toBeGreaterThanOrEqual(3);
    expect(container.querySelector(".sb-user")).not.toBeNull();
  });

  it("renders count badges next to Jobs and Profiles when counts are provided", () => {
    render(
      <MemoryRouter initialEntries={["/jobs"]}>
        <Sidebar counts={{ jobs: 12, profiles: 3 }} />
      </MemoryRouter>
    );
    expect(screen.getByText("12")).toBeDefined();
    expect(screen.getByText("3")).toBeDefined();
  });
});
