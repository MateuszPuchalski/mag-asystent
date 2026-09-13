import { db as defaultDb, type Db } from "../db/db.js";
import { BladLimituAllegro } from "../adapters/allegro.js";
import { logEvent } from "./events.js";
import { stanRabatu, zlozWniosekORabat, type NadawcaWniosku } from "./rabaty.js";

/* ── Wniosek o rabat składany SAM (0.320.0) ──────────────────────────────────
   Zgłoszenie właściciela: „musimy zrobić automatyczny wniosek o rabat
   transakcyjny do zwracanych przedmiotów". Ręczny przycisk stoi przy pozycji
   od 0.164.0 i działa — ale trzeba o nim pamiętać przy KAŻDYM zwrocie, a na
   liście stoi ich w tej firmie kilkaset. Prowizja, po którą nikt nie kliknął,
   zostaje u Allegro.

   KIEDY: zaraz po tym, jak dowiadujemy się o odstąpieniu — czyli po
   zaciągnięciu zwrotu, jeszcze przed werdyktem biura. Decyzja właściciela
   z 13 września, zapisana wprost: „wystawiaj wniosek jak tylko otrzymamy
   informację o odstąpieniu od umowy, do towarów które są zwracane".

   Wniosek NIE JEST decyzją o towarze. Dotyczy prowizji od transakcji, którą
   klient wycofał, więc nie czeka ani na ocenę, ani na korektę. Gdyby zwrot
   okazał się później odmową, wniosek zdejmuje się w panelu Allegro — i to
   jest tańsze niż prowizja, po którą nikt nie sięgnął.

   TYLKO NOWE ZWROTY (też decyzja właściciela). Pozycje zastane w chwili
   wdrożenia migracja stempluje jako `rabat_poza_automatem`: bez tego pierwszy
   przebieg wysłałby do Allegro serię żądań o wnioski dla zwrotów sprzed
   miesięcy, z których część wróciłaby odmową. Ten sam wzorzec i ten sam powód
   co przy powrocie kosza z bufora (`powrot_poza_aplikacja`, 0.266.0).        */

/** Kto podpisuje wniosek złożony bez człowieka. */
export const AUTOMAT_RABATU = "automat (odstąpienie)";

/**
 * Ile wniosków na jeden przebieg.
 *
 * Sufit jest OSTROŻNOŚCIĄ, nie optymalizacją: automat bierze wyłącznie nowe
 * zwroty, więc naturalnie idzie ich kilka na takt. Gdyby jednak wpadła
 * większa paczka — po dłuższej przerwie w synchronizacji — seria stu żądań
 * pod rząd zderzyłaby się z limitem Allegro i zabrała ze sobą resztę taktu.
 */
export const MAKS_NA_PRZEBIEG = 20;

/**
 * Ile minut czekamy od odstąpienia, zanim złożymy wniosek.
 *
 * CZTERDZIEŚCI WNIOSKÓW NA STO ZAKŁADA ALLEGRO SAMO (`type: AUTOMATIC`,
 * obserwacja z 2 września w `docs/allegro-ksztalt.md`). Końcówka nie ma
 * idempotencji, więc nasz wniosek złożony w tej samej minucie co ich byłby
 * DRUGIM zgłoszeniem do tej samej prowizji — a nie tym samym.
 *
 * Karencja daje lustru (`GET /order/refund-claims`, takt co kwadrans) szansę
 * zobaczyć wniosek Allegro, zanim strażnik `stanRabatu` odpowie „brak".
 * Pół godziny to dwa takty; prowizja nie ucieka w tym czasie nigdzie,
 * a właścicielskie „jak tylko otrzymamy informację" nadal znaczy „tego dnia",
 * nie „za tydzień".
 *
 * Nie broni to przed wnioskiem Allegro złożonym po dniach — przed tym nie
 * broni nic poza ich stroną. Broni przed przypadkiem CZĘSTYM.
 */
export const KARENCJA_MIN = 30;

export interface WynikAutomatuRabatow {
  zlozone: number;
  /** Pozycje, przy których nie było czego składać (wniosek już jest, brak pozycji zamówienia). */
  pominiete: number;
  bledy: number;
  /** `true`, gdy przebieg przerwał limit Allegro — reszta poczeka na następny takt. */
  limit: boolean;
}

/**
 * Kandydaci: pozycje zwrotów z Allegro, których automat jeszcze nie dotykał.
 *
 * POZYCJA DOPISANA PRZEZ BIURO ODPADA (`p.zrodlo <> 'allegro'`). Klient jej nie
 * zgłosił, więc nie ma jej w odstąpieniu — a wniosek o prowizję od czegoś, co
 * nie wróciło z woli kupującego, byłby zgłoszeniem nieprawdy.
 *
 * PACZKA NIEODEBRANA ODPADA TAK SAMO (`z.zrodlo = 'allegro'`). Klient niczego
 * nie zgłosił: przesyłka wróciła sama, a to nie jest odstąpienie od umowy.
 *
 * ŚWIEŻE ODSTĄPIENIE CZEKA KARENCJĘ (`KARENCJA_MIN`) — powód przy stałej.
 */
function kandydaci(database: Db, teraz: Date): number[] {
  const prog = new Date(teraz.getTime() - KARENCJA_MIN * 60_000).toISOString();
  return (database.prepare(
    `SELECT p.id FROM zwrot_klienta_pozycja p
       JOIN zwrot_klienta z ON z.id = p.zwrot_id
      WHERE p.rabat_poza_automatem = 0
        AND z.zrodlo = 'allegro'
        AND (p.zrodlo IS NULL OR p.zrodlo = 'allegro')
        AND z.created_at <= ?
      ORDER BY p.id`).all(prog) as Array<{ id: number }>).map((w) => Number(w.id));
}

/**
 * Złożenie brakujących wniosków. Woła to takt rabatów, PO odświeżeniu lustra.
 *
 * Kolejność w takcie jest tu treścią, nie porządkiem: lustro wniosków
 * (`synchronizujAllegroRabaty`) najpierw, automat potem. Odwrotnie automat
 * pytałby o stan sprzed kwadransa i składał drugi wniosek do pozycji, która
 * dostała pierwszy w panelu Allegro.
 *
 * KAŻDA POZYCJA IDZIE WŁASNĄ PRÓBĄ — jedna wywrócona nie ma prawa zabrać
 * pozostałych (ta sama lekcja co przy wiązaniu zaległości w 0.220.0).
 * Wyjątkiem jest limit Allegro: on dotyczy WSZYSTKICH następnych żądań, więc
 * przerywa przebieg zamiast mnożyć odmowy.
 */
export async function zlozBrakujaceWnioski(
  database: Db = defaultDb(), nadaj: NadawcaWniosku, teraz = new Date(),
): Promise<WynikAutomatuRabatow> {
  const wynik: WynikAutomatuRabatow = { zlozone: 0, pominiete: 0, bledy: 0, limit: false };
  for (const pozycjaId of kandydaci(database, teraz)) {
    if (wynik.zlozone >= MAKS_NA_PRZEBIEG) break;
    /* Odczyt lokalny PRZED wyjściem do sieci: pozycja bez odpowiednika
       w zamówieniu i pozycja z gotowym wnioskiem odpadają bez żądania. */
    const stan = stanRabatu(database, pozycjaId);
    if (stan.stan !== "brak" || !stan.lineItemId) {
      wynik.pominiete++;
      continue;
    }
    try {
      const { wniosekId } = await zlozWniosekORabat(
        database, pozycjaId, { id: null, name: AUTOMAT_RABATU }, nadaj, teraz);
      wynik.zlozone++;
      console.log(`[rabat] wniosek ${wniosekId} dla pozycji ${pozycjaId}`);
    } catch (e) {
      if (e instanceof BladLimituAllegro) {
        wynik.limit = true;
        console.warn("[rabat] przerwa na limit Allegro — reszta w następnym takcie");
        break;
      }
      wynik.bledy++;
      const tresc = e instanceof Error ? e.message : String(e);
      console.error(`[rabat] pozycja ${pozycjaId}: ${tresc}`);
      /* Odmowa Allegro zostaje w dzienniku ze zdaniem, a pozycja wraca do puli:
         przyczyna bywa chwilowa (zamówienie jeszcze nierozliczone), a stała
         i tak odpadnie w `stanRabatu` przy następnym przebiegu. */
      logEvent("zwrot_rabat_automat_blad", AUTOMAT_RABATU, null,
        { pozycjaId, blad: tresc }, null, database);
    }
  }
  return wynik;
}
