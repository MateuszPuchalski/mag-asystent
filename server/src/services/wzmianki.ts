import type { DatabaseSync } from "node:sqlite";
import { db } from "../db/db.js";
import { logEvent } from "./events.js";

/**
 * Skrzynka wzmianek — „wspomniano o mnie" (§6.4, 0.160.0).
 *
 * Do tego wydania `conversation_mention` była ZAPISEM BEZ ODCZYTU poza jedną
 * rozmową: wzmianka wracała wyłącznie do tego, kto sam otworzył właściwy wątek.
 * Kto nie zgadł którego, nie dowiadywał się nigdy — a wzmianka jest prośbą
 * o zajęcie się czymś, więc niedostarczona kosztuje tyle, co niezadana.
 *
 * Skrzynka jest PER UŻYTKOWNIK i to nie jest wygoda, tylko granica danych:
 * `userId` bierze się z sesji, nigdy z parametru żądania. Wzmianka niesie
 * fragment komentarza wewnętrznego, a te bywają równie wrażliwe co treść
 * klienta — cudzej nikt tu nie zobaczy.
 */
export interface WpisWzmianki {
  commentId: number;
  conversationId: number;
  klient: string;
  autor: string;
  fragment: string;
  at: string;
  odhaczona: boolean;
  odhaczonaAt: string | null;
}

/* Fragment, nie cała treść. Skrzynka odpowiada na pytanie „czy to moja
   sprawa", a nie zastępuje rozmowy — komentarz na pół ekranu wypchnąłby
   z listy wszystkie następne wzmianki. */
const DLUGOSC_FRAGMENTU = 160;

const LISTA = `
  SELECT k.id AS commentId, k.conversation_id AS conversationId, k.body, k.created_at AS at,
         m.seen_at AS odhaczonaAt, u.name AS autor, c.subject AS klient
    FROM conversation_mention m
    JOIN conversation_comment k ON k.id = m.comment_id
    JOIN conversation c ON c.id = k.conversation_id
    JOIN app_user u ON u.user_id = k.author_user_id
   WHERE m.user_id = ?`;

function naWpis(w: Record<string, unknown>): WpisWzmianki {
  const tresc = String(w.body);
  return {
    commentId: Number(w.commentId),
    conversationId: Number(w.conversationId),
    klient: String(w.klient ?? "Klient"),
    autor: String(w.autor),
    fragment: tresc.length > DLUGOSC_FRAGMENTU
      ? `${tresc.slice(0, DLUGOSC_FRAGMENTU)}…` : tresc,
    at: String(w.at),
    odhaczona: w.odhaczonaAt !== null,
    odhaczonaAt: w.odhaczonaAt === null ? null : String(w.odhaczonaAt),
  };
}

/**
 * Wzmianki dla jednego konta, od najnowszej.
 *
 * Odhaczone ZOSTAJĄ na liście, bo skrzynka bywa też dowodem: „przecież pisałam
 * ci o tym w środę" ma gdzie się sprawdzić. Kto chce samej roboty do zrobienia,
 * bierze `tylkoNowe`.
 */
export function wzmiankiDlaMnie(
  userId: number, opcje: { tylkoNowe?: boolean } = {}, database: DatabaseSync = db(),
): WpisWzmianki[] {
  const warunek = opcje.tylkoNowe ? " AND m.seen_at IS NULL" : "";
  return (database.prepare(`${LISTA}${warunek} ORDER BY k.created_at DESC, k.id DESC`)
    .all(userId) as Array<Record<string, unknown>>).map(naWpis);
}

/** Licznik do plakietki w nagłówku panelu. Sam odczyt, bez zapisu. */
export function liczbaNowychWzmianek(userId: number, database: DatabaseSync = db()): number {
  return (database.prepare(
    "SELECT count(*) n FROM conversation_mention WHERE user_id=? AND seen_at IS NULL")
    .get(userId) as { n: number }).n;
}

/**
 * Odhaczenie wzmianki — JAWNE kliknięcie wzmiankowanego.
 *
 * Nie robi tego ani otwarcie skrzynki, ani wejście do rozmowy: reguła „zero
 * zapisu przy patrzeniu" obowiązuje też tutaj, a wzmianka kasowana samym
 * spojrzeniem ginęłaby dokładnie wtedy, gdy agent przewija listę w biegu.
 *
 * Odhacza się PARĘ komentarz–osoba. Dwoje ludzi wzmiankowanych w jednym
 * zdaniu ma z nim dwie różne sprawy, więc wspólne odhaczenie kasowałoby
 * cudzą robotę jednym kliknięciem.
 */
export function odhaczWzmianke(
  commentId: number, userId: number, teraz = new Date(), database: DatabaseSync = db(),
): { commentId: number; odhaczonaAt: string } {
  const w = database.prepare(
    "SELECT seen_at FROM conversation_mention WHERE comment_id=? AND user_id=?")
    .get(commentId, userId) as { seen_at: string | null } | undefined;
  /* Brak wiersza znaczy albo „nie ma takiej wzmianki", albo „jest, ale nie do
     ciebie". Rozróżnienie w komunikacie zdradzałoby, że ktoś kogoś gdzieś
     wzmiankował — a to już treść cudzej notatki. */
  if (!w) throw new Error("Nie znaleziono wzmianki dla tego konta");
  /* Powtórne kliknięcie nie przestawia godziny. Data odhaczenia mówi, KIEDY
     ktoś się tym zajął; nadpisana przestaje o tym mówić. */
  if (w.seen_at) return { commentId, odhaczonaAt: w.seen_at };

  const kiedy = teraz.toISOString();
  database.prepare("UPDATE conversation_mention SET seen_at=? WHERE comment_id=? AND user_id=?")
    .run(kiedy, commentId, userId);
  /* Bez treści komentarza — dziennik czyta się przy zupełnie innych sprawach,
     a wzmianka bywa równie wrażliwa co wiadomość klienta. */
  logEvent("wzmianka_odhaczona", imie(database, userId), null, { commentId }, userId, database);
  return { commentId, odhaczonaAt: kiedy };
}

function imie(database: DatabaseSync, userId: number): string {
  const u = database.prepare("SELECT name FROM app_user WHERE user_id=?").get(userId) as
    { name: string } | undefined;
  return u?.name ?? `konto ${userId}`;
}
