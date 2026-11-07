import { describe, it, expect, vi } from "vitest";
import { useState } from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { Combobox } from "./Combobox";

const items = [
  { id: 1, name: "Труна Бейка" },
  { id: 2, name: "Труна Класик" },
  { id: 3, name: "Вінок" },
];
type Item = (typeof items)[number];

function Harness({ onPick }: { onPick?: (i: Item | null) => void }) {
  const [v, setV] = useState<Item | null>(null);
  return (
    <Combobox
      label="Товар"
      items={items}
      value={v}
      onChange={(i) => {
        setV(i);
        onPick?.(i);
      }}
      getKey={(i) => i.id}
      getLabel={(i) => i.name}
      clearable
    />
  );
}

describe("Combobox", () => {
  it("is an ARIA combobox that filters while typing and announces the count", () => {
    render(<Harness />);
    const box = screen.getByRole("combobox", { name: "Товар" });
    fireEvent.focus(box);
    expect(box.getAttribute("aria-expanded")).toBe("true");
    fireEvent.change(box, { target: { value: "клас" } });
    expect(screen.getAllByRole("option")).toHaveLength(1);
    expect(screen.getByText("Варіантів: 1")).toBeDefined();
    expect(screen.getByRole("option").querySelector("mark")?.textContent).toBe("Клас");
  });

  it("moves with the arrows, chooses with Enter and shows the choice", () => {
    const pick = vi.fn();
    render(<Harness onPick={pick} />);
    const box = screen.getByRole("combobox", { name: "Товар" }) as HTMLInputElement;
    fireEvent.change(box, { target: { value: "труна" } });
    fireEvent.keyDown(box, { key: "ArrowDown" });
    expect(box.getAttribute("aria-activedescendant")).toBe(screen.getAllByRole("option")[1].id);
    fireEvent.keyDown(box, { key: "Enter" });
    expect(pick).toHaveBeenCalledWith(items[1]);
    expect(box.value).toBe("Труна Класик");
    expect(box.getAttribute("aria-expanded")).toBe("false");
  });

  it("closes on Escape without choosing, and can be cleared", () => {
    const pick = vi.fn();
    render(<Harness onPick={pick} />);
    const box = screen.getByRole("combobox", { name: "Товар" }) as HTMLInputElement;
    fireEvent.change(box, { target: { value: "він" } });
    fireEvent.keyDown(box, { key: "Escape" });
    expect(box.getAttribute("aria-expanded")).toBe("false");
    expect(pick).not.toHaveBeenCalled();
    fireEvent.focus(box);
    fireEvent.click(screen.getAllByRole("option")[2]);
    expect(box.value).toBe("Вінок");
    fireEvent.click(screen.getByRole("button", { name: "Очистити" }));
    expect(pick).toHaveBeenLastCalledWith(null);
    expect(box.value).toBe("");
  });

  it("says so when nothing matches", () => {
    render(<Harness />);
    fireEvent.change(screen.getByRole("combobox", { name: "Товар" }), { target: { value: "ящик" } });
    expect(screen.queryAllByRole("option")).toHaveLength(0);
    expect(screen.getAllByText("Нічого не знайдено").length).toBeGreaterThan(0);
  });

  it("uses the caller's search to rank and highlight", () => {
    render(
      <Combobox
        label="Товар"
        items={items}
        value={null}
        onChange={() => {}}
        getKey={(i) => i.id}
        getLabel={(i) => i.name}
        search={(q) => (q ? [{ item: items[2], ranges: [[0, 1]] }] : [])}
      />,
    );
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "щось" } });
    expect(screen.getByRole("option").textContent).toBe("Вінок");
  });
});
