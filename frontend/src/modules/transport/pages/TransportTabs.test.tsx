import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import TransportPage from "./TransportPage";
import { transportApi } from "@/modules/transport/api";
import { ApiError } from "@/platform/api/client";
import { AuthProvider } from "@/platform/auth/AuthContext";
import type { SessionDTO, TransportOrderDTO } from "@/platform/api/types";
import { todayIso } from "@/platform/i18n";
import type { Car, ProductRequest, Run } from "@/modules/transport/types";

const desk: SessionDTO = { user_id: 1, login: "desk", full_name: "Оксана", organisation: { id: 3, name: "Філія А" }, roles: [], permissions: ["transport.orders.create"], modules: ["transport"], period: "2026-11" };
const boss: SessionDTO = { ...desk, user_id: 2, organisation: null, permissions: ["transport.orders.manage"] };
const viewer: SessionDTO = { ...boss, permissions: ["transport.orders.view_all"] };

const car = (id: number, display: string): Car => ({ id, plate: display.replace(/ /g, ""), display, nonstandard: false, label: "", active: true });
const cars = [car(1, "АА 1111 АА"), car(2, "КК 7777 КК")];
const today = todayIso();

const request = (over: Partial<ProductRequest> = {}): ProductRequest => ({
  id: 5, organisation_id: 3, organisation_name: "Філія А", need_date: today, deceased: "", notes: "", status: "submitted", reply_note: "", submitted_by_name: "Оксана",
  created_at: "", updated_at: "", car: null, total_cents: 0,
  items: [{ id: 50, product_id: 7, product_name: "Труна Бейка спец 3 метра", quantity: 2, unit_price_cents: null, total_cents: 0, loaded: 0, remaining: 2, carriers: [] }], ...over,
});
const order = (over: Partial<TransportOrderDTO> = {}): TransportOrderDTO => ({
  id: 1, organisation: { id: 3, name: "Філія А" }, service_date: today, deceased: "Іваненко І. І.", notes: "", same_car: false, military: false, status: "submitted", reply_note: "",
  delivery: { car_number: "", car_id: null, departure: "Дім", time: "09:30", destination: "Морг", stops: [] }, carriers: null, sort_time: "09:30", submitted_by: "Оксана",
  created_at: "", updated_at: "", can_edit: false, next_statuses: ["accepted"], events: [], ...over,
});
const run = (over: Partial<Run> = {}): Run => ({
  id: 9, kind: "goods", service_date: today, car: cars[0], time: "10:00", departure: "Склад", notes: "", status: "planned", created_by_name: "", created_at: "", updated_at: "",
  stops: [{ id: 1, position: 1, organisation_id: 3, organisation_name: "Філія А", place: "Філія А" }], manifest: [], ...over,
});

function renderPage(session: SessionDTO, url = "/") {
  vi.stubGlobal("fetch", vi.fn(() => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(session) })));
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <AuthProvider>
        <MemoryRouter initialEntries={[url]}>
          <TransportPage />
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>,
  );
}

const tabNames = () => screen.getAllByRole("tab").map((t) => t.textContent);

describe("transport tabs", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(transportApi, "days").mockResolvedValue([]);
    vi.spyOn(transportApi, "orders").mockResolvedValue([]);
    vi.spyOn(transportApi, "cars").mockResolvedValue({ items: cars });
    vi.spyOn(transportApi, "requests").mockResolvedValue([]);
    vi.spyOn(transportApi, "board").mockResolvedValue({ orders: [], runs: [], open_requests: [], cars });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("offers tabs by permission and falls back from a forbidden ?tab=", async () => {
    const { unmount } = renderPage(desk, "/?tab=fleet");
    await screen.findByRole("tablist");
    expect(tabNames()).toEqual(["Замовлення", "Продукція"]);
    expect(screen.getByRole("tab", { name: "Замовлення" }).getAttribute("aria-selected")).toBe("true");
    unmount();
    renderPage(viewer);
    await screen.findByRole("tablist");
    expect(tabNames()).toEqual(["Замовлення", "Продукція", "Рейси"]);
    cleanupTabs();
    renderPage(boss, "/?tab=fleet");
    expect((await screen.findByRole("tab", { name: "Автопарк" })).getAttribute("aria-selected")).toBe("true");
  });

  it("a dispatcher adds a car with a normalised plate", async () => {
    const addCar = vi.spyOn(transportApi, "addCar").mockResolvedValue(car(3, "ВС 5555 ВС"));
    renderPage(boss, "/?tab=fleet");
    const plate = await screen.findByLabelText("Номер авто");
    fireEvent.change(plate, { target: { value: "bc5555bc" } }); // Latin letters
    expect((plate as HTMLInputElement).value).toBe("ВС 5555 ВС");
    fireEvent.click(screen.getByRole("button", { name: "Додати авто" }));
    await waitFor(() => expect(addCar).toHaveBeenCalledWith({ plate: "ВС5555ВС", nonstandard: false, label: "" }));
  });

  it("refuses a plate that is not standard until marked nonstandard", async () => {
    const addCar = vi.spyOn(transportApi, "addCar").mockResolvedValue(car(3, "12345"));
    renderPage(boss, "/?tab=fleet");
    fireEvent.change(await screen.findByLabelText("Номер авто"), { target: { value: "12345" } });
    fireEvent.click(screen.getByRole("button", { name: "Додати авто" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/АА 1234 ВВ/);
    expect(addCar).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("checkbox", { name: /Нестандартний номер/ }));
    fireEvent.click(screen.getByRole("button", { name: "Додати авто" }));
    await waitFor(() => expect(addCar).toHaveBeenCalledWith({ plate: "12345", nonstandard: true, label: "" }));
  });

  it("a desk makes a request: finds the product by any word, shows the price, car optional", async () => {
    vi.spyOn(transportApi, "catalog").mockResolvedValue({ items: [{ id: 7, name: "Труна Бейка спец 3 метра", price_cents: 250000 }, { id: 8, name: "Вінок", price_cents: null }] });
    const create = vi.spyOn(transportApi, "createRequest").mockResolvedValue(request());
    renderPage(desk, "/?tab=products");
    fireEvent.click(await screen.findByRole("button", { name: "Нова заявка" }));
    fireEvent.click(await screen.findByRole("button", { name: "Надіслати" }));
    expect((await screen.findByRole("status")).textContent).toMatch(/хоча б один товар/);
    const box = screen.getByRole("combobox", { name: "Товар" });
    fireEvent.change(box, { target: { value: "3м" } });
    const option = within(screen.getByRole("listbox", { name: "Товар" })).getByRole("option");
    expect(option.textContent).toContain("Труна Бейка спец 3 метра");
    expect(option.textContent).toMatch(/2\s?500,00/);
    fireEvent.click(option);
    fireEvent.click(screen.getByRole("button", { name: /Збільшити кількість/ }));
    expect(screen.getAllByText(/5\s?000,00/).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "Надіслати" }));
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    expect(create.mock.calls[0][0]).toMatchObject({ car_id: null, items: [{ product_id: 7, quantity: 2 }] });
  });

  it("an item without a price says so", async () => {
    vi.spyOn(transportApi, "catalog").mockResolvedValue({ items: [{ id: 8, name: "Вінок", price_cents: null }] });
    renderPage(desk, "/?tab=products");
    fireEvent.click(await screen.findByRole("button", { name: "Нова заявка" }));
    fireEvent.focus(await screen.findByRole("combobox", { name: "Товар" }));
    expect(within(within(screen.getByRole("listbox", { name: "Товар" })).getByRole("option")).getByText("ціну не задано")).toBeDefined();
  });

  it("shows where each item is loaded and the derived status", async () => {
    vi.spyOn(transportApi, "requests").mockResolvedValue([
      request({
        status: "partial", car: cars[1], total_cents: 500000,
        items: [{ id: 50, product_id: 7, product_name: "Труна", quantity: 2, unit_price_cents: 250000, total_cents: 500000, loaded: 1, remaining: 1, carriers: [{ kind: "run", id: 9, car_display: "АА 1111 АА", time: "10:00", status: "planned", quantity: 1 }] }],
      }),
    ]);
    renderPage(desk, "/?tab=products");
    const card = await screen.findByRole("article");
    expect(within(card).getByText("Частково завантажено")).toBeDefined();
    expect(within(card).getByText(/1 шт\. · рейс · АА 1111 АА · 10:00/)).toBeDefined();
    expect(within(card).getByText("1 із 2")).toBeDefined();
    expect(within(card).getByText("КК 7777 КК")).toBeDefined(); // preferred car
    expect(within(card).queryByRole("button", { name: /Додати до рейсу/ })).toBeNull();
  });

  it("the board gives each car a lane with orders and runs in time order, and flags work without a car", async () => {
    vi.spyOn(transportApi, "board").mockResolvedValue({
      orders: [order({ id: 1, deceased: "Без авто" }), order({ id: 2, deceased: "З авто", delivery: { car_number: "АА 1111 АА", car_id: 1, departure: "Дім", time: "12:00", destination: "Морг", stops: [] } })],
      runs: [run({ manifest: [{ organisation_id: 3, organisation_name: "Філія А", place: "Філія А", lines: [{ id: 1, item_id: 50, request_id: 5, organisation_id: 3, organisation_name: "Філія А", product_name: "Труна", quantity: 1 }] }] })],
      open_requests: [], cars,
    });
    renderPage(boss, "/?tab=board");
    const lane = await screen.findByRole("region", { name: "АА 1111 АА" });
    const rows = within(lane).getAllByRole("listitem").filter((li) => li.getAttribute("aria-label"));
    expect(rows[0].getAttribute("aria-label")).toContain("Рейс");
    expect(rows[1].getAttribute("aria-label")).toContain("З авто");
    expect(within(lane).getByText("Труна")).toBeDefined(); // the manifest
    expect(screen.getByRole("region", { name: "Авто не призначено" })).toBeDefined();
    expect(screen.getByText(/Вільні авто/)).toBeDefined();
  });

  it("adds items to a car already going to the desk, sending the old lines along", async () => {
    const open = request();
    const existing = { id: 1, item_id: 50, request_id: 5, organisation_id: 3, organisation_name: "Філія А", product_name: "Труна", quantity: 1 };
    vi.spyOn(transportApi, "board").mockResolvedValue({
      orders: [order({ id: 1, status: "accepted", cargo: [{ organisation_id: 3, organisation_name: "Філія А", place: "Філія А", lines: [existing, { ...existing, id: 2, item_id: 51, product_name: "Вінок" }] }] })],
      runs: [], open_requests: [open], cars,
    });
    const setCargo = vi.spyOn(transportApi, "setCargo").mockResolvedValue(order());
    renderPage(boss, "/?tab=board");
    fireEvent.click(await screen.findByRole("button", { name: "Додати до рейсу" }));
    const dialog = await screen.findByRole("dialog");
    await within(dialog).findByText(/Замовлення · /);
    fireEvent.change(within(dialog).getByRole("textbox", { name: /Кількість/ }), { target: { value: "2" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Завантажити" }));
    await waitFor(() => expect(setCargo).toHaveBeenCalledWith(1, [{ item_id: 50, quantity: 3 }, { item_id: 51, quantity: 1 }]));
  });

  it("a quantity cannot exceed what is left", async () => {
    vi.spyOn(transportApi, "board").mockResolvedValue({ orders: [order({ status: "accepted" })], runs: [], open_requests: [request()], cars });
    renderPage(boss, "/?tab=board");
    fireEvent.click(await screen.findByRole("button", { name: "Додати до рейсу" }));
    const box = (await screen.findByRole("textbox", { name: /Кількість/ })) as HTMLInputElement;
    fireEvent.change(box, { target: { value: "9" } });
    fireEvent.blur(box);
    expect(box.value).toBe("2");
  });

  it("offers a new run when no car goes to the desk, and creates it with the desk's items", async () => {
    vi.spyOn(transportApi, "board").mockResolvedValue({ orders: [], runs: [], open_requests: [request({ car: cars[1] })], cars });
    const createRun = vi.spyOn(transportApi, "createRun").mockResolvedValue(run());
    renderPage(boss, "/?tab=board");
    fireEvent.click(await screen.findByRole("button", { name: "Додати до рейсу" }));
    fireEvent.click(await screen.findByRole("button", { name: "Створити рейс" }));
    const dialog = await screen.findByRole("dialog", { name: "Новий рейс" });
    // The desk's preferred car is preselected.
    expect((within(dialog).getByRole("combobox", { name: /Автомобіль/ }) as HTMLInputElement).value).toBe("КК 7777 КК");
    fireEvent.click(within(dialog).getByRole("button", { name: "Зберегти" }));
    expect((await within(dialog).findByRole("status")).textContent).toMatch(/ГГ:ХХ/);
    fireEvent.change(within(dialog).getByLabelText("Час"), { target: { value: "1030" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Зберегти" }));
    await waitFor(() => expect(createRun).toHaveBeenCalledTimes(1));
    expect(createRun.mock.calls[0][0]).toMatchObject({
      car_id: 2, time: "10:30", departure: "Склад",
      stops: [{ organisation_id: 3, place: "Філія А", lines: [{ item_id: 50, quantity: 2 }] }],
    });
  });

  it("says a car is needed when the server refuses to accept an order without one, and opens the assignment", async () => {
    vi.spyOn(transportApi, "orders").mockResolvedValue([order()]);
    vi.spyOn(transportApi, "setStatus").mockRejectedValue(new ApiError("Потрібне авто", 409, { detail: "Потрібне авто", code: "car_required" }));
    const assign = vi.spyOn(transportApi, "assign").mockResolvedValue(order());
    renderPage(boss);
    fireEvent.click(await screen.findByRole("button", { name: "Прийняти" }));
    fireEvent.click(await screen.findByRole("button", { name: "Застосувати" }));
    expect((await screen.findByRole("status")).textContent).toMatch(/немає авто/);
    fireEvent.click(screen.getByRole("button", { name: "Призначити авто" }));
    const dialog = await screen.findByRole("dialog", { name: /Авто, час і зупинки/ });
    fireEvent.click(within(dialog).getByRole("button", { name: "Зберегти" }));
    expect((await within(dialog).findByRole("status")).textContent).toMatch(/Оберіть авто/);
    fireEvent.focus(within(dialog).getByRole("combobox"));
    fireEvent.click(screen.getAllByRole("option").find((o) => o.textContent?.includes("КК 7777 КК"))!);
    fireEvent.click(within(dialog).getByRole("button", { name: "Зберегти" }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith(1, { delivery: { car_id: 2, time: "09:30", stops: [] } }));
  });

  it("shows a busy-car refusal as the server worded it", async () => {
    vi.spyOn(transportApi, "orders").mockResolvedValue([order()]);
    vi.spyOn(transportApi, "setStatus").mockRejectedValue(new ApiError("Авто АА 1111 АА уже зайняте: 09:00–11:00.", 409, { detail: "Авто АА 1111 АА уже зайняте: 09:00–11:00." }));
    renderPage(boss);
    fireEvent.click(await screen.findByRole("button", { name: "Прийняти" }));
    fireEvent.click(await screen.findByRole("button", { name: "Застосувати" }));
    expect((await screen.findByRole("status")).textContent).toMatch(/уже зайняте: 09:00/);
  });
});

function cleanupTabs() {
  document.body.innerHTML = "";
}
