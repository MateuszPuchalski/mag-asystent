import { config } from "../config.js";
import { db as defaultDb, transaction, type Db } from "../db/db.js";
import { wyslijWiadomoscSprawy } from "../adapters/allegro.http.js";
import { logEvent } from "./events.js";
import { kluczWysylki, niejednoznaczny } from "./idempotencja.js";
import { BladReklamacji, ReklamacjaConflict } from "./reklamacje.js";

/* ── Odpowiedź w reklamacji (0.224.0) ────────────────────────────────────────
   PIERWSZY zapis tego modułu wychodzący do Allegro. Wzorzec w całości
   z `services/wysylka.ts`: jeden wiersz na PRÓBĘ, klucz idempotencji liczony
   po naszej stronie, strzał POZA transakcją, a stan niejednoznaczny nazwany
   wprost zamiast udawać sukces albo porażkę.

   TRZY RÓŻNICE WOBEC SKRZYNKI, wszystkie wymuszone przez naturę sprawy:

   1. BRAMKA `czat_aktywny`, której skrzynka nie ma. `currentState.chatActive`
      mówi, czy Allegro w ogóle przyjmie wiadomość; bez tego sprawdzenia
      wysyłamy żądanie, o którym z góry wiadomo, że wróci z 409.
   2. BRAK BRAMKI WŁAŚCICIELA. `prowadzi` to ZNACZNIK trzymający imię tekstem,
      nie `assigned_user_id`, a `stempelProwadzi` jest przełącznikiem. Cudza
      sprawa nie blokuje odpowiedzi — reklamacja nie ma też uchwytu obecności,
      bo nie ma szyny zdarzeń.
   3. ŚWIEŻOŚĆ LICZY SIĘ OD OSTATNIEJ NIE NASZEJ wiadomości, a nie od
      „przychodzącej": `reklamacja_wiadomosc` nie ma kolumny kierunku, ma rolę
      autora. Doradca Allegro (`ADMIN`) odpisał w 61 sprawach na 100 w sondzie
      i jego zdanie zmienia treść odpowiedzi tak samo jak dopisek klienta.

   Czego tu NIE MA i nie będzie w tym wydaniu: załączników wychodzących
   (dwukrokowe wgranie to osobna maszyneria) oraz typów `RETURN_*`, które są
   formalnym stanowiskiem sprzedawcy w sprawie zwrotu towaru.                */

/** Rola, którą podpisujemy własne wiadomości; ta sama, którą oddaje Allegro. */
const NASZA_ROLA = "SELLER";

/**
 * Limit treści z `MessageRequest.text` (`maxLength: 20000`).
 *
 * DZIESIĘĆ RAZY WIĘCEJ niż 2000 w Centrum Wiadomości i to nie jest pomyłka
 * w odczycie — to inny zasób. Przepisanie tamtej liczby ucinałoby odpowiedzi
 * w sprawie, w której opis usterki bywa długi.
 */
export const LIMIT_ZNAKOW = 20_000;

export type StatusWysylki = "sending" | "sent" | "send_uncertain" | "send_failed";

/** Wysyłka wstrzykiwana, żeby test nie strzelał do Allegro (wzorzec skrzynki). */
export type WyslijWiadomosc = (
  issueId: string, tekst: string,
) => Promise<{ id?: string; createdAt?: string } | null>;

export interface ZadanieOdpowiedzi {
  reklamacjaId: number;
  autor: { id: number; name: string };
  tresc: string;
  expectedWersja: number;
  expectedLastMessageId: number | null;
  /** Jawna zgoda agenta po 409 „ktoś dopisał" — nigdy domyślna. */
  mimoNowejWiadomosci?: boolean;
  database?: Db;
  wyslij?: WyslijWiadomosc;
}

export interface WynikOdpowiedzi {
  status: StatusWysylki;
  externalMessageId: string | null;
  kluczIdempotencji: string;
}

interface Kontekst {
  externalId: string;
  wersja: number;
  czatAktywny: boolean;
  prowadzi: string | null;
  /** Ostatnia wiadomość NIE NASZA — punkt odniesienia dla świeżości. */
  lastMessageId: number | null;
}

function kontekst(database: Db, reklamacjaId: number): Kontekst {
  const r = database.prepare(
    "SELECT external_id, wersja, czat_aktywny, prowadzi FROM reklamacja_klienta WHERE id=?",
  ).get(reklamacjaId) as Record<string, unknown> | undefined;
  if (!r) throw new BladReklamacji(`Reklamacja ${reklamacjaId} nie istnieje`, 404);

  /* NIE NASZA, a nie „od kupującego". Rozmowa bywa trójstronna, więc punkt
     odniesienia przesuwa też doradca Allegro. Własna odpowiedź go NIE
     przesuwa — inaczej druga wiadomość z rzędu zawsze wyglądałaby na pisaną
     do nieaktualnej wersji sprawy (ta sama poprawka co w skrzynce). */
  const w = database.prepare(
    `SELECT id FROM reklamacja_wiadomosc
      WHERE reklamacja_id=? AND COALESCE(autor_rola,'') <> ?
      ORDER BY id DESC LIMIT 1`,
  ).get(reklamacjaId, NASZA_ROLA) as { id: number } | undefined;

  return {
    externalId: String(r.external_id),
    wersja: Number(r.wersja),
    czatAktywny: Number(r.czat_aktywny ?? 1) === 1,
    prowadzi: typeof r.prowadzi === "string" && r.prowadzi.trim() !== "" ? r.prowadzi : null,
    lastMessageId: w ? Number(w.id) : null,
  };
}

type WierszOutboxu = {
  id: number; status: StatusWysylki; external_message_id: string | null;
};

const outboxPoKluczu = (database: Db, klucz: string) => database.prepare(
  "SELECT id, status, external_message_id FROM reklamacja_outbox WHERE idempotency_key=?",
).get(klucz) as WierszOutboxu | undefined;

/**
 * Wysłanie odpowiedzi w sprawie.
 *
 * Kolejność bramek jest częścią umowy: dwie pierwsze odrzucają BEZ tworzenia
 * wiersza w kolejce, bo odrzucona odpowiedź nie ma prawa zostawiać po sobie
 * śladu, który wygląda na próbę wysyłki.
 */
export async function odpowiedzWSprawie(z: ZadanieOdpowiedzi): Promise<WynikOdpowiedzi> {
  const database = z.database ?? defaultDb();
  const wyslij: WyslijWiadomosc = z.wyslij
    ?? ((id, tekst) => wyslijWiadomoscSprawy(config.allegro.apiUrl, id, tekst));

  const tresc = (z.tresc ?? "").trim();
  if (!tresc) throw new BladReklamacji("Pusta odpowiedź nie idzie do Allegro");
  if (tresc.length > LIMIT_ZNAKOW) {
    /* Bramka PRZED kolejką i przed siecią. Agent ma zobaczyć liczbę, a nie
       stracić tekst i dostać kod błędu z Allegro. */
    throw new BladReklamacji(
      `Allegro przyjmuje przy reklamacji najwyżej ${LIMIT_ZNAKOW} znaków, ` +
      `a odpowiedź ma ${tresc.length}`);
  }

  const k = kontekst(database, z.reklamacjaId);

  /* Rozmowa zamknięta przez Allegro. 409, nie 400: to nie jest błąd agenta,
     tylko stan sprawy, który mógł się zmienić, odkąd otworzył ekran. */
  if (!k.czatAktywny) {
    throw new ReklamacjaConflict({
      wersja: k.wersja, czatAktywny: false,
    }, "Allegro zamknęło rozmowę w tej sprawie — nowej wiadomości nie przyjmie");
  }

  if (k.wersja !== Number(z.expectedWersja)) {
    throw new ReklamacjaConflict({ wersja: k.wersja, prowadzi: k.prowadzi });
  }

  const klucz = kluczWysylki("rkl-", z.reklamacjaId, k.lastMessageId, tresc);

  if (k.lastMessageId !== (z.expectedLastMessageId ?? null) && !z.mimoNowejWiadomosci) {
    /* Ktoś dopisał, odkąd agent zaczął pisać — klient albo doradca. Ładunek
       niesie KOMPLET do dialogu: treść nowej wiadomości i gotowy klucz, żeby
       „wyślij mimo to" nie policzyło go od nowa z innych danych. */
    const nowa = k.lastMessageId === null ? null : database.prepare(
      "SELECT id, tresc, autor_rola, utworzono_at FROM reklamacja_wiadomosc WHERE id=?",
    ).get(k.lastMessageId) as Record<string, unknown> | undefined;
    logEvent("reklamacja_wysylka_konflikt", z.autor.name, null,
      { id: z.reklamacjaId, znakow: tresc.length }, undefined, database);
    throw new ReklamacjaConflict({
      wersja: k.wersja,
      lastMessageId: k.lastMessageId,
      nowaWiadomosc: nowa ? {
        id: Number(nowa.id), tresc: String(nowa.tresc ?? ""),
        rola: (nowa.autor_rola as string) ?? null, at: (nowa.utworzono_at as string) ?? null,
      } : null,
      kluczIdempotencji: klucz,
    }, "Ktoś dopisał w tej sprawie — wysyłka wymaga zatwierdzenia");
  }

  /* ── Strażnik dubletu ─────────────────────────────────────────────────────
     Cztery gałęzie, każda znaczy co innego. `sent` oddaje stan PIERWSZEJ próby
     bez ani jednego strzału — to jest cała odpowiedź na podwójne kliknięcie. */
  let outboxId = 0;
  const zastany = outboxPoKluczu(database, klucz);
  if (zastany?.status === "sent") {
    return {
      status: "sent", externalMessageId: zastany.external_message_id ?? null,
      kluczIdempotencji: klucz,
    };
  }
  if (zastany?.status === "sending") {
    throw new ReklamacjaConflict({ kluczIdempotencji: klucz },
      "Ta odpowiedź właśnie idzie do Allegro — poczekaj na wynik");
  }
  if (zastany?.status === "send_uncertain") {
    /* §8.5: po niejednoznacznym timeoucie NIE ponawiamy automatycznie.
       Rozstrzyga synchronizacja — dopiero ona powie, czy wiadomość tam jest. */
    throw new ReklamacjaConflict(
      { kluczIdempotencji: klucz, outboxId: zastany.id },
      "Poprzednia próba nie dała jednoznacznej odpowiedzi — najpierw zsynchronizuj sprawę");
  }
  if (zastany) {
    /* `send_failed` to jedyny stan, który wolno wznowić: wiadomo, że nic nie
       poszło, bo Allegro odmówiło kodem. */
    database.prepare(
      "UPDATE reklamacja_outbox SET status='sending', blad=NULL, finished_at=NULL WHERE id=?",
    ).run(zastany.id);
    outboxId = zastany.id;
  } else {
    outboxId = Number(database.prepare(
      `INSERT INTO reklamacja_outbox(reklamacja_id,idempotency_key,body,expected_wersja,
         expected_last_message_id,status,created_by)
       VALUES (?,?,?,?,?,'sending',?)`,
    ).run(z.reklamacjaId, klucz, tresc, k.wersja, k.lastMessageId, z.autor.id).lastInsertRowid);
  }

  logEvent("reklamacja_wysylka_proba", z.autor.name, null,
    { id: z.reklamacjaId, znakow: tresc.length }, undefined, database);

  /* SIEĆ POZA TRANSAKCJĄ. Trzymanie otwartej transakcji SQLite na czas żądania
     HTTP blokowałoby drugi proces na tyle, ile trwa najwolniejsza odpowiedź. */
  let odp: { id?: string; createdAt?: string } | null;
  try {
    odp = await wyslij(k.externalId, tresc);
  } catch (e) {
    const status: StatusWysylki = niejednoznaczny(e) ? "send_uncertain" : "send_failed";
    database.prepare(
      `UPDATE reklamacja_outbox SET status=?, blad=?, finished_at=datetime('now') WHERE id=?`,
    ).run(status, (e as Error).message.slice(0, 500), outboxId);
    throw e;
  }

  const externalMessageId = typeof odp?.id === "string" && odp.id ? odp.id : null;
  if (externalMessageId === null) {
    /* Allegro odpowiedziało, ale nie nazwało wiadomości. Wiersza na osi NIE
       tworzymy: `reklamacja_wiadomosc` ma `UNIQUE(reklamacja_id, external_id)`,
       więc wpis bez identyfikatora nie miałby jak być idempotentny i wróciłby
       w duplikacie przy najbliższej synchronizacji. */
    database.prepare(
      `UPDATE reklamacja_outbox SET status='send_uncertain', finished_at=datetime('now')
        WHERE id=?`).run(outboxId);
    return { status: "send_uncertain", externalMessageId: null, kluczIdempotencji: klucz };
  }

  const utworzono = typeof odp?.createdAt === "string" ? odp.createdAt : new Date().toISOString();
  transaction(database, () => {
    database.prepare(
      `INSERT INTO reklamacja_wiadomosc
         (reklamacja_id,external_id,autor_login,autor_rola,tresc,utworzono_at)
       VALUES (?,?,NULL,?,?,?)
       ON CONFLICT(reklamacja_id, external_id) DO NOTHING`,
    ).run(z.reklamacjaId, externalMessageId, NASZA_ROLA, tresc, utworzono);

    database.prepare(
      `UPDATE reklamacja_outbox SET status='sent', external_message_id=?,
         finished_at=datetime('now') WHERE id=?`).run(externalMessageId, outboxId);

    /* LICZNIK ROŚNIE O JEDEN. `wiadomosci_ile` jest snapshotem sprzed naszej
       wysyłki, więc bez tego ekran natychmiast skłamałby „ta rozmowa jest
       niepełna" — porównuje liczbę z Allegro z liczbą wierszy u nas. */
    database.prepare(
      `UPDATE reklamacja_klienta
          SET wiadomosci_ile = wiadomosci_ile + 1,
              ostatnia_wiadomosc_status = 'SELLER_REPLIED',
              ostatnia_wiadomosc_at = ?
        WHERE id=?`).run(utworzono, z.reklamacjaId);

    /* ODPOWIEDŹ JEST PROWADZENIEM SPRAWY — stempel, gdy znacznika nie ma.
       Cudzego nie ruszamy: to znacznik dla reszty biura, a nie własność.
       Ta sama doktryna co przy odkładaniu towaru na półkę reklamacyjną
       w implementacji sprzed 0.140.0. */
    if (k.prowadzi === null) {
      database.prepare(
        "UPDATE reklamacja_klienta SET prowadzi=?, prowadzi_at=datetime('now') WHERE id=?",
      ).run(z.autor.name, z.reklamacjaId);
    }

    /* Do dziennika idzie DŁUGOŚĆ, nigdy treść: `events` nie ma retencji. */
    logEvent("reklamacja_odpowiedz", z.autor.name, null,
      { id: z.reklamacjaId, znakow: tresc.length, externalMessageId },
      undefined, database);
  })();

  /* `status_allegro` NIE JEST przestawiany — należy do Allegro. Kubełek
     przelicza się sam z tego, co przyszło, więc sprawa wychodzi z DO ODPOWIEDZI
     przy najbliższej synchronizacji, a nie na nasze życzenie. */
  return { status: "sent", externalMessageId, kluczIdempotencji: klucz };
}

/**
 * Ile wysyłek wymaga oka człowieka.
 *
 * Ten sam kształt co `stanKolejkiWysylek()` przy skrzynce. `sending` bez końca
 * (padnięty proces) liczy się razem z porażkami: nikt tego nie sprząta, więc
 * niech przynajmniej widać.
 */
export function stanKolejkiOdpowiedzi(database: Db = defaultDb()): {
  wyslane: number; doSprawdzenia: number;
} {
  const licz = (sql: string) =>
    Number((database.prepare(sql).get() as { n: number }).n);
  return {
    wyslane: licz("SELECT COUNT(*) n FROM reklamacja_outbox WHERE status='sent'"),
    doSprawdzenia: licz(
      "SELECT COUNT(*) n FROM reklamacja_outbox WHERE status IN ('sending','send_uncertain','send_failed')"),
  };
}
