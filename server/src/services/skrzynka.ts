import { db } from "../db/db.js";
import { utworzZadanie } from "./zadania-terenowe.js";
import { statusEfektywny, zapiszStatusAutomatu, type StatusRozmowy } from "./statusy.js";

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
  /** Status WIDZIANY: odłożenie po terminie jest już `open` (`statusy.ts`). */
  status: StatusRozmowy;
  /** Zapisany w bazie — po to, żeby ekran umiał pokazać, że termin minął. */
  statusZapisany: StatusRozmowy;
  snoozeDo: string | null;
  /** Klient odpisał po zamknięciu i nikt mu jeszcze nie odpowiedział. */
  wrocilaPoZamknieciu: boolean;
}
/** Załącznik wiadomości. `SAFE` znaczy „wolno pobrać"; reszta tylko informuje. */
export interface ZalacznikOsi {
  id: number; nazwa: string; typ: string | null; status: string; doPobrania: boolean;
}
export interface WpisOsi {
  id: string; rodzaj: "wiadomosc" | "wynik_zadania";
  autor: string; odKlienta: boolean; tresc: string; at: string;
  ofertaId: string | null; zadanieId?: number; messageId?: number;
  zalaczniki?: ZalacznikOsi[];
}
export interface StanSkrzynki { ostatniaSynchronizacja: string | null; bledy: number }

const SKRZYNKA = "skrzynka";

/* Znacznik powrotu liczy się PRZY ODCZYCIE i gaśnie sam, gdy biuro odpisze:
   porównujemy moment ostatniego zdarzenia `reopened_by_customer` z momentem
   ostatniej naszej wiadomości. Osobna kolumna wymagałaby kasowania jej przy
   wysyłce, czyli jeszcze jednego zapisu, który może się nie wykonać. */
const LISTA = `
  SELECT c.id, c.subject AS klient, c.updated_at AS ostatniaWiadomoscAt, c.unread,
         c.assigned_user_id AS wlascicielId, u.name AS wlasciciel, c.version AS wersja,
         c.status, c.snooze_do AS snoozeDo,
         (SELECT m.body FROM message m WHERE m.conversation_id=c.id ORDER BY m.id DESC LIMIT 1)
           AS ostatniaWiadomosc,
         (SELECT MAX(e.created_at) FROM conversation_event e
           WHERE e.conversation_id=c.id AND e.event_type='reopened_by_customer') AS wrocilaAt,
         (SELECT MAX(m.sent_at) FROM message m
           WHERE m.conversation_id=c.id AND m.direction='outgoing') AS odpisanoAt
    FROM conversation c LEFT JOIN app_user u ON u.user_id=c.assigned_user_id`;

const naRozmowe = (w: Record<string, unknown>, teraz = new Date()): RozmowaSkrzynki => {
  const zapisany = String(w.status ?? "new");
  const snoozeDo = w.snoozeDo == null ? null : String(w.snoozeDo);
  const wrocilaAt = w.wrocilaAt == null ? null : String(w.wrocilaAt);
  const odpisanoAt = w.odpisanoAt == null ? null : String(w.odpisanoAt);
  return {
    id: Number(w.id), klient: String(w.klient ?? "Klient"),
    ostatniaWiadomosc: String(w.ostatniaWiadomosc ?? ""),
    ostatniaWiadomoscAt: String(w.ostatniaWiadomoscAt),
    nieprzeczytana: Boolean(Number(w.unread)),
    wlascicielId: w.wlascicielId === null ? null : Number(w.wlascicielId),
    wlasciciel: w.wlasciciel === null ? null : String(w.wlasciciel),
    wersja: Number(w.wersja),
    status: statusEfektywny(zapisany, snoozeDo, teraz),
    statusZapisany: (zapisany as StatusRozmowy),
    snoozeDo,
    wrocilaPoZamknieciu: wrocilaAt !== null && (odpisanoAt === null || wrocilaAt > odpisanoAt),
  };
};

export function stanSkrzynki(): StanSkrzynki {
  const s = db().prepare(
    "SELECT last_success_at, error_count FROM allegro_inbox_sync_state WHERE id=1",
  ).get() as { last_success_at: string | null; error_count: number } | undefined;
  return { ostatniaSynchronizacja: s?.last_success_at ?? null, bledy: s?.error_count ?? 0 };
}

/**
 * Liczby obsługi dla `/api/health` (§21).
 *
 * Trasa zdrowia jest publiczna, więc idą tu wyłącznie LICZBY: ile rozmów
 * czeka i jak stare jest najstarsze zadanie. Bez klientów, bez treści i bez
 * numerów ofert — te same reguły, co przy statystykach audytu obok.
 */
export function stanObslugiHealth(teraz = Date.now()) {
  const rozmowy = db().prepare(
    "SELECT count(*) n FROM conversation WHERE assigned_user_id IS NULL").get() as { n: number };
  const zadania = db().prepare(`SELECT count(*) n, min(utworzono_at) najstarsze
    FROM zadanie_terenowe WHERE status IN ('nowe','w_toku')`).get() as
    { n: number; najstarsze: string | null };
  return {
    rozmowyOczekujace: rozmowy.n,
    zadaniaTerenowe: zadania.n,
    najstarszeZadanieMs: zadania.najstarsze
      ? Math.max(0, teraz - Date.parse(zadania.najstarsze)) : null,
    /* Kolejka wysyłek melduje się nawet wyłączona: brak pozycji i brak
       mechanizmu wyglądają na ekranie tak samo, a znaczą co innego. */
    kolejkaWysylek: "wysyłka wyłączona" as const,
  };
}

export function listaRozmow(): RozmowaSkrzynki[] {
  return (db().prepare(`${LISTA} ORDER BY c.updated_at DESC`).all() as Array<Record<string, unknown>>)
    .map((w) => naRozmowe(w));
}

/** Oś rozmowy: wiadomości kanału przeplecione wynikami zadań z hali. */
export function osRozmowy(id: number): {
  rozmowa: RozmowaSkrzynki; os: WpisOsi[]; szkic: Szkic | null; ofertaWskazana: OfertaWskazana | null;
} {
  const wiersz = db().prepare(`${LISTA} WHERE c.id=?`).get(id) as Record<string, unknown> | undefined;
  if (!wiersz) throw new Error("Nie znaleziono rozmowy");
  const rozmowa = naRozmowe(wiersz);

  const wiadomosci = db().prepare(`
    SELECT m.id, m.direction, m.body, m.sent_at, m.related_object_type AS typ,
           m.related_object_id AS oferta, c.subject AS klient
      FROM message m JOIN conversation c ON c.id=m.conversation_id
     WHERE m.conversation_id=? ORDER BY m.id
  `).all(id) as Array<Record<string, unknown>>;

  /* Załączniki jednym zapytaniem dla całej rozmowy, nie po jednym na
     wiadomość: siedem na trzydzieści dziewięć wiadomości to zbyt mało, żeby
     płacić za to osobnym odpytaniem przy każdym wierszu osi. */
  const zalaczniki = new Map<number, ZalacznikOsi[]>();
  for (const z of db().prepare(`
    SELECT a.id, a.message_id, a.file_name, a.mime_type, a.status
      FROM message_attachment a JOIN message m ON m.id=a.message_id
     WHERE m.conversation_id=? ORDER BY a.id
  `).all(id) as Array<Record<string, unknown>>) {
    const lista = zalaczniki.get(Number(z.message_id)) ?? [];
    lista.push({
      id: Number(z.id), nazwa: String(z.file_name),
      typ: z.mime_type == null ? null : String(z.mime_type),
      status: String(z.status),
      /* Pobranie oferujemy WYŁĄCZNIE przy `SAFE`. `UNSAFE` znaczy, że Allegro
         uznało plik za niebezpieczny — nie mamy powodu wiedzieć lepiej, a plik
         i tak wędrowałby przez maszynę biura. `EXPIRED` i `NEW` nie mają czego
         oddać. */
      doPobrania: String(z.status) === "SAFE",
    });
    zalaczniki.set(Number(z.message_id), lista);
  }

  /* Kolejność niesie `message.id`, nie `sent_at`. Do 0.151.0 stało tu
     uzasadnienie „Allegro podaje datę wątku, nie wiadomości" — nieprawdziwe,
     `createdAt` jest per wiadomość. Kolejność po identyfikatorze zostaje, bo
     jest stabilna także przy dwóch wiadomościach z tej samej sekundy. */
  const os: WpisOsi[] = wiadomosci.map((m) => ({
    id: `msg-${m.id}`, rodzaj: "wiadomosc" as const, messageId: Number(m.id),
    autor: String(m.direction) === "incoming" ? String(m.klient ?? "Klient") : "Biuro",
    odKlienta: String(m.direction) === "incoming",
    tresc: String(m.body), at: String(m.sent_at),
    ofertaId: String(m.typ ?? "") === "OFFER" ? String(m.oferta) : null,
    ...(zalaczniki.has(Number(m.id)) ? { zalaczniki: zalaczniki.get(Number(m.id)) } : {}),
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
  return { rozmowa, os, szkic: szkicRozmowy(id), ofertaWskazana: ofertaWskazana(id) };
}

export interface Szkic { body: string; wersja: number; expectedLastMessageId: number | null }

/** Oferta wskazana RĘCZNIE przez agenta — wybór człowieka, nie fakt z Allegro. */
export interface OfertaWskazana { ofertaId: string; autor: string }

export function ofertaWskazana(id: number): OfertaWskazana | null {
  const w = db().prepare(`SELECT payload FROM conversation_event
    WHERE conversation_id=? AND event_type='offer_linked_manually'
    ORDER BY id DESC LIMIT 1`).get(id) as { payload: string | null } | undefined;
  if (!w?.payload) return null;
  const p = JSON.parse(w.payload) as { ofertaId?: string; autor?: string };
  return p.ofertaId ? { ofertaId: p.ofertaId, autor: p.autor ?? "agent" } : null;
}

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
  twId: number | null = null,
) {
  const m = db().prepare(`
    SELECT m.body, m.related_object_type AS typ, m.related_object_id AS oferta, c.subject AS klient
      FROM message m JOIN conversation c ON c.id=m.conversation_id
     WHERE m.id=? AND m.conversation_id=?
  `).get(messageId, rozmowaId) as Record<string, unknown> | undefined;
  if (!m) throw new Error("Wiadomość źródłowa nie należy do tej rozmowy");

  const oferta = String(m.typ ?? "") === "OFFER" ? String(m.oferta) : null;
  const dodatkowa = (instrukcja ?? "").trim();

  /* Kartoteka WSKAZANA przez agenta to co innego niż WYWIEDZIONA z oferty.
     Pierwsza jest jego wyborem i tak ma być podpisana; druga będzie faktem
     z Allegro, gdy dojdzie pobieranie ofert. Hala i audyt muszą widzieć
     różnicę — projekt panelu §4.3 zabrania mieszać fakty z różnych źródeł
     bez pokazania pochodzenia. Dziś synchronizator ofert nie pobiera, więc
     bez wskazania agenta `tw_id` zostaje puste; zgadywanie byłoby gorsze
     niż uczciwy brak. */
  const kontekst = [
    `Pytanie klienta: ${String(m.body)}`,
    oferta ? `Oferta Allegro: ${oferta}` : "Brak powiązania z ofertą Allegro.",
    twId != null ? `Kartotekę wskazał(a) ${autor.name}, nie wynika z oferty.` : "",
    dodatkowa ? `Wskazówka biura: ${dodatkowa}` : "",
  ].filter(Boolean).join("\n");

  const zadanie = utworzZadanie({
    rodzaj: "pomiar",
    tytul: `Pomiar z rozmowy — ${String(m.klient ?? "klient")}`,
    instrukcja: kontekst, twId, zrodlo: SKRZYNKA, zrodloRef: String(rozmowaId),
  }, autor);

  /* Powiązanie idzie kluczami obcymi modelu kanonicznego (0.144.0), a nie samym
     `zrodlo_ref` — dzięki temu wynik wraca na oś TEJ rozmowy i tej wiadomości. */
  db().prepare("UPDATE zadanie_terenowe SET conversation_id=?, message_id=? WHERE id=?")
    .run(rozmowaId, messageId, zadanie.id);
  /* Rozmowa czeka teraz na NAS, nie na klienta — i tym różni się ten status od
     `waiting_for_customer`. Wynik z hali zdejmuje go sam (`dopiszZdarzenieWyniku`),
     więc agent nie ma tu nic do klikania w żadną stronę. */
  zapiszStatusAutomatu(db(), rozmowaId, "waiting_for_internal");
  return { ...zadanie, conversationId: rozmowaId, messageId };
}
