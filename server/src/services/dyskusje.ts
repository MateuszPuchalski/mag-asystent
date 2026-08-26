import { db, nowIso } from "../db/db.js";
import { config } from "../config.js";
import { logEvent } from "./events.js";
import { allegroAdapter } from "../adapters/allegro.js";
import { stanPolaczenia } from "./allegro-token.js";
import { terminReklamacji } from "./reklamacje.js";

/* ── Dyskusje i reklamacje Allegro — rejestr pracy biura ─────────────────────
   Do tej pory sekcja dyskusji była podglądem na kliknięcie: przycisk pobierał
   listę z API i nic nie zostawało. To wystarczało, żeby ZOBACZYĆ sprawy, ale
   nie żeby je PROWADZIĆ — sprawa bez właściciela i bez statusu potrafiła
   czekać niezauważona aż do terminu ustawowego, a przy dwóch biurkach dwie
   osoby brały tę samą.

   Ten moduł powtarza wzorzec `pytania.ts` z jedną istotną różnicą: NIE MA
   ścieżki odpowiedzi. `/sale/issues` zwraca same nagłówki spraw (bez treści
   wiadomości), więc rozmowa toczy się w panelu Allegro i tam się odpowiada.
   Lokalnie zostaje to, czego panel Allegro nie daje: kolejka z priorytetem
   wg terminu, właściciel sprawy, notatka z ustaleń i powiązanie ze zwrotem
   po numerze zamówienia.                                                     */

/** Awaria pracy z dyskusją. `kod` niesie status HTTP dla trasy (wzorzec BladPytania). */
export class BladDyskusji extends Error {
  constructor(
    message: string,
    readonly kod = 400
  ) {
    super(message);
    this.name = "BladDyskusji";
  }
}

/** Lokalne statusy — dozwolone przejścia ręką biura (`nowa` nadaje sync). */
export const STATUSY_DYSKUSJI = ["w_toku", "zamknieta", "pominieta"] as const;

/**
 * Statusy Allegro, po których sprawę zamykamy automatem. [WERYFIKUJ] na
 * własnym koncie: `/sale/issues` jest w becie i lista wartości końcowych nie
 * jest udokumentowana do końca. Nazwa spoza listy zostawia sprawę otwartą —
 * degradacja w stronę ręcznego ZAMKNIJ, nie błąd.
 */
export const FINALNE_STATUSY_ALLEGRO = ["CLOSED", "ENDED", "FINISHED"] as const;

export interface Dyskusja {
  id: number;
  allegroId: string;
  typ: string | null;
  statusAllegro: string | null;
  status: string;
  temat: string | null;
  kupujacyLogin: string | null;
  orderId: string | null;
  utworzonoAllegro: string | null;
  zwrotId: number | null;
  notatka: string | null;
  prowadzi: string | null;
  prowadziAt: string | null;
  zamknietoAt: string | null;
  zamknietoPrzez: string | null;
  /** Termin ustawowy — tylko dla typu CLAIM; rozmowa (DISCUSSION) nie ma zegara. */
  termin: string | null;
  dniDoTerminu: number | null;
  poTerminie: boolean;
}

const tekstLubNull = (v: unknown): string | null =>
  typeof v === "string" && v.trim() !== "" ? v : null;

function zWiersza(w: Record<string, unknown>, teraz: number = Date.now()): Dyskusja {
  /* Termin liczymy, nie pobieramy: `/sale/issues` nie zwraca żadnego zegara,
     a dla CLAIM obowiązuje ten sam termin ustawowy co przy reklamacjach ze
     zwrotów — więc liczy go ta sama funkcja, od zgłoszenia w Allegro. */
  const utworzono = tekstLubNull(w.utworzono_allegro);
  const claim = (w.typ as string | null) === "CLAIM" && utworzono !== null;
  const t = claim ? terminReklamacji(utworzono!, teraz) : null;
  return {
    id: w.id as number,
    allegroId: w.allegro_id as string,
    typ: tekstLubNull(w.typ),
    statusAllegro: tekstLubNull(w.status_allegro),
    status: w.status as string,
    temat: tekstLubNull(w.temat),
    kupujacyLogin: tekstLubNull(w.kupujacy_login),
    orderId: tekstLubNull(w.order_id),
    utworzonoAllegro: utworzono,
    zwrotId: (w.zwrot_id as number) ?? null,
    notatka: tekstLubNull(w.notatka),
    prowadzi: tekstLubNull(w.prowadzi),
    prowadziAt: tekstLubNull(w.prowadzi_at),
    zamknietoAt: tekstLubNull(w.zamknieto_at),
    zamknietoPrzez: tekstLubNull(w.zamknieto_przez),
    termin: t?.termin ?? null,
    dniDoTerminu: t?.dniDoTerminu ?? null,
    poTerminie: t ? t.dniDoTerminu < 0 : false,
  };
}

function wiersz(id: number): Record<string, unknown> {
  const w = db().prepare("SELECT * FROM dyskusja WHERE id = ?").get(id) as
    | Record<string, unknown>
    | undefined;
  if (!w) throw new BladDyskusji("Nie ma takiej dyskusji", 404);
  return w;
}

export function szczegolDyskusji(id: number): Dyskusja {
  return zWiersza(wiersz(id));
}

export function listaDyskusji(opcje: { status?: string; limit?: number } = {}): Dyskusja[] {
  const limit = Math.min(Math.max(opcje.limit ?? 100, 1), 500);
  /* Domyślnie WORKLISTA (nowe + w toku), nie archiwum — ta sama zasada co
     `listaPytan`. Filtr statusu i tryb `wszystkie` dają wgląd w resztę. */
  const wszystko = opcje.status === "wszystkie";
  const sql = wszystko
    ? "SELECT * FROM dyskusja ORDER BY utworzono_allegro DESC, id DESC LIMIT ?"
    : opcje.status
      ? "SELECT * FROM dyskusja WHERE status = ? ORDER BY utworzono_allegro DESC, id DESC LIMIT ?"
      : `SELECT * FROM dyskusja WHERE status IN ('nowa','w_toku')
         ORDER BY utworzono_allegro DESC, id DESC LIMIT ?`;
  const args = !wszystko && opcje.status ? [opcje.status, limit] : [limit];
  const teraz = Date.now();
  const lista = (db().prepare(sql).all(...args) as Array<Record<string, unknown>>).map((w) =>
    zWiersza(w, teraz)
  );
  /* Na workliście CLAIM-y z zegarem idą PRZED rozmowami, najpilniejsze na
     górze — pytanie biura brzmi „co się dziś przeterminuje", jak przy
     reklamacjach ze zwrotów. Archiwum zostaje chronologiczne. */
  if (!wszystko && !opcje.status) {
    lista.sort((a, b) => {
      if (a.dniDoTerminu !== null && b.dniDoTerminu !== null) {
        return a.dniDoTerminu - b.dniDoTerminu;
      }
      if (a.dniDoTerminu !== null) return -1;
      if (b.dniDoTerminu !== null) return 1;
      return 0; // rozmowy zostają w kolejności z SQL (najświeższe na górze)
    });
  }
  return lista;
}

/** Liczby do licznika na zakładce — odpytywane co 30 s, więc same COUNT-y. */
export function licznikDyskusji(): { nowe: number; wToku: number; claimyPoTerminie: number } {
  const w = db()
    .prepare(
      `SELECT
         SUM(CASE WHEN status = 'nowa'   THEN 1 ELSE 0 END) AS nowe,
         SUM(CASE WHEN status = 'w_toku' THEN 1 ELSE 0 END) AS w_toku
       FROM dyskusja`
    )
    .get() as { nowe: number | null; w_toku: number | null };
  /* Przeterminowane CLAIM-y liczymy w JS, nie w SQL: termin to arytmetyka
     `terminReklamacji` i drugie jej wydanie w SQL rozjechałoby się z listą. */
  const claimy = db()
    .prepare(
      `SELECT utworzono_allegro FROM dyskusja
       WHERE typ = 'CLAIM' AND status IN ('nowa','w_toku') AND utworzono_allegro IS NOT NULL`
    )
    .all() as Array<{ utworzono_allegro: string }>;
  const teraz = Date.now();
  const poTerminie = claimy.filter(
    (c) => terminReklamacji(c.utworzono_allegro, teraz).dniDoTerminu < 0
  ).length;
  return { nowe: w.nowe ?? 0, wToku: w.w_toku ?? 0, claimyPoTerminie: poTerminie };
}

export interface WynikSynchronizacjiDyskusji {
  nowych: number;
  zamknietychPrzezAllegro: number;
  przejrzanych: number;
}

/**
 * Ślad ostatniego pobrania — na ekran biura. W PAMIĘCI, nie w bazie, z tych
 * samych powodów co `stanSynchronizacji` przy pytaniach: po restarcie „nie
 * wiem, kiedy ostatnio pytaliśmy" jest prawdą, nie brakiem danych.
 */
export interface StanSynchronizacjiDyskusji {
  at: string;
  przez: string;
  nowych: number;
  zamknietychPrzezAllegro: number;
  przejrzanych: number;
}

let stanSynchronizacji: StanSynchronizacjiDyskusji | null = null;

export function stanSynchronizacjiDyskusji(): StanSynchronizacjiDyskusji | null {
  return stanSynchronizacji;
}

/** Powiązany zwrot po numerze zamówienia; NULL = zwrot jeszcze nie przyjechał. */
function znajdzZwrot(orderId: string | null): number | null {
  if (!orderId) return null;
  const w = db()
    .prepare("SELECT id FROM zwrot WHERE allegro_order_id = ? ORDER BY id DESC LIMIT 1")
    .get(orderId) as { id: number } | undefined;
  return w?.id ?? null;
}

/** Jeden przebieg synchronizacji: sprawy z `/sale/issues` do lokalnego rejestru. */
export async function synchronizujDyskusje(autor: string): Promise<WynikSynchronizacjiDyskusji> {
  const sprawy = await allegroAdapter().listaDyskusji();
  const d = db();
  const teraz = nowIso();

  /* Upsert po `allegro_id` — sync widuje tę samą sprawę w każdym przebiegu.
     Odświeżamy WYŁĄCZNIE pola Allegro; status naszej pracy, prowadzący
     i notatka są nasze i żaden przebieg nie ma prawa ich cofnąć. */
  const upsert = d.prepare(
    `INSERT INTO dyskusja
       (allegro_id, typ, status_allegro, temat, kupujacy_login, order_id,
        utworzono_allegro, zwrot_id, widziano_at, utworzono_at)
     VALUES (?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(allegro_id) DO UPDATE SET
       typ = excluded.typ,
       status_allegro = excluded.status_allegro,
       temat = excluded.temat,
       kupujacy_login = excluded.kupujacy_login,
       order_id = excluded.order_id,
       utworzono_allegro = excluded.utworzono_allegro,
       widziano_at = excluded.widziano_at,
       zwrot_id = COALESCE(dyskusja.zwrot_id, excluded.zwrot_id)`
  );

  const istnieje = d.prepare("SELECT 1 AS jest FROM dyskusja WHERE allegro_id = ?");

  let nowych = 0;
  let zamknietychPrzezAllegro = 0;
  for (const s of sprawy) {
    if (!s.id) continue;
    /* `changes` po upsercie nie odróżnia insertu od update'u, więc nowość
       sprawdzamy wprost, PRZED zapisem — dwa procesy nie ścigają się tu
       o ten sam wiersz (sync odpala ticker albo klik, nie oba naraz). */
    const znana = istnieje.get(s.id) !== undefined;
    /* Zwrot dopasowujemy przy KAŻDYM przebiegu, nie tylko przy insercie:
       paczka bywa skanowana dni po pojawieniu się dyskusji, a COALESCE
       w upsercie pilnuje, żeby raz znalezione wiązanie już nie znikło. */
    const zwrotId = znajdzZwrot(s.orderId);
    upsert.run(
      s.id,
      s.typ,
      s.status,
      s.temat,
      s.kupujacyLogin,
      s.orderId,
      s.utworzono,
      zwrotId,
      teraz,
      teraz
    );
    if (!znana) nowych++;

    /* Sprawa rozstrzygnięta w panelu Allegro ma zejść z naszej kolejki sama —
       inaczej licznik kłamałby w nieskończoność o sprawach dawno zamkniętych.
       Zamykamy TYLKO otwarte i podpisujemy `allegro`, żeby audyt odróżniał
       automat od decyzji człowieka. */
    if (
      s.status &&
      (FINALNE_STATUSY_ALLEGRO as readonly string[]).includes(s.status)
    ) {
      const zamkniete = d
        .prepare(
          `UPDATE dyskusja
              SET status = 'zamknieta', zamknieto_at = ?, zamknieto_przez = 'allegro'
            WHERE allegro_id = ? AND status IN ('nowa','w_toku')`
        )
        .run(teraz, s.id);
      if (zamkniete.changes > 0) {
        zamknietychPrzezAllegro++;
        logEvent("dyskusja_zamknieta", "allegro", null, {
          allegroId: s.id,
          statusAllegro: s.status,
        });
      }
    }
  }

  if (nowych > 0) {
    logEvent("dyskusja_sync", autor, null, { nowych, przejrzanych: sprawy.length });
  }
  stanSynchronizacji = {
    at: teraz,
    przez: autor,
    nowych,
    zamknietychPrzezAllegro,
    przejrzanych: sprawy.length,
  };
  return { nowych, zamknietychPrzezAllegro, przejrzanych: sprawy.length };
}

/**
 * Kto wziął sprawę — ZNACZNIK, nie zamek (ta sama doktryna co
 * `stempelProwadzi` przy pytaniach): nazwisko pojawia się przy zapisie, który
 * i tak następuje, cudzej sprawy nikt nie musi odbijać, a ostatni pracujący
 * podmienia nazwisko. Samo patrzenie na ekran niczego nie zajmuje.
 */
export function stempelProwadziDyskusji(id: number, autor: string): void {
  db()
    .prepare("UPDATE dyskusja SET prowadzi = ?, prowadzi_at = datetime('now') WHERE id = ?")
    .run(autor, id);
}

export function zmienStatusDyskusji(id: number, status: string, autor: string): Dyskusja {
  if (!(STATUSY_DYSKUSJI as readonly string[]).includes(status)) {
    throw new BladDyskusji(
      `Nieznany status „${status}” — dozwolone: ${STATUSY_DYSKUSJI.join(", ")}`
    );
  }
  const w = wiersz(id);
  const obecny = w.status as string;
  /* Sprawy zamkniętej nie przestawiamy dalej — 409, bo drugi klik z sąsiedniego
     biurka to najpewniej ta sama decyzja podjęta dwa razy, nie nowa. Powrót
     do `w_toku` zostaje możliwy: pomyłkę przy zamykaniu prostuje się samemu. */
  if (obecny === status) {
    throw new BladDyskusji(`Dyskusja jest już w statusie „${status}”`, 409);
  }
  const zamykamy = status === "zamknieta" || status === "pominieta";
  db()
    .prepare(
      `UPDATE dyskusja
          SET status = ?, prowadzi = ?, prowadzi_at = datetime('now'),
              zamknieto_at = ?, zamknieto_przez = ?
        WHERE id = ?`
    )
    .run(status, autor, zamykamy ? nowIso() : null, zamykamy ? autor : null, id);
  logEvent(`dyskusja_${status}`, autor, null, { dyskusjaId: id, poprzedni: obecny });
  return szczegolDyskusji(id);
}

export function zapiszNotatkeDyskusji(id: number, notatka: string, autor: string): Dyskusja {
  wiersz(id); // 404, zanim cokolwiek zapiszemy
  const tresc = notatka.trim() || null;
  /* Notatka to zapis USTALEŃ z panelu Allegro — jedyna treść, jaka u nas
     zostaje. Pisanie jej JEST braniem sprawy, więc stempluje prowadzącego
     (ta sama zasada co `zapiszOdpowiedz` przy pytaniach). */
  db()
    .prepare(
      "UPDATE dyskusja SET notatka = ?, prowadzi = ?, prowadzi_at = datetime('now') WHERE id = ?"
    )
    .run(tresc, autor, id);
  logEvent("dyskusja_notatka", autor, null, { dyskusjaId: id, jest: tresc !== null });
  return szczegolDyskusji(id);
}

/**
 * Pętla synchronizacji dyskusji — wołana z `main()`, nigdy z `buildApp()`
 * (testy tras nie mają prawa strzelać do Allegro).
 *
 * Dzieli interwał z zapowiedziami i pytaniami (`ALLEGRO_POLL_MS`): ten sam
 * rodzaj pracy w tle na tym samym koncie, osobne pokrętło niczego by nie
 * dostroiło. Domyślnie zero — pobiera człowiek, kiedy tego potrzebuje.
 */
export function uruchomTickerDyskusji(): void {
  if (config.zwroty.pollMs <= 0) return;
  const przebieg = () => {
    /* Ten sam strażnik co w tickerach zapowiedzi i pytań: bez sparowanego
       konta przebieg tylko zapełniałby log błędem o brakującym tokenie. */
    const stan = stanPolaczenia().stan;
    if (stan !== "dev" && stan !== "polaczone") return;
    synchronizujDyskusje("ticker")
      .then(({ nowych }) => {
        if (nowych > 0) console.log(`[dyskusje] nowych spraw z Allegro: ${nowych}`);
      })
      .catch((e) =>
        console.error("[dyskusje] przebieg nieudany:", e instanceof Error ? e.message : e)
      );
  };
  przebieg();
  setInterval(przebieg, config.zwroty.pollMs);
}
