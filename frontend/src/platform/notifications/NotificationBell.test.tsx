import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NotificationBell } from "./NotificationBell";
import { notificationsApi } from "./api";
import type { NotificationsDTO } from "@/platform/api/types";

const item = (id: number, over: Partial<NotificationsDTO["items"][number]> = {}) => ({
  id, kind: "transport.status", title: `Замовлення ${id}: прийнято`, body: "Виїде о 8:40", link: "/admin/transport",
  created_at: "2026-11-06T10:00:00Z", read: false, ...over,
});

function renderBell(client = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route path="/" element={<NotificationBell />} />
          <Route path="/admin/transport" element={<p>Сторінка транспорту</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("NotificationBell", () => {
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => vi.unstubAllGlobals());

  it("shows the unread count and lists the messages", async () => {
    vi.spyOn(notificationsApi, "list").mockResolvedValue({ unread: 2, items: [item(2), item(1, { read: true })] });
    renderBell();
    const bell = await screen.findByRole("button", { name: "Сповіщення, непрочитаних: 2" });
    fireEvent.click(bell);
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Замовлення 2: прийнято")).toBeDefined();
    expect(within(dialog).getByText("Замовлення 1: прийнято")).toBeDefined();
  });

  it("marks a message read and opens its page", async () => {
    vi.spyOn(notificationsApi, "list").mockResolvedValue({ unread: 1, items: [item(5)] });
    const read = vi.spyOn(notificationsApi, "read").mockResolvedValue({ unread: 0, items: [item(5, { read: true })] });
    renderBell();
    fireEvent.click(await screen.findByRole("button", { name: /Сповіщення, непрочитаних: 1/ }));
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: /Замовлення 5/ }));
    await waitFor(() => expect(read).toHaveBeenCalledWith(5));
    expect(await screen.findByText("Сторінка транспорту")).toBeDefined();
  });

  it("marks everything read", async () => {
    vi.spyOn(notificationsApi, "list").mockResolvedValue({ unread: 2, items: [item(2), item(1)] });
    const readAll = vi.spyOn(notificationsApi, "readAll").mockResolvedValue({ unread: 0, items: [item(2, { read: true }), item(1, { read: true })] });
    renderBell();
    fireEvent.click(await screen.findByRole("button", { name: /Сповіщення, непрочитаних: 2/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Позначити всі прочитаними" }));
    await waitFor(() => expect(readAll).toHaveBeenCalledTimes(1));
  });

  it("picks up a new message by itself and announces only what arrived after the first load", async () => {
    const shown: string[] = [];
    class FakeNotification {
      static permission = "granted";
      static requestPermission = vi.fn();
      constructor(title: string) {
        shown.push(title);
      }
    }
    vi.stubGlobal("Notification", FakeNotification);
    const list = vi
      .spyOn(notificationsApi, "list")
      .mockResolvedValueOnce({ unread: 1, items: [item(1)] })
      .mockResolvedValue({ unread: 2, items: [item(2, { title: "Нове замовлення" }), item(1)] });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    renderBell(client);
    await screen.findByRole("button", { name: "Сповіщення, непрочитаних: 1" });
    expect(shown).toEqual([]); // what was already waiting is not announced
    await client.invalidateQueries({ queryKey: ["notifications"] }); // what the 20 s poll does
    await screen.findByRole("button", { name: "Сповіщення, непрочитаних: 2" });
    expect(list).toHaveBeenCalledTimes(2);
    expect(shown).toEqual(["Нове замовлення"]);
  });

  it("offers device notifications only while the browser has not decided", async () => {
    class FakeNotification {
      static permission = "default";
      static requestPermission = vi.fn(() => Promise.resolve("granted"));
    }
    vi.stubGlobal("Notification", FakeNotification);
    vi.spyOn(notificationsApi, "list").mockResolvedValue({ unread: 0, items: [] });
    renderBell();
    fireEvent.click(await screen.findByRole("button", { name: "Сповіщення" }));
    fireEvent.click(await screen.findByRole("switch", { name: "Показувати сповіщення на цьому пристрої" }));
    await waitFor(() => expect(FakeNotification.requestPermission).toHaveBeenCalled());
    expect(await screen.findByText(/дозволено/)).toBeDefined();
  });

  it("sends a test notification and says whether this device can receive it with the app closed", async () => {
    vi.spyOn(notificationsApi, "list").mockResolvedValue({ unread: 0, items: [] });
    const test = vi.spyOn(notificationsApi, "test").mockResolvedValueOnce({ push_configured: true, devices: 0 }).mockResolvedValueOnce({ push_configured: true, devices: 2 });
    renderBell();
    fireEvent.click(await screen.findByRole("button", { name: "Сповіщення" }));
    fireEvent.click(await screen.findByRole("button", { name: "Надіслати тестове сповіщення" }));
    expect((await screen.findByRole("status")).textContent).toMatch(/ще не підписаний на push/);
    fireEvent.click(screen.getByRole("button", { name: "Надіслати тестове сповіщення" }));
    await waitFor(() => expect(screen.getByRole("status").textContent).toMatch(/пристроїв з push: 2/));
    expect(test).toHaveBeenCalledTimes(2);
  });
});
