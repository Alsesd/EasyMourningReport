/**
 * Cargo arithmetic. The server replaces the whole cargo of an order (`PUT .../cargo`) or the whole run
 * (`PATCH .../runs/{id}`), so "add to this car" means: read what is on it, add, send everything back.
 */

import type { Manifest, ProductRequest, ProductRequestItem, Run, RunInput } from "./types";

export interface Line {
  item_id: number;
  quantity: number;
}

/** Every line of a manifest, flat (an order has one destination). */
export function manifestLines(manifest: Manifest | undefined): Line[] {
  return (manifest ?? []).flatMap((e) => e.lines.map((l) => ({ item_id: l.item_id, quantity: l.quantity })));
}

/** Sum quantities of the same item; zero or negative quantities are dropped; first-seen order is kept. */
export function mergeLines(...lists: Line[][]): Line[] {
  const sum = new Map<number, number>();
  for (const list of lists) for (const l of list) sum.set(l.item_id, (sum.get(l.item_id) ?? 0) + l.quantity);
  return [...sum].filter(([, q]) => q > 0).map(([item_id, quantity]) => ({ item_id, quantity }));
}

/**
 * The run as a PATCH body: its stops with the lines now on them, and `add` placed on the first stop of `organisationId`.
 * Manifest entries come per destination in route order; they are matched to stops by organisation and place, in order,
 * so a desk that appears twice on the route keeps each stop's own lines.
 */
export function runInput(run: Run, add?: { organisationId: number; lines: Line[] }): RunInput {
  const used = new Set<number>();
  let added = false;
  const stops = [...run.stops]
    .sort((a, b) => a.position - b.position)
    .map((s) => {
      const at = run.manifest.findIndex((e, i) => !used.has(i) && e.organisation_id === s.organisation_id && e.place === s.place);
      if (at >= 0) used.add(at);
      let lines: Line[] = at >= 0 ? run.manifest[at].lines.map((l) => ({ item_id: l.item_id, quantity: l.quantity })) : [];
      if (add && !added && add.organisationId === s.organisation_id) {
        lines = mergeLines(lines, add.lines);
        added = true;
      }
      return { organisation_id: s.organisation_id, place: s.place, lines };
    });
  return { service_date: run.service_date, car_id: run.car.id, time: run.time, departure: run.departure, notes: run.notes, stops };
}

/** Items of the requests that can still be loaded (remaining > 0), of one desk, with their request. */
export function openItems(requests: ProductRequest[], organisationId: number): { request: ProductRequest; item: ProductRequestItem }[] {
  return requests
    .filter((r) => r.organisation_id === organisationId && (r.status === "submitted" || r.status === "partial"))
    .flatMap((request) => request.items.filter((item) => item.remaining > 0).map((item) => ({ request, item })));
}
