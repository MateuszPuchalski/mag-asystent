import { describe, expect, it } from "vitest";
import type { StanPrzesylki, SzczegolReklamacji, Zwrot } from "../api/typy";
import { PLAKIETKA_PRZESYLKI, plakietkaKodu, zdarzeniaPrzesylek } from "./przesylki";

/* ── Przesyłki na osi rozmowy ────────────────────────────────────────────────
   Pilnujemy trzech rzeczy: kierunku paczki, plakietki z kodu schematu Allegro
   i chwili, w której wpis staje na osi. Brak danych zostaje brakiem — kod
   spoza schematu nie dostaje plakietki, a dosyłka bez daty nie dostaje daty. */

/* Fikstura niesie tylko pola, które czyta `zdarzeniaPrzesylek`; reszty
   sprawy ten plik nie dotyka, więc jej tu nie ma. */
const zwrot = (n: Partial<Zwrot> = {}): Zwrot => ({
  id: 7, utworzono: "2026-09-29T08:00:00.000Z", paczkaAt: null, dostarczonoAt: null,
  przesylkaStatus: null, waybill: null, przewoznik: null, zrodlo: "allegro", ...n,
}) as Zwrot;

const sprawa = (zwroty: Zwrot[], przesylka: Partial<StanPrzesylki> | null = null) => ({
  zwroty,
  przesylka: przesylka && {
    waybill: null, przewoznik: null, status: null, dostarczonoAt: null, sprawdzonoAt: null, ...przesylka,
  },
}) as unknown as SzczegolReklamacji;

describe("plakietka z kodu ParcelTrackingStatus", () => {
  it("osiem kodów schematu dzieli się na sześć plakietek makiety", () => {
    expect(plakietkaKodu("PENDING")).toBe("przygotowana");
    expect(plakietkaKodu("IN_TRANSIT")).toBe("w_drodze");
    expect(plakietkaKodu("RELEASED_FOR_DELIVERY")).toBe("w_drodze");
    expect(plakietkaKodu("AVAILABLE_FOR_PICKUP")).toBe("czeka_na_odbior");
    expect(plakietkaKodu("NOTICE_LEFT")).toBe("czeka_na_odbior");
    expect(plakietkaKodu("DELIVERED")).toBe("doreczona");
    expect(plakietkaKodu("ISSUE")).toBe("problem");
    expect(plakietkaKodu("RETURNED")).toBe("wraca");
    expect(Object.keys(PLAKIETKA_PRZESYLKI)).toHaveLength(6);
  });

  it("kod spoza schematu i brak kodu nie dostają plakietki — zgadnięta byłaby kłamstwem", () => {
    expect(plakietkaKodu("LOST_IN_SPACE")).toBeNull();
    expect(plakietkaKodu(null)).toBeNull();
    /* `toString` siedzi na prototypie każdego obiektu, a kodem nie jest. */
    expect(plakietkaKodu("toString")).toBeNull();
  });
});

describe("paczki od klienta", () => {
  it("zwrot z paczką staje po stronie klienta, z numerem, nadaniem i doręczeniem", () => {
    const [z] = zdarzeniaPrzesylek(sprawa([zwrot({
      waybill: "600000727616070019994306", przewoznik: "InPost", przesylkaStatus: "DELIVERED",
      paczkaAt: "2026-09-30T12:16:00.000Z", dostarczonoAt: "2026-10-03T08:12:00.000Z",
    })]));
    expect(z).toMatchObject({
      kierunek: "od_klienta", plakietka: "doreczona", waybill: "600000727616070019994306",
      przewoznik: "InPost", nadanoAt: "2026-09-30T12:16:00.000Z", stanAt: "2026-10-03T08:12:00.000Z",
      opis: "zwrot",
    });
    /* Na osi stoi chwila stanu z plakietki, czyli doręczenie. */
    expect(z.moment).toBe("2026-10-03T08:12:00.000Z");
  });

  it("w drodze: chwila to nadanie, a czasu stanu nie zmyślamy", () => {
    const [z] = zdarzeniaPrzesylek(sprawa([zwrot({
      przesylkaStatus: "IN_TRANSIT", paczkaAt: "2026-09-30T12:16:00.000Z" })]));
    expect(z.plakietka).toBe("w_drodze");
    expect(z.moment).toBe("2026-09-30T12:16:00.000Z");
    expect(z.stanAt).toBeNull();
  });

  it("doręczenie z datą przebija spóźniony kod przewoźnika", () => {
    const [z] = zdarzeniaPrzesylek(sprawa([zwrot({
      przesylkaStatus: "IN_TRANSIT", dostarczonoAt: "2026-10-03T08:12:00.000Z" })]));
    expect(z.plakietka).toBe("doreczona");
  });

  it("zwrot bez żadnej paczki nie jest przesyłką — na osi go nie ma", () => {
    expect(zdarzeniaPrzesylek(sprawa([zwrot()]))).toEqual([]);
  });

  it("paczka nieodebrana mówi, czym jest", () => {
    const [z] = zdarzeniaPrzesylek(sprawa([zwrot({ zrodlo: "nieodebrana", przesylkaStatus: "RETURNED",
      paczkaAt: "2026-09-30T12:16:00.000Z" })]));
    expect(z).toMatchObject({ kierunek: "od_klienta", plakietka: "wraca", opis: "paczka nieodebrana" });
  });
});

describe("dosyłka od nas", () => {
  it("staje po naszej stronie, bez numeru, który niesie profil klienta", () => {
    const z = zdarzeniaPrzesylek(sprawa([], {
      dosylka: { status: "AVAILABLE_FOR_PICKUP", dostarczonoAt: null, maNumer: true, zrodlo: "allegro" },
    }));
    expect(z).toHaveLength(1);
    expect(z[0]).toMatchObject({ kierunek: "od_nas", plakietka: "czeka_na_odbior", waybill: null,
      opis: "dosyłka", uwaga: null });
    /* Stan znamy, chwili nie: wpis stoi na końcu osi, bez zmyślonej daty. */
    expect(z[0].moment).toBeNull();
  });

  it("doręczona dosyłka ma chwilę z doręczenia", () => {
    const [z] = zdarzeniaPrzesylek(sprawa([], {
      dosylka: { status: "DELIVERED", dostarczonoAt: "2026-10-12T15:05:00.000Z", maNumer: true, zrodlo: "recznie" },
    }));
    expect(z).toMatchObject({ plakietka: "doreczona", moment: "2026-10-12T15:05:00.000Z" });
  });

  it("dosyłka bez numeru mówi to wprost — agent nie obieca numeru, którego nie ma", () => {
    const [z] = zdarzeniaPrzesylek(sprawa([], {
      dosylka: { status: null, dostarczonoAt: null, maNumer: false, zrodlo: null },
    }));
    expect(z.uwaga).toBe("bez numeru przesyłki");
    expect(z.plakietka).toBeNull();
  });

  it("starszy serwer bez pola dosyłki i sprawa bez zamówienia dają pustą listę", () => {
    expect(zdarzeniaPrzesylek(sprawa([], {}))).toEqual([]);
    expect(zdarzeniaPrzesylek(sprawa([], null))).toEqual([]);
  });
});
