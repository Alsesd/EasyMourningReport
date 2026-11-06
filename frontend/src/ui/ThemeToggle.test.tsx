import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ThemeProvider } from "@/platform/theme/ThemeContext";
import { ThemeToggle } from "./ThemeToggle";

describe("theme", () => {
  beforeEach(() => localStorage.clear());

  it("offers light, dark and system and applies the choice to the document", () => {
    render(
      <ThemeProvider>
        <ThemeToggle />
      </ThemeProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: /тему/ }));
    fireEvent.click(screen.getByText("Темна тема"));
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(localStorage.getItem("easyMourningReport.theme")).toBe("dark");
    fireEvent.click(screen.getByRole("button", { name: /тему/ }));
    fireEvent.click(screen.getByText("Світла тема"));
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });

  it("remembers the stored choice and closes the menu on an outside click", () => {
    localStorage.setItem("easyMourningReport.theme", "dark");
    render(
      <ThemeProvider>
        <ThemeToggle />
        <p>outside</p>
      </ThemeProvider>,
    );
    expect(document.documentElement.dataset.theme).toBe("dark");
    const toggle = screen.getByRole("button", { name: /тему/ });
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    fireEvent.mouseDown(screen.getByText("outside"));
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
  });
});
