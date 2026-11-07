import { describe, it, expect } from "vitest";
import { createProductSearch, fromEnglishLayout } from "./productSearch";

const catalogue = ["Труна Бейка спец 3 метра", "Труна Класик 2 метри", "Вінок «Скорбота»", "Хрест дубовий 30 см", "Корзина п’ять троянд"];
const find = (q: string) => createProductSearch(catalogue, (n) => n).search(q).map((h) => h.item);

describe("product search", () => {
  it("finds by any word of the name, not only by its start", () => {
    expect(find("бейка")).toEqual(["Труна Бейка спец 3 метра"]);
    expect(find("бей 3")).toEqual(["Труна Бейка спец 3 метра"]);
    expect(find("скорб")).toEqual(["Вінок «Скорбота»"]);
  });

  it("reads a number with its unit however it is written", () => {
    for (const q of ["3 метра", "3м", "3 м", "3 метр"]) expect(find(q)).toEqual(["Труна Бейка спец 3 метра"]);
    expect(find("2м")).toEqual(["Труна Класик 2 метри"]);
  });

  it("matches numbers exactly: 3 is not 30", () => {
    expect(find("3")).toEqual(["Труна Бейка спец 3 метра"]);
    expect(find("30")).toEqual(["Хрест дубовий 30 см"]);
    expect(find("30 см")).toEqual(["Хрест дубовий 30 см"]);
  });

  it("does not match unrelated names", () => {
    expect(find("труна")).not.toContain("Вінок «Скорбота»");
    expect(find("труна")).toHaveLength(2);
  });

  it("treats і/и/ї and an apostrophe as one letter", () => {
    expect(find("віно")).toEqual(["Вінок «Скорбота»"]);
    expect(find("винок")).toEqual(["Вінок «Скорбота»"]);
    expect(find("пять")).toEqual(["Корзина п’ять троянд"]);
  });

  it("falls back to a part of a word when no word starts with the query", () => {
    expect(find("орбот")).toEqual(["Вінок «Скорбота»"]);
  });

  it("reads a query typed on the English layout (`бейка` is `,tqrf`)", () => {
    expect(fromEnglishLayout(",tqrf")).toBe("бейка");
    expect(find(",tqrf")).toEqual(["Труна Бейка спец 3 метра"]);
    expect(find("nheyf")).toEqual(["Труна Бейка спец 3 метра", "Труна Класик 2 метри"]); // "труна"
  });

  it("ranks the start of the name before the start of a later word, then alphabetically", () => {
    const s = createProductSearch(["Мішок Труна", "Труна Б", "Труна А"], (n) => n);
    expect(s.search("труна").map((h) => h.item)).toEqual(["Труна А", "Труна Б", "Мішок Труна"]);
  });

  it("returns where to highlight, in the name as written", () => {
    const [hit] = createProductSearch(catalogue, (n) => n).search("бей 3");
    expect(hit.ranges.map(([a, b]) => hit.item.slice(a, b))).toEqual(["Бей", "3"]);
    const [unit] = createProductSearch(catalogue, (n) => n).search("3м");
    expect(unit.ranges.map(([a, b]) => unit.item.slice(a, b))).toEqual(["3", "метра"]);
  });

  it("lists the catalogue alphabetically for an empty query", () => {
    expect(createProductSearch(["Б", "А"], (n) => n).search("").map((h) => h.item)).toEqual(["А", "Б"]);
  });
});
