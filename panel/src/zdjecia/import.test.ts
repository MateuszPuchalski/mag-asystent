import { describe, expect, it } from "vitest";
import {
  czyZdjecie, jedenNaTowar, klasyfikuj, paczki, poKolei, rozbierz, symbolZNazwy, wybierzWariant, type Wariant,
} from "./import";
import type { PozycjaDopasowania } from "../api/zdjecia";

const plik = (name: string, type = name.endsWith(".png") ? "image/png" : "image/jpeg") => ({ name, type });

describe("symbol z nazwy pliku", () => {
  it("bez rozszerzenia, przycięty, wielkimi literami", () => {
    expect(symbolZNazwy("W08-0501.jpg")).toBe("W08-0501");
    expect(symbolZNazwy(" w04-0402 .PNG")).toBe("W04-0402");
    expect(symbolZNazwy("W28-303.png")).toBe("W28-303");
    expect(symbolZNazwy("ABC")).toBe("ABC");
  });
  it("nazwa dłuższa od symbolu kartoteki albo pusta to nie symbol", () => {
    expect(symbolZNazwy("Zrzut ekranu 2026-10-07 123809.jpg")).toBeNull();
    expect(symbolZNazwy("  .png")).toBeNull();
  });
  it("zdjęcie poznaje po typie, a bez typu po rozszerzeniu", () => {
    expect(czyZdjecie(plik("a.jpg"))).toBe(true);
    expect(czyZdjecie({ name: "faktura.pdf", type: "application/pdf" })).toBe(false);
    expect(czyZdjecie({ name: "Thumbs.db", type: "" })).toBe(false);
    expect(czyZdjecie({ name: "W01.JPEG", type: "" })).toBe(true);
  });
});

describe("rozbiór wybranych plików", () => {
  it("grupuje po symbolu bez wielkości liter i odkłada nie-symbole oraz nie-zdjęcia", () => {
    const r = rozbierz([
      plik("W08-0501.jpg"), plik("w08-0501.png"), plik("W04-0402.png"),
      plik("Zrzut ekranu 2026-10-07 123809.jpg"), { name: "opis.txt", type: "text/plain" },
    ]);
    expect(r.grupy.map((g) => [g.symbol, g.pliki.map((p) => p.name)])).toEqual([
      ["W08-0501", ["W08-0501.jpg", "w08-0501.png"]],
      ["W04-0402", ["W04-0402.png"]],
    ]);
    expect(r.niesymbole.map((p) => p.name)).toEqual(["Zrzut ekranu 2026-10-07 123809.jpg"]);
    expect(r.odrzucone.map((p) => p.name)).toEqual(["opis.txt"]);
  });
});

describe("wybór jednego pliku na symbol", () => {
  const w = (nazwa: string, szer: number, wys: number, bajtow = 1000): Wariant =>
    ({ nazwa, typ: nazwa.endsWith(".png") ? "image/png" : "image/jpeg", bajtow, szer, wys });
  it("więcej pikseli wygrywa, nawet z JPG-iem", () => {
    expect(wybierzWariant([w("A.png", 60, 60), w("A.jpg", 400, 300)]).nazwa).toBe("A.jpg");
  });
  it("przy remisie pikseli PNG, potem większy plik", () => {
    expect(wybierzWariant([w("A.jpg", 200, 200, 9000), w("A.png", 200, 200, 100)]).nazwa).toBe("A.png");
    expect(wybierzWariant([w("A.jpg", 200, 200, 100), w("A.jpeg", 200, 200, 900)]).nazwa).toBe("A.jpeg");
  });
});

describe("klasa po odpowiedzi serwera", () => {
  const p = (z: Partial<PozycjaDopasowania>): PozycjaDopasowania =>
    ({ symbol: "S", twId: 7, nazwa: "n", maZdjecie: false, oczekuje: false, zablokowany: false, ...z });
  it("rozróżnia pięć klas", () => {
    expect(klasyfikuj(p({}))).toBe("do_importu");
    expect(klasyfikuj(p({ maZdjecie: true }))).toBe("ma_zdjecie");
    expect(klasyfikuj(p({ oczekuje: true }))).toBe("czeka");
    expect(klasyfikuj(p({ zablokowany: true }))).toBe("zablokowany");
    expect(klasyfikuj(p({ twId: null }))).toBe("nieznany_symbol");
    expect(klasyfikuj(undefined)).toBe("nieznany_symbol");
  });
  it("kilka kartotek z tym symbolem to osobna klasa, nie brak towaru", () => {
    expect(klasyfikuj(p({ twId: null, nazwa: null, niejednoznaczny: true }))).toBe("niejednoznaczny");
  });
  it("istniejące zdjęcie przesłania kolejkę i blokadę", () => {
    expect(klasyfikuj(p({ maZdjecie: true, oczekuje: true, zablokowany: true }))).toBe("ma_zdjecie");
  });
});

describe("jeden wpis na towar", () => {
  it("dwa symbole w tej samej kartotece scalają pliki pod pierwszym symbolem", () => {
    expect(jedenNaTowar([
      { symbol: "A", twId: 1, pliki: ["a.jpg"] }, { symbol: "B", twId: 2, pliki: ["b.jpg"] },
      { symbol: "A2", twId: 1, pliki: ["a2.png"] },
    ])).toEqual([{ symbol: "A", twId: 1, pliki: ["a.jpg", "a2.png"] }, { symbol: "B", twId: 2, pliki: ["b.jpg"] }]);
  });
});

describe("paczki symboli", () => {
  it("bez powtórzeń i po limicie", () => {
    expect(paczki(["A", "B", "A", "C"], 2)).toEqual([["A", "B"], ["C"]]);
    expect(paczki([])).toEqual([]);
  });
});

describe("praca w torach", () => {
  it("nie przekracza współbieżności i robi wszystko", async () => {
    let naraz = 0, maks = 0;
    const zrobione: number[] = [];
    await poKolei([1, 2, 3, 4, 5], 2, async (n) => {
      naraz++; maks = Math.max(maks, naraz);
      await new Promise((r) => setTimeout(r, 1));
      zrobione.push(n); naraz--;
    });
    expect(maks).toBe(2);
    expect(zrobione.sort()).toEqual([1, 2, 3, 4, 5]);
  });
  it("stop kończy bieżące i nie zaczyna nowych; błąd nie przerywa reszty", async () => {
    let stop = false;
    const zrobione: number[] = [];
    await poKolei([1, 2, 3, 4, 5], 2, async (n) => {
      if (n === 1) throw new Error("zły plik");
      zrobione.push(n);
      if (n === 3) stop = true;
    }, () => stop);
    expect(zrobione).toEqual([2, 3]);
  });
});
