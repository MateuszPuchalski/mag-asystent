import { describe, expect, it } from "vitest";
import type { CenaPoziomu } from "../api/typy";
import {
  kluczowa, grupujCeny, poczatekOgonka, polozenieOferty, trafienie, ulozOsCen, wspolneMiejsce,
  type Mierz, type UkladNaOsi, type UkladOsi,
} from "./cenyNaOsi";

/* ── CENY NA JEDNEJ OSI: UKŁAD BEZ PRZEGLĄDARKI ───────────────────────────────
   Układ to czysta funkcja, więc sprawdzamy go bez DOM-u. Atrapa miary jest
   deterministyczna i trochę szersza od Barlow, więc położenia różnią się od
   przeglądarki. Testy pilnują NIEZMIENNIKÓW, nie pikseli: nic nie nachodzi,
   nic nie wychodzi poza blok, kropka leży pod własną etykietą, a prowadnica
   do głębszego pasa nie tnie płytszej etykiety. To ten sam sprawdzian, który
   prototyp uruchamiał w przeglądarce na prawdziwym kroju.                    */

const mierz: Mierz = (t, w, r) => t.length * r * (w === 700 ? 0.6 : 0.55);

const c = (poziom: number, nazwa: string, brutto: number | null, netto: number | null, waluta = "PLN"): CenaPoziomu =>
  ({ poziom, nazwa, bruttoGrosze: brutto, nettoGrosze: netto, waluta });
const of = (grosze: number, waluta = "PLN") => ({ grosze, waluta });

/* Zestawy z briefu, w groszach. D1 to zrzut właściciela, D4 jego nagranie. */
const ZESTAWY: Record<string, { ceny: CenaPoziomu[]; oferta: { grosze: number; waluta: string } | null }> = {
  D1: { ceny: [c(0, "", null, 2683), c(1, "Detaliczna", 4951, 4025), c(2, "Hurtowa", 3795, 3085),
    c(3, "Specjalna", 3565, 2898), c(4, "Bazowa", 3300, 2683), c(5, "Serwisanci", 4290, 3488)], oferta: of(5405) },
  D2: { ceny: [c(1, "Detaliczna", 6499, 5284), c(2, "Allegro", 6499, 5284), c(3, "Hurtowa", 5501, 4472),
    c(4, "Serwis", 5000, 4065)], oferta: of(6499) },
  D3: { ceny: [c(1, "Detaliczna", 12000, 9756), c(2, "Hurtowa", 9900, 8049), c(3, "Serwis", 8900, 7236)],
    oferta: of(4500) },
  D4: { ceny: [c(1, "Detaliczna", 2906, 2363), c(2, "Hurtowa", 2999, 2438)], oferta: of(4500) },
  D5: { ceny: [c(1, "Detaliczna", 1999, 1625)], oferta: null },
  D6: { ceny: [c(1, "Detaliczna", 18900, 15366), c(2, "Hurtowa", 16500, 13415), c(3, "Specjalna", 16500, 13415),
    c(4, "Serwis", 15200, 12358)], oferta: of(17500) },
};
/* Treść kolumn 256, 384 i 448 px (bez dwóch kresek ramy i wcięć po 16 px),
   a 335 to kolumna 384 px z paskiem przewijania. Kolumna przewija się przy
   1366 px, więc to najczęstsza szerokość, jaką agent widzi. */
const SZEROKOSCI = [222, 335, 350, 414];

function naOsi(u: UkladOsi): UkladNaOsi {
  if (u.tryb !== "os") throw new Error("oczekiwano osi, a jest lista");
  return u;
}

/** Sprawdzian z prototypu: lista naruszeń, pusta przy dobrym układzie. */
function naruszenia(u: UkladNaOsi): string[] {
  const W = u.szerokosc;
  const bledy: string[] = [];
  if (u.etykiety.length !== u.punkty.length) bledy.push("punkt bez etykiety");
  for (const e of u.etykiety) {
    const id = e.punkt.id, x = e.punkt.x;
    if (e.lewo < 0 || e.lewo + e.szer > W) bledy.push(`${id} poza blokiem`);
    if (e.gora < 0 || e.gora + e.wys > u.wysokosc) bledy.push(`${id} poza wysokością bloku`);
    /* Znacznik co najmniej 3 px od brzegu etykiety. Pół piksela zapasu, bo
       `lewo` jest zaokrąglone do całego piksela, żeby tekst stał ostro. */
    if (x < e.lewo + 3 - 0.5 || x > e.lewo + e.szer - 3 + 0.5) bledy.push(`${id}: znacznik poza własną etykietą`);
    for (const f of u.etykiety) {
      if (f === e) continue;
      if (e.lewo < f.lewo + f.szer && f.lewo < e.lewo + e.szer && e.gora < f.gora + f.wys && f.gora < e.gora + e.wys
        && id < f.punkt.id) bledy.push(`${id} nachodzi na ${f.punkt.id}`);
      /* Etykieta tego samego miejsca nie jest cudza: ogonek zaczyna się za
         nią (`poczatekOgonka`), więc kreska jej nie przecina. */
      if (f.strona === e.strona && f.pas < e.pas && x >= f.lewo && x <= f.lewo + f.szer
        && Math.abs(f.punkt.x - x) >= 1.5) {
        bledy.push(`prowadnica ${id} tnie ${f.punkt.id}`);
      }
    }
  }
  return bledy;
}

describe("położenie oferty: dwie nowe gałęzie zdania", () => {
  it("równość mówi nazwę poziomu, nigdy kwoty", () => {
    const ceny = [c(1, "Detaliczna", 6499, 5284), c(2, "Allegro", 6499, 5284), c(3, "Hurtowa", 5501, 4472)];
    const p = polozenieOferty(ceny, of(6499));
    expect(p?.zdanie).toBe("Oferta równa poziomom: Detaliczna, Allegro.");
    expect(p?.krotko).toBe("równa: Detaliczna, Allegro");
    /* Kwota w zdaniu równości podałaby cenę oferty, a jej dom to karta zakupu. */
    expect(p?.zdanie).not.toContain("64,99");
    expect(polozenieOferty(ceny, of(5501))?.zdanie).toBe("Oferta równa poziomowi Hurtowa.");
  });

  it("różnica poniżej procenta to „mniej niż 1%”, nie fałszywe „0%”", () => {
    const p = polozenieOferty([c(1, "Detaliczna", 4951, 4025)], of(4965));
    expect(p?.zdanie).toMatch(/mniej niż 1% nad najwyższym/);
    expect(p?.zdanie).not.toMatch(/\b0%/);
    expect(p?.krotko).toBe("mniej niż 1% nad najwyższym poziomem");
  });
});

describe("skala osi", () => {
  it("najniższy punkt stoi 10 px od lewej, najwyższy 10 px od prawej", () => {
    const u = naOsi(ulozOsCen(ZESTAWY.D1.ceny, ZESTAWY.D1.oferta, 350, mierz));
    const xs = u.punkty.map((p) => p.x);
    expect(Math.min(...xs)).toBe(10);
    expect(Math.max(...xs)).toBe(340);
    /* Oferta 54,05 to najwyższy punkt, Bazowa 33,00 najniższy. */
    expect(u.punkty.find((p) => p.rodzaj === "oferta")?.x).toBe(340);
    expect(u.punkty.find((p) => p.nazwa === "Bazowa")?.x).toBe(10);
  });

  it("jeden poziom równy ofercie: oba punkty na środku", () => {
    const u = naOsi(ulozOsCen([c(1, "Detaliczna", 4996, 4062)], of(4996), 350, mierz));
    expect(u.punkty.map((p) => p.x)).toEqual([175, 175]);
    expect(naruszenia(u)).toEqual([]);
  });
});

describe("układ etykiet bez kolizji: D1–D6 przy trzech szerokościach", () => {
  const przypadki = Object.keys(ZESTAWY).flatMap((d) => SZEROKOSCI.map((w) => ({ d, w })));
  it.each(przypadki)("$d przy $w px", ({ d, w }) => {
    const { ceny, oferta } = ZESTAWY[d];
    const u = ulozOsCen(ceny, oferta, w, mierz);
    /* Bez oferty oś nie ma o co pytać, więc blok zostaje listą. */
    if (d === "D5") {
      expect(u.tryb).toBe("lista");
      return;
    }
    expect(naruszenia(naOsi(u))).toEqual([]);
  });

  it("sprawdzian odmawia złego układu", () => {
    /* Strażnik, którego nie sprawdzono na odmowę, jest zielonym kwadratem. */
    const dobry = naOsi(ulozOsCen(ZESTAWY.D1.ceny, ZESTAWY.D1.oferta, 350, mierz));
    const [a, b] = dobry.etykiety;
    const nachodzi = { ...dobry, etykiety: dobry.etykiety.map((e) => (e === b ? { ...b, lewo: a.lewo, gora: a.gora } : e)) };
    expect(naruszenia(nachodzi).join(" ")).toMatch(/nachodzi/);
    const obok = { ...dobry, etykiety: dobry.etykiety.map((e) => (e === a ? { ...a, lewo: a.punkt.x + 10 } : e)) };
    expect(naruszenia(obok).join(" ")).toMatch(/poza własną etykietą/);
  });

  it("etykieta oferty nie niesie kwoty", () => {
    /* Kwota oferty to fakt karty zakupu; tu niesie ją dymek i nazwa figury. */
    for (const d of ["D1", "D2", "D3", "D4", "D6"]) {
      const u = naOsi(ulozOsCen(ZESTAWY[d].ceny, ZESTAWY[d].oferta, 350, mierz));
      const oferta = u.punkty.find((p) => p.rodzaj === "oferta");
      expect(oferta?.kwota, d).toBe("");
      expect(oferta?.nazwa, d).toBe("oferta");
    }
  });

  it("stałe miejsca od 335 px: klucz tuż pod osią, oferta nad osią", () => {
    /* Przy 222 px atrapa miary jest szersza od Barlow i klucz bywa w pasie 2.
       Tam pilnujemy tylko braku kolizji. */
    for (const d of ["D1", "D2", "D3", "D4", "D6"]) {
      for (const w of [335, 350, 414]) {
        const u = naOsi(ulozOsCen(ZESTAWY[d].ceny, ZESTAWY[d].oferta, w, mierz));
        const klucz = u.etykiety.find((e) => e.punkt.klucz);
        const oferta = u.etykiety.find((e) => e.punkt.rodzaj === "oferta");
        expect([klucz?.strona, klucz?.pas], `${d} ${w}: klucz`).toEqual([1, 1]);
        expect(oferta?.strona, `${d} ${w}: oferta`).toBe(-1);
      }
    }
  });

  it("klucz to pierwszy poziom „detal…”, a bez niego pierwszy z ceną brutto", () => {
    const g = grupujCeny([c(1, "Hurtowa", 4000, 3252), c(2, "Detal sklep", 5000, 4065)]);
    expect(kluczowa(g)?.nazwy).toEqual(["Detal sklep"]);
    expect(kluczowa(grupujCeny([c(1, "Hurtowa", 4000, 3252), c(2, "Serwis", 5000, 4065)]))?.nazwy)
      .toEqual(["Hurtowa"]);
  });
});

describe("co stoi na osi, a co obok", () => {
  it("brak brutto (0 i null) i inna waluta idą poza oś", () => {
    const ceny = [c(0, "", 0, 1864), c(1, "Detaliczna", 4996, 4062), c(2, "Zakup", null, 1500),
      c(3, "Eksport", 1200, 975, "EUR")];
    const u = naOsi(ulozOsCen(ceny, of(4500), 350, mierz));
    expect(u.punkty.map((p) => p.id)).toEqual(["p1", "oferta"]);
    expect(u.pozaOsia.map((g) => g.cena.poziom)).toEqual([0, 2, 3]);
  });

  it("poziomy o tej samej cenie dzielą jedną kropkę z pełnymi nazwami", () => {
    const u = naOsi(ulozOsCen(ZESTAWY.D2.ceny, ZESTAWY.D2.oferta, 350, mierz));
    const grupa = u.punkty.filter((p) => p.rodzaj === "poziom" && p.grosze === 6499);
    expect(grupa).toHaveLength(1);
    expect(grupa[0].nazwa).toBe("Detaliczna i 1 inny");
    expect(grupa[0].nazwy).toEqual(["Detaliczna", "Allegro"]);
    /* Poziom w pierścieniu oferty i oferta to jedno miejsce, oferta pierwsza. */
    expect(wspolneMiejsce(u, grupa[0].id).map((p) => p.id)).toEqual(["oferta", grupa[0].id]);
  });
});

describe("kiedy blok zostaje listą", () => {
  it("bez oferty i przy ofercie w innej walucie", () => {
    expect(ulozOsCen(ZESTAWY.D1.ceny, null, 350, mierz).tryb).toBe("lista");
    expect(ulozOsCen(ZESTAWY.D1.ceny, of(5405, "EUR"), 350, mierz).tryb).toBe("lista");
  });

  it("czternaście poziomów w 120 px: lista, nie nachodzące napisy", () => {
    const ceny = Array.from({ length: 14 }, (_, i) => c(i + 1, `Poziom numer ${i + 1}`, 3000 + i * 137, 2400 + i * 111));
    const u = ulozOsCen(ceny, of(4100), 120, mierz);
    expect(u.tryb).toBe("lista");
    expect(u.polozenie?.zdanie).toMatch(/Oferta/);
  });
});

describe("trafienie wskaźnika", () => {
  const u = naOsi(ulozOsCen(ZESTAWY.D1.ceny, ZESTAWY.D1.oferta, 350, mierz));

  it("punkt w etykiecie oddaje jej id", () => {
    for (const e of u.etykiety) {
      expect(trafienie(u, e.lewo + e.szer / 2, e.gora + e.wys / 2)).toBe(e.punkt.id);
    }
  });

  it("puste miejsce oddaje najbliższy znacznik w poziomie", () => {
    /* Na wysokości osi nie stoi żadna etykieta: pas zaczyna się 10 px dalej. */
    const bazowa = u.punkty.find((p) => p.nazwa === "Bazowa");
    expect(trafienie(u, (bazowa?.x ?? 0) + 2, u.osY)).toBe(bazowa?.id);
  });

  it("w połowie między ofertą a poziomem wygrywa oferta", () => {
    const oferta = u.punkty.find((p) => p.rodzaj === "oferta");
    const detaliczna = u.punkty.find((p) => p.nazwa === "Detaliczna");
    const srodek = ((oferta?.x ?? 0) + (detaliczna?.x ?? 0)) / 2;
    expect(trafienie(u, srodek, u.osY)).toBe("oferta");
  });
});

it("układ jest deterministyczny", () => {
  for (const d of Object.keys(ZESTAWY)) {
    for (const w of SZEROKOSCI) {
      expect(ulozOsCen(ZESTAWY[d].ceny, ZESTAWY[d].oferta, w, mierz))
        .toEqual(ulozOsCen(ZESTAWY[d].ceny, ZESTAWY[d].oferta, w, mierz));
    }
  }
});

/* ── CENA ZAKUPU NA OSI (reklamacje) ─────────────────────────────────────────
   Zielony romb „Kupił za …” stoi na tej samej skali co poziomy i oferta.
   Pilnujemy, że skala go obejmuje, że etykiety dalej nie nachodzą i że oś
   rysuje się także bez oferty. Bez zakupu wszystko zostaje jak dotąd.     */
const ZAKUPY: Record<string, { grosze: number; waluta: string }> = {
  D1: of(4500), D2: of(6000), D3: of(4500), D4: of(2906), D5: of(1999), D6: of(17900),
};

describe("cena zakupu na osi", () => {
  const przypadki = Object.keys(ZESTAWY).flatMap((d) => SZEROKOSCI.map((w) => ({ d, w })));
  it.each(przypadki)("$d z zakupem przy $w px: bez kolizji albo lista", ({ d, w }) => {
    const u = ulozOsCen(ZESTAWY[d].ceny, ZESTAWY[d].oferta, w, mierz, ZAKUPY[d]);
    /* Układ niewykonalny w wąskiej kolumnie wolno oddać listą — nachodzić nie wolno. */
    if (u.tryb === "lista") return;
    expect(naruszenia(u)).toEqual([]);
    expect(u.punkty.filter((p) => p.rodzaj === "zakup")).toHaveLength(1);
  });

  it("zakup niesie kwotę w etykiecie, bo w reklamacji nie ma karty zakupu", () => {
    const u = naOsi(ulozOsCen(ZESTAWY.D1.ceny, ZESTAWY.D1.oferta, 350, mierz, ZAKUPY.D1));
    const zakup = u.punkty.find((p) => p.rodzaj === "zakup");
    expect(zakup).toMatchObject({ id: "zakup", nazwa: "Kupił za", kwota: "45,00" });
  });

  it("skala obejmuje zakup: tańszy od wszystkiego stoi na lewym brzegu", () => {
    const u = naOsi(ulozOsCen(ZESTAWY.D1.ceny, ZESTAWY.D1.oferta, 350, mierz, of(2000)));
    expect(u.punkty.find((p) => p.rodzaj === "zakup")?.x).toBe(10);
    expect(u.min).toBe(2000);
  });

  it("oś rysuje się także bez oferty, gdy jest zakup", () => {
    const u = naOsi(ulozOsCen(ZESTAWY.D1.ceny, null, 350, mierz, ZAKUPY.D1));
    expect(u.punkty.some((p) => p.rodzaj === "oferta")).toBe(false);
    expect(u.punkty.some((p) => p.rodzaj === "zakup")).toBe(true);
    expect(u.polozenie.zdanie).toBe("Klient zapłacił 45,00 PLN.");
  });

  it("zdanie pod osią zaczyna się od ceny zakupu, a potem mówi o ofercie", () => {
    const u = naOsi(ulozOsCen(ZESTAWY.D4.ceny, ZESTAWY.D4.oferta, 350, mierz, ZAKUPY.D4));
    expect(u.polozenie.zdanie).toMatch(/^Klient zapłacił 29,06 PLN\. Oferta stoi /);
  });

  it("zakup w innej walucie nie staje na osi, ale zostaje w zdaniu", () => {
    const u = naOsi(ulozOsCen(ZESTAWY.D1.ceny, ZESTAWY.D1.oferta, 350, mierz, of(4500, "EUR")));
    expect(u.punkty.some((p) => p.rodzaj === "zakup")).toBe(false);
    expect(u.polozenie.zdanie).toMatch(/^Klient zapłacił 45,00 EUR\./);
    expect(ulozOsCen(ZESTAWY.D1.ceny, null, 350, mierz, of(4500, "EUR")).tryb).toBe("lista");
  });

  it("zakup po cenie z cennika i oferty — trzy znaczniki w jednym miejscu dalej dają oś", () => {
    /* Najczęstsza reklamacja: klient kupił po detalicznej, a oferta się nie
       zmieniła. Ogonek zakupu zaczyna się za płytszą etykietą tego miejsca. */
    const ceny = [c(1, "Detaliczna", 18900, 15366), c(2, "Hurtowa", 13900, 11301), c(3, "Specjalna", 15900, 12927)];
    for (const w of [335, 350, 414]) {
      const u = naOsi(ulozOsCen(ceny, of(18900), w, mierz, of(18900)));
      expect(naruszenia(u), `${w}`).toEqual([]);
      const zakup = u.etykiety.find((e) => e.punkt.rodzaj === "zakup")!;
      const start = poczatekOgonka(u, zakup, zakup.strona < 0 ? u.osY - 7 : u.osY + 7);
      const plytsze = u.etykiety.filter((f) => f !== zakup && f.strona === zakup.strona && f.pas < zakup.pas
        && Math.abs(f.punkt.x - zakup.punkt.x) < 1.5);
      for (const f of plytsze) {
        expect(zakup.strona > 0 ? start >= f.gora + f.wys : start <= f.gora, `${w}: ogonek przez etykietę`).toBe(true);
      }
    }
  });

  it("bez zakupu układ jest dokładnie taki jak dotąd", () => {
    for (const d of ["D1", "D2", "D6"]) {
      expect(ulozOsCen(ZESTAWY[d].ceny, ZESTAWY[d].oferta, 350, mierz, null))
        .toEqual(ulozOsCen(ZESTAWY[d].ceny, ZESTAWY[d].oferta, 350, mierz));
    }
  });
});
