import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { db, transaction } from "../db/db.js";
import { ConversationConflict } from "./conversations.js";
import { publishConversationEvent } from "./conversation-realtime.js";
import { logEvent } from "./events.js";
import { wyslijDoAllegro, type WyslijDoAllegro } from "./allegro-wysylka.js";

export interface ZadanieWysylki {
  conversationId: number;
  autor: { id: number; name: string };
  body: string;
  expectedVersion: number;
  expectedLastMessageId: number | null;
  /** Jawna zgoda z blizny 0.110.0 — „wyślij mimo to", nigdy ciche nadpisanie. */
  mimoNowejWiadomosci?: boolean;
  database?: DatabaseSync;
  wyslij?: WyslijDoAllegro;
}

export type StatusWysylki = "sending" | "sent" | "send_uncertain" | "send_failed";

/**
 * Klucz idempotencji wylicza SERWER, nie klient.
 *
 * Gdyby podawał go klient, dwie zakładki albo podwójne kliknięcie dałyby dwa
 * różne klucze i dwie odpowiedzi u klienta. Wyliczony z rozmowy, ostatniej
 * wiadomości i treści jest identyczny dla tego samego zamiaru — a inny, gdy
 * agent poprawił choć jedno słowo.
 */
export function kluczIdempotencji(conversationId: number, lastMessageId: number | null, body: string) {
  const skrot = createHash("sha256").update(body).digest("hex").slice(0, 4);
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
export async function wyslijOdpowiedz(z: ZadanieWysylki) {
  const database = z.database ?? db();
  const wyslij = z.wyslij ?? wyslijDoAllegro;
  const tresc = (z.body ?? "").trim();
  if (!tresc) throw new Error("Pusta odpowiedź nie idzie do klienta");

  const k = kontekst(database, z.conversationId);

  if (k.assignedUserId !== z.autor.id) {
    /* Wysyła TEN, kto prowadzi rozmowę. Inaczej dwóch agentów odpowiada
       jednocześnie, a klient dostaje dwie różne wersje tej samej prawdy. */
    throw new ConversationConflict("Rozmowę prowadzi kto inny — najpierw ją przejmij", {
      assignedUserId: k.assignedUserId, version: k.version,
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
      kluczIdempotencji: kluczIdempotencji(z.conversationId, k.lastMessageId, tresc),
    });
  }

  const klucz = kluczIdempotencji(z.conversationId, k.lastMessageId, tresc);
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
    { conversationId: z.conversationId, outboxId, kluczIdempotencji: klucz, znakow: tresc.length },
    undefined, database);

  let wynik;
  try {
    wynik = await wyslij(k.externalConversationId, tresc);
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

  return transaction(database, () => {
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

    logEvent("rozmowa_wyslana", z.autor.name, null,
      { conversationId: z.conversationId, outboxId, kluczIdempotencji: klucz,
        externalMessageId: wynik.externalMessageId, znakow: tresc.length }, undefined, database);

    publishConversationEvent("message.created", z.conversationId, { outboxId });
    return { outboxId, status: "sent" as StatusWysylki, kluczIdempotencji: klucz,
      externalMessageId: wynik.externalMessageId };
  })();
}
