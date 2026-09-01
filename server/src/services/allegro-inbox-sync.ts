import { config } from "../config.js";
import { db as defaultDb, transaction, type Db } from "../db/db.js";
import { urlWatkow, urlWiadomosci, zapytajAllegro } from "../adapters/allegro.http.js";
import { stanSynchronizacji } from "./allegro-inbox-sync-state.js";
import { BladLimituAllegro, BladOdpowiedziAllegro } from "../adapters/allegro.js";
import { publishConversationEvent } from "./conversation-realtime.js";

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

/** Jeden przebieg. Sieć kończy się przed transakcją, więc wolne API nie blokuje SQLite. */
export async function synchronizujAllegroInbox(deps: InboxSyncDeps = {}): Promise<void> {
  const database = deps.database ?? defaultDb();
  const query = deps.query ?? zapytajAllegro;
  const now = deps.now ?? (() => new Date());
  const apiUrl = deps.apiUrl ?? config.allegro.apiUrl;
  const interval = deps.intervalMs ?? config.allegro.inboxSyncMs;
  const startState = stanSynchronizacji(database);
  const threads: Thread[] = [];
  const messages = new Map<string, Message[]>();
  let offset = 0;
  let reachedCursor = false;
  let newest: Thread | undefined;
  try {
    do {
      const page = tablica<Thread>(await query(urlWatkow(apiUrl, offset)), "threads");
      newest ??= page[0];
      for (const thread of page) {
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
    transaction(database, () => {
      const konto = kontoKanalu(database, deps.accountId ?? config.allegro.clientId);
      for (const thread of threads) {
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
      }
      /* `error_count` ZERUJE SIĘ na sukcesie i to jest zmiana z 0.147.0.
         Wcześniej klauzula `DO UPDATE` go pomijała, więc licznik rósł do
         końca życia bazy: pierwsza w tygodniu odmowa Allegro zostawiała
         w panelu „błędów: 1" na stałe, a §21 nie miał z czego policzyć,
         ile przebiegów Z RZĘDU się nie powiodło. */
      database.prepare(`INSERT INTO allegro_inbox_sync_state
        (id,cursor_at,cursor_id,last_success_at,last_attempt_at,last_error_code,
         error_count,error_thread_count,next_attempt_at)
        VALUES(1,?,?,?,?,NULL,0,0,?) ON CONFLICT(id) DO UPDATE SET cursor_at=excluded.cursor_at,
        cursor_id=excluded.cursor_id,last_success_at=excluded.last_success_at,
        last_attempt_at=excluded.last_attempt_at,last_error_code=NULL,
        error_count=0,error_thread_count=0,next_attempt_at=excluded.next_attempt_at`).run(
          newest?.lastMessageDate ?? startState.cursorAt, newest?.id ?? startState.cursorId,
          at, at, new Date(Date.parse(at) + interval).toISOString());
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

function kontoKanalu(database: Db, externalAccountId: string): number {
  const id = externalAccountId || "domyslne";
  database.prepare(`INSERT INTO channel_account(channel, external_account_id)
    VALUES ('allegro', ?) ON CONFLICT(channel, external_account_id) DO NOTHING`).run(id);
  return Number((database.prepare(
    "SELECT id FROM channel_account WHERE channel='allegro' AND external_account_id=?",
  ).get(id) as { id: number }).id);
}

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
