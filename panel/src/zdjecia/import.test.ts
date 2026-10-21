import { describe, expect, it } from "vitest";
import {
  bezDopiskow, czyGlowne, czyZdjecie, jedenNaTowar, kandydaci, kawalki, klasyfikuj, paczki, poKolei, przypiszSymbole, rozbierz, symbolZNazwy,
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

const zFolderu = (sciezka: string) => ({ name: sciezka.split("/").at(-1)!, type: "image/jpeg", webkitRelativePath: sciezka });
const G = "--- Gotowe - wystawione ---";

describe("kawałki opisowej nazwy", () => {
  it("fragmenty z cyfrą, bez słów; dwie liczby sklejone myślnikiem", () => {
    expect(kawalki("katownik_FT1249")).toEqual(["FT1249"]);
    expect(kawalki("Gaznik_Wacker_BS50-2_BS30-2_W09-1501")).toEqual(["BS50-2", "BS30-2", "W09-1501"]);
    expect(kawalki("dystans_gaznika_honda_gx160_gx160_zongshen_168fb_10_02014"))
      .toEqual(["gx160", "gx160", "168fb", "02014", "10-02014"]);
    expect(kawalki("GAŹNK GX270 - 76-011")).toEqual(["GX270", "76-011"]);
    expect(kawalki("8_stolarskie")).toEqual([]);
  });
});

describe("kandydaci na symbol", () => {
  /* Pełna nazwa zawsze pierwsza w swoim poziomie. */
  it("nazwa pliku: pełna, bez dopisku", () => {
    expect(kandydaci(plik("W08-0501.jpg"))).toEqual([{ pelna: "W08-0501", symbole: ["W08-0501"] }]);
    expect(kandydaci(plik("W08-0501-miniaturka.jpg"))[0].symbole.slice(0, 2)).toEqual(["W08-0501-MINIATURKA", "W08-0501"]);
    expect(kandydaci(plik("W08-0501-1.jpg"))[0].symbole.slice(0, 2)).toEqual(["W08-0501-1", "W08-0501"]);
    expect(kandydaci(plik("W08-0501 (2).png"))[0].symbole.slice(0, 2)).toEqual(["W08-0501 (2)", "W08-0501"]);
  });
  it("dopisek nie zjada czterech cyfr symbolu, a kilka dopisków schodzi po kolei", () => {
    expect(bezDopiskow("W08-0501")).toBe("W08-0501");
    expect(bezDopiskow("W08-0501-1-miniaturka")).toBe("W08-0501");
    expect(bezDopiskow("miniaturka")).toBe("miniaturka");
  });
  it("foldery od najbliższego, z kawałkami opisu", () => {
    const k = kandydaci(zFolderu(`${G}/7_budowlane/katownik_FT1249/miniaturka.jpg`));
    expect(k[0]).toEqual({ pelna: "MINIATURKA", symbole: ["MINIATURKA"] });
    expect(k[1]).toEqual({ pelna: "KATOWNIK_FT1249", symbole: ["KATOWNIK_FT1249", "FT1249"] });
    /* Nazwa dłuższa niż symbol nie jest kandydatem, ale jej kawałki są. */
    expect(kandydaci(zFolderu(`${G}/x/W27-1309_W27-1305_W27-1306/m.jpg`))[1])
      .toEqual({ pelna: null, symbole: ["W27-1309", "W27-1305", "W27-1306"] });
    expect(kandydaci(zFolderu(`${G}/2_Do kosiarek spalinowych/3_noze/noz_do_14-05013/Untitled.jpg`))[1].symbole)
      .toEqual(["NOZ_DO_14-05013", "14-05013"]);
  });
});

describe("rozbiór wybranych plików", () => {
  it("zdjęcia z kandydatami, bez kandydata i nie-zdjęcia", () => {
    const r = rozbierz([
      plik("W08-0501.jpg"), plik("Zrzut ekranu.jpg"), { name: "opis.txt", type: "text/plain" },
      { name: "Untitled.jpg", type: "image/jpeg", webkitRelativePath: "Bardzo dlugi folder bez cyfr na dysku/Untitled.jpg" },
    ]);
    expect(r.pliki.map((x) => [x.plik.name, x.kandydaci.map((l) => l.symbole)])).toEqual([
      ["W08-0501.jpg", [["W08-0501"]]], ["Zrzut ekranu.jpg", [["ZRZUT EKRANU"]]], ["Untitled.jpg", [["UNTITLED"]]],
    ]);
    expect(r.odrzucone.map((p) => p.name)).toEqual(["opis.txt"]);
    /* Bez kandydata zostaje tylko nazwa za długa na symbol i bez kawałka z cyfrą. */
    expect(rozbierz([plik("bardzo dlugi opis bez zadnej cyfry.jpg")]).niesymbole).toHaveLength(1);
  });
});

describe("przypisanie symbolu po odpowiedzi serwera", () => {
  const znany = (symbol: string, twId: number | null, niejednoznaczny?: true): PozycjaDopasowania =>
    ({ symbol, twId, nazwa: null, maZdjecie: false, oczekuje: false, zablokowany: false, ...(niejednoznaczny ? { niejednoznaczny } : {}) });
  const przypisz = (pliki: Array<{ name: string; type: string; webkitRelativePath?: string }>, znane: PozycjaDopasowania[]) =>
    przypiszSymbole(rozbierz(pliki).pliki, new Map(znane.map((z) => [z.symbol, z])))
      .map((g) => [g.symbol, g.pliki.map((p) => p.name), g.wiele ?? null]);

  it("pierwszy kandydat znany Subiektowi; nieznany zostaje pod pierwszym kandydatem", () => {
    expect(przypisz([
      plik("W08-0501.jpg"), plik("w08-0501-1.png"), plik("W08-0501-miniaturka.jpg"),
      { name: "miniaturka.jpg", type: "image/jpeg", webkitRelativePath: "SKU/W04-0402/miniaturka.jpg" },
      plik("W99-9999-1.jpg"), plik("W77-0001.jpg"),
    ], [znany("W08-0501", 1), znany("W04-0402", 2), znany("W99-9999-1", null), znany("W77-0001", null, true)])).toEqual([
      ["W08-0501", ["W08-0501.jpg", "w08-0501-1.png", "W08-0501-miniaturka.jpg"], null],
      ["W04-0402", ["miniaturka.jpg"], null],
      ["W99-9999-1", ["W99-9999-1.jpg"], null],
      ["W77-0001", ["W77-0001.jpg"], null],
    ]);
  });
  it("pełna nazwa przed przyciętą, gdy obie są w Subiekcie", () => {
    expect(przypisz([plik("W28-303.png")], [znany("W28-303", 5), znany("W28", 6)])[0][0]).toBe("W28-303");
  });

  /* Prawdziwe ścieżki z folderu właściciela: symbol siedzi w opisie folderu. */
  it("symbol z opisu folderu, także pod dwoma folderami i z podkreślnikiem zamiast myślnika", () => {
    expect(przypisz([
      zFolderu(`${G}/7_budowlane/katownik_FT1249/miniaturka.jpg`),
      zFolderu(`${G}/7_budowlane/Gaznik_Wacker_BS50-2_BS30-2_W09-1501/miniaturka.jpg`),
      zFolderu(`${G}/4_Do traktorków/4.Gazniki/gaznik_do_kosiarki_briggs_&_stratton_12_hp_10-01019/zestaw/miniaturka.jpg`),
      zFolderu(`${G}/6_Do Agregatów prądotwórczych/dystans_gaznika_honda_gx160_gx160_zongshen_168fb_10_02014/miniaturka.jpg`),
      zFolderu(`${G}/21.Tarcze/tarcza_widiowa_185_60T_20mm_FTBW18560/tarcza.jpg`),
    ], [znany("FT1249", 1), znany("W09-1501", 2), znany("10-01019", 3), znany("10-02014", 4), znany("FTBW18560", 5)]))
      .toEqual([
        ["FT1249", ["miniaturka.jpg"], null],
        ["W09-1501", ["miniaturka.jpg"], null],
        ["10-01019", ["miniaturka.jpg"], null],
        ["10-02014", ["miniaturka.jpg"], null],
        ["FTBW18560", ["tarcza.jpg"], null],
      ]);
  });

  /* Kilka towarów w jednej nazwie: zgadywanie dałoby zdjęcie złej kartotece. */
  it("kilka różnych towarów w jednej nazwie idzie do ręcznego dodania", () => {
    const sc = `${G}/4_Do traktorków/1_noze/W27-1309_W27-1305_W27-1306/miniaturka.jpg`;
    expect(przypisz([zFolderu(sc)], [znany("W27-1309", 1), znany("W27-1305", 2), znany("W27-1306", 3)]))
      .toEqual([["W27-1309 / W27-1305 / W27-1306", ["miniaturka.jpg"], ["W27-1309", "W27-1305", "W27-1306"]]]);
    /* Dwa kawałki tego samego towaru to nie „kilka”. */
    expect(przypisz([zFolderu(`${G}/x/noz_W08-0501_W08-0501-1/miniaturka.jpg`)],
      [znany("W08-0501", 1), znany("W08-0501-1", 1)])[0]).toEqual(["W08-0501", ["miniaturka.jpg"], null]);
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
