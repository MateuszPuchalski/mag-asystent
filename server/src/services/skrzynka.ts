import { db } from "../db/db.js";
import { utworzZadanie } from "./zadania-terenowe.js";

/* Skrzynka CZYTA model kanoniczny (`conversation`/`message`), zasilany przez
   `allegro-inbox-sync`. Nie odpytuje Allegro sama: rytm i limity API pilnuje
   jedno miejsce, a ekran otwiera się także wtedy, gdy Allegro nie odpowiada —
   pokazuje wtedy ostatni znany stan i moment ostatniej udanej synchronizacji.

   Do 0.143.1 czytała surowe lądowisko `allegro_inbox_*`. Przejście na model
   kanoniczny jest tym, co czyni przejmowanie rozmowy, właściciela i szkic
   z 0.143.0 osiągalnymi: tamte trasy przyjmują liczbowe `conversation.id`. */

export interface RozmowaSkrzynki {
  id: number; klient: string; ostatniaWiadomosc: string; ostatniaWiadomoscAt: string;
  nieprzeczytana: boolean; wlascicielId: number | null; wlasciciel: string | null; wersja: number;
}
export interface WpisOsi {
  id: string; rodzaj: "wiadomosc" | "wynik_zadania";
  autor: string; odKlienta: boolean; tresc: string; at: string;
  ofertaId: string | null; zadanieId?: number; messageId?: number;
}
export interface StanSkrzynki { ostatniaSynchronizacja: string | null; bledy: number }

const SKRZYNKA = "skrzynka";

const LISTA = `
  SELECT c.id, c.subject AS klient, c.updated_at AS ostatniaWiadomoscAt, c.unread,
         c.assigned_user_id AS wlascicielId, u.name AS wlasciciel, c.version AS wersja,
         (SELECT m.body FROM message m WHERE m.conversation_id=c.id ORDER BY m.id DESC LIMIT 1)
           AS ostatniaWiadomosc
    FROM conversation c LEFT JOIN app_user u ON u.user_id=c.assigned_user_id`;

const naRozmowe = (w: Record<string, unknown>): RozmowaSkrzynki => ({
  id: Number(w.id), klient: String(w.klient ?? "Klient"),
  ostatniaWiadomosc: String(w.ostatniaWiadomosc ?? ""),
  ostatniaWiadomoscAt: String(w.ostatniaWiadomoscAt),
  nieprzeczytana: Boolean(Number(w.unread)),
  wlascicielId: w.wlascicielId === null ? null : Number(w.wlascicielId),
  wlasciciel: w.wlasciciel === null ? null : String(w.wlasciciel),
  wersja: Number(w.wersja),
});

export function stanSkrzynki(): StanSkrzynki {
  const s = db().prepare(
    "SELECT last_success_at, error_count FROM allegro_inbox_sync_state WHERE id=1",
  ).get() as { last_success_at: string | null; error_count: number } | undefined;
  return { ostatniaSynchronizacja: s?.last_success_at ?? null, bledy: s?.error_count ?? 0 };
}

export function listaRozmow(): RozmowaSkrzynki[] {
  return (db().prepare(`${LISTA} ORDER BY c.updated_at DESC`).all() as Array<Record<string, unknown>>)
    .map(naRozmowe);
}

/** Oś rozmowy: wiadomości kanału przeplecione wynikami zadań z hali. */
export function osRozmowy(id: number): { rozmowa: RozmowaSkrzynki; os: WpisOsi[]; szkic: Szkic | null } {
  const wiersz = db().prepare(`${LISTA} WHERE c.id=?`).get(id) as Record<string, unknown> | undefined;
  if (!wiersz) throw new Error("Nie znaleziono rozmowy");
  const rozmowa = naRozmowe(wiersz);

  const wiadomosci = db().prepare(`
    SELECT m.id, m.direction, m.body, m.sent_at, m.related_object_type AS typ,
           m.related_object_id AS oferta, c.subject AS klient
      FROM message m JOIN conversation c ON c.id=m.conversation_id
     WHERE m.conversation_id=? ORDER BY m.id
  `).all(id) as Array<Record<string, unknown>>;

  /* Kolejność niesie `message.id`, nie `sent_at`: Allegro podaje datę WĄTKU,
     nie pojedynczej wiadomości (docs/allegro-ksztalt.md). */
  const os: WpisOsi[] = wiadomosci.map((m) => ({
    id: `msg-${m.id}`, rodzaj: "wiadomosc" as const, messageId: Number(m.id),
    autor: String(m.direction) === "incoming" ? String(m.klient ?? "Klient") : "Biuro",
    odKlienta: String(m.direction) === "incoming",
    tresc: String(m.body), at: String(m.sent_at),
    ofertaId: String(m.typ ?? "") === "OFFER" ? String(m.oferta) : null,
  }));

  /* Wynik z hali jest osobnym wpisem osi, nigdy podmianą treści klienta —
     to zasada z docs/obsluga-klienta.md i ona decyduje o tym kształcie. */
  const zadania = db().prepare(`
    SELECT id, wynik, wykonano_at, wykonano_przez FROM zadanie_terenowe
     WHERE conversation_id=? AND status='wykonane' AND wynik IS NOT NULL ORDER BY wykonano_at
  `).all(id) as Array<Record<string, unknown>>;
  for (const z of zadania) {
    os.push({
      id: `zadanie-${z.id}`, rodzaj: "wynik_zadania",
      autor: String(z.wykonano_przez ?? "magazyn"), odKlienta: false,
      tresc: String(z.wynik), at: String(z.wykonano_at), ofertaId: null, zadanieId: Number(z.id),
    });
  }
  return { rozmowa, os, szkic: szkicRozmowy(id) };
}

export interface Szkic { body: string; wersja: number; expectedLastMessageId: number | null }

export function szkicRozmowy(id: number): Szkic | null {
  const s = db().prepare(
    "SELECT body, version, expected_last_message_id AS oczekiwana FROM conversation_draft WHERE conversation_id=?",
  ).get(id) as { body: string; version: number; oczekiwana: number | null } | undefined;
  return s ? { body: s.body, wersja: s.version, expectedLastMessageId: s.oczekiwana } : null;
}

/**
 * Zleca pomiar z konkretnej wiadomości.
 *
 * Kontekst składa SERWER z zapisanego wiersza, nie klient. Agent podaje
 * wyłącznie identyfikatory; treść pytania i numer oferty biorą się z bazy.
 * Dzięki temu nie da się wysłać na halę zadania wskazującego na cudzą ofertę.
 */
export function zlecPomiar(
  rozmowaId: number, messageId: number, instrukcja: string, autor: { id: number; name: string },
) {
  const m = db().prepare(`
    SELECT m.body, m.related_object_type AS typ, m.related_object_id AS oferta, c.subject AS klient
      FROM message m JOIN conversation c ON c.id=m.conversation_id
     WHERE m.id=? AND m.conversation_id=?
  `).get(messageId, rozmowaId) as Record<string, unknown> | undefined;
  if (!m) throw new Error("Wiadomość źródłowa nie należy do tej rozmowy");

  const oferta = String(m.typ ?? "") === "OFFER" ? String(m.oferta) : null;
  const dodatkowa = (instrukcja ?? "").trim();

  /* Hala dostaje pytanie klienta w oryginale plus namiary. `tw_id` zostaje
     puste: synchronizator nie pobiera ofert, więc mapowania oferta→kartoteka
     nie ma z czego zrobić. Zgadywanie byłoby gorsze niż uczciwy brak — patrz
     ostrzeżenie „Brak powiązania z ofertą" na ekranie skrzynki. */
  const kontekst = [
    `Pytanie klienta: ${String(m.body)}`,
    oferta ? `Oferta Allegro: ${oferta}` : "Brak powiązania z ofertą Allegro.",
    dodatkowa ? `Wskazówka biura: ${dodatkowa}` : "",
  ].filter(Boolean).join("\n");

  const zadanie = utworzZadanie({
    rodzaj: "pomiar",
    tytul: `Pomiar z rozmowy — ${String(m.klient ?? "klient")}`,
    instrukcja: kontekst, twId: null, zrodlo: SKRZYNKA, zrodloRef: String(rozmowaId),
  }, autor);

  /* Powiązanie idzie kluczami obcymi modelu kanonicznego (0.144.0), a nie samym
     `zrodlo_ref` — dzięki temu wynik wraca na oś TEJ rozmowy i tej wiadomości. */
  db().prepare("UPDATE zadanie_terenowe SET conversation_id=?, message_id=? WHERE id=?")
    .run(rozmowaId, messageId, zadanie.id);
  return { ...zadanie, conversationId: rozmowaId, messageId };
}
