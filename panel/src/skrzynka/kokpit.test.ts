import { describe, expect, it } from "vitest";
import type { HistoriaKlienta, OsRozmowy } from "../api/typy";
import { coSwieci, historiaPozaZakupem, historiaWierszaKlienta, klientMaHistorie, klientWKolumnie, nowyKlient,
  ofertaWKarcie, paczkaWyzej, pozycjeWKolumnie, towarOtwartyNaStart }
  from "./kokpit";

/* ── Reguły ciemnego kokpitu (0.498.0) ──────────────────────────────────────
   Szara linia jest bezpieczna tylko wtedy, gdy reguła „w normie" nie kłamie.
   Dlatego każda reguła ma tu parę: stan, w którym gaśnie, i stan, w którym
   MUSI się zapalić. Test tylko z pierwszej połowy przepuściłby regułę, która
   gasi wszystko.                                                            */

const dane = (n: Partial<OsRozmowy> = {}): OsRozmowy => ({
  rozmowa: { kopilot: null }, zwroty: [], sprawy: [], zamowienie: null, kandydaciZamowien: [],
  oferta: { externalId: "111", link: null, zrodlo: "wiadomosc", zgodnosc: null, pobrana: null,
    kartoteka: { pewnosc: "brak", twId: null, symbol: null, zrodlo: "—", powod: null } },
  ...n,
} as unknown as OsRozmowy);

const zamowienie = (n: Record<string, unknown> = {}) => ({
  externalId: "z1", link: null, przesylka: null, pobrane: null, ...n,
}) as OsRozmowy["zamowienie"];

describe("co świeci w kolumnie kontekstu", () => {
  it("spokojna rozmowa nie świeci niczym, a towar stoi otwarty", () => {
    expect(coSwieci(dane())).toEqual([]);
    expect(towarOtwartyNaStart([])).toBe(true);
  });

  it("zwrot świeci, dopóki ktoś u nas ma ruch; zamknięty i odrzucony gasną", () => {
    for (const kubelek of ["decyzja", "ocena", "zwrot", "korekta"]) {
      expect(coSwieci(dane({ zwroty: [{ kubelek } as never] }))).toEqual(["zwrot"]);
    }
    for (const kubelek of ["zamkniety", "odrzucony"]) {
      expect(coSwieci(dane({ zwroty: [{ kubelek } as never] }))).toEqual([]);
    }
  });

  it("otwarta reklamacja albo dyskusja świeci, zamknięta nie", () => {
    expect(coSwieci(dane({ sprawy: [{ otwarta: true } as never] }))).toEqual(["sprawa"]);
    expect(coSwieci(dane({ sprawy: [{ otwarta: false } as never] }))).toEqual([]);
  });

  it("zwrot i sprawa zwijają kartę towaru, paczka i pozycja jej nie zwijają", () => {
    expect(towarOtwartyNaStart(["zwrot"])).toBe(false);
    expect(towarOtwartyNaStart(["sprawa"])).toBe(false);
    expect(towarOtwartyNaStart(["pozycja", "paczka"])).toBe(true);
  });

  it("paczka świeci przy awizo, problemie i powrocie — nie w drodze i nie po doręczeniu", () => {
    const z = (status: string, dostarczonoAt: string | null = null) => dane({ zamowienie: zamowienie({
      przesylka: { waybill: null, przewoznik: null, status, dostarczonoAt, sprawdzonoAt: null } }) });
    for (const s of ["NOTICE_LEFT", "ISSUE", "RETURNED"]) expect(coSwieci(z(s))).toEqual(["paczka"]);
    expect(coSwieci(z("IN_TRANSIT"))).toEqual([]);
    expect(coSwieci(z("ISSUE", "2026-09-25T10:00:00Z"))).toEqual([]);
  });

  /* Soczewka paczki (0.531.0) stoi nad „Wymaga Ciebie" i mówi o awizo sama.
     Para jak wszędzie tutaj: przy pytaniu o towar awizo dalej musi świecić. */
  it("awizo nie świeci drugi raz, gdy paczkę pokazuje soczewka", () => {
    const z = (kategoria: string) => dane({
      rozmowa: { kopilot: { kategoria, dodatkowe: [], zrodlo: "MODEL", status: "SUCCESS",
        nieaktualna: false, kategoriaCzlowieka: null } } as never,
      zamowienie: zamowienie({ przesylka: { waybill: "X1", przewoznik: "DPD", status: "NOTICE_LEFT",
        dostarczonoAt: null, sprawdzonoAt: "2026-09-25T10:00:00Z" } }) });
    expect(coSwieci(z("DELIVERY_DELAY"))).toEqual([]);
    expect(coSwieci(z("PRODUCT_QUESTION"))).toEqual(["paczka"]);
  });

  it("zamówienie z kilku pozycji bez wskazanej oferty świeci; z jedną — nie", () => {
    const pobrane = (n: number) => ({ pozycje: Array.from({ length: n }, (_, i) => ({ offerId: String(i) })) });
    expect(coSwieci(dane({ oferta: null, zamowienie: zamowienie({ pobrane: pobrane(2) }) }))).toEqual(["pozycja"]);
    expect(coSwieci(dane({ oferta: null, zamowienie: zamowienie({ pobrane: pobrane(1) }) }))).toEqual([]);
  });
});

/* ── Karta towaru otwarta tylko przy pytaniu o towar (0.506.0) ─────────────
   Zgłoszenie agenta: „przytłacza". Przy zwrocie, dostawie czy fakturze karta
   oferty z cenami i EAN stała otwarta, choć pasmo mówiło już nazwę i stan. */
describe("karta towaru na starcie według rodzaju pytania", () => {
  it("otwarta przy pytaniu o towar i bez rozpoznania; zwinięta przy zwrocie, dostawie, fakturze", () => {
    expect(towarOtwartyNaStart([], "PRODUCT_COMPATIBILITY")).toBe(true);
    expect(towarOtwartyNaStart([], null)).toBe(true);
    expect(towarOtwartyNaStart([], "RETURN")).toBe(false);
    expect(towarOtwartyNaStart([], "DELIVERY_DELAY")).toBe(false);
    expect(towarOtwartyNaStart([], "INVOICE")).toBe(false);
    expect(towarOtwartyNaStart(["zwrot"], "PRODUCT_QUESTION")).toBe(false);
  });
});

/* ── Puste wiersze znikają (0.531.0, decyzja właściciela z 26 września) ──
   Para przy każdej regule: stan, w którym wiersz gaśnie, i stan, w którym
   MUSI stanąć. Reguła gasząca wszystko schowałaby klienta z historią. */
describe("pusty wiersz Klient", () => {
  const h = (n: Partial<HistoriaKlienta> = {}): HistoriaKlienta => ({ login: "pasikonik5", wpisy: [], ...n });

  it("Klient staje z historią; bez niej i przed odczytem — nie", () => {
    expect(klientMaHistorie(undefined)).toBe(false);
    expect(klientMaHistorie(h())).toBe(false);
    expect(klientMaHistorie(h({ wpisy: [{ rodzaj: "zakup" } as never] }))).toBe(true);
  });

  it("„nowy klient” tylko przy znanym loginie bez historii — bez loginu nie wiemy, kto pisze", () => {
    expect(nowyKlient(h())).toBe(true);
    expect(nowyKlient(h({ login: null }))).toBe(false);
    expect(nowyKlient(h({ wpisy: [{ rodzaj: "rozmowa" } as never] }))).toBe(false);
    expect(nowyKlient(undefined)).toBe(false);
  });
});

/* ── Jeden dom faktu ─────────────────────────────────────────────────────────
   Karta zakupu nad osią mówi zakup i klienta, kolumna mówi Subiekt, paczkę
   i robotę. Te reguły rozstrzygają, kiedy kolumna fakt pokazuje, a kiedy
   oddaje go karcie. Para jak wszędzie tutaj: stan, w którym fakt schodzi,
   i stan, w którym MUSI zostać, bo nie ma innego domu. */
describe("historia bez tego zakupu", () => {
  const wpis = (rodzaj: string, zamowienieId: string | null) =>
    ({ rodzaj, at: "2026-09-01T10:00:00Z", tresc: "x", zamowienieId, link: null, rozmowaId: null, sprawaId: null }) as never;
  const sprawa = { id: 5, stan: "w_toku" } as never;
  const h = (n: Partial<HistoriaKlienta> = {}): HistoriaKlienta => ({ login: "pasikonik5", wpisy: [], ...n });

  it("wycina zakup, zwrot, reklamację i dyskusję tego zamówienia; resztę zostawia", () => {
    const pelna = h({
      wpisy: [wpis("zakup", "z"), wpis("zwrot", "z"), wpis("reklamacja", "z"), wpis("dyskusja", "z"),
        wpis("rozmowa", null), wpis("zakup", "inne"), wpis("rozmowa", "z")],
      sprawa,
    });
    const poza = historiaPozaZakupem(pelna, "z")!;
    /* Rozmowa z numerem tego zamówienia też zostaje. Serwer daje dziś
       rozmowom pusty numer, a reguła ma przetrwać dzień, w którym zacznie
       go podawać: inna rozmowa to wcześniejszy kontakt, nie ten zakup. */
    expect(poza.wpisy.map((w) => `${w.rodzaj}:${w.zamowienieId}`))
      .toEqual(["rozmowa:null", "zakup:inne", "rozmowa:z"]);
    expect(poza.login).toBe("pasikonik5");
    expect(poza.sprawa).toBe(sprawa);
  });

  it("bez numeru zamówienia oddaje to samo, bez historii — nic", () => {
    const pelna = h({ wpisy: [wpis("zakup", "z")] });
    expect(historiaPozaZakupem(pelna, null)).toBe(pelna);
    expect(historiaPozaZakupem(undefined, "z")).toBeUndefined();
  });

  it("„nowy klient” przy jedynym zakupie tym właśnie zakupem; przy innym — nie", () => {
    expect(nowyKlient(historiaPozaZakupem(h({ wpisy: [wpis("zakup", "z")] }), "z"))).toBe(true);
    expect(nowyKlient(historiaPozaZakupem(h({ wpisy: [wpis("zakup", "inne")] }), "z"))).toBe(false);
  });

  it("wiersz Klient: bez historii i z samym tym zakupem nie staje; z innym wpisem albo sprawą — staje", () => {
    expect(klientWKolumnie(undefined, "z")).toBe(false);
    expect(klientWKolumnie(h({ wpisy: [wpis("zakup", "z")] }), "z")).toBe(false);
    expect(klientWKolumnie(h({ wpisy: [wpis("zakup", "z"), wpis("rozmowa", null)] }), "z")).toBe(true);
    /* Bez loginu historii nie ma, ale sprawa klienta tak — rozmowa ma do niej odsyłać. */
    expect(klientWKolumnie(h({ login: null, sprawa }), "z")).toBe(true);
  });

  /* Para: zakup z listy schodzi z historii tylko przy OTWARTEJ liście (bez
     zamówienia rozmowy). Przy zamówieniu lista stoi za „to nie ta paczka?",
     a zakup wycięty z historii nie stałby nigdzie na widoku. */
  it("historia wiersza bez zamówienia wycina zakupy z listy, zostawia ich zwroty i rozmowy", () => {
    const pelna = h({ wpisy: [wpis("zakup", "inne"), wpis("zwrot", "inne"), wpis("rozmowa", null)] });
    const naLiscie = new Set(["inne"]);
    expect(historiaWierszaKlienta(pelna, null, naLiscie)!.wpisy.map((w) => w.rodzaj)).toEqual(["zwrot", "rozmowa"]);
    expect(historiaWierszaKlienta(pelna, "z", naLiscie)!.wpisy.map((w) => w.rodzaj))
      .toEqual(["zakup", "zwrot", "rozmowa"]);
    expect(historiaWierszaKlienta(pelna, null)).toBe(pelna);
  });

  it("wiersz Klient nie staje dla samych zakupów z otwartej listy; przy zamówieniu staje", () => {
    const tylkoInny = h({ wpisy: [wpis("zakup", "inne")] });
    expect(klientWKolumnie(tylkoInny, null, new Set(["inne"]))).toBe(false);
    expect(klientWKolumnie(tylkoInny, "z", new Set(["inne"]))).toBe(true);
  });
});

describe("paczka nad wierszem „Zamówienie”", () => {
  const przesylka = (status: string) =>
    ({ waybill: "X1", przewoznik: "DPD", status, dostarczonoAt: null, sprawdzonoAt: "2026-09-25T10:00:00Z" });
  const z = (status: string, kategoria: string | null = null) => dane({
    rozmowa: { kopilot: kategoria === null ? null : { kategoria, dodatkowe: [], zrodlo: "MODEL", status: "SUCCESS",
      nieaktualna: false, kategoriaCzlowieka: null } } as never,
    zamowienie: zamowienie({ przesylka: przesylka(status) }) });

  it("stoi wyżej w soczewce paczki i przy odchyleniu; zwykła droga zostaje w wierszu", () => {
    expect(paczkaWyzej(z("IN_TRANSIT", "DELIVERY_DELAY"))).toBe(true);
    expect(paczkaWyzej(z("NOTICE_LEFT"))).toBe(true);
    expect(paczkaWyzej(z("IN_TRANSIT"))).toBe(false);
  });
});

describe("pozycje zamówienia w kolumnie", () => {
  const pobrane = (...ids: Array<string | null>) => ({ pozycje: ids.map((offerId) => ({ offerId })) });

  it("bez treści i przy jedynej pozycji będącej ofertą — nie; przy kilku albo innej — tak", () => {
    expect(pozycjeWKolumnie(dane({ zamowienie: zamowienie() }))).toBe(false);
    expect(pozycjeWKolumnie(dane({ zamowienie: zamowienie({ pobrane: pobrane("111") }) }))).toBe(false);
    expect(pozycjeWKolumnie(dane({ zamowienie: zamowienie({ pobrane: pobrane("111", "222") }) }))).toBe(true);
    expect(pozycjeWKolumnie(dane({ zamowienie: zamowienie({ pobrane: pobrane("999") }) }))).toBe(true);
  });
});

describe("oferta w karcie zakupu", () => {
  const pobrana = { nazwa: "Nóż", sku: "N1", cenaGrosze: 4500, waluta: "PLN", status: "ACTIVE",
    syncedAt: "2026-09-01T10:00:00Z", zdjecie: "brak" as const };
  const zOferta = (n: Partial<NonNullable<OsRozmowy["oferta"]>>) => ({ ...dane().oferta!, ...n });

  it("bez oferty nie; bez zamówienia — gdy treść oferty pobrana", () => {
    expect(ofertaWKarcie(dane({ oferta: null }))).toBe(false);
    expect(ofertaWKarcie(dane({ oferta: zOferta({ pobrana }) }))).toBe(true);
    expect(ofertaWKarcie(dane({ zamowienie: zamowienie() }))).toBe(false);
  });

  it("z pozycjami — tylko gdy oferta jest jedną z nich", () => {
    expect(ofertaWKarcie(dane({ zamowienie: zamowienie({ pobrane: { pozycje: [{ offerId: "111" }] } }) }))).toBe(true);
    expect(ofertaWKarcie(dane({ oferta: zOferta({ pobrana }),
      zamowienie: zamowienie({ pobrane: { pozycje: [{ offerId: "999" }] } }) }))).toBe(false);
  });
});
