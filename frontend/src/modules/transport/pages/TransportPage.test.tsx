import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import TransportPage from "./TransportPage";
import { transportApi } from "@/modules/transport/api";
import { AuthProvider } from "@/platform/auth/AuthContext";
import type { SessionDTO, TransportOrderDTO } from "@/platform/api/types";
import { todayIso } from "@/platform/i18n";

const base: SessionDTO = {
  user_id: 1, login: "desk", full_name: "Оксана", organisation: { id: 3, name: "Філія А" },
  roles: ["Стіл"], permissions: ["transport.orders.create"], modules: ["transport"], period: "2026-11",
};
const dispatcher: SessionDTO = { ...base, user_id: 2, login: "boss", organisation: null, permissions: ["transport.orders.manage"] };

const order = (over: Partial<TransportOrderDTO>): TransportOrderDTO => ({
  id: 1, organisation: { id: 3, name: "Філія А" }, service_date: todayIso(), deceased: "Іваненко І. І.", notes: "",
  status: "submitted", reply_note: "", delivery: { car_number: "АА 1111 АА", time: "09:30", destination: "Морг", stops: [] },
  carriers: null, sort_time: "09:30", submitted_by: "Оксана", created_at: "", updated_at: "", can_edit: true, next_statuses: [], events: [], ...over,
});

function renderPage(session: SessionDTO) {
  vi.stubGlobal("fetch", vi.fn(() => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(session) })));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <AuthProvider>
        <MemoryRouter>
          <TransportPage />
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>,
  );
}

describe("TransportPage", () => {
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => vi.unstubAllGlobals());

  it("shows a desk its orders in time order with delivery and carriers together", async () => {
    vi.spyOn(transportApi, "orders").mockResolvedValue([
      order({ id: 1, deceased: "Ранній", sort_time: "08:30", carriers: { count: 6, time: "08:30", from: "вул. Квітуча, 5", cemetery_number: "3", stops: ["Церква"] } }),
      order({ id: 2, deceased: "Пізній", sort_time: "12:00", status: "accepted", reply_note: "Авто виїде о 11:20", can_edit: false }),
    ]);
    renderPage(base);
    const early = await screen.findByRole("article", { name: /Ранній/ });
    expect(within(early).getByRole("region", { name: "Доставка" })).toBeDefined();
    expect(within(early).getByRole("region", { name: "Винос" })).toBeDefined();
    expect(within(early).getByText("Церква")).toBeDefined();
    expect(within(early).getByRole("button", { name: /Скасувати замовлення/ })).toBeDefined();
    const late = screen.getByRole("article", { name: /Пізній/ });
    expect(within(late).getByText("Прийнято")).toBeDefined();
    expect(within(late).getByText("Авто виїде о 11:20")).toBeDefined();
    expect(within(late).queryByRole("button", { name: /Скасувати замовлення/ })).toBeNull();
    // Chronological: the early order comes first in the document.
    const articles = screen.getAllByRole("article").map((a) => a.getAttribute("aria-label"));
    expect(articles[0]).toContain("Ранній");
  });

  it("a desk creates an order through the form and sees the validation first", async () => {
    vi.spyOn(transportApi, "orders").mockResolvedValue([]);
    const create = vi.spyOn(transportApi, "create").mockResolvedValue(order({}));
    renderPage(base);
    fireEvent.click(await screen.findByRole("button", { name: /Нове замовлення/ }));
    fireEvent.click(screen.getByRole("button", { name: "Надіслати" }));
    expect((await screen.findByRole("status")).textContent).toMatch(/Прізвище та ініціали померлого/);
    expect(create).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("Прізвище та ініціали померлого"), { target: { value: "Петренко П. П." } });
    fireEvent.change(screen.getByLabelText("Номер авто"), { target: { value: "ВС 5555 ВС" } });
    fireEvent.change(screen.getByLabelText("Час"), { target: { value: "0930" } });
    fireEvent.change(screen.getByLabelText("Кінцевий пункт"), { target: { value: "Кладовище №2" } });
    fireEvent.click(screen.getByRole("button", { name: "Надіслати" }));
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    const sent = create.mock.calls[0][0];
    expect(sent).toMatchObject({ deceased: "Петренко П. П.", carriers: null, delivery: { car_number: "ВС 5555 ВС", time: "09:30", destination: "Кладовище №2" } });
  });

  it("a dispatcher replies with a status and a note", async () => {
    vi.spyOn(transportApi, "orders").mockResolvedValue([order({ can_edit: false, next_statuses: ["accepted", "rejected"] })]);
    const setStatus = vi.spyOn(transportApi, "setStatus").mockResolvedValue(order({ status: "accepted" }));
    renderPage(dispatcher);
    const card = await screen.findByRole("article", { name: /Іваненко/ });
    expect(within(card).getByText(/Філія А/)).toBeDefined();
    expect(within(card).queryByRole("button", { name: /Скасувати замовлення/ })).toBeNull();
    fireEvent.click(within(card).getByRole("button", { name: "Прийняти" }));
    fireEvent.change(await screen.findByLabelText(/Відповідь для філії/), { target: { value: "Виїде о 8:40" } });
    fireEvent.click(screen.getByRole("button", { name: "Застосувати" }));
    await waitFor(() => expect(setStatus).toHaveBeenCalledWith(1, "accepted", "Виїде о 8:40"));
  });

  it("requires a reason to reject", async () => {
    vi.spyOn(transportApi, "orders").mockResolvedValue([order({ can_edit: false, next_statuses: ["accepted", "rejected"] })]);
    const setStatus = vi.spyOn(transportApi, "setStatus").mockResolvedValue(order({ status: "rejected" }));
    renderPage(dispatcher);
    fireEvent.click(await screen.findByRole("button", { name: "Відхилити" }));
    fireEvent.click(await screen.findByRole("button", { name: "Застосувати" }));
    expect(setStatus).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText(/Причина/), { target: { value: "Немає вільних авто" } });
    fireEvent.click(screen.getByRole("button", { name: "Застосувати" }));
    await waitFor(() => expect(setStatus).toHaveBeenCalledWith(1, "rejected", "Немає вільних авто"));
  });
});
