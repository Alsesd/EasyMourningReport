import { describe, it, expect } from "vitest";
import { manifestLines, mergeLines, openItems, runInput } from "./cargo";
import type { ProductRequest, Run } from "./types";

const car = { id: 1, plate: "АА1111АА", display: "АА 1111 АА", nonstandard: false, label: "", active: true };
const line = (id: number, item_id: number, quantity: number, org = 3) => ({ id, item_id, request_id: 1, organisation_id: org, organisation_name: "Філія", product_name: `Товар ${item_id}`, quantity });

const run: Run = {
  id: 9, kind: "goods", service_date: "2026-11-09", car, time: "10:00", departure: "Склад", notes: "", status: "planned", created_by_name: "", created_at: "", updated_at: "",
  stops: [
    { id: 1, position: 1, organisation_id: 3, organisation_name: "Філія А", place: "Філія А" },
    { id: 2, position: 2, organisation_id: 4, organisation_name: "Філія Б", place: "Двір" },
    { id: 3, position: 3, organisation_id: 3, organisation_name: "Філія А", place: "Склад А" },
  ],
  manifest: [
    { organisation_id: 3, organisation_name: "Філія А", place: "Філія А", lines: [line(1, 10, 2)] },
    { organisation_id: 4, organisation_name: "Філія Б", place: "Двір", lines: [line(2, 20, 1, 4)] },
    { organisation_id: 3, organisation_name: "Філія А", place: "Склад А", lines: [line(3, 11, 5)] },
  ],
};

describe("cargo arithmetic", () => {
  it("sums the same item and keeps the order of first appearance", () => {
    expect(mergeLines([{ item_id: 1, quantity: 2 }, { item_id: 2, quantity: 1 }], [{ item_id: 1, quantity: 3 }])).toEqual([
      { item_id: 1, quantity: 5 },
      { item_id: 2, quantity: 1 },
    ]);
    expect(mergeLines([{ item_id: 1, quantity: 0 }])).toEqual([]);
  });

  it("flattens a manifest to item lines", () => {
    expect(manifestLines(run.manifest.slice(0, 1))).toEqual([{ item_id: 10, quantity: 2 }]);
    expect(manifestLines(undefined)).toEqual([]);
  });

  it("rebuilds the run body with each stop's own lines and adds to the first stop of the desk", () => {
    const body = runInput(run, { organisationId: 3, lines: [{ item_id: 10, quantity: 1 }, { item_id: 12, quantity: 4 }] });
    expect(body).toMatchObject({ service_date: "2026-11-09", car_id: 1, time: "10:00", departure: "Склад" });
    expect(body.stops.map((s) => s.lines)).toEqual([
      [{ item_id: 10, quantity: 3 }, { item_id: 12, quantity: 4 }],
      [{ item_id: 20, quantity: 1 }],
      [{ item_id: 11, quantity: 5 }], // the desk's second stop is untouched
    ]);
  });

  it("lists only what can still be loaded, of one desk", () => {
    const req = (id: number, org: number, status: ProductRequest["status"], remaining: number): ProductRequest => ({
      id, organisation_id: org, organisation_name: "", need_date: "2026-11-09", deceased: "", notes: "", status, reply_note: "", submitted_by_name: "", created_at: "", updated_at: "", car: null, total_cents: 0,
      items: [{ id: id * 10, product_id: 1, product_name: "Труна", quantity: 2, unit_price_cents: null, total_cents: 0, loaded: 2 - remaining, remaining, carriers: [] }],
    });
    const out = openItems([req(1, 3, "submitted", 2), req(2, 3, "planned", 0), req(3, 4, "submitted", 2), req(4, 3, "partial", 0)], 3);
    expect(out.map((o) => o.item.id)).toEqual([10]);
  });
});
