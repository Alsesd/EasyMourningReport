import { describe, it, expect, vi } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { AnimatedCollapse } from "./AnimatedCollapse";

describe("AnimatedCollapse", () => {
  it("renders content when open is true", () => {
    render(
      <AnimatedCollapse open={true}>
        <div>Dynamic Field Content</div>
      </AnimatedCollapse>
    );

    expect(screen.getByText("Dynamic Field Content")).toBeDefined();
  });

  it("does not render content initially when open is false and unmountOnExit is true", () => {
    render(
      <AnimatedCollapse open={false} unmountOnExit={true}>
        <div>Hidden Content</div>
      </AnimatedCollapse>
    );

    expect(screen.queryByText("Hidden Content")).toBeNull();
  });

  it("mounts content when open transitions to true", async () => {
    const { rerender } = render(
      <AnimatedCollapse open={false}>
        <div>Spawning Field</div>
      </AnimatedCollapse>
    );

    expect(screen.queryByText("Spawning Field")).toBeNull();

    rerender(
      <AnimatedCollapse open={true}>
        <div>Spawning Field</div>
      </AnimatedCollapse>
    );

    expect(await screen.findByText("Spawning Field")).toBeDefined();
  });

  it("unmounts after duration when open transitions to false", async () => {
    vi.useFakeTimers();

    const { rerender } = render(
      <AnimatedCollapse open={true} durationMs={200}>
        <div>Collapsing Field</div>
      </AnimatedCollapse>
    );

    expect(screen.getByText("Collapsing Field")).toBeDefined();

    rerender(
      <AnimatedCollapse open={false} durationMs={200}>
        <div>Collapsing Field</div>
      </AnimatedCollapse>
    );

    // Still in DOM during exit animation
    expect(screen.getByText("Collapsing Field")).toBeDefined();

    // Fast-forward past duration
    act(() => {
      vi.advanceTimersByTime(250);
    });

    expect(screen.queryByText("Collapsing Field")).toBeNull();

    vi.useRealTimers();
  });

  it("preserves children during collapse when children become null on close", async () => {
    vi.useFakeTimers();

    const { rerender } = render(
      <AnimatedCollapse open={true} durationMs={200}>
        <div>Dynamic Alert Content</div>
      </AnimatedCollapse>
    );

    expect(screen.getByText("Dynamic Alert Content")).toBeDefined();

    // Parent unsets state to null when closing (e.g. feedback alert dismissed)
    rerender(
      <AnimatedCollapse open={false} durationMs={200}>
        {null}
      </AnimatedCollapse>
    );

    // Should STILL be in DOM during exit animation thanks to lastChildrenRef
    expect(screen.getByText("Dynamic Alert Content")).toBeDefined();

    act(() => {
      vi.advanceTimersByTime(250);
    });

    expect(screen.queryByText("Dynamic Alert Content")).toBeNull();

    vi.useRealTimers();
  });
});
