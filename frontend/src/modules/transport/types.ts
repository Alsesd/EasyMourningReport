/** Transport v2 shapes, aliased from the hand-maintained schema (platform/api/types.ts belongs to the shell). */

import type { components } from "@/platform/api/schema";

type S = components["schemas"];

export type Car = S["TransportCarDTO"];
export type CarInput = S["TransportCarInputDTO"];
export type CargoLine = S["CargoLineDTO"];
export type ManifestEntry = S["ManifestEntryDTO"];
export type Manifest = S["ManifestDTO"];
export type CatalogItem = S["CatalogItemDTO"];
export type ProductRequest = S["ProductRequestDTO"];
export type ProductRequestItem = S["ProductRequestItemDTO"];
export type ProductRequestInput = S["ProductRequestInputDTO"];
export type RequestCarrier = S["RequestCarrierDTO"];
export type Run = S["TransportRunDTO"];
export type RunStop = S["RunStopDTO"];
export type RunInput = S["TransportRunInputDTO"];
export type Assignment = S["TransportAssignmentDTO"];
export type Board = S["TransportBoardDTO"];

export type RequestStatus = ProductRequest["status"];
export type RunStatus = Run["status"];
