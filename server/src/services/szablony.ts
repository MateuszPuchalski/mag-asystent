import type { DatabaseSync } from "node:sqlite";
import { db, transaction } from "../db/db.js";
import { logEvent } from "./events.js";
import { imieAutora } from "./conversations.js";

/* ── Szablony odpowiedzi (0.399.0) ───────────────────────────────────────────
   Zgłoszenie właściciela: „dodaj ten szablon do szablonów odpowiedzi
   w skrzynce". Szablonów nie było wcale — §10.4 projektu panelu wymieniał je
   wśród rzeczy planowanych i sam pisał „Nie ma szablonów".

   TREŚĆ WCHODZI DOSŁOWNIE, bez podstawiania numerów i imion. Podstawienie
   znaczyłoby, że zła wartość wjeżdża do wiadomości WYSŁANEJ do klienta, a agent
   zobaczy ją dopiero po fakcie. Zaoszczędzone przepisanie numeru nie równoważy
   kosztu takiej pomyłki, a wstawka i tak ląduje w szkicu do przeczytania.

   TO NIE JEST AUTOODPOWIEDŹ. Szablon wchodzi do szkicu na kliknięcie agenta
   i dalej wymaga „Wyślij do klienta" — druga zasada nadrzędna projektu panelu
   mówi, że treść wychodzi z WERTIS wyłącznie na kliknięcie człowieka.        */

export interface Szablon {
  id: number;
  nazwa: string;
  tresc: string;
  utworzono: string;
  utworzyl: string;
  zmieniono: string | null;
  zmienil: string | null;
}

const tekst = (v: unknown): string | null => {
  const s = v == null ? "" : String(v).trim();
  return s === "" ? null : s;
};

/** Limit długości nazwy i treści — ten sam, co przy notatce biura. */
const MAKS_NAZWA = 120;
/**
 * Treść nie może przekroczyć limitu Allegro dla jednej wiadomości.
 *
 * `NewMessageInThread.text` ma `maxLength: 2000` (patrz `services/wysylka.ts`).
 * Szablon dłuższy dałoby się zapisać, ale jego wstawienie robiłoby szkic
 * niewysyłalnym — a agent dowiedziałby się o tym dopiero przy wysyłce.
 */
const MAKS_TRESC = 2000;

function sprawdz(nazwa: string, tresc: string): { nazwa: string; tresc: string } {
  const n = tekst(nazwa);
  const t = tekst(tresc);
  if (!n) throw new Error("Szablon musi mieć nazwę");
  if (!t) throw new Error("Szablon bez treści nie ma czego wstawić");
  if (n.length > MAKS_NAZWA) throw new Error(`Nazwa ma najwyżej ${MAKS_NAZWA} znaków`);
  if (t.length > MAKS_TRESC) {
    throw new Error(
      `Allegro przyjmuje najwyżej ${MAKS_TRESC} znaków, a szablon ma ${t.length}`);
  }
  return { nazwa: n, tresc: t };
}

const zWiersza = (w: Record<string, unknown>): Szablon => ({
  id: Number(w.id), nazwa: String(w.nazwa), tresc: String(w.tresc),
  utworzono: String(w.utworzono), utworzyl: String(w.utworzyl ?? ""),
  zmieniono: tekst(w.zmieniono), zmienil: tekst(w.zmienil),
});

/**
 * Lista do wyboru w edytorze — bez archiwalnych, po nazwie.
 *
 * PO NAZWIE, nie po dacie dodania: agent uczy się miejsca na liście, a kolejność
 * zmieniająca się przy każdej poprawce kazałaby czytać ją od nowa za każdym
 * razem. Odczyt niczego nie mutuje („zero zapisu przy patrzeniu").
 */
export function listaSzablonow(database: DatabaseSync = db()): Szablon[] {
  return (database.prepare(`SELECT id, nazwa, tresc, utworzono, utworzyl, zmieniono, zmienil
    FROM szablon_odpowiedzi WHERE archiwalny = 0 ORDER BY nazwa COLLATE NOCASE`)
    .all() as Array<Record<string, unknown>>).map(zWiersza);
}

export function dodajSzablon(
  nazwa: string, tresc: string, autorId: number, database: DatabaseSync = db(),
): Szablon {
  const dane = sprawdz(nazwa, tresc);
  const autor = imieAutora(database, autorId);
  return transaction(database, () => {
    /* Nazwa jest UNIQUE także wśród ARCHIWALNYCH, więc kolizję trzeba nazwać
       zdaniem. Gołe „UNIQUE constraint failed" mówi agentowi tyle, co nic. */
    const zajeta = database.prepare(
      "SELECT archiwalny FROM szablon_odpowiedzi WHERE nazwa = ? COLLATE NOCASE")
      .get(dane.nazwa) as { archiwalny: number } | undefined;
    if (zajeta) {
      throw new Error(Number(zajeta.archiwalny) === 1
        ? "Szablon o tej nazwie leży w archiwum — przywróć go zamiast zakładać drugi"
        : "Szablon o tej nazwie już jest");
    }
    const id = Number(database.prepare(
      "INSERT INTO szablon_odpowiedzi(nazwa, tresc, utworzyl) VALUES (?,?,?)")
      .run(dane.nazwa, dane.tresc, autor).lastInsertRowid);
    /* Do dziennika idzie DŁUGOŚĆ, nie treść — ta sama zasada, co przy notatce
       biura: `events` nie ma retencji, a szablon bywa zdaniem o kliencie. */
    logEvent("szablon_dodany", autor, null, { id, nazwa: dane.nazwa, znakow: dane.tresc.length },
      undefined, database);
    return zWiersza(database.prepare(
      `SELECT id, nazwa, tresc, utworzono, utworzyl, zmieniono, zmienil
         FROM szablon_odpowiedzi WHERE id = ?`).get(id) as Record<string, unknown>);
  })();
}

export function zmienSzablon(
  id: number, nazwa: string, tresc: string, autorId: number, database: DatabaseSync = db(),
): Szablon {
  const dane = sprawdz(nazwa, tresc);
  const autor = imieAutora(database, autorId);
  return transaction(database, () => {
    const jest = database.prepare("SELECT id FROM szablon_odpowiedzi WHERE id = ?").get(id);
    if (!jest) throw new Error("Nie ma takiego szablonu");
    const kolizja = database.prepare(
      "SELECT id FROM szablon_odpowiedzi WHERE nazwa = ? COLLATE NOCASE AND id <> ?")
      .get(dane.nazwa, id);
    if (kolizja) throw new Error("Szablon o tej nazwie już jest");
    database.prepare(`UPDATE szablon_odpowiedzi
        SET nazwa = ?, tresc = ?, zmieniono = strftime('%Y-%m-%dT%H:%M:%fZ','now'), zmienil = ?
      WHERE id = ?`).run(dane.nazwa, dane.tresc, autor, id);
    logEvent("szablon_zmieniony", autor, null,
      { id, nazwa: dane.nazwa, znakow: dane.tresc.length }, undefined, database);
    return zWiersza(database.prepare(
      `SELECT id, nazwa, tresc, utworzono, utworzyl, zmieniono, zmienil
         FROM szablon_odpowiedzi WHERE id = ?`).get(id) as Record<string, unknown>);
  })();
}

/**
 * Zdjęcie szablonu z listy.
 *
 * ARCHIWUM, NIE KASOWANIE (§25a.5). Szablon zszedł z listy, bo zdanie się
 * zdezaktualizowało — ale wisi przy nim historia tego, co wysłaliśmy klientom,
 * a pomyłkę w kliknięciu ma cofać przywrócenie, nie odtwarzanie treści z głowy.
 */
export function zarchiwizujSzablon(
  id: number, archiwalny: boolean, autorId: number, database: DatabaseSync = db(),
): void {
  const autor = imieAutora(database, autorId);
  transaction(database, () => {
    const w = database.prepare("SELECT nazwa FROM szablon_odpowiedzi WHERE id = ?").get(id) as
      { nazwa: string } | undefined;
    if (!w) throw new Error("Nie ma takiego szablonu");
    database.prepare("UPDATE szablon_odpowiedzi SET archiwalny = ? WHERE id = ?")
      .run(archiwalny ? 1 : 0, id);
    logEvent(archiwalny ? "szablon_zdjety" : "szablon_przywrocony", autor, null,
      { id, nazwa: w.nazwa }, undefined, database);
  })();
}

/** Szablony zdjęte z listy — do przywrócenia, osobnym odczytem. */
export function archiwumSzablonow(database: DatabaseSync = db()): Szablon[] {
  return (database.prepare(`SELECT id, nazwa, tresc, utworzono, utworzyl, zmieniono, zmienil
    FROM szablon_odpowiedzi WHERE archiwalny = 1 ORDER BY nazwa COLLATE NOCASE`)
    .all() as Array<Record<string, unknown>>).map(zWiersza);
}
