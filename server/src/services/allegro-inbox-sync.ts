import { config } from "../config.js";
import { db as defaultDb, transaction, type Db } from "../db/db.js";
import { urlWatkow, urlWiadomosci, zapytajAllegro } from "../adapters/allegro.http.js";
import { stanSynchronizacji } from "./allegro-inbox-sync-state.js";
import { BladLimituAllegro, BladOdpowiedziAllegro } from "../adapters/allegro.js";
import { publishConversationEvent } from "./conversation-realtime.js";
import { kontoKanalu } from "./kanal-konto.js";

type Thread = { id: string; read: boolean; lastMessageDate: string;
  interlocutor: { login: string } };
type Message = { id: string; author: { login: string; role: string }; text: string;
  relatedObject: { type: string; id: string } | null; read: boolean };

/* Kod bierze się z KLASY błędu, nie z jego zdania. Do 0.149.0 stało tu
   wyrażenie szukające kodu w nawiasie — łapało „(401)", ale nie „Allegro
   odpowiedziało 503: …", więc status synchronizacji milczał akurat przy
   odmowach, które sam ma nazywać. */
const kodHttp = (error: unknown): number | null =>
  error instanceof BladOdpowiedziAllegro ? error.status : null;

function tablica<T>(value: unknown, pole: string): T[] {
  if (!value || typeof value !== "object" || !Array.isArray((value as Record<string, unknown>)[pole])) {
    throw new Error(`Odpowiedź Allegro nie ma tablicy ${pole} opisanej w docs/allegro-ksztalt.md`);
  }
  return (value as Record<string, unknown>)[pole] as T[];
}

export interface InboxSyncDeps {
  database?: Db;
  query?: (url: string) => Promise<unknown | null>;
  now?: () => Date;
  apiUrl?: string;
  intervalMs?: number;
  accountId?: string;
}

/** Jeden przebieg. Sieć kończy się przed zapisem, więc wolne API nie blokuje SQLite. */
export async function synchronizujAllegroInbox(deps: InboxSyncDeps = {}): Promise<void> {
  const database = deps.database ?? defaultDb();
  const query = deps.query ?? zapytajAllegro;
  const now = deps.now ?? (() => new Date());
  const apiUrl = deps.apiUrl ?? config.allegro.apiUrl;
  const interval = deps.intervalMs ?? config.allegro.inboxSyncMs;
  const startState = stanSynchronizacji(database);
  const threads: Thread[] = [];
  const messages = new Map<string, Message[]>();
  /* Wszystkie wątki tego przebiegu w kolejności od Allegro, czyli od
     najnowszego. Kursor wybiera się z tej listy DOPIERO po zapisie, bo dopiero
     wtedy wiadomo, który wątek faktycznie wszedł do skrzynki. */
  const widziane: Thread[] = [];
  let offset = 0;
  let reachedCursor = false;
  try {
    do {
      const page = tablica<Thread>(await query(urlWatkow(apiUrl, offset)), "threads");
      for (const thread of page) {
        widziane.push(thread);
        if (thread.lastMessageDate === startState.cursorAt && thread.id === startState.cursorId) {
          reachedCursor = true;
          break;
        }
        const known = database.prepare(
          "SELECT last_message_at FROM allegro_inbox_thread WHERE id=?"
        ).get(thread.id) as { last_message_at: string } | undefined;
        if (!known || known.last_message_at !== thread.lastMessageDate) {
          const body = await query(urlWiadomosci(apiUrl, thread.id));
          messages.set(thread.id, tablica<Message>(body, "messages"));
          threads.push(thread);
        }
      }
      offset += page.length;
      if (page.length < 20) break;
    } while (!reachedCursor);

    const at = now().toISOString();
    const konto = kontoKanalu(database, deps.accountId ?? config.allegro.clientId);

    /* KAŻDY WĄTEK MA WŁASNĄ TRANSAKCJĘ, bo §9 projektu panelu żąda, żeby
       synchronizator „izolował błąd pojedynczego wątku". Do 0.149.2 cała
       partia szła jedną transakcją i produkcja pokazała, co to znaczy:
       Allegro przysłało wątek bez
       `lastMessageDate`, `node:sqlite` odmówił związania `undefined`
       („Provided value cannot be bound to SQLite parameter 3"), a wycofanie
       zabrało ze sobą wszystkie zdrowe wątki z tego samego przebiegu. Skrzynka
       stała przez wiele przebiegów z rzędu przez JEDEN zepsuty wątek.

       Nie zgaduję tutaj, czy wątek bez daty ma prawo wejść do skrzynki z pustą
       datą — rozstrzyga to specyfikacja Allegro, której wciąż nie mamy (patrz
       znaczniki `[WERYFIKUJ]` w docs/allegro-ksztalt.md). Do tego czasu taki
       wątek jest odrzucany, czyli tak samo jak dotąd; zmienia się wyłącznie
       to, że nie zabiera reszty przebiegu ze sobą. */
    const zepsute = new Set<string>();
    for (const thread of threads) {
      try {
        transaction(database, () => {
          database.prepare(`INSERT INTO allegro_inbox_thread
            (id,read,last_message_at,interlocutor_login,surowe_json,synced_at)
            VALUES (?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET read=excluded.read,
            last_message_at=excluded.last_message_at, interlocutor_login=excluded.interlocutor_login,
            surowe_json=excluded.surowe_json, synced_at=excluded.synced_at`).run(
            thread.id, Number(thread.read), thread.lastMessageDate, thread.interlocutor.login,
            JSON.stringify(thread), at);
          database.prepare("DELETE FROM allegro_inbox_message WHERE thread_id=?").run(thread.id);
          for (const message of messages.get(thread.id) ?? []) {
            database.prepare(`INSERT INTO allegro_inbox_message
              (id,thread_id,author_login,author_role,text,related_object_type,
               related_object_id,read,surowe_json) VALUES (?,?,?,?,?,?,?,?,?)`).run(
              message.id, thread.id, message.author.login, message.author.role, message.text,
              message.relatedObject?.type ?? null, message.relatedObject?.id ?? null,
              Number(message.read), JSON.stringify(message));
          }
          zapiszKanonicznie(database, thread, messages.get(thread.id) ?? [], konto);
        })();
      } catch (e) {
        /* Wątek zostaje poza skrzynką, ale przebieg leci dalej. Dziennik niesie
           IDENTYFIKATOR, bo bez niego „wątek pominięty" jest nie do odtworzenia
           po stronie Allegro. Treści wątku nie logujemy — polityka danych
           z docs/obsluga-klienta.md obowiązuje też dziennik. */
        zepsute.add(thread.id);
        console.warn("[allegro-inbox] wątek pominięty:", thread.id,
          e instanceof Error ? e.message : e);
      }
    }

    /* §8.3: kursora nie przesuwa się „po niepełnym zapisie". Może więc stanąć
       WYŁĄCZNIE na wątku, który przeszedł. Gdyby stanął na pominiętym, następny
       przebieg uznałby go za punkt odniesienia i przestał widzieć wszystko,
       co za nim — jeden zepsuty wątek zabrałby ze sobą
       historię, zamiast samego siebie. Wątek bez daty odpada z tego wyboru
       osobno, bo kursor porównuje się PARĄ (data, id). */
    const kursor = widziane.find((w) => !zepsute.has(w.id) && w.lastMessageDate != null);

    transaction(database, () => {
      /* `error_count` ZERUJE SIĘ na sukcesie i to jest zmiana z 0.147.0.
         Wcześniej klauzula `DO UPDATE` go pomijała, więc licznik rósł do
         końca życia bazy: pierwsza w tygodniu odmowa Allegro zostawiała
         w panelu „błędów: 1" na stałe, a §21 nie miał z czego policzyć,
         ile przebiegów Z RZĘDU się nie powiodło.

         `error_thread_count` liczy co innego i dlatego stoi osobno: przebieg
         z pominiętym wątkiem DOMKNĄŁ SIĘ, więc nie jest porażką przebiegu.
         Kolumna i wiersz „Wątki z błędem" w panelu istnieją od 0.147.0 —
         do 0.149.2 nikt do nich nie pisał, więc panel pokazywał zero także
         wtedy, gdy skrzynka gubiła wątki. */
      database.prepare(`INSERT INTO allegro_inbox_sync_state
        (id,cursor_at,cursor_id,last_success_at,last_attempt_at,last_error_code,
         error_count,error_thread_count,next_attempt_at)
        VALUES(1,?,?,?,?,NULL,0,?,?) ON CONFLICT(id) DO UPDATE SET cursor_at=excluded.cursor_at,
        cursor_id=excluded.cursor_id,last_success_at=excluded.last_success_at,
        last_attempt_at=excluded.last_attempt_at,last_error_code=NULL,
        error_count=0,error_thread_count=excluded.error_thread_count,
        next_attempt_at=excluded.next_attempt_at`).run(
          kursor?.lastMessageDate ?? startState.cursorAt, kursor?.id ?? startState.cursorId,
          at, at, zepsute.size, new Date(Date.parse(at) + interval).toISOString());
    })();
  } catch (error) {
    const wait = error instanceof BladLimituAllegro
      ? Math.max(interval, error.poIluMs ?? interval * 2)
      : interval;
    const next = new Date(now().getTime() + wait).toISOString();
    /* Kod porażki decyduje o statusie z §7: 401 i 403 to `authentication_error`
       („zawołaj admina"), 429 to `rate_limited` („poczekaj"). Bez zapamiętania
       kodu panel umiałby powiedzieć wyłącznie „nie udało się". */
    const kod = error instanceof BladLimituAllegro ? 429 : kodHttp(error);
    database.prepare(`INSERT INTO allegro_inbox_sync_state
      (id,error_count,last_attempt_at,last_error_code,next_attempt_at)
      VALUES(1,1,?,?,?) ON CONFLICT(id) DO UPDATE SET error_count=error_count+1,
      last_attempt_at=excluded.last_attempt_at,last_error_code=excluded.last_error_code,
      next_attempt_at=excluded.next_attempt_at`).run(now().toISOString(), kod, next);
    throw error;
  }
}

/* ── Model kanoniczny (0.144.0) ─────────────────────────────────────────────
   Tabele `allegro_inbox_*` zostają SUROWYM LĄDOWISKIEM: trzymają odpowiedź
   Allegro w kształcie, w jakim przyszła, razem z `surowe_json`. Obsługa
   klienta pracuje na `channel_account`/`conversation`/`message`, bo tylko ten
   model unosi drugi kanał, przypisanie agenta, szkic i komentarze.

   Do 0.143.1 nikt nie zapisywał do `conversation`, więc przejmowanie rozmowy
   i szkic z 0.143.0 były kodem nieosiągalnym — trasy przyjmowały liczbowe id
   rozmowy, której nic nie tworzyło. Ten zapis jest tym brakującym ogniwem. */

function zapiszKanonicznie(database: Db, thread: Thread, messages: Message[], konto: number): void {
  database.prepare(`INSERT INTO conversation(channel_account_id, external_conversation_id, subject, unread, updated_at)
    VALUES (?,?,?,?,?) ON CONFLICT(channel_account_id, external_conversation_id)
    DO UPDATE SET unread=excluded.unread, updated_at=excluded.updated_at`).run(
    konto, thread.id, thread.interlocutor.login, Number(!thread.read), thread.lastMessageDate);
  const rozmowa = Number((database.prepare(
    "SELECT id FROM conversation WHERE channel_account_id=? AND external_conversation_id=?",
  ).get(konto, thread.id) as { id: number }).id);

  for (const message of messages) {
    /* Wiadomości NIE kasujemy i nie nadpisujemy, inaczej niż w lądowisku:
       wiszą na nich szkic (`expected_last_message_id`) i zadania terenowe.
       Konflikt na unikalnym kluczu jest tu poprawnym końcem pracy. */
    const wynik = database.prepare(`INSERT INTO message(conversation_id, channel_account_id,
      external_message_id, direction, body, related_object_type, related_object_id, sent_at)
      VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(channel_account_id, external_message_id) DO NOTHING`).run(
      rozmowa, konto, message.id,
      message.author.role.toUpperCase() === "SELLER" ? "outgoing" : "incoming",
      message.text, message.relatedObject?.type ?? null, message.relatedObject?.id ?? null,
      /* Allegro podaje datę WĄTKU, nie pojedynczej wiadomości — patrz
         docs/allegro-ksztalt.md. Kolejność niesie `message.id`, a `sent_at`
         jest etykietą wątku; udawanie godzin per wiadomość dałoby oś, która
         wygląda na dokładną i nie jest. */
      thread.lastMessageDate);
    if (wynik.changes > 0) {
      publishConversationEvent("message.created", rozmowa, {
        messageId: Number(wynik.lastInsertRowid), external: message.id,
      });
    }
  }
}
