/** Server errors in the words of the dispatcher and the desks. */

import { ApiError } from "@/platform/api/client";
import { uk } from "./i18n";

const t = uk.transport;

/** The machine code of a refusal (`{"detail": "...", "code": "car_required"}`), if the server sent one. */
export function errorCode(err: unknown): string | undefined {
  if (err instanceof ApiError && err.data && typeof err.data === "object" && "code" in err.data) {
    const code = (err.data as { code?: unknown }).code;
    return typeof code === "string" ? code : undefined;
  }
  return undefined;
}

/** `car_required` has its own sentence; a busy-car 409 carries the server's Ukrainian detail, with a fallback if it is empty. */
export function transportError(err: unknown): string {
  if (errorCode(err) === "car_required") return t.carRequired;
  if (err instanceof ApiError && err.status === 409 && /^HTTP 409/.test(err.message)) return t.carBusyFallback;
  return err instanceof Error ? err.message : uk.common.error;
}
