/** The dispatcher's day board: orders and runs grouped per car, in time order. */

import type { TransportOrderDTO } from "@/platform/api/types";
import { normalizePlate } from "./plate";
import type { Car, Run } from "./types";

export type LaneEntry =
  | { kind: "order"; time: string; key: string; order: TransportOrderDTO; parts: ("delivery" | "carriers")[] }
  | { kind: "run"; time: string; key: string; run: Run };

export interface Lane {
  /** Car id, or null for the lane of work that has no car yet. */
  carId: number | null;
  display: string;
  entries: LaneEntry[];
}

const CLOSED = new Set(["rejected", "cancelled"]);

/** The fleet car a part goes in: by id, else by its text (old rows carry the text only), else none. */
function carOf(part: { car_id?: number | null; car_number: string }, cars: Car[]): { id: number | null; display: string } {
  if (part.car_id) return { id: part.car_id, display: cars.find((c) => c.id === part.car_id)?.display ?? part.car_number };
  const n = normalizePlate(part.car_number);
  if (!n) return { id: null, display: "" };
  const found = cars.find((c) => c.plate === n);
  return found ? { id: found.id, display: found.display } : { id: null, display: part.car_number };
}

/**
 * Lanes for the cars that have work (the lane without a car first), each time-sorted. An order whose parts go in two
 * cars appears in both lanes, with the parts of that car. Rejected and cancelled orders and runs are left out.
 */
export function buildLanes(orders: TransportOrderDTO[], runs: Run[], cars: Car[]): Lane[] {
  const lanes = new Map<string, Lane>();
  const lane = (id: number | null, display: string): Lane => {
    const key = id === null ? `text:${normalizePlate(display)}` : `car:${id}`;
    let l = lanes.get(key);
    if (!l) lanes.set(key, (l = { carId: id, display, entries: [] }));
    return l;
  };
  for (const order of orders) {
    if (CLOSED.has(order.status)) continue;
    const parts: { part: "delivery" | "carriers"; time: string; id: number | null; display: string }[] = [];
    if (order.delivery) parts.push({ part: "delivery", time: order.delivery.time, ...carOf(order.delivery, cars) });
    if (order.carriers) parts.push({ part: "carriers", time: order.carriers.time, ...carOf(order.carriers, cars) });
    const byLane = new Map<string, typeof parts>();
    for (const p of parts) {
      const k = p.id === null ? `text:${normalizePlate(p.display)}` : `car:${p.id}`;
      byLane.set(k, [...(byLane.get(k) ?? []), p]);
    }
    for (const group of byLane.values()) {
      const first = group[0];
      lane(first.id, first.display).entries.push({
        kind: "order",
        key: `o${order.id}-${first.id ?? first.display}`,
        order,
        time: group.map((g) => g.time).sort()[0],
        parts: group.map((g) => g.part),
      });
    }
  }
  for (const run of runs) {
    if (run.status === "cancelled") continue;
    lane(run.car.id, run.car.display).entries.push({ kind: "run", key: `r${run.id}`, run, time: run.time });
  }
  const sorted = [...lanes.values()];
  for (const l of sorted) l.entries.sort((a, b) => a.time.localeCompare(b.time));
  return sorted.sort((a, b) => (a.display === "" ? -1 : b.display === "" ? 1 : a.display.localeCompare(b.display, "uk")));
}
