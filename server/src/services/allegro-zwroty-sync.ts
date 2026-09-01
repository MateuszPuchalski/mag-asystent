import { config } from "../config.js";
import { db as defaultDb, transaction, type Db } from "../db/db.js";
import { urlListyZwrotow, zapytajAllegro } from "../adapters/allegro.http.js";
import { BladLimituAllegro, BladOdpowiedziAllegro } from "../adapters/allegro.js";
import { kontoKanalu } from "./kanal-konto.js";
import { stanZwrotow } from "./allegro-zwroty-sync-state.js";

/* ── Synchronizator zwrotów klienckich (0.150.0) ─────────────────────────────
   Kształt pól pochodzi z OFICJALNEJ specyfikacji OpenAPI Allegro (modele
   `CustomerReturn`, `CustomerReturnItem`, `CustomerReturnReturnParcel`,
   `CustomerReturnRejection`), nie z pamięci i nie z kodu sprzed 0.138.0.
   Spis pól z uzasadnieniem stoi w `docs/allegro-ksztalt.md`; §8.2 projektu
   panelu każe traktować TAMTEN dokument jako kontrakt, a ten plik jako jego
   wykonanie.

   TRZECH RZECZY NIE MAPUJEMY, i to jest decyzja, nie przeoczenie:
   `refund.bankAccount` (właściciel, numer, IBAN, SWIFT, adres),
   `parcels[].sender.phoneNumber` oraz adres z konta bankowego. Zwrot da się
   rozstrzygnąć bez nich, a raz pobrane dane osobowe zostają w kopii
   zapasowej na lata. Kolumn na nie po prostu NIE MA — nieuważne mapowanie
   wywali się na SQL-u zamiast wyciec po cichu (pilnuje
   `db/migracja-zwrotow.test.ts`).

   Rytm i respekt dla 429 bierze `services/takt.ts`; ponowień w środku
   przebiegu nie ma.                                                         */

type Kwota = { amount?: string; currency?: string };
type Pozycja = {
  offerId?: string; quantity?: number; name?: string; price?: Kwota;
  reason?: { type?: string; userComment?: string } | null;
};
type Paczka = { createdAt?: string; waybill?: string; carrierId?: string };
type Zwrot = {
  id: string;
  createdAt?: string;
  referenceNumber?: string;
  orderId?: string;
  items?: Pozycja[];
  parcels?: Paczka[];
  rejection?: { code?: string; reason?: string; createdAt?: string } | null;
};

/* Kod bierze się z KLASY błędu, nie z jego zdania — ta sama poprawka co
   w skrzynce w 0.149.0. */
const kodHttp = (error: unknown): number | null =>
  error instanceof BladOdpowiedziAllegro ? error.status : null;

/**
 * Ile stron wolno przejść w jednym przebiegu.
 *
 * BEZPIECZNIK, nie limit poprawnościowy: to jest blizna 0.127.0 postawiona
 * na głowie. Tam rejestr czytał PIERWSZĄ stronę i gubił resztę po cichu;
 * tu chodzimy dalej, dopóki Allegro oddaje pełne strony, ale nie w
 * nieskończoność — zapętlona paginacja biłaby w konto aż do blokady.
 * Dziesięć stron to tysiąc zwrotów na przebieg, czyli więcej, niż firma
 * dostaje w kwartale.
 */
const MAKS_STRON = 10;

/** Ile rekordów prosi jedna strona; musi zgadzać się z `urlListyZwrotow`. */
const NA_STRONE = 100;

export interface ZwrotySyncDeps {
  database?: Db;
  query?: (url: string) => Promise<unknown | null>;
  now?: () => Date;
  apiUrl?: string;
  intervalMs?: number;
  accountId?: string;
  oknoDni?: number;
}

function tablica<T>(value: unknown, pole: string): T[] {
  if (!value || typeof value !== "object" || !Array.isArray((value as Record<string, unknown>)[pole])) {
    throw new Error(`Odpowiedź Allegro nie ma tablicy ${pole} opisanej w docs/allegro-ksztalt.md`);
  }
  return (value as Record<string, unknown>)[pole] as T[];
}

/**
 * Kwota Allegro na grosze.
 *
 * Allegro oddaje kwotę STRINGIEM i mówi wprost dlaczego: „to avoid rounding
 * errors". Zamiana na `number` i mnożenie przez sto zwróciłaby ten błąd
 * tylnymi drzwiami (`19.99 * 100` to 1998.9999...), a my te kwoty sumujemy,
 * żeby zaproponować zwrot. Liczymy więc na tekście.
 */
export function naGrosze(amount: string | undefined): number {
  if (!amount) return 0;
  const m = /^(-?)(\d+)(?:[.,](\d{1,2}))?$/.exec(amount.trim());
  if (!m) throw new Error(`Kwota Allegro „${amount}" nie ma kształtu z docs/allegro-ksztalt.md`);
  const grosze = Number(m[2]) * 100 + Number((m[3] ?? "0").padEnd(2, "0"));
  return m[1] === "-" ? -grosze : grosze;
}

/** Najwcześniejsza paczka; NULL znaczy „towar jeszcze nie wrócił". */
function pierwszaPaczka(paczki: Paczka[] | undefined): string | null {
  const daty = (paczki ?? []).map((p) => p.createdAt).filter((d): d is string => Boolean(d));
  return daty.length ? daty.sort()[0] : null;
}

/** Jeden przebieg. Sieć kończy się PRZED transakcją, więc wolne API nie blokuje SQLite. */
export async function synchronizujAllegroZwroty(deps: ZwrotySyncDeps = {}): Promise<void> {
  const database = deps.database ?? defaultDb();
  const query = deps.query ?? zapytajAllegro;
  const now = deps.now ?? (() => new Date());
  const apiUrl = deps.apiUrl ?? config.allegro.apiUrl;
  const interval = deps.intervalMs ?? config.allegro.zwrotySyncMs;
  const oknoDni = deps.oknoDni ?? config.allegro.zwrotyOknoDni;
  const start = stanZwrotow(database);

  /* Kursor rządzi, gdy jest; okno dat wchodzi TYLKO przy pierwszym przebiegu.
     Trzymanie obu naraz zawężałoby wynik dwa razy i po dziewięćdziesięciu
     dniach cicho przestałoby oddawać cokolwiek nowego. */
  const odKiedy = start.cursorId
    ? null
    : new Date(now().getTime() - oknoDni * 86_400_000).toISOString();

  const zebrane: Zwrot[] = [];
  try {
    for (let strona = 0; strona < MAKS_STRON; strona++) {
      const body = await query(urlListyZwrotow(apiUrl, odKiedy, strona * NA_STRONE, start.cursorId));
      const partia = tablica<Zwrot>(body, "customerReturns");
      zebrane.push(...partia.filter((z) => typeof z?.id === "string"));
      if (partia.length < NA_STRONE) break;
    }

    const at = now().toISOString();
    /* Kursor liczymy z NAJPÓŹNIEJSZEJ daty, a nie z ostatniego elementu
       tablicy. Dokumentacja nie obiecuje porządku listy, a kursor wzięty
       z niewłaściwego końca przewinąłby nas wstecz przy każdym przebiegu. */
    const najnowszy = zebrane.reduce<Zwrot | null>(
      (a, z) => (!a || (z.createdAt ?? "") > (a.createdAt ?? "") ? z : a), null);

    transaction(database, () => {
      const konto = kontoKanalu(database, deps.accountId ?? config.allegro.clientId);
      for (const zwrot of zebrane) zapisz(database, zwrot, konto, at);

      /* `error_count` ZERUJE SIĘ na sukcesie — ta sama poprawka co w skrzynce
         w 0.147.0. Licznik, który tylko rośnie, po tygodniu mówi wyłącznie
         „kiedyś było źle". */
      database.prepare(`INSERT INTO allegro_zwroty_sync_state
        (id,cursor_id,cursor_at,last_success_at,last_attempt_at,last_error_code,
         error_count,next_attempt_at)
        VALUES(1,?,?,?,?,NULL,0,?) ON CONFLICT(id) DO UPDATE SET
        cursor_id=excluded.cursor_id, cursor_at=excluded.cursor_at,
        last_success_at=excluded.last_success_at, last_attempt_at=excluded.last_attempt_at,
        last_error_code=NULL, error_count=0, next_attempt_at=excluded.next_attempt_at`).run(
        najnowszy?.id ?? start.cursorId,
        najnowszy?.createdAt ?? start.cursorAt,
        at, at, new Date(Date.parse(at) + interval).toISOString());
    })();
  } catch (error) {
    const wait = error instanceof BladLimituAllegro
      ? Math.max(interval, error.poIluMs ?? interval * 2)
      : interval;
    const next = new Date(now().getTime() + wait).toISOString();
    const kod = error instanceof BladLimituAllegro ? 429 : kodHttp(error);
    database.prepare(`INSERT INTO allegro_zwroty_sync_state
      (id,error_count,last_attempt_at,last_error_code,next_attempt_at)
      VALUES(1,1,?,?,?) ON CONFLICT(id) DO UPDATE SET error_count=error_count+1,
      last_attempt_at=excluded.last_attempt_at,last_error_code=excluded.last_error_code,
      next_attempt_at=excluded.next_attempt_at`).run(now().toISOString(), kod, next);
    throw error;
  }
}

/**
 * Lądowisko plus model pracy, jednym ruchem.
 *
 * DECYZJE BIURA SĄ NIETYKALNE. Ponowne pobranie uzupełnia pola z Allegro
 * i podnosi `synced_at`, ale nie rusza `werdykt*`, `kwota*`, `korekta*` ani
 * `wersja` — to jest blizna 0.128.0 („drugi przebieg nie robi duplikatów")
 * rozszerzona o pracę człowieka. Pozycje przepisujemy w całości, bo są
 * odbiciem Allegro; ocena hali wisi jednak na pozycji, więc wraca po
 * kluczu naturalnym zamiast zginąć razem z wierszem.
 */
function zapisz(database: Db, zwrot: Zwrot, konto: number, at: string): void {
  const utworzono = zwrot.createdAt ?? at;
  database.prepare(`INSERT INTO allegro_zwrot(id,created_at,surowe_json,synced_at)
    VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET created_at=excluded.created_at,
    surowe_json=excluded.surowe_json, synced_at=excluded.synced_at`).run(
    zwrot.id, utworzono, JSON.stringify(zwrot), at);

  database.prepare(`INSERT INTO zwrot_klienta
    (channel_account_id,external_id,reference_number,order_id,created_at,paczka_at,
     rejection_code,rejection_reason,synced_at)
    VALUES (?,?,?,?,?,?,?,?,?)
    ON CONFLICT(channel_account_id, external_id) DO UPDATE SET
      reference_number=excluded.reference_number, order_id=excluded.order_id,
      created_at=excluded.created_at, paczka_at=excluded.paczka_at,
      rejection_code=excluded.rejection_code, rejection_reason=excluded.rejection_reason,
      synced_at=excluded.synced_at`).run(
    konto, zwrot.id, zwrot.referenceNumber ?? null, zwrot.orderId ?? null,
    utworzono, pierwszaPaczka(zwrot.parcels),
    zwrot.rejection?.code ?? null, zwrot.rejection?.reason ?? null, at);

  const id = Number((database.prepare(
    "SELECT id FROM zwrot_klienta WHERE channel_account_id=? AND external_id=?",
  ).get(konto, zwrot.id) as { id: number }).id);

  /* Ocena hali NIE MA prawa zginąć przy odświeżeniu listy. Zdejmujemy ją
     przed przepisaniem pozycji i oddajemy po ofercie i nazwie — jedyne dwa
     pola, po których pozycja daje się rozpoznać między przebiegami. */
  const oceny = new Map<string, { ocena: string; at: string | null; przez: string | null }>();
  for (const p of database.prepare(
    "SELECT offer_id, nazwa, ocena, ocena_at, ocena_przez FROM zwrot_klienta_pozycja WHERE zwrot_id=? AND ocena IS NOT NULL",
  ).all(id) as Array<Record<string, string | null>>) {
    oceny.set(`${p.offer_id ?? ""}|${p.nazwa ?? ""}`,
      { ocena: p.ocena as string, at: p.ocena_at, przez: p.ocena_przez });
  }

  database.prepare("DELETE FROM zwrot_klienta_pozycja WHERE zwrot_id=?").run(id);
  for (const poz of zwrot.items ?? []) {
    const nazwa = poz.name ?? "";
    const stara = oceny.get(`${poz.offerId ?? ""}|${nazwa}`);
    database.prepare(`INSERT INTO zwrot_klienta_pozycja
      (zwrot_id,offer_id,nazwa,ilosc,cena_grosze,waluta,powod,powod_komentarz,
       ocena,ocena_at,ocena_przez)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(
      id, poz.offerId ?? null, nazwa, Number(poz.quantity ?? 0),
      naGrosze(poz.price?.amount), poz.price?.currency ?? "PLN",
      poz.reason?.type ?? null, poz.reason?.userComment ?? null,
      stara?.ocena ?? null, stara?.at ?? null, stara?.przez ?? null);
  }
}
