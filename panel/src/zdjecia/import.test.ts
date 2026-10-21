import { describe, expect, it } from "vitest";
import {
  bezDopiskow, czyGlowne, czyZdjecie, jedenNaTowar, kandydaci, klasyfikuj, paczki, poKolei, przypiszSymbole, rozbierz, symbolZNazwy,
  wybierzWariant, type Wariant,
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

describe("kandydaci na symbol", () => {
  /* Właściciel ma pliki `symbol-miniaturka`, `symbol-1` i `miniaturka.jpg`
     w folderze nazwanym symbolem. Pełna nazwa zawsze idzie pierwsza. */
  it("nazwa, potem nazwa bez dopisku", () => {
    expect(kandydaci(plik("W08-0501.jpg"))).toEqual(["W08-0501"]);
    expect(kandydaci(plik("W08-0501-miniaturka.jpg"))).toEqual(["W08-0501-MINIATURKA", "W08-0501"]);
    expect(kandydaci(plik("W08-0501-1.jpg"))).toEqual(["W08-0501-1", "W08-0501"]);
    expect(kandydaci(plik("W08-0501 (2).png"))).toEqual(["W08-0501 (2)", "W08-0501"]);
    expect(kandydaci(plik("W08-0501_mini.jpg"))).toEqual(["W08-0501_MINI", "W08-0501"]);
  });
  it("dopisek nie zjada czterech cyfr symbolu, a kilka dopisków schodzi po kolei", () => {
    expect(bezDopiskow("W08-0501")).toBe("W08-0501");
    expect(bezDopiskow("W08-0501-1-miniaturka")).toBe("W08-0501");
    expect(bezDopiskow("miniaturka")).toBe("miniaturka");
  });
  it("foldery od najbliższego, gdy wybrano folder", () => {
    expect(kandydaci({ name: "miniaturka.jpg", webkitRelativePath: "WERTIS SKU/Filtry/W08-0501/miniaturka.jpg" }))
      .toEqual(["MINIATURKA", "W08-0501", "FILTRY", "WERTIS SKU"]);
    expect(kandydaci({ name: "Zrzut ekranu 2026-10-07 123809.jpg", webkitRelativePath: "x/W08-0501-1/Zrzut ekranu 2026-10-07 123809.jpg" }))
      .toEqual(["W08-0501-1", "W08-0501", "X"]);
  });
});

describe("rozbiór wybranych plików", () => {
  it("zdjęcia z kandydatami, bez kandydata i nie-zdjęcia", () => {
    const r = rozbierz([
      plik("W08-0501.jpg"), plik("Zrzut ekranu 2026-10-07 123809.jpg"), { name: "opis.txt", type: "text/plain" },
    ]);
    expect(r.pliki.map((x) => [x.plik.name, x.kandydaci])).toEqual([["W08-0501.jpg", ["W08-0501"]]]);
    expect(r.niesymbole.map((p) => p.name)).toEqual(["Zrzut ekranu 2026-10-07 123809.jpg"]);
    expect(r.odrzucone.map((p) => p.name)).toEqual(["opis.txt"]);
  });
});

describe("przypisanie symbolu po odpowiedzi serwera", () => {
  const znany = (symbol: string, twId: number | null, niejednoznaczny?: true): PozycjaDopasowania =>
    ({ symbol, twId, nazwa: null, maZdjecie: false, oczekuje: false, zablokowany: false, ...(niejednoznaczny ? { niejednoznaczny } : {}) });
  it("pierwszy kandydat znany Subiektowi; nieznany zostaje pod pierwszym kandydatem", () => {
    const r = rozbierz([
      plik("W08-0501.jpg"), plik("w08-0501-1.png"), plik("W08-0501-miniaturka.jpg"),
      { name: "miniaturka.jpg", type: "image/jpeg", webkitRelativePath: "SKU/W04-0402/miniaturka.jpg" },
      plik("W99-9999-1.jpg"), plik("W77-0001.jpg"),
    ]);
    const mapa = new Map([
      ["W08-0501", znany("W08-0501", 1)], ["W04-0402", znany("W04-0402", 2)],
      ["W99-9999-1", znany("W99-9999-1", null)], ["W77-0001", znany("W77-0001", null, true)],
    ]);
    expect(przypiszSymbole(r.pliki, mapa).map((g) => [g.symbol, g.pliki.map((p) => p.name)])).toEqual([
      ["W08-0501", ["W08-0501.jpg", "w08-0501-1.png", "W08-0501-miniaturka.jpg"]],
      ["W04-0402", ["miniaturka.jpg"]],
      ["W99-9999-1", ["W99-9999-1.jpg"]],
      ["W77-0001", ["W77-0001.jpg"]],
    ]);
  });
  /* Symbol z cyfrą na końcu, który w Subiekcie istnieje, wygrywa z przyciętym. */
  it("pełna nazwa przed przyciętą, gdy obie są w Subiekcie", () => {
    const r = rozbierz([plik("W28-303.png")]);
    const mapa = new Map([["W28-303", znany("W28-303", 5)], ["W28", znany("W28", 6)]]);
    expect(przypiszSymbole(r.pliki, mapa)[0].symbol).toBe("W28-303");
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
  /* Folder Allegro `W09-0819` ma `2`, `kat`, `ls1`…`ls3` i `min`; główne jest `min`,
     choć aranżacja `ls1` ma więcej pikseli. */
  it("zdjęcie główne oferty wygrywa z większym ujęciem dodatkowym", () => {
    expect(wybierzWariant([w("ls1.jpg", 4000, 3000), w("kat.jpg", 900, 900), w("min.jpg", 2000, 2000)]).nazwa)
      .toBe("min.jpg");
    expect(wybierzWariant([w("W08-0501.jpg", 1600, 1600), w("W08-0501-miniaturka.jpg", 300, 300)]).nazwa)
      .toBe("W08-0501-miniaturka.jpg");
  });
  it("główne poznaje po końcówce nazwy, nie po fragmencie słowa", () => {
    expect(czyGlowne("min.jpg")).toBe(true);
    expect(czyGlowne("W08-0501_miniaturka.png")).toBe(true);
    expect(czyGlowne("ls1.jpg")).toBe(false);
    expect(czyGlowne("admin.jpg")).toBe(false);
    expect(czyGlowne("2.jpg")).toBe(false);
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
