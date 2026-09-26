import { describe, expect, it } from "vitest";
import type { HistoriaKlienta, OsRozmowy, WiedzaDoboru } from "../api/typy";
import { bramkaDoboru, coSwieci, klientMaHistorie, nowyKlient, towarOtwartyNaStart, towarZnany, wiedzaMaTresc }
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
  dobor: { status: "not_started", wersja: 1, brakuje: null, wybrany: null, updatedBy: null, updatedAt: null,
    dane: { marka: null, model: null, wariant: null, rocznik: null, nrSeryjny: null, silnik: null,
      oem: null, nazwaCzesci: null, parametry: {} } },
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

  it("zwrot i sprawa zwijają kartę towaru, dobór jej nie zwija", () => {
    expect(towarOtwartyNaStart(["zwrot"])).toBe(false);
    expect(towarOtwartyNaStart(["sprawa"])).toBe(false);
    expect(towarOtwartyNaStart(["dobor", "paczka"])).toBe(true);
  });

  it("paczka świeci przy awizo, problemie i powrocie — nie w drodze i nie po doręczeniu", () => {
    const z = (status: string, dostarczonoAt: string | null = null) => dane({ zamowienie: zamowienie({
      przesylka: { waybill: null, przewoznik: null, status, dostarczonoAt, sprawdzonoAt: null } }) });
    for (const s of ["NOTICE_LEFT", "ISSUE", "RETURNED"]) expect(coSwieci(z(s))).toEqual(["paczka"]);
    expect(coSwieci(z("IN_TRANSIT"))).toEqual([]);
    expect(coSwieci(z("ISSUE", "2026-09-25T10:00:00Z"))).toEqual([]);
  });

  /* Soczewka paczki (@wydanie) stoi nad „Wymaga Ciebie" i mówi o awizo sama.
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

  it("dobór w toku świeci; nierozpoczęty i zatwierdzony nie", () => {
    const d = (status: string) => dane({ dobor: { ...dane().dobor, status } as never });
    expect(coSwieci(d("searching"))).toEqual(["dobor"]);
    expect(coSwieci(d("candidates_found"))).toEqual(["dobor"]);
    expect(coSwieci(d("not_started"))).toEqual([]);
    expect(coSwieci(d("confirmed"))).toEqual([]);
  });
});

describe("bramka doboru", () => {
  const zZamowienia = (n: Partial<OsRozmowy["dobor"]> = {}) => dane({
    zamowienie: zamowienie(),
    oferta: { ...dane().oferta!, zrodlo: "zamowienie" },
    dobor: { ...dane().dobor, status: "searching", updatedBy: "automat (szkic)", ...n },
  });

  it("oferta z jedynej pozycji zamówienia to towar znany — dobór automatu gaśnie", () => {
    expect(towarZnany(zZamowienia())).toBe(true);
    expect(bramkaDoboru(zZamowienia())).toBe(true);
    expect(coSwieci(zZamowienia())).toEqual([]);
  });

  it("oferta wskazana ręcznie, ale będąca pozycją zamówienia, też jest znana", () => {
    const d = dane({ zamowienie: zamowienie({ pobrane: { pozycje: [{ offerId: "111" }] } }),
      oferta: { ...dane().oferta!, zrodlo: "reczne" } });
    expect(towarZnany(d)).toBe(true);
  });

  it("oferta spoza zamówienia i rozmowa bez zamówienia — towar nieznany", () => {
    expect(towarZnany(dane())).toBe(false);
    expect(towarZnany(dane({ zamowienie: zamowienie({ pobrane: { pozycje: [{ offerId: "999" }] } }) }))).toBe(false);
  });

  it("wybór agenta wygrywa z bramką", () => {
    expect(towarZnany(zZamowienia({ wybrany: { twId: 1, symbol: "X" } as never }))).toBe(false);
  });

  it("dobór w toku uruchomiony przez człowieka zostaje na wierzchu", () => {
    const d = zZamowienia({ updatedBy: "A. Lewandowska" });
    expect(bramkaDoboru(d)).toBe(false);
    expect(coSwieci(d)).toEqual(["dobor"]);
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

/* ── Puste wiersze znikają (@wydanie, decyzja właściciela z 26 września) ──
   Para przy każdej regule: stan, w którym wiersz gaśnie, i stan, w którym
   MUSI stanąć. Reguła gasząca wszystko schowałaby klienta z historią. */
describe("puste wiersze Klient i Wiedza", () => {
  const h = (n: Partial<HistoriaKlienta> = {}): HistoriaKlienta => ({ login: "pasikonik5", wpisy: [], maszyny: [], ...n });

  it("Klient staje z historią albo maszyną; bez nich i przed odczytem — nie", () => {
    expect(klientMaHistorie(undefined)).toBe(false);
    expect(klientMaHistorie(h())).toBe(false);
    expect(klientMaHistorie(h({ wpisy: [{ rodzaj: "zakup" } as never] }))).toBe(true);
    expect(klientMaHistorie(h({ maszyny: [{ marka: "NAC" } as never] }))).toBe(true);
  });

  it("„nowy klient” tylko przy znanym loginie bez historii — bez loginu nie wiemy, kto pisze", () => {
    expect(nowyKlient(h())).toBe(true);
    expect(nowyKlient(h({ login: null }))).toBe(false);
    expect(nowyKlient(h({ wpisy: [{ rodzaj: "rozmowa" } as never] }))).toBe(false);
    expect(nowyKlient(undefined)).toBe(false);
  });

  it("Wiedza staje z zastosowaniem albo pomiarem; pusta i przed odczytem — nie", () => {
    const w = (n: Partial<WiedzaDoboru> = {}) => ({ zastosowanie: null, zabudowa: null, pasowanie: null,
      silniki: [], silnikZPola: null, pomiary: [], ...n }) as WiedzaDoboru;
    expect(wiedzaMaTresc(undefined)).toBe(false);
    expect(wiedzaMaTresc(w())).toBe(false);
    expect(wiedzaMaTresc(w({ pomiary: [{ zadanieId: 1 } as never] }))).toBe(true);
    expect(wiedzaMaTresc(w({ zastosowanie: { dowody: [] } as never }))).toBe(true);
  });
});
