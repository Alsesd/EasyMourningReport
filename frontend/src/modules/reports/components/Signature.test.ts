import { describe, it, expect } from "vitest";
import { signatureText } from "./Signature";

const store = { by: "Оксана Мельник", kind: "store" as const, submitted_at: "2026-11-06T10:32:00Z" };
const admin = { by: "boss", kind: "admin" as const, submitted_at: "2026-11-06T10:32:00Z" };

describe("signatureText", () => {
  it("names the employee who submitted a locked report", () => {
    expect(signatureText("submitted", store)).toMatch(/^Надіслав\(ла\): Оксана Мельник · /);
  });
  it("names the administrator who locked a report the store never submitted", () => {
    expect(signatureText("submitted", admin)).toMatch(/^Заблокував\(ла\): boss · /);
  });
  it("shows the last submission after an unlock, but not a past admin lock", () => {
    expect(signatureText("draft", store)).toMatch(/^Востаннє надіслав\(ла\): Оксана Мельник/);
    expect(signatureText("draft", admin)).toBeNull();
  });
  it("shows nothing for reports from before the signature existed", () => {
    expect(signatureText("submitted", undefined)).toBeNull();
    expect(signatureText("submitted", null)).toBeNull();
  });
});
