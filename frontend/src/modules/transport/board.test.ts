import { describe, it, expect } from "vitest";
import { buildLanes } from "./board";
import type { TransportOrderDTO } from "@/platform/api/types";
import type { Car, Run } from "./types";

const car = (id: number, display: string): Car => ({ id, plate: display.replace(/ /g, ""), display, nonstandard: false, label: "", active: true });
const cars = [car(1, "АА 1111 АА"), car(2, "КК 7777 КК")];
const order = (id: number, over: Partial<TransportOrderDTO>): TransportOrderDTO => ({
  id, organisation: { id: 3, name: "Філія А" }, service_date: "2026-11-09", deceased: `П${id}`, notes: "", same_car: false, military: false, status: "accepted", reply_note: "",
  delivery: null, carriers: null, sort_time: "09:00", submitted_by: "", created_at: "", updated_at: "", can_edit: false, next_statuses: [], events: [], ...over,
});
const delivery = (time: string, car_id: number | null, car_number = "") => ({ car_number, car_id, departure: "а", time, destination: "б", stops: [] });
const carry = (time: string, car_id: number | null, car_number = "") => ({ car_number, car_id, departure: "б", count: 4 as const, time, cemetery_number: "1", stops: ["в"] });
const run = (id: number, time: string, c: Car, status: Run["status"] = "planned"): Run => ({
  id, kind: "goods", service_date: "2026-11-09", car: c, time, departure: "Склад", notes: "", status, created_by_name: "", created_at: "", updated_at: "", stops: [], manifest: [],
});

describe("board lanes", () => {
  it("groups orders and runs per car in time order, unassigned work first", () => {
    const lanes = buildLanes(
      [order(1, { delivery: delivery("11:00", 1) }), order(2, { delivery: delivery("08:00", null) }), order(3, { delivery: delivery("07:00", 2) })],
      [run(9, "09:30", cars[0])],
      cars,
    );
    expect(lanes.map((l) => l.display)).toEqual(["", "АА 1111 АА", "КК 7777 КК"]);
    expect(lanes[1].entries.map((e) => e.time)).toEqual(["09:30", "11:00"]);
    expect(lanes[1].entries.map((e) => e.kind)).toEqual(["run", "order"]);
  });

  it("puts an order whose parts use one car once, and two cars in both lanes", () => {
    const lanes = buildLanes(
      [order(1, { delivery: delivery("09:00", 1), carriers: carry("11:00", 1) }), order(2, { delivery: delivery("09:00", 1), carriers: carry("12:00", 2) })],
      [],
      cars,
    );
    const first = lanes.find((l) => l.carId === 1)!;
    expect(first.entries).toHaveLength(2);
    const solo = first.entries.find((e) => e.kind === "order" && e.order.id === 1);
    expect(solo && solo.kind === "order" && solo.parts).toEqual(["delivery", "carriers"]);
    const other = lanes.find((l) => l.carId === 2)!;
    expect(other.entries[0].kind === "order" && other.entries[0].parts).toEqual(["carriers"]);
  });

  it("finds the car of an old row by its text and skips closed work", () => {
    const lanes = buildLanes(
      [order(1, { delivery: delivery("09:00", null, "аа1111аа") }), order(2, { status: "rejected", delivery: delivery("09:00", 1) }), order(3, { status: "cancelled", delivery: delivery("09:00", 1) })],
      [run(9, "10:00", cars[1], "cancelled")],
      cars,
    );
    expect(lanes).toHaveLength(1);
    expect(lanes[0].carId).toBe(1);
  });
});
