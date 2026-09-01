import { db } from "../db/db.js";
import { utworzZadanie } from "./zadania-terenowe.js";

/* Skrzynka CZYTA to, co zsynchronizował `allegro-inbox-sync` (0.142.1), i nie
   odpytuje Allegro sama. Dwa powody. Po pierwsze rytm i limity API ma pilnować
   jedno miejsce — synchronizator zna kursor, backoff i respekt dla 429.
   Po drugie ekran ma się otworzyć także wtedy, gdy Allegro nie odpowiada:
   pokazuje wtedy ostatni znany stan i moment ostatniej udanej synchronizacji,
   zamiast pustej listy z błędem. */

export interface RozmowaSkrzynki {
  id: string; klient: string; ostatniaWiadomosc: string;
  ostatniaWiadomoscAt: string; nieprzeczytana: boolean;
}
export interface WpisOsi {
  id: string; rodzaj: "wiadomosc" | "wynik_zadania";
  autor: string; odKlienta: boolean; tresc: string; at: string;
  ofertaId: string | null; zadanieId?: number;
}
export interface StanSkrzynki { ostatniaSynchronizacja: string | null; bledy: number }

const SKRZYNKA = "skrzynka";

export function stanSkrzynki(): StanSkrzynki {
  const s = db().prepare(
    "SELECT last_success_at, error_count FROM allegro_inbox_sync_state WHERE id=1",
  ).get() as { last_success_at: string | null; error_count: number } | undefined;
  return { ostatniaSynchronizacja: s?.last_success_at ?? null, bledy: s?.error_count ?? 0 };
}

export function listaRozmow(): RozmowaSkrzynki[] {
  return db().prepare(`
    SELECT t.id, t.interlocutor_login AS klient, t.last_message_at AS ostatniaWiadomoscAt,
           t.read AS przeczytana,
           (SELECT m.text FROM allegro_inbox_message m
             WHERE m.thread_id = t.id ORDER BY m.rowid DESC LIMIT 1) AS ostatniaWiadomosc
      FROM allegro_inbox_thread t
     ORDER BY t.last_message_at DESC
  `).all().map((r) => {
    const w = r as Record<string, unknown>;
    return {
      id: String(w.id), klient: String(w.klient),
      ostatniaWiadomosc: String(w.ostatniaWiadomosc ?? ""),
      ostatniaWiadomoscAt: String(w.ostatniaWiadomoscAt),
      nieprzeczytana: !Number(w.przeczytana),
    };
  });
}

/** Oś rozmowy: wiadomości Allegro przeplecione wynikami zadań z hali. */
export function osRozmowy(id: string): { rozmowa: RozmowaSkrzynki; os: WpisOsi[] } {
  const rozmowa = listaRozmow().find((r) => r.id === id);
  if (!rozmowa) throw new Error("Nie znaleziono rozmowy");

  const wiadomosci = db().prepare(`
    SELECT id, author_login, author_role, text, related_object_type, related_object_id
      FROM allegro_inbox_message WHERE thread_id=? ORDER BY rowid
  `).all(id) as Array<Record<string, unknown>>;

  /* Zsynchronizowany magazyn NIE ma daty pojedynczej wiadomości — Allegro
     zwraca ją w wątku, a `allegro_inbox_message` przechowuje tylko kolejność
     zapisu. Dlatego wiadomości idą w kolejności z API, a `at` niesie datę
     wątku i służy wyłącznie za etykietę. Wymyślanie godzin per wiadomość
     dałoby oś, która wygląda na dokładną i nie jest. */
  const os: WpisOsi[] = wiadomosci.map((m) => ({
    id: String(m.id), rodzaj: "wiadomosc" as const,
    autor: String(m.author_login), odKlienta: String(m.author_role).toUpperCase() !== "SELLER",
    tresc: String(m.text), at: rozmowa.ostatniaWiadomoscAt,
    ofertaId: String(m.related_object_type ?? "") === "OFFER" ? String(m.related_object_id) : null,
  }));

  /* Wynik z hali jest osobnym wpisem osi, nigdy podmianą treści klienta —
     to zasada z docs/obsluga-klienta.md i ona decyduje o tym kształcie. */
  const zadania = db().prepare(`
    SELECT id, tytul, wynik, wykonano_at, wykonano_przez FROM zadanie_terenowe
     WHERE zrodlo=? AND zrodlo_ref=? AND status='wykonane' AND wynik IS NOT NULL
     ORDER BY wykonano_at
  `).all(SKRZYNKA, id) as Array<Record<string, unknown>>;

  for (const z of zadania) {
    os.push({
      id: `zadanie-${z.id}`, rodzaj: "wynik_zadania",
      autor: String(z.wykonano_przez ?? "magazyn"), odKlienta: false,
      tresc: String(z.wynik), at: String(z.wykonano_at), ofertaId: null,
      zadanieId: Number(z.id),
    });
  }
  return { rozmowa, os };
}

/**
 * Zleca pomiar z konkretnej wiadomości.
 *
 * Kontekst składa SERWER z zsynchronizowanego wiersza, nie klient. Agent podaje
 * wyłącznie identyfikatory; treść pytania i numer oferty biorą się z bazy.
 * Dzięki temu nie da się wysłać na halę zadania wskazującego na cudzą ofertę.
 */
export function zlecPomiar(
  rozmowaId: string, wiadomoscId: string, instrukcja: string,
  autor: { id: number; name: string },
) {
  const m = db().prepare(`
    SELECT m.text, m.related_object_type, m.related_object_id, t.interlocutor_login
      FROM allegro_inbox_message m JOIN allegro_inbox_thread t ON t.id=m.thread_id
     WHERE m.id=? AND m.thread_id=?
  `).get(wiadomoscId, rozmowaId) as Record<string, unknown> | undefined;
  if (!m) throw new Error("Wiadomość źródłowa nie należy do tej rozmowy");

  const oferta = String(m.related_object_type ?? "") === "OFFER"
    ? String(m.related_object_id) : null;
  const dodatkowa = (instrukcja ?? "").trim();

  /* Hala dostaje pytanie klienta w oryginale plus namiary. `tw_id` zostaje
     puste: synchronizator nie pobiera ofert, więc mapowania oferta→kartoteka
     nie ma z czego zrobić. Zgadywanie byłoby gorsze niż uczciwy brak — patrz
     ostrzeżenie „Brak powiązania z ofertą" na ekranie skrzynki. */
  const kontekst = [
    `Pytanie klienta: ${String(m.text)}`,
    oferta ? `Oferta Allegro: ${oferta}` : "Brak powiązania z ofertą Allegro.",
    `Rozmowa: ${rozmowaId} · wiadomość: ${wiadomoscId}`,
    dodatkowa ? `Wskazówka biura: ${dodatkowa}` : "",
  ].filter(Boolean).join("\n");

  return utworzZadanie({
    rodzaj: "pomiar",
    tytul: `Pomiar z rozmowy — ${String(m.interlocutor_login)}`,
    instrukcja: kontekst,
    twId: null,
    zrodlo: SKRZYNKA,
    zrodloRef: rozmowaId,
  }, autor);
}
