import { describe, it, expect } from "vitest";
import { isAcceptablePassword, MIN_PASSWORD_LENGTH } from "./passwordPolicy";

describe("password policy", () => {
  it("needs 8 characters with small and capital letters and a digit", () => {
    expect(MIN_PASSWORD_LENGTH).toBe(8);
    expect(isAcceptablePassword("Abcdef12")).toBe(true);
    expect(isAcceptablePassword("Пароль123")).toBe(true); // Cyrillic counts
    for (const bad of ["Abcde12", "abcdefg1", "ABCDEFG1", "Abcdefgh", "12345678", ""]) expect(isAcceptablePassword(bad)).toBe(false);
  });
});
