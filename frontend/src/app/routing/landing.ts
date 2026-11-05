/** Where a user lands after signing in: the highest-priority page any installed module offers them. */

import { useAuth } from "@/platform/auth/AuthContext";
import type { SessionDTO } from "@/platform/api/types";
import { allowed } from "@/platform/modules";
import { appModules } from "@/app/registry";

export function landingPathFor(session: SessionDTO | null | undefined): string {
  if (!session) return "/login";
  const candidates = appModules
    .flatMap((m) => m.landing ?? [])
    .filter((page) => allowed(session.permissions, page.permissions))
    .sort((a, b) => a.priority - b.priority);
  return candidates[0]?.path ?? "/admin/settings";
}

export function useLandingPath(): string {
  const { session } = useAuth();
  return landingPathFor(session);
}
