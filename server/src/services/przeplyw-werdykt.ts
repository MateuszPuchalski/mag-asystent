import type { DatabaseSync } from "node:sqlite";
import { transaction } from "../db/db.js";
import { logEvent } from "./events.js";
import { publishConversationEvent } from "./conversation-realtime.js";
import { ustawPriorytet } from "./conversations.js";
import { zlecPomiar } from "./skrzynka.js";
import { biezacaDecyzja, naPropozycje, type PropozycjaPrzeplywu } from "./przeplyw-kategorii.js";

/* ── Werdykt agenta o propozycji przepływu (tryb cienia) ────────────────────
   Osobno od `przeplyw-kategorii.ts`, bo zgoda wykonuje krok przez
   `skrzynka.ts` i `conversations.ts`. Obie czytają stałe klasyfikatora już
   przy ładowaniu, a klasyfikator czyta przepływy do pomiaru. W jednym
   module dałoby to cykl, który wywraca start serwera. */

/** Błąd z kodem HTTP — trasa tłumaczy go bez zgadywania po treści. */
export class BladPrzeplywu extends Error {
  constructor(message: string, readonly kod: 400 | 404 | 409) { super(message); }
}

/**
 * Werdykt agenta dla „krok" i „pilne". Zgoda wykonuje krok, który automat
 * proponował, bo agent właśnie go zlecił. Sprzeciw zapisuje tylko werdykt.
 *
 * Werdykt idzie PO udanym kroku, nie w jednej transakcji z nim. Krok otwiera
 * własne transakcje, a SQLite nie zagnieżdża `BEGIN`. Funkcja jest
 * synchroniczna, więc dwa żądania nie przeplotą się między sprawdzeniem
 * a zapisem.
 */
export function werdyktPropozycji(
  database: DatabaseSync, conversationId: number, propozycjaId: number,
  werdykt: "zgoda" | "sprzeciw", autor: { id: number; name: string }, teraz = new Date(),
): PropozycjaPrzeplywu {
  if (werdykt !== "zgoda" && werdykt !== "sprzeciw") {
    throw new BladPrzeplywu("Werdykt to „zgoda” albo „sprzeciw”.", 400);
  }
  const p = database.prepare("SELECT * FROM propozycja_przeplywu WHERE id=?").get(propozycjaId) as
    Record<string, unknown> | undefined;
  /* Cudza propozycja dostaje 404, a nie 403: nie potwierdzamy, że istnieje. */
  if (!p || Number(p.conversation_id) !== conversationId) {
    throw new BladPrzeplywu("Nie znaleziono propozycji w tej rozmowie", 404);
  }
  /* „Wyślij" ocenia wysyłka: los szkicu jest twardszym dowodem niż klik.
     Wyjątek to szkic wysłany przez automat. Tam losu nie ma, bo nikt go nie
     poprawiał, więc jedynym dowodem jest przegląd agenta po fakcie. */
  const wyslanaSama = p.rodzaj === "wyslij" && p.wykonana_at != null;
  if (p.rodzaj === "wyslij" && !wyslanaSama) {
    throw new BladPrzeplywu("Wysyłkę ocenia sama wysyłka szkicu, nie przycisk", 400);
  }
  if (p.werdykt != null) throw new BladPrzeplywu("Ta propozycja ma już werdykt", 409);
  if (wyslanaSama) {
    /* Bez sprawdzenia bieżącej decyzji: odpowiedź już poszła, a dopisek
       klienta po niej nie zmienia, czy automat odpisał dobrze. Zgoda niczego
       nie wykonuje, bo wykonał ją automat. */
    zapiszWerdykt(database, conversationId, propozycjaId, p, werdykt, autor, teraz);
    return naPropozycje(database.prepare("SELECT * FROM propozycja_przeplywu WHERE id=?")
      .get(propozycjaId) as Record<string, unknown>);
  }
  const biezaca = database.prepare(`SELECT k.id ${biezacaDecyzja()} WHERE c.id = ?`)
    .get(conversationId) as { id: number } | undefined;
  /* Krok pod stare rozpoznanie zleciłby hali coś, czego klient już nie chce. */
  if (!biezaca || Number(biezaca.id) !== Number(p.decyzja_id)) {
    throw new BladPrzeplywu("Rozpoznanie się zmieniło — ta propozycja jest nieaktualna", 409);
  }

  if (werdykt === "zgoda" && p.rodzaj === "pilne") {
    const r = database.prepare("SELECT priorytet FROM conversation WHERE id=?")
      .get(conversationId) as { priorytet: string };
    /* Już pilna nie dostaje drugiego wpisu na osi „z pilny na pilny". */
    if (r.priorytet !== "pilny") ustawPriorytet(database, conversationId, "pilny", autor.id);
  }
  if (werdykt === "zgoda" && p.rodzaj === "krok") {
    const r = database.prepare("SELECT subject FROM conversation WHERE id=?")
      .get(conversationId) as { subject: string | null };
    zlecPomiar(conversationId, Number(p.message_id), String(p.instrukcja ?? ""), autor, null,
      { rodzaj: "weryfikacja", tytul: `Weryfikacja z rozmowy — ${r.subject ?? "klient"}` });
  }

  zapiszWerdykt(database, conversationId, propozycjaId, p, werdykt, autor, teraz);
  return naPropozycje(database.prepare("SELECT * FROM propozycja_przeplywu WHERE id=?")
    .get(propozycjaId) as Record<string, unknown>);
}

function zapiszWerdykt(
  database: DatabaseSync, conversationId: number, propozycjaId: number, p: Record<string, unknown>,
  werdykt: "zgoda" | "sprzeciw", autor: { id: number; name: string }, teraz: Date,
): void {
  transaction(database, () => {
    database.prepare(`UPDATE propozycja_przeplywu SET werdykt=?, werdykt_zrodlo='agent',
      werdykt_at=?, werdykt_przez=?, werdykt_user_id=? WHERE id=? AND werdykt IS NULL`)
      .run(werdykt, teraz.toISOString(), autor.name, autor.id, propozycjaId);
    logEvent("przeplyw_werdykt", autor.name, null, {
      conversationId, propozycjaId, rodzaj: String(p.rodzaj), kategoria: String(p.kategoria), werdykt,
      ...(p.wykonana_at != null ? { naZywo: true } : {}),
    }, autor.id, database);
  })();
  publishConversationEvent("assignment.changed", conversationId, { przeplyw: true });
}
