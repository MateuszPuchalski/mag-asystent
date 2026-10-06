import type { DatabaseSync } from "node:sqlite";
import { config } from "../config.js";
import { db as defaultDb, transaction } from "../db/db.js";
import { allegroTryb, BladLimituAllegro, BladOdpowiedziAllegro } from "../adapters/allegro.js";
import { logEvent } from "./events.js";
import { publishConversationEvent, trzymajacy } from "./conversation-realtime.js";
import { ConversationConflict } from "./conversations.js";
import { niejednoznaczny } from "./idempotencja.js";
import {
  wyslijDoAllegro, type OznaczPrzeczytany, type WyslijDoAllegro,
} from "./allegro-wysylka.js";
import { kluczIdempotencji, wyslijOdpowiedz } from "./wysylka.js";
import { biezacaDecyzja, kategorieNaZywo } from "./przeplyw-kategorii.js";

/* ── Przepływ kategorii na żywo (6 października 2026) ───────────────────────
   Decyzja właściciela: „build the live mode for order status". To jest
   PIERWSZA droga w kodzie, którą odpowiedź idzie do klienta bez kliknięcia
   człowieka. Dlatego każda wątpliwość rozstrzyga się na „nie wysyłaj":
   agent i tak zobaczy rozmowę, a odpowiedzi wysłanej nie da się cofnąć.

   WŁĄCZA JĄ WYŁĄCZNIE PLIK. Pusta `PRZEPLYW_NA_ZYWO` kończy funkcję przed
   pierwszym zapytaniem do bazy, więc serwer zachowuje się jak w trybie cienia.
   Kategoria z pliku przechodzi przez `NA_ZYWO_MOZLIWE`, czyli listę
   przejrzaną w kodzie.

   SIEDEM WARUNKÓW, w kolejności z kontraktu. Niespełniony warunek to ciche
   pominięcie bez zapisu: kandydat zostaje i agent obsłuży go ręcznie.
   Zbiorczy wpis dziennika na koniec przebiegu mówi, ile i dlaczego.

   BŁĄD NIE JEST PONAWIANY. Wysyłka, która padła, zapisuje powód przy
   propozycji i wypada z kandydatów. Ponowienie co takt szłoby na koszt
   klienta, a po niejednoznacznym timeoucie §8.5 zabrania go w ogóle. */

/** Nazwa konta automatu: autor wiadomości na osi i w dzienniku. */
export const NAZWA_AUTOMATU = "Automat";

/**
 * Konto-ślad automatu. `outbox.created_by` wymaga konta, a wysyłka podpisu.
 *
 * Bez loginu, bez hasła i nieaktywne: `userByLogin` wymaga loginu i
 * `active = 1`, a `zaloguj` hasła. Trzy niezależne zamki, bo to konto
 * wysyła do klientów i nikt nie ma prawa się nim posłużyć.
 *
 * Zakładane leniwie, przy pierwszej wysyłce. Przy starcie byłoby zapisem
 * na każdej instalacji, także tej z wyłączonym trybem na żywo.
 */
export function kontoAutomatu(database: DatabaseSync): { id: number; name: string } {
  const jest = database.prepare(`SELECT user_id FROM app_user
    WHERE name = ? AND login IS NULL AND haslo_hash IS NULL ORDER BY user_id LIMIT 1`)
    .get(NAZWA_AUTOMATU) as { user_id: number } | undefined;
  if (jest) return { id: Number(jest.user_id), name: NAZWA_AUTOMATU };
  const id = Number(database.prepare(`INSERT INTO app_user(login, haslo_hash, name, role, active)
    VALUES (NULL, NULL, ?, 'biuro', 0)`).run(NAZWA_AUTOMATU).lastInsertRowid);
  logEvent("przeplyw_na_zywo_konto", NAZWA_AUTOMATU, null, { userId: id }, id, database);
  return { id, name: NAZWA_AUTOMATU };
}

export interface NaZywoDeps {
  database?: DatabaseSync;
  /** Wysyłka do Allegro. Wstrzykiwana, żeby test nie szedł w sieć. */
  wyslij?: WyslijDoAllegro;
  oznaczPrzeczytany?: OznaczPrzeczytany;
  /** Surowa lista z pliku; przecięcie z `NA_ZYWO_MOZLIWE` robi funkcja. */
  naZywo?: readonly string[];
  naGodzine?: number;
  now?: () => Date;
}

export interface WynikNaZywo {
  wyslanych: number;
  pominietych: number;
  bledow: number;
  /** Zdanie dla dziennika, gdy przebieg stanął. `null` = doszedł do końca. */
  przerwane: string | null;
}

/** Powody pominięcia, w kolejności warunków. Klucze idą do dziennika. */
type Powod = "decyzja" | "odpisano" | "szkic" | "agentPisze" | "przydzial" | "obecnosc" | "konflikt";

const NIC: WynikNaZywo = { wyslanych: 0, pominietych: 0, bledow: 0, przerwane: null };

/** Długość powodu przy propozycji. Komunikat Allegro bywa długi, a karta ma jeden wiersz. */
const BLAD_ZNAKOW = 300;

/** Ile wysłał automat w ostatniej godzinie. Z bazy, bo restart nie zeruje rachunku klienta. */
function wyslaneWGodzinie(database: DatabaseSync, teraz: Date): number {
  const od = new Date(teraz.getTime() - 3_600_000).toISOString();
  return Number((database.prepare(`SELECT COUNT(*) AS n FROM propozycja_przeplywu
    WHERE wykonana_at IS NOT NULL AND wykonana_at >= ?`).get(od) as { n: number }).n);
}

/** Błąd, po którym następna wysyłka też padnie: limit, odrzucony token, brak uprawnienia. */
const stanAllegro = (e: unknown) => e instanceof BladLimituAllegro
  || (e instanceof BladOdpowiedziAllegro && (e.status === 401 || e.status === 403));

/**
 * Wysyła sam szkic „wyslij" w kategoriach włączonych na żywo, dla podanych
 * rozmów. Wołana zaraz po `zapiszPropozycje`, bo kandydatem jest propozycja.
 */
export async function wyslijNaZywo(rozmowyId: number[], deps: NaZywoDeps = {}): Promise<WynikNaZywo> {
  const kategorie = kategorieNaZywo(deps.naZywo ?? config.przeplyw.naZywo);
  if (kategorie.length === 0 || rozmowyId.length === 0) return { ...NIC };
  /* W trybie `dev` nie ma dokąd wysłać. Wstrzyknięta funkcja bije tryb, bo
     test chce sprawdzić właśnie wysyłkę. Ta sama reguła co przy oznaczeniu
     wątku jako przeczytanego w `wysylka.ts`. */
  const wyslij = deps.wyslij ?? (allegroTryb() === "http" ? wyslijDoAllegro : null);
  if (!wyslij) return { ...NIC };

  const database = deps.database ?? defaultDb();
  const now = deps.now ?? (() => new Date());
  const naGodzine = deps.naGodzine ?? config.przeplyw.naZywoNaGodzine;

  const kandydaci = database.prepare(`SELECT id, conversation_id, message_id, decyzja_id, kategoria
      FROM propozycja_przeplywu
     WHERE rodzaj = 'wyslij' AND werdykt IS NULL AND wykonana_at IS NULL AND wykonanie_blad IS NULL
       AND kategoria IN (${kategorie.map(() => "?").join(",")})
       AND conversation_id IN (${rozmowyId.map(() => "?").join(",")})
     ORDER BY id`).all(...kategorie, ...rozmowyId) as Array<{
      id: number; conversation_id: number; message_id: number; decyzja_id: number; kategoria: string }>;
  if (kandydaci.length === 0) return { ...NIC };

  const powody: Partial<Record<Powod, number>> = {};
  const pomin = (p: Powod) => { powody[p] = (powody[p] ?? 0) + 1; };
  const w: WynikNaZywo = { ...NIC };

  for (const p of kandydaci) {
    const rozmowa = Number(p.conversation_id);
    const wiadomosc = Number(p.message_id);

    /* 1. Odpowiadamy na to, o co klient pyta TERAZ. Dopisek albo poprawka
          kategorii zmienia pytanie, a szkic odpowiada na stare. */
    const biezaca = database.prepare(`SELECT k.id AS decyzja, m.id AS wiadomosc, m.sent_at
      ${biezacaDecyzja()} WHERE c.id = ?`).get(rozmowa) as
      { decyzja: number; wiadomosc: number; sent_at: string } | undefined;
    if (!biezaca || Number(biezaca.decyzja) !== Number(p.decyzja_id)
      || Number(biezaca.wiadomosc) !== wiadomosc) { pomin("decyzja"); continue; }

    /* 2. Ktoś już odpisał albo właśnie odpisuje. Wiersz kolejki łapie
          wysyłkę w locie i niepewną, której wiadomości jeszcze nie ma. */
    const odpisano = database.prepare(`SELECT 1 FROM message
       WHERE conversation_id = ? AND direction = 'outgoing' AND sent_at >= ?
      UNION ALL
      SELECT 1 FROM outbox WHERE conversation_id = ? AND expected_last_message_id = ?
         AND status <> 'send_failed'
      LIMIT 1`).get(rozmowa, biezaca.sent_at, rozmowa, wiadomosc);
    if (odpisano) { pomin("odpisano"); continue; }

    /* 3. Szkic pod tę wiadomość i tę decyzję, bez zastrzeżeń, nieodrzucony
          i nieruszony przez agenta. Zastrzeżenie znaczy, że model czegoś
          nie wiedział, a wtedy zgaduje on, nie fakty. */
    const szkic = database.prepare(`SELECT tresc, message_id, decyzja_id, zastrzezenia, ocena
      FROM szkic_copilota WHERE conversation_id = ?`).get(rozmowa) as
      { tresc: string; message_id: number | null; decyzja_id: number | null;
        zastrzezenia: string | null; ocena: string | null } | undefined;
    if (!szkic || Number(szkic.message_id) !== wiadomosc
      || Number(szkic.decyzja_id) !== Number(p.decyzja_id)
      || szkic.ocena !== null || !bezZastrzezen(szkic.zastrzezenia)
      || !String(szkic.tresc ?? "").trim()) { pomin("szkic"); continue; }

    /* 4. Agent coś pisze albo dołożył plik. Wysyłka zabrałaby jego załącznik
          do odpowiedzi automatu i skasowała mu szkic. */
    const pisze = database.prepare(`SELECT 1 FROM conversation_draft
       WHERE conversation_id = ? AND TRIM(body) <> ''
      UNION ALL
      SELECT 1 FROM wysylka_zalacznik WHERE conversation_id = ?
      LIMIT 1`).get(rozmowa, rozmowa);
    if (pisze) { pomin("agentPisze"); continue; }

    /* 5. Rozmowę prowadzi człowiek, więc ruch należy do niego. */
    const c = database.prepare("SELECT assigned_user_id, version FROM conversation WHERE id = ?")
      .get(rozmowa) as { assigned_user_id: number | null; version: number };
    if (c.assigned_user_id !== null) { pomin("przydzial"); continue; }

    /* 6. Ktoś siedzi przy rozmowie. Uchwyt żyje w pamięci procesu. */
    if (trzymajacy(rozmowa) !== null) { pomin("obecnosc"); continue; }

    /* 7. Sufit godzinowy. Liczony przed każdą wysyłką, bo poprzednia go zjada. */
    const teraz = now();
    if (wyslaneWGodzinie(database, teraz) >= naGodzine) {
      w.przerwane = "sufit godzinowy wyczerpany";
      logEvent("przeplyw_na_zywo_sufit", NAZWA_AUTOMATU, null,
        { naGodzine, czekalo: kandydaci.length }, null, database);
      break;
    }

    const autor = kontoAutomatu(database);
    const tresc = String(szkic.tresc);
    try {
      const r = await wyslijOdpowiedz({
        conversationId: rozmowa, autor, body: tresc, expectedVersion: Number(c.version),
        expectedLastMessageId: wiadomosc, zakoncz: false, automat: true,
        database, wyslij, oznaczPrzeczytany: deps.oznaczPrzeczytany,
      });
      if (r.status === "sent") {
        transaction(database, () => {
          database.prepare(`UPDATE propozycja_przeplywu SET wykonana_at = ?, outbox_id = ?
            WHERE id = ?`).run(now().toISOString(), r.outboxId, p.id);
          logEvent("przeplyw_wyslane_na_zywo", autor.name, null, {
            conversationId: rozmowa, propozycjaId: p.id, kategoria: p.kategoria, outboxId: r.outboxId,
          }, autor.id, database);
        })();
        publishConversationEvent("assignment.changed", rozmowa, { przeplyw: true });
        w.wyslanych++;
      } else {
        /* Allegro przyjęło żądanie bez numeru wiadomości. Mogła dojść, więc
           rozstrzyga synchronizacja, a automat nie próbuje drugi raz. */
        zapiszBlad(database, p, autor, "niepewna", r.outboxId);
        w.bledow++;
      }
    } catch (e) {
      if (e instanceof ConversationConflict) { pomin("konflikt"); continue; }
      const outboxId = (database.prepare("SELECT id FROM outbox WHERE idempotency_key = ?")
        .get(kluczIdempotencji(rozmowa, wiadomosc, tresc.trim())) as { id: number } | undefined)?.id ?? null;
      const komunikat = e instanceof Error ? e.message : String(e);
      if (niejednoznaczny(e)) {
        /* Timeout mógł dowieźć wiadomość. Następna wysyłka trafiłaby w tę
           samą sieć i zostawiła kolejną niepewną, więc przebieg staje. */
        zapiszBlad(database, p, autor, "niepewna", outboxId);
        w.bledow++;
        w.przerwane = komunikat;
        break;
      }
      if (stanAllegro(e)) {
        /* Nic nie wyszło, a następna próba padnie tak samo. Propozycja
           zostaje bez błędu, bo winne jest konto, nie ta odpowiedź. */
        logEvent("przeplyw_na_zywo_blad", autor.name, null,
          { conversationId: rozmowa, propozycjaId: p.id, outboxId, blad: komunikat, przerwane: true },
          autor.id, database);
        w.bledow++;
        w.przerwane = komunikat;
        break;
      }
      zapiszBlad(database, p, autor, komunikat, outboxId);
      w.bledow++;
    }
  }

  w.pominietych = Object.values(powody).reduce((a, b) => a + (b ?? 0), 0);
  logEvent("przeplyw_na_zywo", NAZWA_AUTOMATU, null, {
    kandydatow: kandydaci.length, wyslanych: w.wyslanych, pominietych: w.pominietych,
    bledow: w.bledow, przerwane: w.przerwane, powody,
  }, null, database);
  return w;
}

/** Pusta lista zastrzeżeń. Uszkodzony JSON to brak wiedzy, więc nie wysyłamy. */
function bezZastrzezen(json: string | null): boolean {
  try {
    const lista = JSON.parse(json ?? "[]") as unknown;
    return Array.isArray(lista) && lista.length === 0;
  } catch {
    return false;
  }
}

/** Powód przy propozycji i wpis w dzienniku. Propozycja z powodem nie wraca do kandydatów. */
function zapiszBlad(
  database: DatabaseSync, p: { id: number; conversation_id: number; kategoria: string },
  autor: { id: number; name: string }, blad: string, outboxId: number | null,
): void {
  const krotki = blad.slice(0, BLAD_ZNAKOW);
  transaction(database, () => {
    database.prepare(`UPDATE propozycja_przeplywu SET wykonanie_blad = ?, outbox_id = ?
      WHERE id = ?`).run(krotki, outboxId, p.id);
    logEvent("przeplyw_na_zywo_blad", autor.name, null, {
      conversationId: Number(p.conversation_id), propozycjaId: p.id, kategoria: p.kategoria,
      outboxId, blad: krotki,
    }, autor.id, database);
  })();
  publishConversationEvent("assignment.changed", Number(p.conversation_id), { przeplyw: true });
}
