import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import SessionsSection, { groupByUser } from "./SessionsSection";
import { accessApi } from "./api";
import type { AdminSessionDTO } from "@/platform/api/types";

const row = (id: number, user_id: number, login: string, device: string, over: Partial<AdminSessionDTO> = {}): AdminSessionDTO => ({
  id, user_id, login, full_name: login === "desk" ? "Оксана Мельник" : "", organisation: { id: 1, name: "Філія А" }, active: true,
  device, ip: "198.51.100.10", created_at: "2026-11-06T10:00:00Z", last_seen: "2026-11-06T10:30:00Z", current: false, ...over,
});

describe("SessionsSection", () => {
  afterEach(() => vi.restoreAllMocks());

  it("groups sessions by employee", () => {
    const groups = groupByUser([row(1, 2, "desk", "Chrome · Windows"), row(2, 2, "desk", "Safari · iOS"), row(3, 3, "other", "Edge · Windows")]);
    expect(groups.map((g) => g.length)).toEqual([2, 1]);
  });

  it("lists every device and ends one after a confirmation", async () => {
    vi.spyOn(accessApi, "sessions").mockResolvedValue([row(1, 2, "desk", "Chrome · Windows"), row(2, 2, "desk", "Safari · iOS"), row(3, 1, "boss", "Edge · Windows", { current: true })]);
    const end = vi.spyOn(accessApi, "endSession").mockResolvedValue({ message: "ok" });
    const notify = vi.fn();
    render(
      <QueryClientProvider client={new QueryClient()}>
        <SessionsSection notify={notify} />
      </QueryClientProvider>,
    );
    const desk = await screen.findByRole("region", { name: "Оксана Мельник" });
    expect(within(desk).getByText("Chrome · Windows")).toBeDefined();
    expect(within(desk).getByText("Safari · iOS")).toBeDefined();
    expect(screen.getByText(/· Ви/)).toBeDefined();
    fireEvent.click(within(desk).getByRole("button", { name: /Завершити сеанс: Оксана Мельник, Safari/ }));
    expect(end).not.toHaveBeenCalled();
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Завершити сеанс" }));
    await waitFor(() => expect(end).toHaveBeenCalledWith(2));
  });

  it("signs an employee out everywhere", async () => {
    vi.spyOn(accessApi, "sessions").mockResolvedValue([row(1, 2, "desk", "Chrome · Windows")]);
    const all = vi.spyOn(accessApi, "endUserSessions").mockResolvedValue({ message: "ok" });
    render(
      <QueryClientProvider client={new QueryClient()}>
        <SessionsSection notify={vi.fn()} />
      </QueryClientProvider>,
    );
    fireEvent.click(await screen.findByRole("button", { name: "Вийти скрізь" }));
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Вийти скрізь" }));
    await waitFor(() => expect(all).toHaveBeenCalledWith(2));
  });
});
