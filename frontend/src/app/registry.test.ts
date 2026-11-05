import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { appModules, navFor } from "./registry";
import { landingPathFor } from "./routing/landing";
import type { SessionDTO } from "@/platform/api/types";

const session = (permissions: string[], organisation: SessionDTO["organisation"] = null): SessionDTO => ({
  user_id: 1,
  login: "user",
  full_name: "",
  organisation,
  roles: [],
  permissions,
  modules: [],
  period: "2026-10",
});

describe("module registry", () => {
  it("has unique module, route and nav ids", () => {
    const ids = appModules.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
    const nav = appModules.flatMap((m) => m.nav ?? []).map((n) => n.id);
    expect(new Set(nav).size).toBe(nav.length);
    const paths = appModules.flatMap((m) => m.routes).map((r) => r.path);
    expect(new Set(paths).size).toBe(paths.length);
    const sections = appModules.flatMap((m) => m.admin ?? []).map((s) => s.id);
    expect(new Set(sections).size).toBe(sections.length);
  });

  it("builds navigation from permissions", () => {
    expect(navFor(["reports.submit"]).map((n) => n.id)).toEqual(["report"]);
    expect(navFor(["reports.review", "platform.audit.view"]).map((n) => n.id)).toEqual(["summary", "reports", "admin"]);
    expect(navFor(["transport.orders.create", "org.users.manage"]).map((n) => n.id)).toEqual(["admin"]);
    // A module's catalogue permission alone is enough to reach the hub.
    expect(navFor(["reports.catalog.manage"]).map((n) => n.id)).toEqual(["admin"]);
  });

  it("lands every kind of user on the best page they may open", () => {
    expect(landingPathFor(session(["reports.review", "reports.submit"]))).toBe("/admin/summary");
    expect(landingPathFor(session(["reports.submit"], { id: 1, name: "Shop" }))).toBe("/report");
    expect(landingPathFor(session(["org.users.manage"], { id: 1, name: "Shop" }))).toBe("/admin/manage");
    expect(landingPathFor(session([]))).toBe("/admin/home");
    expect(landingPathFor(null)).toBe("/login");
  });
});

const SRC = join(__dirname, "..");

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

function imports(path: string): string[] {
  return [...readFileSync(path, "utf8").matchAll(/from\s+["'](@\/[^"']+)["']/g)].map((m) => m[1]);
}

describe("frontend architecture", () => {
  it("keeps modules independent of each other and of the app shell", () => {
    const violations: string[] = [];
    for (const moduleDir of readdirSync(join(SRC, "modules"))) {
      const dir = join(SRC, "modules", moduleDir);
      if (!statSync(dir).isDirectory()) continue;
      for (const file of files(dir)) {
        for (const target of imports(file)) {
          const foreignModule = target.startsWith("@/modules/") && !target.startsWith(`@/modules/${moduleDir}/`);
          if (foreignModule || target.startsWith("@/app/")) violations.push(`${relative(SRC, file)} → ${target}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it("never lets the platform or ui import modules or the app shell", () => {
    const violations: string[] = [];
    for (const folder of ["platform", "ui"]) {
      for (const file of files(join(SRC, folder))) {
        if (file.endsWith(".test.tsx") || file.endsWith(".test.ts")) continue;
        for (const target of imports(file)) {
          if (target.startsWith("@/modules") || target.startsWith("@/app/")) {
            violations.push(`${relative(SRC, file)} → ${target}`);
          }
        }
      }
    }
    expect(violations).toEqual([]);
  });
});
