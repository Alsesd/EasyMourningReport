import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/ui/Dialog";

describe("Dialog", () => {
  it("is laid out by the dialog-panel class, which centres without transform and becomes a sheet on phones", () => {
    render(
      <Dialog open>
        <DialogContent>
          <DialogTitle>Назва</DialogTitle>
          <DialogDescription>Опис</DialogDescription>
        </DialogContent>
      </Dialog>,
    );
    const panel = screen.getByRole("dialog");
    expect(panel.className).toContain("dialog-panel");
    // Utilities that would fight the CSS (full-screen insets, translate centring) must stay out of the primitive.
    expect(panel.className).not.toMatch(/translate|inset-0|rounded-none/);
    expect(screen.getByRole("button", { name: "Закрити" })).toBeDefined();
  });
});
