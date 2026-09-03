import { TRACKING_NA_ZADANIE, urlTrackingu, zapytajAllegro } from "../adapters/allegro.http.js";
import { config } from "../config.js";
import type { Db } from "../db/db.js";

/* ── Kiedy paczka zwrotna do nas dotarła (0.187.0) ───────────────────────────
   Do 0.186.0 panel twierdził, że „Allegro nie podaje daty doręczenia do nas".
   To była NIEPRAWDA wzięta ze zbyt wąskiego czytania: obiekt `CustomerReturn`
   i jego `parcels[]` istotnie mają tylko datę NADANIA — ale API ma osobną
   końcówkę, która podaje czas każdej zmiany statusu przesyłki:

       GET /order/carriers/{carrierId}/tracking?waybill=…

   Każdy wpis niesie `occurredAt` („actual shipment status change time"),
   a wśród kodów jest `DELIVERED`. Właściciel zobaczył tę datę we własnym
   panelu sprzedawcy i słusznie zapytał, czemu u nas jej nie ma.

   ── Numeru listu dalej NIE ZAPISUJEMY (polityka 0.163.0) ───────────────────
   I nie trzeba. Waybill przychodzi w tej samej odpowiedzi, co zwrot, więc
   synchronizacja ma go w ręku podczas przebiegu: pytamy tracking od razu
   i zapisujemy WYŁĄCZNIE wynik — moment doręczenia i kod statusu. Numer żyje
   przez jedno żądanie, dokładnie jak mówi polityka.

   ── Pytamy tylko o te W DRODZE (decyzja właściciela) ───────────────────────
   Zwrot z zapisaną datą doręczenia nie jest pytany drugi raz: data się nie
   zmieni, a każde żądanie to koszt u Allegro. Dwadzieścia numerów na
   wywołanie, partie po przewoźniku — przy kilkunastu paczkach w drodze
   wychodzi jedno wywołanie na takt.                                          */

/** Kod statusu przesyłki, którego szukamy. */
const DORECZONA = "DELIVERED";

type Status = { occurredAt?: string; code?: string };
type Historia = { waybill?: string; trackingDetails?: { statuses?: Status[] } | null };
type Odpowiedz = { carrierId?: string; waybills?: Historia[] };

/** Co wiemy o jednej przesyłce po odpytaniu przewoźnika. */
export interface StanPrzesylki {
  /** Moment doręczenia — `null`, dopóki paczka jedzie. */
  dostarczonoAt: string | null;
  /** Kod OSTATNIEGO statusu: `IN_TRANSIT`, `NOTICE_LEFT`, `ISSUE`, `RETURNED`… */
  status: string | null;
}

/**
 * Wyciąga z historii moment doręczenia i ostatni status.
 *
 * Doręczenie bierzemy z wpisu `DELIVERED`, a nie z ostatniego wpisu w tablicy:
 * po doręczeniu potrafią dojść kolejne zdarzenia, a specyfikacja nie obiecuje
 * porządku listy. Ostatni status liczymy po `occurredAt`, z tego samego powodu.
 */
export function stanZHistorii(historia: Historia | undefined): StanPrzesylki {
  const statusy = (historia?.trackingDetails?.statuses ?? [])
    .filter((s): s is Status & { occurredAt: string } => typeof s?.occurredAt === "string");
  if (statusy.length === 0) return { dostarczonoAt: null, status: null };

  const doreczone = statusy.filter((s) => s.code === DORECZONA)
    .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
  const ostatni = [...statusy].sort((a, b) => a.occurredAt.localeCompare(b.occurredAt)).at(-1);
  return {
    /* Pierwsze doręczenie, nie ostatnie: paczka doręczona i potem zwrócona
       nadawcy ma dwa wpisy, a nas interesuje moment, w którym trafiła do nas. */
    dostarczonoAt: doreczone[0]?.occurredAt ?? null,
    status: ostatni?.code ?? null,
  };
}

/** Paczka do sprawdzenia: przewoźnik, numer i zwrot, do którego należy. */
export interface DoSprawdzenia {
  zwrotId: number;
  carrierId: string;
  waybill: string;
}

export interface TrackingDeps {
  query?: (url: string) => Promise<unknown | null>;
  apiUrl?: string;
}

/**
 * Odpytuje przewoźników i zapisuje przy zwrotach to, co wróciło.
 *
 * DEGRADUJE, nie przerywa. Tracking jest wygodą biura, a synchronizacja
 * zwrotów — pracą: gdy przewoźnik nie odpowie, zwroty i tak wchodzą, a data
 * doręczenia dojdzie przy następnym takcie. Błąd jednego przewoźnika nie
 * zabiera pozostałych (ta sama lekcja co przy wątkach skrzynki w 0.149.2).
 *
 * Oddaje liczbę zwrotów, którym dopisał datę doręczenia.
 */
export async function uzupelnijDoreczenia(
  database: Db, paczki: DoSprawdzenia[], deps: TrackingDeps = {},
): Promise<number> {
  const query = deps.query ?? zapytajAllegro;
  const apiUrl = deps.apiUrl ?? config.allegro.apiUrl;

  /* Partie po PRZEWOŹNIKU, bo carrierId siedzi w ścieżce adresu. */
  const wgPrzewoznika = new Map<string, DoSprawdzenia[]>();
  for (const p of paczki) {
    const lista = wgPrzewoznika.get(p.carrierId) ?? [];
    lista.push(p);
    wgPrzewoznika.set(p.carrierId, lista);
  }

  let dopisanych = 0;
  for (const [carrierId, lista] of wgPrzewoznika) {
    for (let i = 0; i < lista.length; i += TRACKING_NA_ZADANIE) {
      const partia = lista.slice(i, i + TRACKING_NA_ZADANIE);
      let odp: Odpowiedz | null = null;
      try {
        const url = urlTrackingu(apiUrl, carrierId, partia.map((p) => p.waybill));
        odp = (await query(url)) as Odpowiedz | null;
      } catch (e) {
        console.warn(`[tracking] ${carrierId}: ${e instanceof Error ? e.message : e}`);
        continue;
      }

      const wgNumeru = new Map<string, Historia>();
      for (const h of odp?.waybills ?? []) {
        if (typeof h?.waybill === "string") wgNumeru.set(h.waybill, h);
      }

      for (const p of partia) {
        const stan = stanZHistorii(wgNumeru.get(p.waybill));
        if (stan.dostarczonoAt === null && stan.status === null) continue;
        database.prepare(
          "UPDATE zwrot_klienta SET dostarczono_at=?, przesylka_status=? WHERE id=?")
          .run(stan.dostarczonoAt, stan.status, p.zwrotId);
        if (stan.dostarczonoAt) dopisanych++;
      }
    }
  }
  return dopisanych;
}
