import { TRACKING_NA_ZADANIE, urlTrackingu, zapytajAllegro } from "../adapters/allegro.http.js";
import { BladLimituAllegro, BladOdpowiedziAllegro } from "../adapters/allegro.js";
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

   ── Tu numer dalej ŻYJE PRZEZ JEDNO ŻĄDANIE (0.344.0) ─────────────────────
   Decyzja właściciela zdjęła politykę 0.163.0 i model pracy trzyma teraz numer
   PIERWSZEJ paczki zwrotu. Ten plik i tak go stamtąd nie bierze: pytanie brzmi
   „co z KAŻDĄ paczką tego zwrotu", a na to odpowiada wyłącznie lądowisko.
   Zapisujemy z odpytania WYŁĄCZNIE wynik — moment doręczenia i kod statusu.

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
  /**
   * `occurredAt` ostatniego statusu (@wydanie). Dosyłka rozpoznaje po nim
   * paczkę bez daty rejestracji: ruch u przewoźnika po zgłoszeniu zwrotu
   * odróżnia nową paczkę od oryginału (`wybierzNumer` w `dosylka.ts`).
   */
  ostatnioAt: string | null;
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
  if (statusy.length === 0) return { dostarczonoAt: null, status: null, ostatnioAt: null };

  const doreczone = statusy.filter((s) => s.code === DORECZONA)
    .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
  const ostatni = [...statusy].sort((a, b) => a.occurredAt.localeCompare(b.occurredAt)).at(-1);
  return {
    /* Pierwsze doręczenie, nie ostatnie: paczka doręczona i potem zwrócona
       nadawcy ma dwa wpisy, a nas interesuje moment, w którym trafiła do nas. */
    dostarczonoAt: doreczone[0]?.occurredAt ?? null,
    status: ostatni?.code ?? null,
    ostatnioAt: ostatni?.occurredAt ?? null,
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

/** Jedna paczka do zapytania przewoźnika. */
export interface PaczkaDoTrackingu {
  carrierId: string;
  waybill: string;
}

/**
 * Pyta przewoźników o paczki i oddaje stan każdej po numerze — bez zapisu.
 *
 * JEDNA droga do końcówki trackingu dla zwrotów i dla dosyłki (0.536.0).
 * Partie po PRZEWOŹNIKU, bo `carrierId` siedzi w ścieżce adresu, i po
 * dwadzieścia numerów, bo tyle dopuszcza `maxItems`.
 *
 * DEGRADUJE PO PARTII. Numer z partii, która padła, NIE MA wpisu w wyniku —
 * wołający odróżnia „przewoźnik nic nie wie” (wpis z pustym stanem) od „nie
 * udało się zapytać” (brak wpisu). Pierwsze warto zapisać jako sprawdzenie,
 * drugiego nie.
 *
 * `limitWyzej`: 429 przerywa i idzie do wołającego, żeby `uruchomTakt`
 * odczekał `Retry-After`. Limit jest wspólny dla całego konta, więc dalsze
 * partie tylko by go przedłużały. Zwroty tej flagi nie podają i zachowują
 * się jak przed wydzieleniem: partia z 429 przepada, reszta idzie dalej.
 *
 * `pojedynczoPoBledzie` (dosyłka): partię, która padła czymś innym niż 429,
 * pyta jeszcze raz numer po numerze. Jeden źle wpisany numer potrafi
 * wywrócić całą partię, a z nią dosyłki, które są w porządku. Dosyłek w toku
 * jest kilka, więc ponowienie kosztuje kilka żądań na takt, w którym coś
 * padło. Zwroty tej flagi nie podają — ich partie bywają pełne.
 *
 * DZIENNIK DOSTAJE STAŁE ZDANIE: przewoźnik i kod HTTP. Treść błędu Allegro
 * bywa czymkolwiek, także kawałkiem odpowiedzi z adresem odbiorcy.
 */
export async function odpytajTracking(
  query: (url: string) => Promise<unknown | null>, apiUrl: string, paczki: readonly PaczkaDoTrackingu[],
  opcje: { limitWyzej?: boolean; pojedynczoPoBledzie?: boolean } = {},
): Promise<Map<string, StanPrzesylki>> {
  const wgPrzewoznika = new Map<string, PaczkaDoTrackingu[]>();
  for (const p of paczki) {
    const lista = wgPrzewoznika.get(p.carrierId) ?? [];
    lista.push(p);
    wgPrzewoznika.set(p.carrierId, lista);
  }

  const stany = new Map<string, StanPrzesylki>();
  /* Jedno pytanie o partię; `false`, gdy nie doszło — wtedy numery partii
     nie dostają wpisu, a dziennik dostaje stałe zdanie. */
  const zapytaj = async (carrierId: string, partia: readonly PaczkaDoTrackingu[]): Promise<boolean> => {
    let odp: Odpowiedz | null = null;
    try {
      odp = (await query(urlTrackingu(apiUrl, carrierId, partia.map((p) => p.waybill)))) as Odpowiedz | null;
    } catch (e) {
      if (opcje.limitWyzej && e instanceof BladLimituAllegro) throw e;
      const kod = e instanceof BladOdpowiedziAllegro ? `HTTP ${e.status}` : "bez odpowiedzi";
      console.warn(`[tracking] ${carrierId}: pytanie o ${partia.length} numer(y) nie doszło (${kod})`);
      return false;
    }
    const wgNumeru = new Map<string, Historia>();
    for (const h of odp?.waybills ?? []) {
      if (typeof h?.waybill === "string") wgNumeru.set(h.waybill, h);
    }
    for (const p of partia) stany.set(p.waybill, stanZHistorii(wgNumeru.get(p.waybill)));
    return true;
  };

  for (const [carrierId, lista] of wgPrzewoznika) {
    for (let i = 0; i < lista.length; i += TRACKING_NA_ZADANIE) {
      const partia = lista.slice(i, i + TRACKING_NA_ZADANIE);
      if (await zapytaj(carrierId, partia)) continue;
      if (!opcje.pojedynczoPoBledzie || partia.length < 2) continue;
      for (const p of partia) await zapytaj(carrierId, [p]);
    }
  }
  return stany;
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
  const stany = await odpytajTracking(query, apiUrl, paczki);

  let dopisanych = 0;
  for (const p of paczki) {
    const stan = stany.get(p.waybill);
    if (!stan || (stan.dostarczonoAt === null && stan.status === null)) continue;
    database.prepare(
      "UPDATE zwrot_klienta SET dostarczono_at=?, przesylka_status=? WHERE id=?")
      .run(stan.dostarczonoAt, stan.status, p.zwrotId);
    if (stan.dostarczonoAt) dopisanych++;
  }
  return dopisanych;
}
