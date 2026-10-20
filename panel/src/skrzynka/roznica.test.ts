import { describe, expect, it } from "vitest";
import { liczbaZmian, roznicaSlow, type KawalekRoznicy } from "./roznica";

/* ── Różnica słów dwóch wersji szkicu ────────────────────────────────────────
   Agent wysyła tekst po poprawce Copilota i ma zobaczyć, CO się zmieniło.
   Różnica, która gubi albo przestawia choćby odstęp, pokazuje inny tekst niż
   ten w polu. Stąd test odbudowy: wspólne + usunięte daje DOKŁADNIE starą
   wersję, a wspólne + dodane nową — co do nowej linii.                     */

const przed = (r: KawalekRoznicy[]) => r.filter((k) => k.rodzaj !== "dodane").map((k) => k.tekst).join("");
const po = (r: KawalekRoznicy[]) => r.filter((k) => k.rodzaj !== "usuniete").map((k) => k.tekst).join("");

describe("roznicaSlow", () => {
  it("identyczne teksty to jeden kawałek wspólny", () => {
    expect(roznicaSlow("Dzień dobry, pasuje.", "Dzień dobry, pasuje."))
      .toEqual([{ rodzaj: "wspolne", tekst: "Dzień dobry, pasuje." }]);
    expect(roznicaSlow("", "")).toEqual([]);
  });

  it("samo dodanie: nowe słowa w środku, reszta wspólna", () => {
    expect(roznicaSlow("Nóż pasuje do kosiarki.", "Nóż na pewno pasuje do kosiarki.")).toEqual([
      { rodzaj: "wspolne", tekst: "Nóż " },
      { rodzaj: "dodane", tekst: "na pewno " },
      { rodzaj: "wspolne", tekst: "pasuje do kosiarki." },
    ]);
  });

  it("samo usunięcie", () => {
    expect(roznicaSlow("Nóż chyba pasuje.", "Nóż pasuje.")).toEqual([
      { rodzaj: "wspolne", tekst: "Nóż " },
      { rodzaj: "usuniete", tekst: "chyba " },
      { rodzaj: "wspolne", tekst: "pasuje." },
    ]);
  });

  it("zamiana: najpierw skreślenie, potem dopisanie, odstęp między zmianami należy do bloku", () => {
    expect(roznicaSlow("Gaźnik W09 kosztuje 120 zł.", "Gaźnik W10 Walbro kosztuje 120 zł.")).toEqual([
      { rodzaj: "wspolne", tekst: "Gaźnik " },
      { rodzaj: "usuniete", tekst: "W09" },
      { rodzaj: "dodane", tekst: "W10 Walbro" },
      { rodzaj: "wspolne", tekst: " kosztuje 120 zł." },
    ]);
    /* Dwa słowa zamienione na dwa: jeden blok, nie „~~a~~b ~~c~~d”. */
    expect(roznicaSlow("x foo bar y", "x baz qux y")).toEqual([
      { rodzaj: "wspolne", tekst: "x " },
      { rodzaj: "usuniete", tekst: "foo bar" },
      { rodzaj: "dodane", tekst: "baz qux" },
      { rodzaj: "wspolne", tekst: " y" },
    ]);
  });

  it("nowe linie zostają co do znaku", () => {
    const a = "Dzień dobry,\n\nnóż pasuje.\nPozdrawiamy";
    const b = "Dzień dobry,\n\nnóż pasuje do LS 46.\n\nPozdrawiamy\nWERTIS";
    const r = roznicaSlow(a, b);
    expect(przed(r)).toBe(a);
    expect(po(r)).toBe(b);
    expect(r.find((k) => k.rodzaj === "dodane")?.tekst).toContain("\n");
  });

  it("odbudowuje obie wersje przy zmianach w wielu miejscach", () => {
    const a = "Dzień dobry, do gaźnika W09-0211 pasuje uszczelka LC170430140 (F3). Wysyłka jutro.";
    const b = "Dzień dobry Panie Janie, do gaźnika W09-0211 pasuje uszczelka LC170430140-0001. Wysyłka dziś.";
    const r = roznicaSlow(a, b);
    expect(przed(r)).toBe(a);
    expect(po(r)).toBe(b);
    /* Sąsiednie kawałki tego samego rodzaju są sklejone. */
    r.forEach((k, i) => { if (i > 0) expect(k.rodzaj).not.toBe(r[i - 1].rodzaj); });
  });

  it("tekst od zera: całość dodana", () => {
    expect(roznicaSlow("", "Dzień dobry.")).toEqual([{ rodzaj: "dodane", tekst: "Dzień dobry." }]);
  });
});

describe("liczbaZmian", () => {
  it("liczy słowa, nie znaki ani odstępy", () => {
    expect(liczbaZmian(roznicaSlow("Gaźnik W09 kosztuje.", "Gaźnik W10 Walbro kosztuje.")))
      .toEqual({ dodane: 2, usuniete: 1 });
    expect(liczbaZmian(roznicaSlow("a b", "a\n\nb"))).toEqual({ dodane: 0, usuniete: 0 });
  });
});
