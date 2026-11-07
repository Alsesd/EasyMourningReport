import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import TransportPage from "./TransportPage";
import { transportApi } from "@/modules/transport/api";
import { AuthProvider } from "@/platform/auth/AuthContext";
import type { SessionDTO, TransportOrderDTO } from "@/platform/api/types";
import { shiftDay, todayIso } from "@/platform/i18n";
import type { Car } from "@/modules/transport/types";

const car = (id: number, display: string, over: Partial<Car> = {}): Car => ({ id, plate: display.replace(/ /g, ""), display, nonstandard: false, label: "", active: true, ...over });
const fleet = [car(1, "АА 1111 АА", { label: "Мерседес" }), car(2, "КК 7777 КК"), car(3, "ВС 5555 ВС")];

/** Choose a car in a fleet combobox by its plate. */
function pickCar(label: string | RegExp, plate: string, index = 0) {
  const box = screen.getAllByRole("combobox", { name: label })[index];
  fireEvent.focus(box);
  fireEvent.click(screen.getAllByRole("option").find((o) => o.textContent?.includes(plate))!);
}

/** The delivery part every desk fills: time, departure, destination. */
function fillDelivery(deceased = "Петренко П. П.") {
  fireEvent.change(screen.getByLabelText("Прізвище та ініціали померлого"), { target: { value: deceased } });
  fireEvent.change(screen.getByLabelText("Звідки забирає"), { target: { value: "вул. Квітуча, 5" } });
  fireEvent.change(screen.getByLabelText("Час доставки"), { target: { value: "0930" } });
  fireEvent.change(screen.getByLabelText("Кінцевий пункт"), { target: { value: "Кладовище №2" } });
}

const base: SessionDTO = {
  user_id: 1, login: "desk", full_name: "Оксана", organisation: { id: 3, name: "Філія А" },
  roles: ["Стіл"], permissions: ["transport.orders.create"], modules: ["transport"], period: "2026-11",
};
const dispatcher: SessionDTO = { ...base, user_id: 2, login: "boss", organisation: null, permissions: ["transport.orders.manage"] };

const order = (over: Partial<TransportOrderDTO>): TransportOrderDTO => ({
  id: 1, organisation: { id: 3, name: "Філія А" }, service_date: todayIso(), deceased: "Іваненко І. І.", notes: "", same_car: false, military: false,
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
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(transportApi, "days").mockResolvedValue([]);
    vi.spyOn(transportApi, "cars").mockResolvedValue({ items: fleet });
  });
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
    expect(within(early).getByText(/Церква/)).toBeDefined();
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
    await screen.findByLabelText("Прізвище та ініціали померлого");
    fireEvent.click(screen.getByRole("button", { name: "Надіслати" }));
    expect((await screen.findByRole("status")).textContent).toMatch(/Прізвище та ініціали померлого/);
    expect(create).not.toHaveBeenCalled();

    fillDelivery();
    fireEvent.click(screen.getByRole("button", { name: "Надіслати" }));
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    // The car is optional for a desk: the dispatcher assigns it.
    expect(create.mock.calls[0][0]).toMatchObject({
      deceased: "Петренко П. П.",
      carriers: null,
      delivery: { car_id: null, car_number: "", departure: "вул. Квітуча, 5", time: "09:30", destination: "Кладовище №2" },
    });
  });

  it("asks for the car once and sends it from the fleet", async () => {
    vi.spyOn(transportApi, "orders").mockResolvedValue([]);
    const create = vi.spyOn(transportApi, "create").mockResolvedValue(order({}));
    renderPage(base);
    fireEvent.click(await screen.findByRole("button", { name: /Нове замовлення/ }));
    await screen.findByLabelText("Прізвище та ініціали померлого");
    fireEvent.click(screen.getAllByRole("switch", { name: "Винос" })[0]);
    // One car field, whatever parts are on; no car-number text boxes at all.
    expect(screen.getAllByRole("combobox", { name: /Автомобіль/ })).toHaveLength(1);
    expect(screen.queryByLabelText(/Номер авто/)).toBeNull();
    pickCar("Автомобіль", "АА 1111 АА");
    fillDelivery();
    fireEvent.change(screen.getByLabelText("Час виносу"), { target: { value: "1130" } });
    fireEvent.change(screen.getByLabelText("Кладовище №"), { target: { value: "3" } });
    fireEvent.change(screen.getByLabelText("Зупинка 1"), { target: { value: "Дім жалоби" } });
    fireEvent.click(screen.getByRole("button", { name: "Надіслати" }));
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    // The same car carries from where the delivery ended; the desk typed neither again.
    expect(create.mock.calls[0][0]).toMatchObject({
      delivery: { car_id: 1, car_number: "АА 1111 АА", departure: "вул. Квітуча, 5", destination: "Кладовище №2" },
      carriers: { car_id: 1, car_number: "АА 1111 АА", departure: "Кладовище №2", time: "11:30", cemetery_number: "3", stops: ["Дім жалоби"] },
    });
  });

  it("shows the carriers' own car and departure only when it is not the same car", async () => {
    vi.spyOn(transportApi, "orders").mockResolvedValue([]);
    const create = vi.spyOn(transportApi, "create").mockResolvedValue(order({}));
    renderPage(base);
    fireEvent.click(await screen.findByRole("button", { name: /Нове замовлення/ }));
    await screen.findByLabelText("Прізвище та ініціали померлого");
    fireEvent.click(screen.getAllByRole("switch", { name: "Винос" })[0]);
    expect((screen.getByRole("switch", { name: "Той самий автомобіль" }) as HTMLInputElement).checked).toBe(true);
    expect(screen.queryByRole("combobox", { name: "Автомобіль для виносу" })).toBeNull();
    expect(screen.queryByLabelText("Звідки забирає винос")).toBeNull();
    fireEvent.click(screen.getByRole("switch", { name: "Той самий автомобіль" }));
    pickCar("Автомобіль", "АА 1111 АА");
    pickCar("Автомобіль для виносу", "КК 7777 КК");
    fillDelivery();
    fireEvent.change(screen.getByLabelText("Звідки забирає винос"), { target: { value: "Морг" } });
    fireEvent.change(screen.getByLabelText("Час виносу"), { target: { value: "1130" } });
    fireEvent.change(screen.getByLabelText("Кладовище №"), { target: { value: "3" } });
    fireEvent.change(screen.getByLabelText("Зупинка 1"), { target: { value: "Дім жалоби" } });
    fireEvent.click(screen.getByRole("button", { name: "Надіслати" }));
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    expect(create.mock.calls[0][0]).toMatchObject({
      delivery: { car_id: 1 },
      carriers: { car_id: 2, car_number: "КК 7777 КК", departure: "Морг" },
    });
  });

  it("marks an order as military and shows the server's busy-car message", async () => {
    vi.spyOn(transportApi, "orders").mockResolvedValue([]);
    const create = vi
      .spyOn(transportApi, "create")
      .mockRejectedValueOnce(new Error("Авто ВС 5555 ВС уже зайняте: 09:30–11:30. Оберіть інший час або авто."))
      .mockResolvedValueOnce(order({ military: true }));
    renderPage(base);
    fireEvent.click(await screen.findByRole("button", { name: /Нове замовлення/ }));
    await screen.findByLabelText("Прізвище та ініціали померлого");
    pickCar("Автомобіль", "ВС 5555 ВС");
    fillDelivery();
    fireEvent.click(screen.getByRole("button", { name: "Надіслати" }));
    expect((await screen.findByRole("status")).textContent).toMatch(/уже зайняте/);
    expect(create.mock.calls[0][0].military).toBe(false);

    fireEvent.click(screen.getByRole("switch", { name: "Військове замовлення" }));
    fireEvent.click(screen.getByRole("button", { name: "Надіслати" }));
    await waitFor(() => expect(create).toHaveBeenCalledTimes(2));
    expect(create.mock.calls[1][0].military).toBe(true);
  });

  it("shows a military badge and lets the desk edit an order whose car was taken", async () => {
    vi.spyOn(transportApi, "orders").mockResolvedValue([
      order({ id: 1, deceased: "Військовий", military: true, can_edit: false }),
      order({ id: 2, deceased: "Знятий", status: "bumped", reply_note: "Авто знято під військове замовлення.", can_edit: true }),
    ]);
    renderPage(base);
    const mil = await screen.findByRole("article", { name: /Військовий/ });
    expect(within(mil).getByText("Військове")).toBeDefined();
    const bumped = await screen.findByRole("article", { name: /Знятий/ });
    expect(within(bumped).getByText("Авто знято")).toBeDefined();
    expect(within(bumped).getByText(/Авто знято під військове/)).toBeDefined();
    expect(within(bumped).getByRole("button", { name: /Змінити|Редагувати/ })).toBeDefined();
  });

  it("a dispatcher replies with a status and a note", async () => {
    vi.spyOn(transportApi, "orders").mockResolvedValue([order({ can_edit: false, next_statuses: ["accepted", "rejected"] })]);
    const setStatus = vi.spyOn(transportApi, "setStatus").mockResolvedValue(order({ status: "accepted" }));
    renderPage(dispatcher);
    const card = await screen.findByRole("article", { name: /Іваненко/ });
    expect(within(card).getByText(/Філія А/)).toBeDefined();
    expect(within(card).queryByRole("button", { name: /Скасувати замовлення/ })).toBeNull();
    fireEvent.click(within(card).getByRole("button", { name: "Прийняти" }));
    fireEvent.change(await screen.findByLabelText(/Відповідь підрозділу/), { target: { value: "Виїде о 8:40" } });
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
    const toggle = (await screen.findAllByRole("switch", { name: "Винос" }))[0];
    fireEvent.click(toggle);
    const select = (await screen.findByLabelText("Бригада виносу")) as HTMLSelectElement;
    expect([...select.options].map((o) => o.value)).toEqual(["4", "6"]);
  });

  it("requires a stop and the cemetery for the bearers, so the route is in the order", async () => {
    vi.spyOn(transportApi, "orders").mockResolvedValue([]);
    const create = vi.spyOn(transportApi, "create").mockResolvedValue(order({}));
    renderPage(base);
    fireEvent.click(await screen.findByRole("button", { name: /Нове замовлення/ }));
    fireEvent.change(await screen.findByLabelText("Прізвище та ініціали померлого"), { target: { value: "Петренко П. П." } });
    fireEvent.click(screen.getAllByRole("switch", { name: "Доставка" })[0]); // delivery off
    fireEvent.click(screen.getAllByRole("switch", { name: "Винос" })[0]); // bearers on
    pickCar("Автомобіль", "ВС 5555 ВС");
    fireEvent.change(screen.getByLabelText("Звідки забирає винос"), { target: { value: "Морг" } });
    fireEvent.change(screen.getByLabelText("Час виносу"), { target: { value: "1130" } });
    fireEvent.change(screen.getByLabelText("Кладовище №"), { target: { value: "3" } });
    fireEvent.click(screen.getByRole("button", { name: "Надіслати" }));
    expect((await screen.findByRole("status")).textContent).toMatch(/хоча б одну зупинку/);
    expect(create).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Зупинка 1"), { target: { value: "Дім жалоби" } });
    fireEvent.click(screen.getByRole("button", { name: "Надіслати" }));
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    expect(create.mock.calls[0][0]).toMatchObject({ delivery: null, carriers: { car_id: 3, car_number: "ВС 5555 ВС", departure: "Морг", count: 6, time: "11:30", cemetery_number: "3", stops: ["Дім жалоби"] } });
  });

  it("shows the car once on a card and flags an order that has none", async () => {
    vi.spyOn(transportApi, "orders").mockResolvedValue([
      order({
        id: 1,
        deceased: "Одне авто",
        same_car: true,
        delivery: { car_number: "АА 1111 АА", departure: "Дім", time: "09:00", destination: "Морг", stops: [] },
        carriers: { car_number: "АА 1111 АА", departure: "Морг", count: 4, time: "11:00", cemetery_number: "3", stops: ["Церква"], bearers: [] },
        sort_time: "09:00",
      }),
      order({ id: 2, deceased: "Без авто", delivery: { car_number: "", departure: "Дім", time: "12:00", destination: "Морг", stops: [] }, sort_time: "12:00" }),
    ]);
    renderPage(dispatcher);
    const one = await screen.findByRole("article", { name: /Одне авто/ });
    expect(within(one).getAllByText("АА 1111 АА")).toHaveLength(1);
    expect(within(one).getByText("Одне авто на доставку й винос")).toBeDefined();
    // The carrying leg continues from the delivery's end point: it is not repeated as another "from".
    expect(within(within(one).getByRole("region", { name: "Винос" })).queryByText(/Морг/)).toBeNull();
    const none = screen.getByRole("article", { name: /Без авто/ });
    expect(within(none).getByText("Авто не призначено")).toBeDefined();
  });

  it("marks today's orders urgent and keeps an order for next week in work", async () => {
    const today = todayIso();
    const week = shiftDay(today, 7);
    vi.spyOn(transportApi, "orders").mockResolvedValue([
      order({ id: 1, deceased: "Сьогоднішній" }),
      order({ id: 2, deceased: "Вже виконаний", status: "done", can_edit: false }),
    ]);
    vi.spyOn(transportApi, "days").mockResolvedValue([
      { date: today, total: 1, open: 1, attention: 0, military_open: 0, by_status: { submitted: 1 } },
      { date: week, total: 1, open: 1, attention: 0, military_open: 0, by_status: { accepted: 1 } },
    ]);
    renderPage(base);
    const card = await screen.findByRole("article", { name: /Сьогоднішній/ });
    expect(within(card).getByText("Терміново · сьогодні")).toBeDefined();
    // A closed order of today names its day without urgency.
    const done = screen.getByRole("article", { name: /Вже виконаний/ });
    expect(within(done).queryByText(/Терміново/)).toBeNull();
    expect(within(done).getByText("Сьогодні")).toBeDefined();
    // The order a week ahead is listed under "ahead" and opens its day.
    const ahead = await screen.findByRole("button", { name: /через 7 днів/ });
    fireEvent.click(ahead);
    await waitFor(() => expect(transportApi.orders).toHaveBeenLastCalledWith({ date: week }));
  });

  it("warns about orders of past days that were never closed and jumps there", async () => {
    const today = todayIso();
    const old = shiftDay(today, -3);
    vi.spyOn(transportApi, "orders").mockResolvedValue([]);
    vi.spyOn(transportApi, "days").mockResolvedValue([{ date: old, total: 2, open: 2, attention: 1, military_open: 0, by_status: { submitted: 1, accepted: 1 } }]);
    renderPage(dispatcher);
    expect((await screen.findByText(/Незакриті заявки за минулі дні: 2/)).textContent).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Показати/ }));
    await waitFor(() => expect(transportApi.orders).toHaveBeenLastCalledWith({ date: old }));
  });

  it("shows on the day strip how many orders are in work and which wait for an answer", async () => {
    const today = todayIso();
    const tomorrow = shiftDay(today, 1);
    vi.spyOn(transportApi, "orders").mockResolvedValue([]);
    vi.spyOn(transportApi, "days").mockResolvedValue([{ date: tomorrow, total: 3, open: 2, attention: 1, military_open: 1, by_status: { submitted: 1, accepted: 1, done: 1 } }]);
    renderPage(dispatcher);
    const strip = await screen.findByRole("list", { name: "Дні із заявками" });
    const cell = await within(strip).findByRole("button", { name: /у роботі 2 із 3, чекають відповіді 1, військових 1/ });
    fireEvent.click(cell);
    await waitFor(() => expect(transportApi.orders).toHaveBeenLastCalledWith({ date: tomorrow }));
    expect(cell.getAttribute("aria-pressed")).toBe("true");
  });

  it("opens the day of an order saved for another day, so it does not vanish", async () => {
    const after = shiftDay(todayIso(), 2);
    vi.spyOn(transportApi, "orders").mockResolvedValue([]);
    vi.spyOn(transportApi, "create").mockResolvedValue(order({ service_date: after }));
    renderPage(base);
    fireEvent.click(await screen.findByRole("button", { name: /Нове замовлення/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Післязавтра" }));
    fillDelivery();
    fireEvent.click(screen.getByRole("button", { name: "Надіслати" }));
    await waitFor(() => expect(transportApi.create).toHaveBeenCalledWith(expect.objectContaining({ service_date: after })));
    expect(await screen.findByText(/Замовлення надіслано на/)).toBeDefined();
    await waitFor(() => expect(transportApi.orders).toHaveBeenLastCalledWith({ date: after }));
  });

  it("shows the overdue banner to the dispatcher only, not to a desk", async () => {
    const old = shiftDay(todayIso(), -3);
    const week = shiftDay(todayIso(), 7);
    vi.spyOn(transportApi, "orders").mockResolvedValue([]);
    // One query feeds both the banner and «Попереду в роботі»: once the chip is there, the banner would be too.
    vi.spyOn(transportApi, "days").mockResolvedValue([
      { date: old, total: 2, open: 2, attention: 0, military_open: 0, by_status: { accepted: 2 } },
      { date: week, total: 1, open: 1, attention: 0, military_open: 0, by_status: { accepted: 1 } },
    ]);
    renderPage(base);
    await screen.findByRole("button", { name: /через 7 днів/ });
    expect(screen.queryByText(/Незакриті заявки/)).toBeNull();
  });

  it("marks a military order apart from urgent and filters military orders", async () => {
    vi.spyOn(transportApi, "orders").mockResolvedValue([
      order({ id: 1, deceased: "Військовий", military: true }),
      order({ id: 2, deceased: "Звичайний" }),
    ]);
    renderPage(dispatcher);
    const mil = await screen.findByRole("article", { name: /Військовий/ });
    expect(within(mil).getByText("Військове")).toBeDefined();
    expect(within(mil).getByText("Терміново · сьогодні")).toBeDefined();
    expect(within(screen.getByRole("article", { name: /Звичайний/ })).queryByText("Військове")).toBeNull();
    fireEvent.change(screen.getByLabelText("Статус"), { target: { value: "military" } });
    await waitFor(() => expect(screen.queryByRole("article", { name: /Звичайний/ })).toBeNull());
    expect(screen.getByRole("article", { name: /Військовий/ })).toBeDefined();
  });
});
