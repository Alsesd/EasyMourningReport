import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MakerMark } from "./MakerMark";

describe("MakerMark", () => {
  it("renders trigger button and toggles credit on click", () => {
    render(<MakerMark />);
    const trigger = screen.getByRole("button", { name: "Reveal creator credit" });
    expect(trigger).toBeDefined();
    expect(trigger.getAttribute("aria-expanded")).toBe("false");

    // Click to reveal
    fireEvent.click(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("made by")).toBeDefined();
    expect(screen.getByText("Alsesd")).toBeDefined();

    // Click again to hide
    fireEvent.click(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
  });

  it("closes on Escape key press", () => {
    render(<MakerMark />);
    const trigger = screen.getByRole("button", { name: "Reveal creator credit" });
    fireEvent.click(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");

    fireEvent.keyDown(document, { key: "Escape" });
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
  });

  it("closes on click outside", () => {
    render(
      <div>
        <div data-testid="outside">Outside area</div>
        <MakerMark />
      </div>
    );
    const trigger = screen.getByRole("button", { name: "Reveal creator credit" });
    fireEvent.click(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");

    fireEvent.mouseDown(screen.getByTestId("outside"));
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
  });
});
