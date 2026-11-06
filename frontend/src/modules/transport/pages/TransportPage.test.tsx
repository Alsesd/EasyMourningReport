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
  id: 1, organisation: { id: 3, name: "Філія А" }, service_date: todayIso(), deceased: "Іваненко І. І.", notes: "", same_car: false,
  status: "submitted", reply_note: "", delivery: { car_number: "АА 1111 АА", departure: "вул. Квітуча, 5", time: "09:30", destination: "Морг", stops: [] },
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
      order({ id: 1, deceased: "Ранній", sort_time: "08:30", carriers: { car_number: "АА 1111 АА", departure: "Морг", count: 6, time: "08:30", cemetery_number: "3", stops: ["Церква"] } }),
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
    fireEvent.change(screen.getByLabelText(/Номер авто/), { target: { value: "ВС 5555 ВС" } });
    fireEvent.change(screen.getByLabelText(/Звідки забирає/), { target: { value: "вул. Квітуча, 5" } });
    fireEvent.change(screen.getByLabelText("Час"), { target: { value: "0930" } });
    fireEvent.change(screen.getByLabelText("Кінцевий пункт"), { target: { value: "Кладовище №2" } });
    fireEvent.click(screen.getByRole("button", { name: "Надіслати" }));
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    const sent = create.mock.calls[0][0];
    expect(sent).toMatchObject({ deceased: "Петренко П. П.", carriers: null, delivery: { car_number: "ВС 5555 ВС", departure: "вул. Квітуча, 5", time: "09:30", destination: "Кладовище №2" } });
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

  it("asks in a Ukrainian dialog before cancelling and then cancels", async () => {
    vi.spyOn(transportApi, "orders").mockResolvedValue([order({})]);
    const cancel = vi.spyOn(transportApi, "cancel").mockResolvedValue(order({ status: "cancelled", can_edit: false }));
    const nativeConfirm = vi.fn(() => true);
    vi.stubGlobal("confirm", nativeConfirm);
    renderPage(base);
    const card = await screen.findByRole("article", { name: /Іваненко/ });
    fireEvent.click(within(card).getByRole("button", { name: /Скасувати замовлення/ }));
    const dialog = await screen.findByRole("dialog");
    expect(cancel).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "Скасувати замовлення" }));
    await waitFor(() => expect(cancel).toHaveBeenCalledWith(1));
    expect(nativeConfirm).not.toHaveBeenCalled();
  });

  it("a dispatcher names the bearers of the ordered crew", async () => {
    const carrying = order({
      can_edit: false,
      carriers: { car_number: "АА 1111 АА", departure: "Морг", count: 4, time: "12:00", cemetery_number: "3", stops: ["Церква"], bearers: [] },
    });
    vi.spyOn(transportApi, "orders").mockResolvedValue([carrying]);
    const setBearers = vi.spyOn(transportApi, "setBearers").mockResolvedValue(carrying);
    renderPage(dispatcher);
    const card = await screen.findByRole("article", { name: /Іваненко/ });
    expect(within(card).getByText("Носіїв ще не призначено")).toBeDefined();
    fireEvent.click(within(card).getByRole("button", { name: /Призначити носіїв/ }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getAllByRole("textbox")).toHaveLength(4); // one field per man of the crew
    fireEvent.change(within(dialog).getByLabelText("Носій 1"), { target: { value: "Петренко О." } });
    fireEvent.change(within(dialog).getByLabelText("Носій 2"), { target: { value: "Коваль І." } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Зберегти" }));
    await waitFor(() => expect(setBearers).toHaveBeenCalledWith(1, ["Петренко О.", "Коваль І."]));
  });

  it("a desk offers only crews of 4 or 6", async () => {
    vi.spyOn(transportApi, "orders").mockResolvedValue([]);
    renderPage(base);
    fireEvent.click(await screen.findByRole("button", { name: /Нове замовлення/ }));
    const toggle = screen.getAllByRole("switch", { name: "Винос" })[0];
    fireEvent.click(toggle);
    const select = (await screen.findByLabelText("Бригада виносу")) as HTMLSelectElement;
    expect([...select.options].map((o) => o.value)).toEqual(["4", "6"]);
  });

  it("requires a stop and the cemetery for the bearers, so the route is in the order", async () => {
    vi.spyOn(transportApi, "orders").mockResolvedValue([]);
    const create = vi.spyOn(transportApi, "create").mockResolvedValue(order({}));
    renderPage(base);
    fireEvent.click(await screen.findByRole("button", { name: /Нове замовлення/ }));
    fireEvent.change(screen.getByLabelText("Прізвище та ініціали померлого"), { target: { value: "Петренко П. П." } });
    fireEvent.click(screen.getAllByRole("switch", { name: "Доставка" })[0]); // delivery off
    fireEvent.click(screen.getAllByRole("switch", { name: "Винос" })[0]); // bearers on
    fireEvent.change(await screen.findByLabelText(/Номер авто/), { target: { value: "ВС 5555 ВС" } });
    fireEvent.change(screen.getByLabelText(/Звідки забирає/), { target: { value: "Морг" } });
    fireEvent.change(screen.getByLabelText("Час"), { target: { value: "1130" } });
    fireEvent.change(screen.getByLabelText("Номер кладовища"), { target: { value: "3" } });
    fireEvent.click(screen.getByRole("button", { name: "Надіслати" }));
    expect((await screen.findByRole("status")).textContent).toMatch(/хоча б одну зупинку/);
    expect(create).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Зупинка 1"), { target: { value: "Дім жалоби" } });
    fireEvent.click(screen.getByRole("button", { name: "Надіслати" }));
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    expect(create.mock.calls[0][0]).toMatchObject({ delivery: null, carriers: { car_number: "ВС 5555 ВС", departure: "Морг", count: 6, time: "11:30", cemetery_number: "3", stops: ["Дім жалоби"] } });
  });

  it("starts the carrying car and place as the delivery's, and lets another car carry", async () => {
    vi.spyOn(transportApi, "orders").mockResolvedValue([]);
    const create = vi.spyOn(transportApi, "create").mockResolvedValue(order({}));
    renderPage(base);
    fireEvent.click(await screen.findByRole("button", { name: /Нове замовлення/ }));
    fireEvent.change(screen.getByLabelText("Прізвище та ініціали померлого"), { target: { value: "Петренко П. П." } });
    fireEvent.click(screen.getAllByRole("switch", { name: "Винос" })[0]);
    const cars = () => screen.getAllByLabelText(/Номер авто/) as HTMLInputElement[];
    fireEvent.change(cars()[0], { target: { value: "АА 1111 АА" } });
    expect(cars()[1].value).toBe("АА 1111 АА"); // mirrored while not edited apart
    fireEvent.change(cars()[1], { target: { value: "КК 7777 КК" } }); // another car carries
    fireEvent.change(cars()[0], { target: { value: "АА 2222 АА" } });
    expect(cars()[1].value).toBe("КК 7777 КК"); // no longer follows
    fireEvent.change(screen.getAllByLabelText(/Звідки забирає/)[0], { target: { value: "Морг" } });
    fireEvent.change(screen.getByLabelText("Кінцевий пункт"), { target: { value: "Кладовище" } });
    fireEvent.change(screen.getAllByLabelText("Час")[0], { target: { value: "1000" } });
    fireEvent.change(screen.getAllByLabelText("Час")[1], { target: { value: "1130" } });
    fireEvent.change(screen.getByLabelText("Номер кладовища"), { target: { value: "3" } });
    fireEvent.change(screen.getByLabelText("Зупинка 1"), { target: { value: "Дім жалоби" } });
    fireEvent.click(screen.getByRole("button", { name: "Надіслати" }));
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    expect(create.mock.calls[0][0]).toMatchObject({
      delivery: { car_number: "АА 2222 АА", departure: "Морг" },
      carriers: { car_number: "КК 7777 КК", departure: "Морг" },
    });
  });
});
