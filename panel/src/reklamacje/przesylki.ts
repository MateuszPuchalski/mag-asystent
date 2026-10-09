import type { SzczegolReklamacji, Zwrot } from "../api/typy";

/* ── PRZESYŁKI NA OSI ROZMOWY ────────────────────────────────────────────────
   Makieta właściciela stawia paczki na tej samej osi co wiadomości. Agent
   czyta wtedy jedną historię: klient napisał, paczka wyszła, paczka doszła.
   Dwie osobne listy kazałyby mu składać tę kolejność w głowie.

   KIERUNEK MÓWI STRONA I KSZTAŁT, nie sama barwa (WCAG 1.4.1). Paczka od
   klienta stoi po lewej, po stronie klienta, a nasza po prawej. Ten plik
   liczy wyłącznie dane; rysuje je `Czat.tsx`.

   KODY Z PLIKU, NIE Z PAMIĘCI. Osiem wartości `ParcelTrackingStatus.code`
   z `docs/allegro/swagger.yaml` dzieli się na sześć plakietek makiety.
   Kod spoza listy nie dostaje plakietki, bo zgadnięta byłaby kłamstwem.  */

export type KierunekPrzesylki = "od_klienta" | "od_nas";

export type PlakietkaPrzesylki =
  | "przygotowana" | "w_drodze" | "czeka_na_odbior" | "doreczona" | "problem" | "wraca";

/** Kody `ParcelTrackingStatus.code` — wszystkie osiem ze schematu Allegro. */
export type KodSledzenia =
  | "PENDING" | "IN_TRANSIT" | "RELEASED_FOR_DELIVERY" | "AVAILABLE_FOR_PICKUP"
  | "NOTICE_LEFT" | "DELIVERED" | "ISSUE" | "RETURNED";

/* `Record` po kodach: nowa wartość w typie nie skompiluje się bez plakietki. */
const PLAKIETKA_KODU: Record<KodSledzenia, PlakietkaPrzesylki> = {
  PENDING: "przygotowana",
  IN_TRANSIT: "w_drodze",
  RELEASED_FOR_DELIVERY: "w_drodze",
  AVAILABLE_FOR_PICKUP: "czeka_na_odbior",
  NOTICE_LEFT: "czeka_na_odbior",
  DELIVERED: "doreczona",
  ISSUE: "problem",
  RETURNED: "wraca",
};

/** Napis i ranga plakietki — ranga to ten sam słownik co w całym panelu. */
export const PLAKIETKA_PRZESYLKI: Record<PlakietkaPrzesylki, {
  etykieta: string; ranga: "nic" | "uwaga" | "ok" | "zle";
}> = {
  przygotowana: { etykieta: "Przygotowana", ranga: "nic" },
  w_drodze: { etykieta: "W drodze", ranga: "nic" },
  czeka_na_odbior: { etykieta: "Czeka na odbiór", ranga: "uwaga" },
  doreczona: { etykieta: "Doręczona", ranga: "ok" },
  problem: { etykieta: "Problem z przesyłką", ranga: "zle" },
  wraca: { etykieta: "Wraca do nadawcy", ranga: "zle" },
};

/** Plakietka dla kodu przewoźnika; `null` dla braku kodu i dla kodu spoza schematu. */
export function plakietkaKodu(kod: string | null): PlakietkaPrzesylki | null {
  if (kod === null || !Object.prototype.hasOwnProperty.call(PLAKIETKA_KODU, kod)) return null;
  return PLAKIETKA_KODU[kod as KodSledzenia];
}

export interface ZdarzeniePrzesylki {
  /** Stały klucz do listy Reacta. */
  klucz: string;
  kierunek: KierunekPrzesylki;
  /**
   * Kiedy zdarzenie staje na osi: chwila stanu z plakietki, a bez niej nadanie.
   * `null` znaczy „stan znamy, chwili nie” — taki wpis stoi na końcu osi,
   * bo to stan bieżący, a nie zmyślona data.
   */
  moment: string | null;
  plakietka: PlakietkaPrzesylki | null;
  /** Kiedy zaszedł stan z plakietki. Znamy go tylko przy doręczeniu. */
  stanAt: string | null;
  nadanoAt: string | null;
  /** Numer listu. Dosyłka go nie niesie: numer stoi na profilu klienta. */
  waybill: string | null;
  przewoznik: string | null;
  /** Co to za paczka, jednym słowem po „Od klienta” albo „Od nas”. */
  opis: string;
  /** Dopisek pod wierszem, gdy jest coś, czego agent nie zgadnie sam. */
  uwaga: string | null;
}

/* Zwrot bez numeru, nadania, kodu i doręczenia to zgłoszenie bez paczki.
   Na osi przesyłek nie ma czego pokazać, więc go pomijamy. */
const maPaczke = (z: Zwrot) =>
  z.waybill !== null || z.paczkaAt !== null || z.przesylkaStatus !== null || z.dostarczonoAt !== null;

/* Doręczenie z datą przebija kod: tracking bywa spóźniony o przebieg taktu,
   a data dostarczenia jest faktem z tego samego źródła. */
function plakietkaPaczki(kod: string | null, dostarczonoAt: string | null): PlakietkaPrzesylki | null {
  return dostarczonoAt !== null ? "doreczona" : plakietkaKodu(kod);
}

/**
 * Przesyłki sprawy do wstawienia na oś rozmowy.
 *
 * Od klienta: paczki zwrotne z `s.zwroty`. Od nas: dosyłka z `s.przesylka`.
 * Pierwsza paczka zamówienia nie wchodzi, bo stoi na drodze sprawy jako krok
 * „Doręczono”, a na osi byłaby drugim domem tego samego faktu.
 */
export function zdarzeniaPrzesylek(s: SzczegolReklamacji): ZdarzeniePrzesylki[] {
  const wynik: ZdarzeniePrzesylki[] = [];
  for (const z of s.zwroty ?? []) {
    if (!maPaczke(z)) continue;
    const plakietka = plakietkaPaczki(z.przesylkaStatus, z.dostarczonoAt);
    /* Paczka nieodebrana to nasza pierwsza paczka w drodze powrotnej, więc
       stoi po stronie klienta: z jego adresu jedzie do nas. */
    const nieodebrana = z.zrodlo === "nieodebrana";
    wynik.push({
      klucz: `zwrot-${z.id}`,
      kierunek: "od_klienta",
      moment: z.dostarczonoAt ?? z.paczkaAt ?? z.utworzono,
      plakietka,
      stanAt: z.dostarczonoAt,
      nadanoAt: z.paczkaAt,
      waybill: z.waybill,
      przewoznik: z.przewoznik,
      opis: nieodebrana ? "paczka nieodebrana" : "zwrot",
      uwaga: null,
    });
  }
  const d = s.przesylka?.dosylka;
  if (d) {
    wynik.push({
      klucz: "dosylka",
      kierunek: "od_nas",
      moment: d.dostarczonoAt,
      plakietka: plakietkaPaczki(d.status, d.dostarczonoAt),
      stanAt: d.dostarczonoAt,
      nadanoAt: null,
      waybill: null,
      przewoznik: null,
      opis: "dosyłka",
      /* Bez numeru nie ma czego śledzić, a agent ma to wiedzieć, zanim
         obieca klientowi numer przesyłki w czacie. */
      uwaga: d.maNumer ? null : "bez numeru przesyłki",
    });
  }
  return wynik;
}
