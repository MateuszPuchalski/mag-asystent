import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import { migrate } from "../db/db.js";
import { synchronizujAllegroInbox } from "./allegro-inbox-sync.js";
import { BladLimituAllegro } from "../adapters/allegro.js";

const schema = fs.readFileSync(new URL("../db/schema.sql", import.meta.url), "utf8");
/* Schemat PLUS dostawki: `events.user_ref` i część indeksów dochodzą dopiero
   w `migrate()`, więc baza z samego `schema.sql` ma inny kształt niż ta,
   na której chodzi serwer. Audyt przejęcia rozmowy pisze właśnie do `events`. */
const mkDb = () => { const d = new DatabaseSync(":memory:"); d.exec(schema); migrate(d); return d; };
/* Kształt WPROST ZE SPECYFIKACJI Allegro (docs/allegro-ksztalt.md). Do 0.151.0
   stał tu kształt wymyślony razem z kodem — `lastMessageDate`, `author.role`,
   `relatedObject` — i to on jest powodem, dla którego skrzynka nigdy nie
   zapisała ani jednego wątku. Testy nie mają prawa opisywać wygodniejszego
   Allegro niż prawdziwe. */
const thread = (n: number, date = `2026-08-${String(30 - n).padStart(2, "0")}T12:00:00Z`) => ({
  id: `t-${n}`, read: false, lastMessageDateTime: date,
  interlocutor: { login: `anon-${n}`, avatarUrl: `https://a.example.test/anon-${n}` },
});
const message = (id: string, nadpisz: Record<string, unknown> = {}) => ({
  id, status: "DELIVERED", type: "MESSAGE_CENTER", createdAt: "2026-08-29T11:00:00Z",
  thread: { id: "t-1" }, author: { login: "anon", isInterlocutor: true },
  text: "zanonimizowana treść", subject: "Zanonimizowany temat",
  relatesTo: { offer: { id: "oferta-anon" } },
  hasAdditionalAttachments: false, attachments: [], ...nadpisz,
});

function fake(pages: object[][], messageIds = new Map<string, string[]>()) {
  const urls: string[] = [];
  return { urls, query: async (url: string): Promise<unknown> => {
    urls.push(url);
    if (url.includes("/messages")) {
      const id = decodeURIComponent(url.split("/").at(-2)!);
      return { messages: (messageIds.get(id) ?? [`m-${id}`]).map((m) => message(m)),
        offset: 0, limit: 20 };
    }
    const offset = Number(new URL(url).searchParams.get("offset"));
    return { threads: pages[offset / 20] ?? [], offset, limit: 20 };
  }};
}

test("pierwsze pobranie zapisuje wątek, wiadomość i kursor", async () => {
  const database = mkDb(); const api = fake([[thread(1)]]);
  await synchronizujAllegroInbox({ database, query: api.query, apiUrl: "https://api.test", now: () => new Date(0) });
  assert.equal((database.prepare("SELECT count(*) n FROM allegro_inbox_thread").get() as {n:number}).n, 1);
  assert.equal((database.prepare("SELECT count(*) n FROM allegro_inbox_message").get() as {n:number}).n, 1);
  assert.equal((database.prepare("SELECT cursor_id id FROM allegro_inbox_sync_state").get() as {id:string}).id, "t-1");
});

test("drugi przebieg kończy się na kursorze i nie pobiera wiadomości", async () => {
  const database = mkDb(); const first = fake([[thread(1)]]);
  await synchronizujAllegroInbox({ database, query: first.query, apiUrl: "https://api.test" });
  const second = fake([[thread(1)]]);
  await synchronizujAllegroInbox({ database, query: second.query, apiUrl: "https://api.test" });
  assert.equal(second.urls.filter((u) => u.includes("/messages")).length, 0);
});

test("paginacja nie kończy się na pierwszych 20 rekordach", async () => {
  const database = mkDb(); const api = fake([Array.from({length:20},(_,i)=>thread(i)), [thread(20)]]);
  await synchronizujAllegroInbox({ database, query: api.query, apiUrl: "https://api.test" });
  assert.equal((database.prepare("SELECT count(*) n FROM allegro_inbox_thread").get() as {n:number}).n, 21);
  assert.ok(api.urls.some((u) => u.includes("offset=20")));
});

test("dopisanej wiadomości nie gubi drugi przebieg", async () => {
  const database = mkDb(); const one = thread(1);
  await synchronizujAllegroInbox({ database, query: fake([[one]]).query, apiUrl: "https://api.test" });
  const changed = thread(1, "2026-08-31T12:00:00.000Z");
  await synchronizujAllegroInbox({ database, query: fake([[changed]], new Map([["t-1", ["old", "new"]]])).query, apiUrl: "https://api.test" });
  assert.equal((database.prepare("SELECT count(*) n FROM allegro_inbox_message").get() as {n:number}).n, 2);
});

for (const [name, error] of [
  ["429", new BladLimituAllegro("429", 10_000)], ["401", new Error("401")], ["403", new Error("403")],
] as const) test(`${name} przerywa przebieg, zwiększa błędy i nie przesuwa kursora`, async () => {
  const database = mkDb();
  await assert.rejects(synchronizujAllegroInbox({ database, query: async () => { throw error; }, apiUrl: "https://api.test" }));
  const state = database.prepare("SELECT error_count n,cursor_id id FROM allegro_inbox_sync_state").get() as {n:number,id:null};
  assert.equal(state.n, 1);
  assert.equal(state.id, null);
});

test("awaria sieci przy pobieraniu wiadomości kończy przebieg bez zapisu", async () => {
  const database = mkDb();
  await assert.rejects(synchronizujAllegroInbox({ database, apiUrl: "https://api.test", query: async (url) => {
    if (!url.includes("/messages")) return { threads: [thread(1), thread(2)] };
    if (url.includes("t-2")) throw new Error("awaria jednego wątku");
    return { messages: [message("m-1")] };
  }}));
  assert.equal((database.prepare("SELECT count(*) n FROM allegro_inbox_thread").get() as {n:number}).n, 0);
  assert.equal((database.prepare("SELECT cursor_id id FROM allegro_inbox_sync_state").get() as {id:null}).id, null);
});

/* ── Model kanoniczny (0.144.0) ────────────────────────────────────────────
   Do 0.143.1 nikt nie zapisywał do `conversation`, więc przejmowanie rozmowy
   i szkic były kodem nieosiągalnym. Te testy pilnują ogniwa, które to zmienia. */

test("synchronizacja zakłada rozmowę i wiadomość w modelu kanonicznym", async () => {
  const database = mkDb(); const api = fake([[thread(1)]]);
  await synchronizujAllegroInbox({ database, query: api.query, apiUrl: "https://api.test", accountId: "seller-a" });

  const konto = database.prepare("SELECT id, channel, external_account_id e FROM channel_account")
    .get() as { id: number; channel: string; e: string };
  assert.equal(konto.channel, "allegro");
  assert.equal(konto.e, "seller-a");

  const rozmowa = database.prepare(
    "SELECT id, external_conversation_id x, unread, assigned_user_id a FROM conversation",
  ).get() as { id: number; x: string; unread: number; a: number | null };
  assert.equal(rozmowa.x, "t-1");
  assert.equal(rozmowa.unread, 1, "wątek nieprzeczytany w Allegro jest nieprzeczytany u nas");
  assert.equal(rozmowa.a, null, "świeża rozmowa nie ma właściciela");

  const wiadomosc = database.prepare(
    "SELECT conversation_id c, direction, body FROM message",
  ).get() as { c: number; direction: string; body: string };
  assert.equal(wiadomosc.c, rozmowa.id);
  assert.equal(wiadomosc.direction, "incoming");
});

/* KIERUNEK LICZY SIĘ Z `author.isInterlocutor`, nie z roli. Allegro nie
   przysyła żadnego `role` — rozmówca to ten, który NIE jest nami, więc
   `isInterlocutor: true` znaczy „od klienta". Do 0.151.0 stało tu
   `role.toUpperCase() === "SELLER"`, które na prawdziwej odpowiedzi rzucało
   `TypeError` na nieistniejącym polu. */
test("kierunek bierze się z isInterlocutor, a oferta z relatesTo", async () => {
  const database = mkDb();
  const query = async (url: string): Promise<unknown> => url.includes("/messages")
    ? { messages: [
        message("m-1", { author: { login: "klient", isInterlocutor: true },
          text: "Zmierzycie?", relatesTo: { offer: { id: "oferta-9" } } }),
        message("m-2", { author: { login: "wertis", isInterlocutor: false },
          text: "Sprawdzimy.", relatesTo: undefined }),
      ], offset: 0, limit: 20 }
    : { threads: Number(new URL(url).searchParams.get("offset")) ? [] : [thread(1)],
        offset: 0, limit: 20 };
  await synchronizujAllegroInbox({ database, query, apiUrl: "https://api.test" });

  const wiersze = database.prepare(
    "SELECT external_message_id x, direction, related_object_type t, related_object_id o FROM message ORDER BY id",
  ).all() as Array<{ x: string; direction: string; t: string | null; o: string | null }>;
  // node:sqlite zwraca wiersze bez prototypu — rozpakowanie robi z nich zwykłe obiekty
  assert.deepEqual(wiersze.map((w) => ({ ...w })), [
    { x: "m-1", direction: "incoming", t: "OFFER", o: "oferta-9" },
    { x: "m-2", direction: "outgoing", t: null, o: null },
  ]);
});

/* Oś czasu rozmowy stoi na `createdAt` KAŻDEJ wiadomości. Do 0.151.0 wszystkie
   wiadomości wątku dostawały jedną datę — datę wątku — bo kod twierdził, że
   Allegro nie podaje daty pojedynczej wiadomości. Podaje. */
test("wiadomość niesie własną datę i temat, nie datę wątku", async () => {
  const database = mkDb();
  const query = async (url: string): Promise<unknown> => url.includes("/messages")
    ? { messages: [
        message("m-1", { createdAt: "2026-08-29T09:15:00Z", subject: "Rozrusznik 148" }),
        message("m-2", { createdAt: "2026-08-29T16:40:00Z", subject: "Rozrusznik 148" }),
      ], offset: 0, limit: 20 }
    : { threads: Number(new URL(url).searchParams.get("offset")) ? [] : [thread(1)],
        offset: 0, limit: 20 };
  await synchronizujAllegroInbox({ database, query, apiUrl: "https://api.test" });

  const daty = (database.prepare("SELECT sent_at FROM message ORDER BY id")
    .all() as Array<{ sent_at: string }>).map((w) => w.sent_at);
  assert.deepEqual(daty, ["2026-08-29T09:15:00Z", "2026-08-29T16:40:00Z"]);

  const temat = (database.prepare("SELECT subject FROM conversation").get() as
    { subject: string | null }).subject;
  assert.equal(temat, "Rozrusznik 148", "temat rozmowy to temat, nie login rozmówcy");
});

/* Powtórny przebieg nie może podmienić wiersza wiadomości: wiszą na nim szkic
   (`expected_last_message_id`) i `zadanie_terenowe.message_id`. */
test("powtórna synchronizacja nie dubluje ani nie podmienia wiadomości", async () => {
  const database = mkDb();
  await synchronizujAllegroInbox({ database, query: fake([[thread(1)]]).query, apiUrl: "https://api.test" });
  const przed = database.prepare("SELECT id FROM message").get() as { id: number };
  // nowa data wątku wymusza ponowne pobranie wiadomości
  await synchronizujAllegroInbox({
    database, query: fake([[thread(1, "2026-08-31T12:00:00.000Z")]]).query, apiUrl: "https://api.test",
  });
  const po = database.prepare("SELECT id FROM message").all() as Array<{ id: number }>;
  assert.equal(po.length, 1, "wiadomość nie zdublowała się");
  assert.equal(po[0].id, przed.id, "wiersz zachował identyfikator, więc szkic i zadania nie osierocieją");
  assert.equal((database.prepare("SELECT count(*) n FROM conversation").get() as {n:number}).n, 1);
});

test("przejęcie rozmowy działa na rozmowie z synchronizacji", async () => {
  const database = mkDb();
  await synchronizujAllegroInbox({ database, query: fake([[thread(1)]]).query, apiUrl: "https://api.test" });
  const { przejmijRozmowe } = await import("./conversations.js");
  const rozmowa = database.prepare("SELECT id, version FROM conversation").get() as { id: number; version: number };
  const agent = Number(database.prepare(
    "INSERT INTO app_user(login,name,role) VALUES ('ala','Ala','biuro')").run().lastInsertRowid);

  const wynik = przejmijRozmowe(rozmowa.id, agent, rozmowa.version, database);
  assert.equal(wynik.assignedUserId, agent);
  assert.throws(() => przejmijRozmowe(rozmowa.id, agent + 1, rozmowa.version, database), /przejął już inny agent/);
});

/* ── Wątek bez ostatniej wiadomości ─────────────────────────────────────────
   Schemat `Thread` wymaga WYŁĄCZNIE `id` i `read`; `lastMessageDateTime`
   i `interlocutor` są opcjonalne i jawnie `nullable`. Wątek świeżo założony
   nie ma jak mieć ostatniej wiadomości, więc to jest zwykła poprawna
   odpowiedź, a nie awaria.

   0.151.0 zaczęło od odwrotnego założenia — że taki wątek jest zepsuty
   i należy go pominąć. Specyfikacja to obaliła i dlatego ten test stoi tutaj:
   pominięcie poprawnego wątku znaczyłoby rozmowę, której panel nie pokazuje. */
test("wątek bez daty i bez rozmówcy wchodzi do skrzynki z pustymi polami", async () => {
  const database = mkDb();
  const { lastMessageDateTime: _d, interlocutor: _i, ...swiezy } = thread(3);

  await synchronizujAllegroInbox({
    database, apiUrl: "https://api.test",
    query: fake([[thread(1), swiezy]]).query,
  });

  const w = database.prepare(`SELECT last_message_at d, interlocutor_login l
    FROM allegro_inbox_thread WHERE id='t-3'`).get() as
    { d: string | null; l: string | null } | undefined;
  assert.ok(w, "wątek bez daty ma wejść do skrzynki, a nie zostać pominięty");
  assert.equal(w.d, null);
  assert.equal(w.l, null);

  /* Kursor porównuje się PARĄ (data, id), więc wątek bez daty nie ma jak
     w tej parze stanąć — bierze go najnowszy wątek, który datę ma. */
  const stan = database.prepare("SELECT cursor_id i, error_thread_count e FROM allegro_inbox_sync_state")
    .get() as { i: string; e: number };
  assert.equal(stan.i, "t-1");
  assert.equal(stan.e, 0, "poprawny wątek nie jest błędem");
});

/* ── §9: błąd pojedynczego wątku ma być IZOLOWANY ───────────────────────────
   Z produkcji (1 września 2026): `Provided value cannot be bound to SQLite
   parameter 3` w kółko, przez wiele przebiegów. Cała partia szła JEDNĄ
   transakcją, więc jeden odrzucony wątek wywracał przebieg w całości:
   skrzynka przestawała się odświeżać, choć pozostałe wątki były zdrowe.
   §9 projektu panelu żąda czegoś innego — synchronizator „izoluje błąd
   pojedynczego wątku", a §8.3 zabrania przesuwać kursor „po niepełnym
   zapisie".

   Zepsuty wątek to dziś taki, który łamie SCHEMAT: `read` jest wymagane
   i logiczne, więc „może" nie jest wartością, którą wolno zgadnąć na zero. */
test("jeden zepsuty wątek nie zatrzymuje przebiegu ani nie truje kursora", async () => {
  const database = mkDb();
  const zepsuty = { ...thread(3), read: "może" };

  await synchronizujAllegroInbox({
    database, apiUrl: "https://api.test",
    query: fake([[thread(1), zepsuty, thread(2)]]).query,
  });

  const zapisane = (database.prepare("SELECT id FROM allegro_inbox_thread ORDER BY id")
    .all() as Array<{ id: string }>).map((w) => w.id);
  assert.deepEqual(zapisane, ["t-1", "t-2"], "zdrowe wątki mają przejść mimo zepsutego");

  const stan = database.prepare(`SELECT cursor_id, last_success_at, error_thread_count
    FROM allegro_inbox_sync_state WHERE id=1`).get() as
    { cursor_id: string | null; last_success_at: string | null; error_thread_count: number };
  assert.ok(stan.last_success_at, "przebieg ma się domknąć, a nie polec");
  assert.equal(stan.error_thread_count, 1, "zepsuty wątek ma się policzyć");
  assert.notEqual(stan.cursor_id, "t-3");
});
