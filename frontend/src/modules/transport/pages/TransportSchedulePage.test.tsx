import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import TransportSchedulePage, { carryingOrders } from "./TransportSchedulePage";
import { transportApi } from "@/modules/transport/api";
import type { TransportOrderDTO } from "@/platform/api/types";

const carry = (id: number, time: string, over: Partial<TransportOrderDTO> = {}): TransportOrderDTO => ({
  id, organisation: { id: 1, name: "Філія А" }, service_date: "2026-11-06", deceased: `Покійний ${id}`, notes: "", status: "accepted",
  reply_note: "", delivery: null, sort_time: time, submitted_by: "x", created_at: "", updated_at: "", can_edit: false, next_statuses: [], events: [],
  carriers: { count: 4, time, from: `Адреса ${id}`, cemetery_number: "3", stops: ["Церква"], bearers: ["Петренко О.", "Коваль І."] }, ...over,
});

describe("carrying schedule", () => {
  afterEach(() => vi.restoreAllMocks());

  it("keeps carrying orders only, earliest carrying time first", () => {
    const rows = carryingOrders([
      carry(1, "14:00"),
      carry(2, "09:30"),
      carry(3, "10:00", { status: "rejected" }),
      carry(4, "11:00", { status: "cancelled" }),
      carry(5, "08:00", { carriers: null }),
    ]);
    expect(rows.map((o) => o.id)).toEqual([2, 1]);
  });

  it("prints who carries where and when, and flags a missing crew", async () => {
    vi.spyOn(transportApi, "orders").mockResolvedValue([carry(1, "14:00"), carry(2, "09:30", { carriers: { count: 6, time: "09:30", from: "Адреса 2", cemetery_number: "", stops: [], bearers: [] } })]);
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter initialEntries={["/admin/transport/schedule?date=2026-11-06"]}>
          <TransportSchedulePage />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    const rows = await screen.findAllByRole("row");
    expect(within(rows[1]).getByText("Покійний 2")).toBeDefined();
    expect(within(rows[1]).getByText("Носіїв ще не призначено")).toBeDefined();
    expect(within(rows[2]).getByText("Петренко О.")).toBeDefined();
    expect(within(rows[2]).getByText("Церква")).toBeDefined();
    expect(screen.getByRole("button", { name: /Друкувати/ })).toBeDefined();
  });
});
