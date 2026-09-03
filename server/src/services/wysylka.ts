import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { allegroTryb } from "../adapters/allegro.js";
import { db, transaction } from "../db/db.js";
import { ConversationConflict, zmienStatus } from "./conversations.js";
import { publishConversationEvent, trzymajacy } from "./conversation-realtime.js";
import { logEvent } from "./events.js";
import {
  oznaczPrzeczytanyWAllegro, wyslijDoAllegro,
  type OznaczPrzeczytany, type WyslijDoAllegro,
} from "./allegro-wysylka.js";
import { zalacznikiRozmowy } from "./zalaczniki-wysylki.js";

export interface ZadanieWysylki {
  conversationId: number;
  autor: { id: number; name: string };
  body: string;
  expectedVersion: number;
  expectedLastMessageId: number | null;
  /** Jawna zgoda z blizny 0.110.0 — „wyślij mimo to", nigdy ciche nadpisanie. */
  mimoNowejWiadomosci?: boolean;
  /** Druga jawna zgoda: „odpowiadam, choć przy rozmowie siedzi kto inny". */
  mimoObecnosci?: boolean;
  database?: DatabaseSync;
  wyslij?: WyslijDoAllegro;
  /** Znacznik „przeczytane" w Allegro. Wstrzykiwany, żeby test nie szedł w sieć. */
  oznaczPrzeczytany?: OznaczPrzeczytany;
}

export type StatusWysylki = "sending" | "sent" | "send_uncertain" | "send_failed";

/** Znacznik „nie ma czego oznaczać" — tryb dev. Nie jest błędem i nie idzie do audytu. */
class PomijamOznaczenie extends Error {}

/**
 * Klucz idempotencji wylicza SERWER, nie klient.
 *
 * Gdyby podawał go klient, dwie zakładki albo podwójne kliknięcie dałyby dwa
 * różne klucze i dwie odpowiedzi u klienta. Wyliczony z rozmowy, ostatniej
 * wiadomości i treści jest identyczny dla tego samego zamiaru — a inny, gdy
 * agent poprawił choć jedno słowo.
 */
export function kluczIdempotencji(
  conversationId: number, lastMessageId: number | null, body: string, zalaczniki: string[] = [],
) {
  /* ZAŁĄCZNIKI WCHODZĄ DO KLUCZA (0.195.0). Bez nich „ten sam tekst z innym
     zdjęciem" miałby klucz identyczny z wysyłką sprzed chwili, a strażnik
     dubletu oddałby stan tamtej próby zamiast wysłać poprawiony komplet —
     czyli zdjęcie po cichu nie poszłoby do klienta. Kolejność sortowana, bo
     ta sama para plików dodana odwrotnie to ten sam zamiar. */
  const material = zalaczniki.length === 0 ? body : `${body}\u0000${[...zalaczniki].sort().join(",")}`;
  const skrot = createHash("sha256").update(material).digest("hex").slice(0, 4);
  return `snd-${conversationId}-${lastMessageId ?? 0}-${skrot}`;
}

/* Niejednoznaczny timeout to NIE to samo co odmowa. Odmowę widać w kodzie
   HTTP i wiadomo, że nic nie poszło; po timeoucie żądanie mogło dojść.
   §8.5: nie ponawiamy takiej wysyłki automatycznie. */
const niejednoznaczny = (e: unknown) =>
  /timeout|abort|ECONNRESET|socket hang up/i.test(e instanceof Error ? e.message : String(e));

interface Kontekst {
  externalConversationId: string;
  channelAccountId: number;
  version: number;
  assignedUserId: number | null;
  lastMessageId: number | null;
}

function kontekst(database: DatabaseSync, conversationId: number): Kontekst {
  const c = database.prepare(`SELECT external_conversation_id, channel_account_id, version,
    assigned_user_id FROM conversation WHERE id=?`).get(conversationId) as
    { external_conversation_id: string; channel_account_id: number; version: number;
      assigned_user_id: number | null } | undefined;
  if (!c) throw new Error("Nie znaleziono rozmowy");
  /* Ostatnia wiadomość KLIENTA, nie ostatnia w ogóle. §8.5 mówi o „zgodności
     ostatniej wiadomości klienta", i to nie jest drobiazg: własna odpowiedź
     przesuwałaby ten punkt, więc druga wysyłka w tej samej rozmowie zawsze
     wyglądałaby na pisaną do nieaktualnego pytania. */
  const m = database.prepare(
    "SELECT id FROM message WHERE conversation_id=? AND direction='incoming' ORDER BY id DESC LIMIT 1")
    .get(conversationId) as { id: number } | undefined;
  return {
    externalConversationId: c.external_conversation_id,
    channelAccountId: c.channel_account_id,
    version: c.version,
    assignedUserId: c.assigned_user_id,
    lastMessageId: m?.id ?? null,
  };
}

/**
 * Wysyłka odpowiedzi do klienta (§8.5).
 *
 * Osiem warunków z projektu: zalogowany agent i uprawnienie (pilnuje trasa),
 * aktualne przypisanie, niepusta treść, zgodność wersji rozmowy, zgodność
 * ostatniej wiadomości klienta, klucz idempotencji i zdarzenie audytowe.
 *
 * Sieć jest POZA transakcją, tak samo jak w synchronizatorze: wolne Allegro
 * nie ma prawa trzymać blokady zapisu SQLite.
 */
/** `NewMessageInThread.text` — `maxLength: 2000` wprost ze specyfikacji. */
export const LIMIT_ZNAKOW = 2000;

export async function wyslijOdpowiedz(z: ZadanieWysylki) {
  const database = z.database ?? db();
  const wyslij = z.wyslij ?? wyslijDoAllegro;
  const tresc = (z.body ?? "").trim();
  if (!tresc) throw new Error("Pusta odpowiedź nie idzie do klienta");
  /* Limit z `NewMessageInThread` w specyfikacji Allegro. Bez tej bramki
     za długa odpowiedź idzie do Allegro, wraca jako 400, a kolejka zapisuje
     `send_failed` — agent traci napisany tekst i nie wie, dlaczego. Lepiej
     powiedzieć to przed wysłaniem, gdy szkic jeszcze stoi na ekranie. */
  if (tresc.length > LIMIT_ZNAKOW) {
    throw new Error(
      `Allegro przyjmuje najwyżej ${LIMIT_ZNAKOW} znaków, a odpowiedź ma ${tresc.length}`);
  }

  const k = kontekst(database, z.conversationId);

  /* ── Kto ma prawo odpowiedzieć (0.159.0) ──────────────────────────────────
     Do 0.158.0 wysyłka wymagała WCZEŚNIEJSZEGO przejęcia rozmowy: agent, który
     wszedł w pytanie i napisał odpowiedź, dostawał na końcu „najpierw ją
     przejmij" i tracił ruch. Decyzja właściciela: samo wejście trzyma rozmowę
     na czas siedzenia, a ODPOWIEDŹ przydziela ją na stałe.

     Rozmowa nieprzypisana idzie więc do wysyłki bez osobnego kliknięcia —
     chyba że siedzi przy niej kto inny. Wtedy blokuje UCHWYT z pamięci
     procesu, a nie kolumna w bazie: sygnał żyje kilkadziesiąt sekund od
     ostatniego znaku życia i nie przeżywa restartu usługi. */
  if (k.assignedUserId !== null && k.assignedUserId !== z.autor.id) {
    /* Trwały właściciel bije wszystko. Inaczej dwóch agentów odpowiada
       jednocześnie, a klient dostaje dwie różne wersje tej samej prawdy. */
    throw new ConversationConflict("Rozmowę prowadzi kto inny — najpierw ją przejmij", {
      assignedUserId: k.assignedUserId, version: k.version,
    });
  }
  const trzyma = k.assignedUserId === null ? trzymajacy(z.conversationId) : null;
  if (trzyma && trzyma.userId !== z.autor.id && !z.mimoObecnosci) {
    /* Blokada MIĘKKA i z jawnym wyjściem: kolega mógł zostawić otwartą
       zakładkę i wyjść. Bez „mimo to" uchwyt byłby ścianą do końca TTL. */
    throw new ConversationConflict(
      `Przy tej rozmowie siedzi ${trzyma.name} — odpowiedź wymaga potwierdzenia`, {
        trzymajacyUserId: trzyma.userId, trzymajacyName: trzyma.name, version: k.version,
      });
  }
  if (k.version !== z.expectedVersion) {
    throw new ConversationConflict("Rozmowa zmieniła się podczas redagowania", {
      version: k.version,
    });
  }

  /* Kontrola świeżości — blizna 0.110.0. Dopisek klienta nie zakłada drugiej
     sprawy i NIE kasuje szkicu; zmienia tylko to, na którą wersję pytania
     odpowiadamy. Dlatego wysyłka wymaga ponownego zatwierdzenia. */
  if (k.lastMessageId !== z.expectedLastMessageId && !z.mimoNowejWiadomosci) {
    const nowa = database.prepare(
      "SELECT id, body, sent_at FROM message WHERE id=? AND direction='incoming'").get(k.lastMessageId) as
      { id: number; body: string; sent_at: string } | undefined;
    logEvent("rozmowa_wysylka_konflikt", z.autor.name, null,
      { conversationId: z.conversationId, oczekiwana: z.expectedLastMessageId,
        biezaca: k.lastMessageId }, undefined, database);
    throw new ConversationConflict("Klient dopisał wiadomość — wysyłka wymaga zatwierdzenia", {
      lastMessageId: k.lastMessageId,
      nowaWiadomosc: nowa ? { id: nowa.id, tresc: nowa.body, at: nowa.sent_at } : null,
      kluczIdempotencji: kluczIdempotencji(
        z.conversationId, k.lastMessageId, tresc, zalacznikiRozmowy(database, z.conversationId)
          .map((a) => a.allegroId)),
    });
  }

  /* Załączniki bierzemy Z BAZY, nie z żądania panelu: leżą przy rozmowie od
     chwili wgrania do Allegro (`wysylka_zalacznik`), a szkic jest współdzielony
     — plik dołożony przez kolegę ma pójść z odpowiedzią tak samo jak jego
     zdanie w treści. Panel nie ma czego przysyłać, więc nie ma czego zgubić. */
  const zalaczniki = zalacznikiRozmowy(database, z.conversationId);
  const idZalacznikow = zalaczniki.map((a) => a.allegroId);

  const klucz = kluczIdempotencji(z.conversationId, k.lastMessageId, tresc, idZalacznikow);
  const juz = database.prepare("SELECT id, status, external_message_id FROM outbox WHERE idempotency_key=?")
    .get(klucz) as { id: number; status: StatusWysylki; external_message_id: string | null } | undefined;

  if (juz) {
    /* Podwójne kliknięcie nie tworzy drugiej odpowiedzi. Zwracamy stan
       pierwszej próby zamiast strzelać jeszcze raz. */
    if (juz.status === "sent") {
      return { outboxId: juz.id, status: juz.status, kluczIdempotencji: klucz,
        externalMessageId: juz.external_message_id };
    }
    if (juz.status === "sending") {
      throw new ConversationConflict("Wysyłka tej odpowiedzi już trwa", { kluczIdempotencji: klucz });
    }
    if (juz.status === "send_uncertain") {
      /* §8.5: po niejednoznacznym timeoucie NIE ponawiamy automatycznie.
         Najpierw synchronizacja wątku ma powiedzieć, czy odpowiedź tam jest. */
      throw new ConversationConflict(
        "Poprzednia próba nie dała jednoznacznej odpowiedzi — najpierw zsynchronizuj wątek",
        { kluczIdempotencji: klucz, outboxId: juz.id });
    }
    database.prepare("UPDATE outbox SET status='sending', blad=NULL, finished_at=NULL WHERE id=?")
      .run(juz.id);
  }

  const outboxId = juz?.id ?? Number(database.prepare(`INSERT INTO outbox(conversation_id,
    idempotency_key, body, expected_version, expected_last_message_id, status, created_by)
    VALUES (?,?,?,?,?,'sending',?)`).run(z.conversationId, klucz, tresc, z.expectedVersion,
      k.lastMessageId, z.autor.id).lastInsertRowid);

  logEvent("rozmowa_wysylka_proba", z.autor.name, null,
    { conversationId: z.conversationId, outboxId, kluczIdempotencji: klucz, znakow: tresc.length,
      zalacznikow: idZalacznikow.length },
    undefined, database);

  let wynik;
  try {
    wynik = await wyslij(k.externalConversationId, tresc, idZalacznikow);
  } catch (e) {
    const status: StatusWysylki = niejednoznaczny(e) ? "send_uncertain" : "send_failed";
    const komunikat = e instanceof Error ? e.message : String(e);
    database.prepare(`UPDATE outbox SET status=?, blad=?,
      finished_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?`).run(status, komunikat, outboxId);
    logEvent(status === "send_uncertain" ? "rozmowa_wysylka_niepewna" : "rozmowa_wysylka_blad",
      z.autor.name, null, { conversationId: z.conversationId, outboxId, blad: komunikat },
      undefined, database);
    throw e;
  }

  const wynikWysylki = transaction(database, () => {
    /* Wiersz `message` powstaje TYLKO z numerem od Allegro. Bez numeru
       synchronizacja przyniosłaby tę samą wiadomość jeszcze raz i na osi
       stanęłyby dwie — a §8.4 zabrania, żeby wiersz wracał z nowym numerem. */
    if (!wynik.externalMessageId) {
      database.prepare(`UPDATE outbox SET status='send_uncertain',
        blad='Allegro nie podało numeru wiadomości',
        finished_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?`).run(outboxId);
      logEvent("rozmowa_wysylka_niepewna", z.autor.name, null,
        { conversationId: z.conversationId, outboxId }, undefined, database);
      return { outboxId, status: "send_uncertain" as StatusWysylki, kluczIdempotencji: klucz,
        externalMessageId: null };
    }

    database.prepare(`INSERT INTO message(conversation_id, channel_account_id,
      external_message_id, direction, body, sent_at)
      VALUES (?,?,?,'outgoing',?,strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      ON CONFLICT(channel_account_id, external_message_id) DO NOTHING`)
      .run(z.conversationId, k.channelAccountId, wynik.externalMessageId, tresc);

    database.prepare(`UPDATE outbox SET status='sent', external_message_id=?,
      finished_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?`)
      .run(wynik.externalMessageId, outboxId);

    /* Szkic znika dopiero po UDANEJ wysyłce. Przy każdym innym końcu zostaje
       nietknięty — odrzucona wysyłka nie ma prawa skasować pracy agenta. */
    database.prepare("DELETE FROM conversation_draft WHERE conversation_id=?").run(z.conversationId);
    /* Załączniki znikają razem ze szkicem i z tego samego powodu: poszły już
       do klienta, więc wiszące dalej przy rozmowie doklejałyby się do KAŻDEJ
       następnej odpowiedzi. */
    database.prepare("DELETE FROM wysylka_zalacznik WHERE conversation_id=?").run(z.conversationId);

    /* ODPOWIEDŹ PRZESTAWIA ROZMOWĘ NA CZEKANIE (§7, 0.158.0). Piłka jest po
       stronie klienta i kolejka ma to pokazywać sama — status wymagający
       osobnego kliknięcia po każdej wysyłce zostałby pomijany. */
    zmienStatus(database, z.conversationId, "waiting_for_customer", z.autor.id, null);

    /* ODPOWIEDŹ PRZYDZIELA NA STAŁE (0.159.0). Kto odpisał klientowi, ten
       prowadzi sprawę — bez tego rozmowa wracałaby do puli zaraz po tym, jak
       ktoś wziął za nią odpowiedzialność, a klient dopytujący trafiałby za
       każdym razem na kogo innego.

       Zapis idzie razem z wiadomością, w tej samej transakcji: przypisanie
       bez wysłanej odpowiedzi albo odwrotnie to dwa różne rodzaje kłamstwa. */
    if (k.assignedUserId === null) {
      database.prepare(`UPDATE conversation SET assigned_user_id=?, version=version+1
        WHERE id=?`).run(z.autor.id, z.conversationId);
      database.prepare(`INSERT INTO conversation_assignment(conversation_id, assigned_to, assigned_by)
        VALUES (?,?,?)`).run(z.conversationId, z.autor.id, z.autor.id);
      logEvent("rozmowa_przypisana_odpowiedzia", z.autor.name, null,
        { conversationId: z.conversationId, outboxId }, undefined, database);
    }

    logEvent("rozmowa_wyslana", z.autor.name, null,
      { conversationId: z.conversationId, outboxId, kluczIdempotencji: klucz,
        externalMessageId: wynik.externalMessageId, znakow: tresc.length,
        zalacznikow: idZalacznikow.length }, undefined, database);

    publishConversationEvent("message.created", z.conversationId, { outboxId });
    return { outboxId, status: "sent" as StatusWysylki, kluczIdempotencji: klucz,
      externalMessageId: wynik.externalMessageId };
  })();

  /* ── Wątek przeczytany PO wysyłce (0.195.0) ────────────────────────────────
     Do 0.194.1 odpowiedź wysłana z panelu zostawiała wątek NIEPRZECZYTANY
     w Centrum Wiadomości Allegro. Im lepiej działał panel, tym bardziej kłamał
     licznik po tamtej stronie: czerwona plakietka przy sprawach załatwionych,
     a po niej nie sposób poznać, co jeszcze czeka.

     TU, a nie przy otwarciu rozmowy: „zero zapisu przy patrzeniu" obowiązuje
     także zapisy do cudzego systemu. Przeczytana znaczy „odpisaliśmy", nie
     „ktoś zajrzał" — a zajrzeć potrafi dwóch agentów naraz.

     POZA transakcją i po niej, jak każda sieć w tym pliku. Błąd NIE wywraca
     wysyłki: wiadomość jest już u klienta, więc odmowa oznaczenia to
     niedogodność, nie utrata pracy. Idzie do audytu i tam zostaje. */
  if (wynikWysylki.status === "sent") {
    /* W trybie `dev` nie ma dokąd tego wysłać, a testy tras i serwisów mają
       NIE strzelać do Allegro — ta sama reguła, przez którą tickery stoją
       wyłącznie w `main()`. Wstrzyknięta funkcja bije tryb, bo test wysyłki
       chce sprawdzić właśnie to wywołanie. */
    const oznacz = z.oznaczPrzeczytany
      ?? (allegroTryb() === "http" ? oznaczPrzeczytanyWAllegro : null);
    try {
      if (!oznacz) throw new PomijamOznaczenie();
      await oznacz(k.externalConversationId);
      /* Lokalna flaga schodzi od razu, nie za kwadrans: kolejka odświeża się
         przy tym zdarzeniu, a synchronizacja przyniosłaby to samo dopiero
         przy najbliższym przebiegu. */
      database.prepare("UPDATE conversation SET unread=0 WHERE id=?").run(z.conversationId);
    } catch (e) {
      if (e instanceof PomijamOznaczenie) return wynikWysylki;
      logEvent("rozmowa_przeczytana_blad", z.autor.name, null,
        { conversationId: z.conversationId, outboxId: wynikWysylki.outboxId,
          blad: e instanceof Error ? e.message : String(e) }, undefined, database);
    }
  }

  return wynikWysylki;
}
