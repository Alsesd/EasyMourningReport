import { describe, it, expect } from "vitest";
import { returnPath } from "./returnPath";

const from = (pathname: string, search = "") => ({ from: { pathname, search } });

describe("returnPath", () => {
  it("keeps a same-site path with its query", () => {
    expect(returnPath(from("/admin/reports", "?period=2026-11"))).toBe("/admin/reports?period=2026-11");
  });
  it("ignores the root, the login page and missing state", () => {
    expect(returnPath(from("/"))).toBeNull();
    expect(returnPath(from("/login"))).toBeNull();
    expect(returnPath(null)).toBeNull();
  });
  it("refuses anything that could point to another origin", () => {
    for (const bad of ["//evil.example", "/\\evil.example", "https://evil.example", "evil", "/a\\b"]) {
      expect(returnPath(from(bad))).toBeNull();
    }
  });
});
