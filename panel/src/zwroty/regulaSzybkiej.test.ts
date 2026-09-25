import { describe, expect, it } from "vitest";
import { calaDostawa, szybkaSciezka } from "./regulaSzybkiej";
import type { PozycjaZwrotu, Zwrot } from "../api/typy";

/* ── Reguła szybkiej ścieżki (0.481.0) ────────────────────────────────────
   Ścieżka puszcza kilka zapisów i wypłatę naraz, więc każdy przypadek, który
   wymaga człowieka, musi ją zatrzymać PRZED pierwszym zapisem. Te testy
   pilnują listy takich przypadków. */

const POZ = (n: Partial<PozycjaZwrotu> = {}): PozycjaZwrotu => ({
  id: 1, zrodlo: "allegro", offerId: "1", ofertaZamowienia: null, ofertaZdjecie: "nieznane",
  nazwa: "Sekator", ilosc: 1, cenaGrosze: 4999, waluta: "PLN", powod: null, powodKomentarz: null,
  ocena: null, wKoszyku: false, iloscZwrocona: null, url: null, twId: 10, twSymbol: "SEK",
  twZrodlo: "sku", sku: null, ean: null, potracenieGrosze: null, potraceniePowod: null,
  propozycja: null,
  rabat: { stan: "brak", lineItemId: "li-1", ilosc: 1, wniosekId: null,
    prowizjaGrosze: null, waluta: null, typ: null, powod: null, zrodlo: null },
  ...n,
});

const ZW = (n: Partial<Zwrot> = {}): Zwrot => ({
  id: 5, kubelek: "decyzja", werdykt: null, kwotaGrosze: null, zrodlo: "allegro",
  linkZwrotu: "https://salescenter.allegro.com/returns?q=Z", zamowienie: null,
  pozycje: [POZ()], sygnaly: [], ...n,
} as unknown as Zwrot);

const przeszkoda = (z: Zwrot, pudla: Parameters<typeof szybkaSciezka>[1] = []) => {
  const s = szybkaSciezka(z, pudla);
  return s.pokaz ? s.przeszkoda : "UKRYTA";
};

describe("szybka ścieżka zwrotu", () => {
  it("typowy zwrot przechodzi bez przeszkód", () => {
    expect(przeszkoda(ZW())).toBeNull();
    expect(przeszkoda(ZW({ kubelek: "ocena", werdykt: "przyjety" }))).toBeNull();
    expect(przeszkoda(ZW({ kubelek: "zwrot", werdykt: "przyjety",
      pozycje: [POZ({ ocena: "stan", wKoszyku: true })] }))).toBeNull();
  });

  it("znika tam, gdzie nie ma czego skracać", () => {
    /* Kwota zapisana, zwrot zamknięty albo odrzucony, paczka nieodebrana
       (bez zwrotu w Allegro nie ma gdzie oddać pieniędzy). */
    expect(przeszkoda(ZW({ kubelek: "zwrot", kwotaGrosze: 4999 }))).toBe("UKRYTA");
    expect(przeszkoda(ZW({ kubelek: "korekta" }))).toBe("UKRYTA");
    expect(przeszkoda(ZW({ kubelek: "odrzucony", werdykt: "odrzucony" }))).toBe("UKRYTA");
    expect(przeszkoda(ZW({ zrodlo: "nieodebrana" }))).toBe("UKRYTA");
  });

  it("paczka, która nie wróciła, zatrzymuje — a nieodesłana chowa przycisk (0.505.0)", () => {
    /* Zgłoszenie właściciela przy 5ZRQ/2026: „na półkę i oddaj" za filtr,
       który nigdy nie przyjechał. */
    expect(przeszkoda(ZW({ sygnaly: ["brak_dowodu"] }))).toMatch(/nie wróciła/);
    expect(przeszkoda(ZW({ sygnaly: ["nie_odeslany"] }))).toBe("UKRYTA");
  });

  it("nie puszcza zwrotu, który odbiega od zamówienia", () => {
    expect(przeszkoda(ZW({ pozycje: [POZ({ ocena: "utylizacja" })] }))).toMatch(/inną ocenę/);
    expect(przeszkoda(ZW({ pozycje: [POZ({ potracenieGrosze: 100 })] }))).toMatch(/potrącenie/);
    expect(przeszkoda(ZW({ pozycje: [POZ({ ilosc: 2, iloscZwrocona: 1 })] }))).toMatch(/brak sztuk/);
    expect(przeszkoda(ZW({ pozycje: [] }))).toMatch(/bez pozycji/);
    expect(przeszkoda(ZW({ linkZwrotu: null }))).toMatch(/odnośnika/);
  });

  it("pozycja „na stan” spoza pudła zatrzymuje — ciąg by ją pominął (0.484.2)", () => {
    expect(przeszkoda(ZW({ kubelek: "ocena", werdykt: "przyjety",
      pozycje: [POZ({ ocena: "stan", wKoszyku: false })] }))).toMatch(/nie leży w pudle/);
    expect(przeszkoda(ZW({ kubelek: "ocena", werdykt: "przyjety",
      pozycje: [POZ({ ocena: "stan", wKoszyku: true })] }))).toBeNull();
  });

  it("kartoteka: pewna propozycja wystarcza, zgadywana zatrzymuje", () => {
    const prop = (pewnosc: "sku" | "jedyna_pozycja") =>
      ({ pewnosc, twId: 10, symbol: "SEK", zrodlo: "x", powod: null, poKolumnie: null });
    expect(przeszkoda(ZW({ pozycje: [POZ({ twId: null, propozycja: prop("sku") })] }))).toBeNull();
    expect(przeszkoda(ZW({ pozycje: [POZ({ twId: null, propozycja: prop("jedyna_pozycja") })] })))
      .toMatch(/nie ma pewnej kartoteki/);
    expect(przeszkoda(ZW({ pozycje: [POZ({ twId: null })] }))).toMatch(/Sekator/);
  });

  it("pudła nie zgaduje — przy kilku otwartych bierze tylko to z tym zwrotem", () => {
    const pudlo = (zwrotId: number | null) => ({ rodzaj: "zwroty", pozycje: zwrotId ? [{ zwrotId }] : [] });
    expect(przeszkoda(ZW(), [pudlo(null)])).toBeNull();
    expect(przeszkoda(ZW(), [pudlo(null), pudlo(null)])).toMatch(/Kilka otwartych pudeł/);
    expect(przeszkoda(ZW(), [pudlo(5), pudlo(null)])).toBeNull();
    /* Odpad nie liczy się do wyboru — ścieżka ocenia wyłącznie „na stan". */
    expect(przeszkoda(ZW(), [pudlo(null), { rodzaj: "odpad", pozycje: [] }])).toBeNull();
    /* Wszystko ocenione — pudło nie jest już potrzebne. */
    expect(przeszkoda(ZW({ pozycje: [POZ({ ocena: "stan", wKoszyku: true })] }),
      [pudlo(null), pudlo(null)])).toBeNull();
  });

  it("dostawa wraca tylko przy zwrocie CAŁEGO zamówienia", () => {
    const zam = (wraca: number) => ({ pozycje: [{ zwracana: wraca > 0, wracaIlosc: wraca, ilosc: 2 }] });
    expect(calaDostawa(ZW({ zamowienie: zam(2) as unknown as Zwrot["zamowienie"] }))).toBe(true);
    expect(calaDostawa(ZW({ zamowienie: zam(1) as unknown as Zwrot["zamowienie"] }))).toBe(false);
    expect(calaDostawa(ZW())).toBe(false);
  });
});
