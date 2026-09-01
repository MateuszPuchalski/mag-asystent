import { config } from "../config.js";
import { db as defaultDb, transaction, type Db } from "../db/db.js";
import { urlWatkow, urlWiadomosci, zapytajAllegro } from "../adapters/allegro.http.js";
import { stanSynchronizacji } from "./allegro-inbox-sync-state.js";
import { BladLimituAllegro, BladOdpowiedziAllegro } from "../adapters/allegro.js";
import { publishConversationEvent } from "./conversation-realtime.js";
import { obudzPrzychodzaca } from "./conversations.js";
import { odkodujEncje } from "../tekst.js";
import { kontoKanalu } from "./kanal-konto.js";

/* Kształt ze SPECYFIKACJI Allegro — patrz docs/allegro-ksztalt.md. Do 0.151.0
   stały tu nazwy wymyślone razem z kodem (`lastMessageDate`, `author.role`,
   `relatedObject`) i przez to skrzynka nie zapisała ani jednego wątku:
   `undefined` na trzecim parametrze wstawki wywracał każdy z nich.
   Pola, których świadomie nie mapujemy, są wymienione w kontrakcie —
   `surowe_json` i tak trzyma całą odpowiedź. */
type Thread = { id: string; read: unknown; lastMessageDateTime?: string | null;
  interlocutor?: { login: string } | null };
type Message = { id: string; author: { login: string; isInterlocutor: unknown };
  text: string; subject?: string; status?: string; createdAt: string;
  relatesTo?: { offer?: { id: string }; order?: { id: string } } | null;
  attachments?: Array<{ fileName: string; mimeType?: string; url?: string; status: string }> };

/* Schemat mówi `type: boolean`, ale opublikowany PRZYKŁAD renderuje `read`
   jako tekst („false"). Ta funkcja przyjmuje obie postaci — kosztuje trzy
   linijki, a broni przed rozbieżnością, którą Allegro ma we własnej
   dokumentacji. Wszystko inne jest błędem wątku, nie zgadniętym zerem: po
   0.149.2 taki wątek zostaje pominięty, a przebieg leci dalej. */
function flaga(wartosc: unknown, pole: string): boolean {
  if (typeof wartosc === "boolean") return wartosc;
  if (wartosc === "true") return true;
  if (wartosc === "false") return false;
  throw new Error(`Pole ${pole} ma nieoczekiwaną postać: ${JSON.stringify(wartosc)}`);
}

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
  /** Granica czasu; `null` znaczy „bez progu". Patrz `config.allegro.inboxOd`. */
  inboxOd?: string | null;
}

/** Jeden przebieg. Sieć kończy się przed zapisem, więc wolne API nie blokuje SQLite. */
export async function synchronizujAllegroInbox(deps: InboxSyncDeps = {}): Promise<void> {
  const database = deps.database ?? defaultDb();
  const query = deps.query ?? zapytajAllegro;
  const now = deps.now ?? (() => new Date());
  const apiUrl = deps.apiUrl ?? config.allegro.apiUrl;
  const interval = deps.intervalMs ?? config.allegro.inboxSyncMs;
  const od = deps.inboxOd !== undefined ? deps.inboxOd : config.allegro.inboxOd;
  const startState = stanSynchronizacji(database);
  const threads: Thread[] = [];
  const messages = new Map<string, Message[]>();
  /* Wszystkie wątki tego przebiegu w kolejności od Allegro, czyli od
     najnowszego. Kursor wybiera się z tej listy DOPIERO po zapisie, bo dopiero
     wtedy wiadomo, który wątek faktycznie wszedł do skrzynki. */
  const widziane: Thread[] = [];
  let offset = 0;
  let reachedCursor = false;
  let poniżejGranicy = false;
  try {
    do {
      const page = tablica<Thread>(await query(urlWatkow(apiUrl, offset)), "threads");
      for (const thread of page) {
        /* GRANICA CZASU (0.152.0). Lista przychodzi od najnowszego, więc
           pierwszy wątek poniżej progu znaczy „dalej są już same starsze" —
           i to jest jedyny moment, w którym wolno przestać czytać. Bez tego
           każdy przebieg chodził przez całą historię konta aż do końca.

           Wątek BEZ daty przepuszczamy: schemat Allegro dopuszcza brak
           `lastMessageDateTime` (patrz 0.151.0), a świeżo założona rozmowa nie
           ma jak mieć ostatniej wiadomości. Odrzucanie jej progiem znaczyłoby
           rozmowę, której panel nigdy nie pokaże. */
        if (od && thread.lastMessageDateTime && thread.lastMessageDateTime < od) {
          poniżejGranicy = true;
          break;
        }
        widziane.push(thread);
        if (thread.lastMessageDateTime === startState.cursorAt && thread.id === startState.cursorId) {
          reachedCursor = true;
          break;
        }
        const known = database.prepare(
          "SELECT last_message_at FROM allegro_inbox_thread WHERE id=?"
        ).get(thread.id) as { last_message_at: string } | undefined;
        if (!known || known.last_message_at !== thread.lastMessageDateTime) {
          const body = await query(urlWiadomosci(apiUrl, thread.id));
          messages.set(thread.id, tablica<Message>(body, "messages"));
          threads.push(thread);
        }
      }
      offset += page.length;
      if (poniżejGranicy || page.length < 20) break;
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
            thread.id, Number(flaga(thread.read, "thread.read")),
            thread.lastMessageDateTime ?? null, thread.interlocutor?.login ?? null,
            JSON.stringify(thread), at);
          database.prepare("DELETE FROM allegro_inbox_message WHERE thread_id=?").run(thread.id);
          for (const message of messages.get(thread.id) ?? []) {
            database.prepare(`INSERT INTO allegro_inbox_message
              (id,thread_id,author_login,author_is_interlocutor,text,subject,status,
               created_at,related_object_type,related_object_id,surowe_json)
              VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(
              message.id, thread.id, message.author.login,
              Number(flaga(message.author.isInterlocutor, "author.isInterlocutor")),
              message.text, message.subject ?? null, message.status ?? null,
              message.createdAt, oferta(message)[0], oferta(message)[1],
              JSON.stringify(message));
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
    const kursor = widziane.find((w) => !zepsute.has(w.id) && w.lastMessageDateTime != null);

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
         last_error_text,error_count,error_thread_count,next_attempt_at)
        VALUES(1,?,?,?,?,NULL,NULL,0,?,?) ON CONFLICT(id) DO UPDATE SET cursor_at=excluded.cursor_at,
        cursor_id=excluded.cursor_id,last_success_at=excluded.last_success_at,
        last_attempt_at=excluded.last_attempt_at,last_error_code=NULL,last_error_text=NULL,
        error_count=0,error_thread_count=excluded.error_thread_count,
        next_attempt_at=excluded.next_attempt_at`).run(
          kursor?.lastMessageDateTime ?? startState.cursorAt, kursor?.id ?? startState.cursorId,
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
    /* Zdanie, nie tylko kod. Komunikaty z `wazneBearer` i `zapytajAllegro` są
       pisane dla człowieka i niosą instrukcję, co kliknąć — przepisujemy je
       bez zmian, zamiast budować drugi słownik powodów. Obcięcie chroni
       kolumnę przed odpowiedzią serwera wklejoną w całości. */
    const tekst = (error instanceof Error ? error.message : String(error)).slice(0, 500);
    database.prepare(`INSERT INTO allegro_inbox_sync_state
      (id,error_count,last_attempt_at,last_error_code,last_error_text,next_attempt_at)
      VALUES(1,1,?,?,?,?) ON CONFLICT(id) DO UPDATE SET error_count=error_count+1,
      last_attempt_at=excluded.last_attempt_at,last_error_code=excluded.last_error_code,
      last_error_text=excluded.last_error_text,
      next_attempt_at=excluded.next_attempt_at`).run(now().toISOString(), kod, tekst, next);
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

/* Powiązanie wiadomości z ofertą. Allegro daje `relatesTo` z osobnymi gałęziami
   `offer` i `order`; nas interesuje oferta, bo to ona nazywa TOWAR, o który
   pyta klient. Numer zamówienia zostaje w `surowe_json` do czasu, aż będzie
   miał ekran. Typ zapisujemy jako `OFFER`, bo tak nazywa go model kanoniczny —
   to nasze słowo, nie cytat z Allegro. */
function oferta(message: Message): [string | null, string | null] {
  const id = message.relatesTo?.offer?.id;
  return id == null ? [null, null] : ["OFFER", String(id)];
}

/* Najpóźniejsze `createdAt` z wątku. `Message.createdAt` jest w schemacie
   WYMAGANE, więc gdy wiadomości są, data też jest. */
function najnowsza(messages: Message[]): string | null {
  return messages.map((m) => m.createdAt).sort().at(-1) ?? null;
}

/* Temat rozmowy niesie WIADOMOŚĆ, nie wątek. Bierzemy pierwszy niepusty —
   Allegro powtarza go w kolejnych wiadomościach tego samego wątku. Gdy go nie
   ma, wołający zostaje przy loginie rozmówcy, czyli przy tym, co stało
   w `conversation.subject` do 0.151.0. */
function temat(messages: Message[]): string | null {
  const s = messages.find((m) => typeof m.subject === "string" && m.subject !== "")?.subject;
  return s === undefined ? null : odkodujEncje(s);
}

/* ENCJE HTML SCHODZĄ TUTAJ, przy wjeździe do modelu pracy — nie przy
   wyświetlaniu. To jest blizna 0.127.0 („polskie znaki przyjeżdżały jako encje
   HTML") z listy w `docs/obsluga-klienta.md`, kupiona DRUGI RAZ: `odkodujEncje`
   czekała w `tekst.ts` z kompletem testów i z komentarzem mówiącym wprost, że
   nowa obsługa ma ją wziąć gotową, nie odkryć drugi raz na produkcji. Odkryła
   ją drugi raz na produkcji — panel escape'uje przy renderowaniu, więc
   `kt&oacute;ry` z bazy stał na ekranie dosłownie, w każdej polskiej
   wiadomości.

   Specyfikacja tego nie zapowiada: `Message.text` to goły `type: string`, bez
   słowa o HTML-u. Tak wygląda różnica między tym, co Allegro DEKLARUJE,
   a tym, co przysyła.

   LĄDOWISKO ZOSTAJE SUROWE. `allegro_inbox_message.text` i `surowe_json` niosą
   odpowiedź w kształcie, w jakim przyszła — to jedyny ślad, gdyby dekodowanie
   kiedyś skrzywdziło cudzy tekst. */
function zapiszKanonicznie(database: Db, thread: Thread, messages: Message[], konto: number): void {
  database.prepare(`INSERT INTO conversation(channel_account_id, external_conversation_id, subject, unread, updated_at)
    VALUES (?,?,?,?,?) ON CONFLICT(channel_account_id, external_conversation_id)
    DO UPDATE SET unread=excluded.unread, updated_at=excluded.updated_at`).run(
    konto, thread.id, temat(messages) ?? thread.interlocutor?.login ?? null,
    Number(!flaga(thread.read, "thread.read")),
    /* `updated_at` jest NOT NULL, a data wątku bywa pusta. Wtedy schodzimy na
       datę najnowszej wiadomości, a gdy wątek nie ma i wiadomości — na czas
       synchronizacji. Rozmowa musi mieć się gdzie ustawić na liście. */
    thread.lastMessageDateTime ?? najnowsza(messages) ?? new Date().toISOString());
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
      /* KIERUNEK Z `isInterlocutor`. Rozmówca to ten, który nie jest nami,
         więc jego wiadomość jest przychodząca. Do 0.151.0 stało tu porównanie
         z rolą `SELLER`, której Allegro nie przysyła — na prawdziwej
         odpowiedzi rzucało `TypeError`. */
      flaga(message.author.isInterlocutor, "author.isInterlocutor") ? "incoming" : "outgoing",
      odkodujEncje(message.text), oferta(message)[0], oferta(message)[1],
      /* Data POJEDYNCZEJ wiadomości. Do 0.151.0 wszystkie wiadomości wątku
         dostawały tu jedną datę — datę wątku — bo kod twierdził, że Allegro
         daty wiadomości nie podaje. Podaje: `createdAt`. */
      message.createdAt);
    if (wynik.changes > 0) {
      /* PRZYCHODZĄCA BUDZI ROZMOWĘ (§7, 0.158.0). Klient dopisujący pytanie do
         sprawy uznanej za załatwioną musi ją z powrotem otworzyć — inaczej
         rozmowa zostaje na liście „rozwiązane" i nikt do niej nie zagląda.
         Wychodzące pomijamy: to nasza własna odpowiedź wracająca z Allegro. */
      if (flaga(message.author.isInterlocutor, "author.isInterlocutor")) {
        obudzPrzychodzaca(database, rozmowa);
      }
      /* Załączniki wchodzą TYLKO razem z nową wiadomością. Wiadomości nie
         nadpisujemy (wiszą na nich szkice i zadania), więc powtórny przebieg
         nie ma tu czego robić — i dzięki temu nie trzeba osobnego klucza
         przeciw duplikatom na polach, z których żadne nie jest wymagane. */
      for (const z of message.attachments ?? []) {
        database.prepare(`INSERT INTO message_attachment
          (message_id, file_name, mime_type, url, status) VALUES (?,?,?,?,?)`).run(
          Number(wynik.lastInsertRowid), odkodujEncje(z.fileName),
          z.mimeType ?? null, z.url ?? null, z.status);
      }
      publishConversationEvent("message.created", rozmowa, {
        messageId: Number(wynik.lastInsertRowid), external: message.id,
      });
    }
  }
}
