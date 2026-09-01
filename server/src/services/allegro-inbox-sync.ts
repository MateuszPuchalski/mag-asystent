import { config } from "../config.js";
import { db as defaultDb, transaction, type Db } from "../db/db.js";
import { urlWatkow, urlWiadomosci, zapytajAllegro } from "../adapters/allegro.http.js";
import { stanSynchronizacji } from "./allegro-inbox-sync-state.js";
import { BladLimituAllegro } from "../adapters/allegro.js";

type Thread = { id: string; read: boolean; lastMessageDate: string;
  interlocutor: { login: string } };
type Message = { id: string; author: { login: string; role: string }; text: string;
  relatedObject: { type: string; id: string } | null; read: boolean };

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
      }
      database.prepare(`INSERT INTO allegro_inbox_sync_state
        (id,cursor_at,cursor_id,last_success_at,error_count,next_attempt_at)
        VALUES(1,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET cursor_at=excluded.cursor_at,
        cursor_id=excluded.cursor_id,last_success_at=excluded.last_success_at,
        next_attempt_at=excluded.next_attempt_at`).run(
          newest?.lastMessageDate ?? startState.cursorAt, newest?.id ?? startState.cursorId,
          at, startState.errorCount, new Date(Date.parse(at) + interval).toISOString());
    })();
  } catch (error) {
    const wait = error instanceof BladLimituAllegro
      ? Math.max(interval, error.poIluMs ?? interval * 2)
      : interval;
    const next = new Date(now().getTime() + wait).toISOString();
    database.prepare(`INSERT INTO allegro_inbox_sync_state(id,error_count,next_attempt_at)
      VALUES(1,1,?) ON CONFLICT(id) DO UPDATE SET error_count=error_count+1,
      next_attempt_at=excluded.next_attempt_at`).run(next);
    throw error;
  }
}
