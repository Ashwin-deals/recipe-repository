import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { ThemeToggle } from "./ThemeToggle";

afterEach(() => {
  delete document.documentElement.dataset.theme;
});

describe("ThemeToggle", () => {
  it("switches theme, labels the next choice, and remembers it", async () => {
    render(<ThemeToggle />);
    const button = screen.getByRole("button", { name: "Switch to dark theme" });
    await userEvent.click(button);
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(localStorage.getItem("cartchef:theme")).toBe("dark");
    expect(button).toHaveAccessibleName("Switch to light theme");
    await userEvent.click(button);
    expect(document.documentElement.dataset.theme).toBe("light");
  });
});
