import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import App from "./App";

describe("App", () => {
  it("should render Hello World", () => {
    render(<App />);

    const heading = screen.getByText("Hello World");

    expect(heading).toBeDefined();
  });
});
