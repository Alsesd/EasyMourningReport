import { describe, it, expect } from "vitest";
import { signatureLines } from "./Signature";

const employee = { by: "Оксана Мельник", signed_at: "2026-11-06T10:32:00Z" };
const admin = { by: "boss", signed_at: "2026-11-06T12:00:00Z" };

describe("signatureLines", () => {
  it("names the employee who submitted a locked report", () => {
    expect(signatureLines("submitted", { submission: employee })).toEqual([expect.stringMatching(/^Надіслав\(ла\): Оксана Мельник · /)]);
  });
  it("shows both when an administrator locked it again after an unlock", () => {
    const lines = signatureLines("submitted", { submission: employee, locked: admin });
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(/Оксана Мельник/);
    expect(lines[1]).toMatch(/^Заблокував\(ла\) адміністратор: boss/);
  });
  it("names only the administrator for a report the store never submitted", () => {
    expect(signatureLines("submitted", { locked: admin })).toEqual([expect.stringMatching(/boss/)]);
  });
  it("shows the last submission after an unlock and hides a stale lock", () => {
    expect(signatureLines("draft", { submission: employee, locked: admin })).toEqual([expect.stringMatching(/^Востаннє надіслав\(ла\): Оксана Мельник/)]);
  });
  it("shows nothing for reports from before the signature existed", () => {
    expect(signatureLines("submitted", {})).toEqual([]);
    expect(signatureLines("submitted", { submission: null, locked: null })).toEqual([]);
  });
});
