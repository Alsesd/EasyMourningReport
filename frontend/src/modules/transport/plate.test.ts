import { describe, it, expect } from "vitest";
import { displayPlate, formatPlateInput, isStandardPlate, normalizePlate, plateProblem } from "./plate";

describe("plates", () => {
  it("normalises case, separators and Latin lookalikes", () => {
    expect(normalizePlate(" aa-1234.bb ")).toBe("АА1234ВВ"); // Latin a, b -> Cyrillic А, В
    expect(normalizePlate("KI 0001 XM")).toBe("КІ0001ХМ");
    expect(normalizePlate("ка 1234 ів")).toBe("КА1234ІВ");
  });

  it("recognises a standard plate only with the twelve plate letters", () => {
    expect(isStandardPlate("AA1234BB")).toBe(true);
    expect(isStandardPlate("ДД 1234 ВВ")).toBe(false); // Д is not a plate letter
    expect(isStandardPlate("AA123BB")).toBe(false);
    expect(isStandardPlate("AA 12345 BB")).toBe(false);
  });

  it("shows a standard plate as АА 1234 ВВ and leaves others as normalised", () => {
    expect(displayPlate("aa1234bb")).toBe("АА 1234 ВВ");
    expect(displayPlate("dk-77")).toBe("DК77"); // D has no lookalike; K becomes Cyrillic
  });

  it("formats while typing, converting lookalikes, without cutting text that does not fit", () => {
    expect(formatPlateInput("a", false)).toBe("А");
    expect(formatPlateInput("aa12", false)).toBe("АА 12");
    expect(formatPlateInput("AA1234b", false)).toBe("АА 1234 В");
    expect(formatPlateInput("aa1234bb", false)).toBe("АА 1234 ВВ");
    expect(formatPlateInput("12ab", false)).toBe("12АВ"); // not the shape: kept, flagged by plateProblem
    expect(formatPlateInput("12 ab", true)).toBe("12АВ");
  });

  it("validates: standard unless the plate is marked nonstandard", () => {
    expect(plateProblem("", false)).toBe("empty");
    expect(plateProblem("АА 12", false)).toBe("format");
    expect(plateProblem("АА 1234 ВВ", false)).toBeNull();
    expect(plateProblem("12", true)).toBe("format"); // too short even for a nonstandard plate
    expect(plateProblem("ВО 12-34", true)).toBeNull();
  });
});
