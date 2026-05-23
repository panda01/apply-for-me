import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

/**
 * Minimal in-memory localStorage stand-in. The configured jsdom env does not
 * expose a real Storage implementation, but AppShell reads/writes
 * `afm:sidebar` on mount and on every toggle.
 */
const inMemoryStorage = new Map<string, string>();
Object.defineProperty(window, "localStorage", {
  configurable: true,
  value: {
    getItem: (key: string): string | null => inMemoryStorage.get(key) ?? null,
    setItem: (key: string, value: string): void => {
      inMemoryStorage.set(key, value);
    },
    removeItem: (key: string): void => {
      inMemoryStorage.delete(key);
    },
    clear: (): void => {
      inMemoryStorage.clear();
    },
    key: (index: number): string | null => Array.from(inMemoryStorage.keys())[index] ?? null,
    get length(): number {
      return inMemoryStorage.size;
    },
  },
});

import AppShell from "./AppShell";

beforeEach(() => {
  inMemoryStorage.clear();
});

afterEach(() => {
  inMemoryStorage.clear();
});

/**
 * Render AppShell with a known child node inside a MemoryRouter so we can verify
 * that `children` is rendered into the `.content` region and that the outer
 * `.app` element carries the expected `data-sidebar` attribute.
 *
 * @returns The render result from @testing-library/react.
 */
function renderAppShell() {
  return render(
    <MemoryRouter>
      <AppShell>
        <div data-testid="child-content">child marker</div>
      </AppShell>
    </MemoryRouter>
  );
}

describe("AppShell", () => {
  it("renders children inside the content region", () => {
    renderAppShell();
    expect(screen.getByTestId("child-content").textContent).toBe("child marker");
  });

  it("starts with sidebar expanded when localStorage is empty", () => {
    const { container } = renderAppShell();
    const appEl = container.querySelector(".app");
    expect(appEl?.getAttribute("data-sidebar")).toBe("expanded");
  });

  it("restores collapsed sidebar state from localStorage", () => {
    inMemoryStorage.set("afm:sidebar", "collapsed");
    const { container } = renderAppShell();
    const appEl = container.querySelector(".app");
    expect(appEl?.getAttribute("data-sidebar")).toBe("collapsed");
  });

  it("falls back to expanded when localStorage holds an invalid value", () => {
    inMemoryStorage.set("afm:sidebar", "not-a-real-state");
    const { container } = renderAppShell();
    const appEl = container.querySelector(".app");
    expect(appEl?.getAttribute("data-sidebar")).toBe("expanded");
  });

  it("toggles the sidebar when the topbar toggle button is clicked", () => {
    const { container } = renderAppShell();
    const appEl = container.querySelector(".app");
    expect(appEl?.getAttribute("data-sidebar")).toBe("expanded");

    const toggleButton = screen.getByRole("button", { name: /toggle sidebar/i });
    fireEvent.click(toggleButton);

    expect(appEl?.getAttribute("data-sidebar")).toBe("collapsed");

    fireEvent.click(toggleButton);
    expect(appEl?.getAttribute("data-sidebar")).toBe("expanded");
  });

  it("persists the sidebar state to localStorage on toggle", () => {
    renderAppShell();
    const toggleButton = screen.getByRole("button", { name: /toggle sidebar/i });
    fireEvent.click(toggleButton);
    expect(inMemoryStorage.get("afm:sidebar")).toBe("collapsed");
    fireEvent.click(toggleButton);
    expect(inMemoryStorage.get("afm:sidebar")).toBe("expanded");
  });

  it("falls back to expanded and skips persistence when localStorage is unavailable", () => {
    // Mimic a private-mode / SSR-like environment where window.localStorage is
    // undefined. Restored in finally so other tests retain the polyfill.
    const originalDescriptor = Object.getOwnPropertyDescriptor(window, "localStorage");
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: undefined,
    });
    try {
      const { container } = renderAppShell();
      const appEl = container.querySelector(".app");
      expect(appEl?.getAttribute("data-sidebar")).toBe("expanded");

      // Toggling should still work — the persistence side-effect early-returns
      // without throwing, but the in-memory state still flips.
      const toggleButton = screen.getByRole("button", { name: /toggle sidebar/i });
      fireEvent.click(toggleButton);
      expect(appEl?.getAttribute("data-sidebar")).toBe("collapsed");
    } finally {
      if (originalDescriptor) {
        Object.defineProperty(window, "localStorage", originalDescriptor);
      }
    }
  });
});
