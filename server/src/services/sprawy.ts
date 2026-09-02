import type { DatabaseSync } from "node:sqlite";
import { db, transaction } from "../db/db.js";
import { logEvent } from "./events.js";

/**
 * Sprawa — jeden problem klienta ponad rozmowami (§6.1, 0.161.0).
 *
 * Decyzja właściciela z `docs/obsluga-klienta.md` (pytanie 1), zapisana tam
 * jawnie jako podjęta PRZED liczbami, których to pytanie żądało. Poprzednia
 * odpowiedź o tym samym kształcie kosztowała cztery tabele nakładki oraz
 * ręczne SCAL i ROZKLEJ — dlatego ten kształt jest najmniejszy z możliwych.
 *
 * Sprawa NIE MA własnego statusu ani własnej osi. §7 nie zna statusów sprawy,
 * a blizna z 0.130.0 mówi wprost: zdarzenia wiszą przy ŹRÓDLE, bo historia
 * sklejona z rozmów ginęła przy pierwszym rozklejeniu. Sprawa jest klamrą:
 * tytułem i listą rozmów, niczym więcej.
 */
export interface SprawaRozmowy {
  id: number;
  tytul: string;
  rozmowy: Array<{ id: number; klient: string; ostatniaWiadomoscAt: string }>;
}

export interface WierszSprawy {
  id: number;
  tytul: string;
  liczbaRozmow: number;
  /** Kiedy w tej sprawie ostatnio coś przyszło. `null`, gdy żadnej wiadomości. */
  ostatniaWiadomoscAt: string | null;
}

function imie(database: DatabaseSync, userId: number): string {
  const u = database.prepare("SELECT name FROM app_user WHERE user_id=?").get(userId) as
    { name: string } | undefined;
  return u?.name ?? `konto ${userId}`;
}

/** Sprawa rozmowy razem z jej rodzeństwem. `null`, gdy rozmowa stoi sama. */
export function sprawaRozmowy(
  conversationId: number, database: DatabaseSync = db(),
): SprawaRozmowy | null {
  const w = database.prepare(`SELECT s.id, s.tytul FROM sprawa_klienta_rozmowa sr
    JOIN sprawa_klienta s ON s.id = sr.sprawa_id WHERE sr.conversation_id=?`)
    .get(conversationId) as { id: number; tytul: string } | undefined;
  if (!w) return null;
  const rozmowy = database.prepare(`SELECT c.id, c.subject AS klient, c.updated_at AS at
      FROM sprawa_klienta_rozmowa sr JOIN conversation c ON c.id = sr.conversation_id
     WHERE sr.sprawa_id=? ORDER BY c.updated_at DESC, c.id`)
    .all(w.id) as Array<Record<string, unknown>>;
  return {
    id: w.id, tytul: w.tytul,
    rozmowy: rozmowy.map((r) => ({
      id: Number(r.id), klient: String(r.klient ?? "Klient"),
      ostatniaWiadomoscAt: String(r.at),
    })),
  };
}

/**
 * Lista spraw do wyboru.
 *
 * Niesie liczbę rozmów i moment ostatniej wiadomości, bo po tych dwóch
 * rzeczach agent poznaje sprawę na liście: czy to ta duża sprzed miesiąca,
 * czy dzisiejsza. Sam tytuł tego nie mówi.
 */
export function listaSpraw(database: DatabaseSync = db()): WierszSprawy[] {
  return (database.prepare(`
    SELECT s.id, s.tytul, count(sr.conversation_id) AS liczba,
           max((SELECT max(m.sent_at) FROM message m
                 WHERE m.conversation_id = sr.conversation_id)) AS ostatnia
      FROM sprawa_klienta s LEFT JOIN sprawa_klienta_rozmowa sr ON sr.sprawa_id = s.id
     GROUP BY s.id ORDER BY ostatnia DESC NULLS LAST, s.id DESC
  `).all() as Array<Record<string, unknown>>).map((w) => ({
    id: Number(w.id), tytul: String(w.tytul), liczbaRozmow: Number(w.liczba),
    ostatniaWiadomoscAt: w.ostatnia == null ? null : String(w.ostatnia),
  }));
}

/** Nowa sprawa zakładana Z ROZMOWY — pusta klamra nie ma czego skleić. */
export function utworzSprawe(
  tytul: string, conversationId: number, userId: number, database: DatabaseSync = db(),
): { id: number; tytul: string } {
  const nazwa = (tytul ?? "").trim();
  if (!nazwa) throw new Error("Sprawa musi mieć tytuł — klamra bez nazwy nic nie skleja");
  return transaction(database, () => {
    const id = Number(database.prepare("INSERT INTO sprawa_klienta(tytul,utworzyl) VALUES (?,?)")
      .run(nazwa, userId).lastInsertRowid);
    logEvent("sprawa_utworzona", imie(database, userId), null,
      { sprawaId: id, conversationId }, userId, database);
    zwiaz(database, id, conversationId, userId);
    return { id, tytul: nazwa };
  })();
}

/** Dołączenie kolejnej rozmowy do istniejącej sprawy. */
export function dolaczRozmowe(
  sprawaId: number, conversationId: number, userId: number, database: DatabaseSync = db(),
): SprawaRozmowy {
  return transaction(database, () => {
    zwiaz(database, sprawaId, conversationId, userId);
    return sprawaRozmowy(conversationId, database)!;
  })();
}

function zwiaz(
  database: DatabaseSync, sprawaId: number, conversationId: number, userId: number,
): void {
  const s = database.prepare("SELECT tytul FROM sprawa_klienta WHERE id=?").get(sprawaId) as
    { tytul: string } | undefined;
  if (!s) throw new Error("Nie znaleziono sprawy");

  /* Rozmowa należy do JEDNEJ sprawy. Odmowa niesie TYTUŁ tamtej sprawy, bo
     „już jest w innej" kazałoby agentowi szukać, którą odkleić. */
  const juz = sprawaRozmowy(conversationId, database);
  if (juz) {
    if (juz.id === sprawaId) return;
    throw new Error(`Rozmowa należy już do sprawy „${juz.tytul}" — najpierw ją odklej`);
  }

  database.prepare(
    "INSERT INTO sprawa_klienta_rozmowa(conversation_id,sprawa_id,dolaczyl) VALUES (?,?,?)")
    .run(conversationId, sprawaId, userId);
  /* Wpis idzie na oś ROZMOWY, nie sprawy (blizna 0.130.0): rozklejenie nie ma
     prawa zabrać ze sobą historii tego, że sprawy kiedyś były razem. */
  slad(database, conversationId, "sprawa_dolaczona", { sprawaId, tytul: s.tytul },
    imie(database, userId), userId);
}

/** Rozklejenie. Dotyczy KLAMRY — rozmowa i jej treść zostają nietknięte. */
export function odlaczRozmowe(
  conversationId: number, userId: number, database: DatabaseSync = db(),
): void {
  const juz = sprawaRozmowy(conversationId, database);
  if (!juz) throw new Error("Ta rozmowa nie należy do żadnej sprawy");
  transaction(database, () => {
    database.prepare("DELETE FROM sprawa_klienta_rozmowa WHERE conversation_id=?").run(conversationId);
    slad(database, conversationId, "sprawa_odlaczona", { sprawaId: juz.id, tytul: juz.tytul },
      imie(database, userId), userId);
  })();
}

function slad(
  database: DatabaseSync, conversationId: number, typ: string,
  dane: Record<string, unknown>, autor: string, userId: number,
): void {
  database.prepare(`INSERT INTO conversation_event(conversation_id, event_type, payload)
    VALUES (?,?,?)`).run(conversationId, typ, JSON.stringify({ ...dane, autor }));
  logEvent(typ, autor, null, { conversationId, ...dane }, userId, database);
}
