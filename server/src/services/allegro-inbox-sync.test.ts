import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import { migrate } from "../db/db.js";
import {
  _zdejmijWstrzymanieStruktury, rozmowcaWatku, strukturaZOdpowiedzi, synchronizujAllegroInbox,
} from "./allegro-inbox-sync.js";
import { BladLimituAllegro, BladOdpowiedziAllegro } from "../adapters/allegro.js";
import { onConversationEvent } from "./conversation-realtime.js";
import { stanProblemowZakupu } from "./allegro-inbox-sync-state.js";

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
/* Daty fixture'ów stoją ZA granicą produkcyjną (1 września 2026). Sierpniowe
   znaczyłyby dziś „przed progiem" i testy mierzyłyby granicę tam, gdzie
   sprawdzają co innego. */
const thread = (n: number, date = `2026-09-${String(30 - n).padStart(2, "0")}T12:00:00Z`) => ({
  id: `t-${n}`, read: false, lastMessageDateTime: date,
  interlocutor: { login: `anon-${n}`, avatarUrl: `https://a.example.test/anon-${n}` },
});
const message = (id: string, nadpisz: Record<string, unknown> = {}) => ({
  id, status: "DELIVERED", type: "MESSAGE_CENTER", createdAt: "2026-09-29T11:00:00Z",
  thread: { id: "t-1" }, author: { login: "anon", isInterlocutor: true },
  text: "zanonimizowana treść", subject: "Zanonimizowany temat",
  relatesTo: { offer: { id: "oferta-anon" } },
  hasAdditionalAttachments: false, attachments: [], ...nadpisz,
});

function fake(pages: object[][], messageIds = new Map<string, string[]>(),
  nadpiszWiadomosc: Record<string, unknown> = {}) {
  const urls: string[] = [];
  return { urls, query: async (url: string): Promise<unknown> => {
    urls.push(url);
    if (url.includes("/messages")) {
      const id = decodeURIComponent(url.split("/").at(-2)!);
      return { messages: (messageIds.get(id) ?? [`m-${id}`])
          .map((m) => message(m, nadpiszWiadomosc)),
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
  const changed = thread(1, "2026-09-30T12:00:00.000Z");
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
        /* Gałęzie `offer` i `order` są NIEZALEŻNE (0.166.0): sama druga,
           obie naraz. Do 0.164.0 `order` ginął przy mapowaniu w każdym z tych
           przypadków — a sonda liczy go częściej niż ofertę. */
        message("m-3", { text: "Kiedy wysyłka?", relatesTo: { order: { id: "zam-3" } } }),
        message("m-4", { text: "Ta sztuka z tego zamówienia?",
          relatesTo: { offer: { id: "oferta-9" }, order: { id: "zam-4" } } }),
      ], offset: 0, limit: 20 }
    : { threads: Number(new URL(url).searchParams.get("offset")) ? [] : [thread(1)],
        offset: 0, limit: 20 };
  await synchronizujAllegroInbox({ database, query, apiUrl: "https://api.test" });

  const wiersze = database.prepare(
    `SELECT external_message_id x, direction, related_object_type t, related_object_id o,
            related_order_id z FROM message ORDER BY id`,
  ).all() as Array<{ x: string; direction: string; t: string | null; o: string | null; z: string | null }>;
  // node:sqlite zwraca wiersze bez prototypu — rozpakowanie robi z nich zwykłe obiekty
  assert.deepEqual(wiersze.map((w) => ({ ...w })), [
    { x: "m-1", direction: "incoming", t: "OFFER", o: "oferta-9", z: null },
    { x: "m-2", direction: "outgoing", t: null, o: null, z: null },
    { x: "m-3", direction: "incoming", t: null, o: null, z: "zam-3" },
    { x: "m-4", direction: "incoming", t: "OFFER", o: "oferta-9", z: "zam-4" },
  ]);
});

/* Oś czasu rozmowy stoi na `createdAt` KAŻDEJ wiadomości. Do 0.151.0 wszystkie
   wiadomości wątku dostawały jedną datę — datę wątku — bo kod twierdził, że
   Allegro nie podaje daty pojedynczej wiadomości. Podaje. */
test("wiadomość niesie własną datę i temat, nie datę wątku", async () => {
  const database = mkDb();
  const query = async (url: string): Promise<unknown> => url.includes("/messages")
    ? { messages: [
        message("m-1", { createdAt: "2026-09-29T09:15:00Z", subject: "Rozrusznik 148" }),
        message("m-2", { createdAt: "2026-09-29T16:40:00Z", subject: "Rozrusznik 148" }),
      ], offset: 0, limit: 20 }
    : { threads: Number(new URL(url).searchParams.get("offset")) ? [] : [thread(1)],
        offset: 0, limit: 20 };
  await synchronizujAllegroInbox({ database, query, apiUrl: "https://api.test" });

  const daty = (database.prepare("SELECT sent_at FROM message ORDER BY id")
    .all() as Array<{ sent_at: string }>).map((w) => w.sent_at);
  assert.deepEqual(daty, ["2026-09-29T09:15:00Z", "2026-09-29T16:40:00Z"]);

  const temat = (database.prepare("SELECT subject FROM conversation").get() as
    { subject: string | null }).subject;
  assert.equal(temat, "Rozrusznik 148", "temat rozmowy to temat, nie login rozmówcy");
});

/* Allegro oddaje wiadomości OD NAJNOWSZEJ (23 września 2026). Wpis w tej
   kolejności dawał starszemu dopiskowi wyższe `id`, a kontrola świeżości
   wysyłki odmawiała wtedy 409 przy każdej odpowiedzi w takiej rozmowie. */
test("paczka od najnowszej wchodzi od najstarszej: id rosną razem z czasem", async () => {
  const database = mkDb();
  const query = async (url: string): Promise<unknown> => url.includes("/messages")
    ? { messages: [
        message("m-2", { createdAt: "2026-09-22T21:57:00Z" }),
        message("m-1", { createdAt: "2026-09-22T21:56:00Z" }),
      ], offset: 0, limit: 20 }
    : { threads: Number(new URL(url).searchParams.get("offset")) ? [] : [thread(1)],
        offset: 0, limit: 20 };
  await synchronizujAllegroInbox({ database, query, apiUrl: "https://api.test" });
  const kolejnosc = (database.prepare("SELECT external_message_id AS e FROM message ORDER BY id")
    .all() as Array<{ e: string }>).map((w) => w.e);
  assert.deepEqual(kolejnosc, ["m-1", "m-2"]);
});

/* Powtórny przebieg nie może podmienić wiersza wiadomości: wiszą na nim szkic
   (`expected_last_message_id`) i `zadanie_terenowe.message_id`. */
test("powtórna synchronizacja nie dubluje ani nie podmienia wiadomości", async () => {
  const database = mkDb();
  await synchronizujAllegroInbox({ database, query: fake([[thread(1)]]).query, apiUrl: "https://api.test" });
  const przed = database.prepare("SELECT id FROM message").get() as { id: number };
  // nowa data wątku wymusza ponowne pobranie wiadomości
  await synchronizujAllegroInbox({
    database, query: fake([[thread(1, "2026-09-30T12:00:00.000Z")]]).query, apiUrl: "https://api.test",
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

/* ── Granica czasu (0.152.0) ─────────────────────────────────────────────────
   Decyzja właściciela: skrzynka pokazuje rozmowy od 1 września 2026, północy
   czasu lokalnego. Wcześniejszych nie pobieramy wcale — nie chodzi o ukrycie
   ich na ekranie, tylko o to, żeby synchronizacja przestała przemielać całą
   historię konta przy każdym przebiegu.

   Granica stoi na WĄTKU, nie na wiadomości: rozmowa z jakąkolwiek wiadomością
   po tej dacie wchodzi w całości, razem z wcześniejszym kontekstem. Agent,
   który widzi pytanie bez jego początku, odpowiada w ciemno. */
const GRANICA = "2026-08-31T22:00:00Z";

test("wątek sprzed granicy nie wchodzi i NIE zostaje kursorem", async () => {
  const database = mkDb();
  const nowy = thread(1, "2026-09-01T08:00:00.000Z");
  const stary = thread(2, "2026-08-20T08:00:00.000Z");

  await synchronizujAllegroInbox({
    database, apiUrl: "https://api.test", inboxOd: GRANICA,
    query: fake([[nowy, stary]]).query,
  });

  const zapisane = (database.prepare("SELECT id FROM allegro_inbox_thread ORDER BY id")
    .all() as Array<{ id: string }>).map((w) => w.id);
  assert.deepEqual(zapisane, ["t-1"], "wątek sprzed granicy wjechał mimo progu");

  /* Ta sama zasada, co przy wątku pominiętym w 0.149.2: kursor na wątku,
     którego nie zapisaliśmy, kazałby następnemu przebiegowi uznać go za punkt
     odniesienia i przestać widzieć wszystko, co za nim. */
  const stan = database.prepare("SELECT cursor_id FROM allegro_inbox_sync_state WHERE id=1")
    .get() as { cursor_id: string | null };
  assert.equal(stan.cursor_id, "t-1");
});

test("granica zatrzymuje skanowanie, zamiast czytać całą historię", async () => {
  /* Lista wątków przychodzi od najnowszego, więc pierwszy wątek poniżej progu
     znaczy „dalej są już same starsze". Bez zatrzymania każdy przebieg
     chodziłby przez wszystkie strony konta aż do końca historii. */
  const database = mkDb();
  /* OBIE strony są PEŁNE (20 wątków). Bez granicy pętla poszłaby po trzecią,
     bo pełna strona znaczy „może być więcej" — więc brak zapytania o
     `offset=40` jest dowodem, że zatrzymał ją próg, a nie koniec danych. */
  const api = fake([
    Array.from({ length: 20 }, (_, i) => thread(i, `2026-09-${String(30 - i).padStart(2, "0")}T08:00:00Z`)),
    Array.from({ length: 20 }, (_, i) => thread(100 + i, `2026-08-${String(30 - i).padStart(2, "0")}T08:00:00Z`)),
    Array.from({ length: 20 }, (_, i) => thread(200 + i, `2026-07-${String(30 - i).padStart(2, "0")}T08:00:00Z`)),
  ]);

  await synchronizujAllegroInbox({
    database, apiUrl: "https://api.test", inboxOd: GRANICA, query: api.query,
  });

  assert.ok(!api.urls.some((u) => u.includes("offset=40")),
    "skanowanie poszło dalej mimo wątku poniżej granicy");
});

test("wątek po granicy wchodzi z CAŁYM kontekstem, także sprzed niej", async () => {
  const database = mkDb();
  const aktywny = thread(1, "2026-09-01T08:00:00.000Z");

  await synchronizujAllegroInbox({
    database, apiUrl: "https://api.test", inboxOd: GRANICA,
    query: fake([[aktywny]], new Map([["t-1", ["sierpniowa", "wrzesniowa"]]])).query,
  });

  const n = (database.prepare("SELECT count(*) n FROM message").get() as { n: number }).n;
  assert.equal(n, 2, "kontekst sprzed granicy został obcięty");
});

test("bez granicy nic się nie zmienia", async () => {
  /* Pusta wartość to poprawne „bez progu", nie brak konfiguracji. */
  const database = mkDb();
  await synchronizujAllegroInbox({
    database, apiUrl: "https://api.test", inboxOd: null,
    query: fake([[thread(1, "2020-01-01T00:00:00.000Z")]]).query,
  });
  assert.equal((database.prepare("SELECT count(*) n FROM allegro_inbox_thread")
    .get() as { n: number }).n, 1);
});

/* ── Encje HTML (0.152.0) ────────────────────────────────────────────────────
   BLIZNA KUPIONA DRUGI RAZ. `odkodujEncje` leży w `tekst.ts` od 0.127.0
   z kompletem testów, a jej komentarz mówi wprost: „nowa obsługa ma ją wziąć
   gotową, nie odkryć drugi raz na produkcji". Nowa obsługa odkryła ją drugi
   raz na produkcji — panel escape'uje przy renderowaniu, więc `kt&oacute;ry`
   z bazy wyświetlał się dosłownie w każdej polskiej wiadomości. */
test("encje HTML schodzą z treści i tematu przy wjeździe", async () => {
  const database = mkDb();
  await synchronizujAllegroInbox({
    database, apiUrl: "https://api.test",
    query: fake([[thread(1)]], new Map([["t-1", ["m-1"]]]), {
      text: "zwr&oacute;ci&cacute; kt&oacute;ry &ndash; tak",
      subject: "Re: zam&oacute;wienie",
    }).query,
  });

  /* Temat wisi na ROZMOWIE, nie na wiadomości — Allegro powtarza go w każdej
     wiadomości wątku, więc trzymanie go przy każdej byłoby powielaniem. */
  const body = (database.prepare("SELECT body FROM message").get() as { body: string }).body;
  const temat = (database.prepare("SELECT subject FROM conversation")
    .get() as { subject: string | null }).subject;
  assert.equal(body, "zwrócić który – tak");
  assert.equal(temat, "Re: zamówienie");
});

test("lądowisko zostaje SUROWE — encje i tak tam siedzą", async () => {
  /* Doktryna tabel `allegro_inbox_*`: trzymają odpowiedź w kształcie, w jakim
     przyszła. To jedyny ślad, gdyby dekodowanie kiedyś skrzywdziło tekst. */
  const database = mkDb();
  await synchronizujAllegroInbox({
    database, apiUrl: "https://api.test",
    query: fake([[thread(1)]], new Map([["t-1", ["m-1"]]]),
      { text: "kt&oacute;ry" }).query,
  });

  const l = database.prepare("SELECT text, surowe_json FROM allegro_inbox_message")
    .get() as { text: string; surowe_json: string };
  assert.equal(l.text, "kt&oacute;ry");
  assert.ok(l.surowe_json.includes("kt&oacute;ry"));
});

/* ── Powód porażki SŁOWEM (0.152.0) ──────────────────────────────────────────
   Skrzynka stała 62 przebiegi na błędzie BEZ kodu HTTP („Konto Allegro
   niepołączone — /biuro → …"). Serwer znał to zdanie i pisał je do dziennika;
   panel pokazywał `failed` i nic więcej, bo baza trzymała wyłącznie kod.
   Właściciel szukał przyczyny w logach usługi zamiast przeczytać ją z ekranu. */
test("błąd bez kodu HTTP zapisuje SWOJE ZDANIE, nie samo `failed`", async () => {
  const database = mkDb();
  await assert.rejects(synchronizujAllegroInbox({
    database, apiUrl: "https://api.test",
    query: async () => { throw new Error("Konto Allegro niepołączone — /biuro → POŁĄCZ."); },
  }));

  const s = database.prepare(
    "SELECT last_error_code, last_error_text FROM allegro_inbox_sync_state WHERE id=1")
    .get() as { last_error_code: number | null; last_error_text: string | null };
  assert.equal(s.last_error_code, null, "goły Error nie ma kodu i to jest cała sprawa");
  assert.match(s.last_error_text ?? "", /niepołączone/);
});

test("udany przebieg czyści zdanie o błędzie razem z licznikiem", async () => {
  const database = mkDb();
  await assert.rejects(synchronizujAllegroInbox({
    database, apiUrl: "https://api.test",
    query: async () => { throw new Error("chwilowa awaria"); },
  }));
  await synchronizujAllegroInbox({
    database, apiUrl: "https://api.test", query: fake([[thread(1)]]).query,
  });

  const s = database.prepare(
    "SELECT last_error_text, error_count FROM allegro_inbox_sync_state WHERE id=1")
    .get() as { last_error_text: string | null; error_count: number };
  assert.equal(s.last_error_text, null, "stare zdanie zostało na ekranie po naprawie");
  assert.equal(s.error_count, 0);
});

/* ── Załączniki (0.155.0) ────────────────────────────────────────────────────
   Sonda z żywego konta: `attachments` niepuste w 7 z 39 wiadomości. Klient
   przysyłający zdjęcie pękniętej części był dla agenta niewidzialny, bo
   mapowanie kończyło się na treści.

   Schemat Allegro (`MessageAttachmentInfo`) wymaga TYLKO `fileName` i `status`
   — `url` bywa go pozbawiony, a status ma cztery wartości, w tym `UNSAFE`
   i `EXPIRED`. Załącznik bez adresu nie jest usterką, tylko stanem. */
test("załączniki wiadomości wchodzą do bazy razem z nią", async () => {
  const database = mkDb();
  await synchronizujAllegroInbox({
    database, apiUrl: "https://api.test",
    query: fake([[thread(1)]], new Map([["t-1", ["m-1"]]]), {
      attachments: [
        { fileName: "szarpak.jpeg", mimeType: "image/jpeg", status: "SAFE",
          url: "https://upload.allegro.pl/message-center/message-attachments/a1" },
        { fileName: "wygasly.pdf", status: "EXPIRED" },
      ],
    }).query,
  });

  const z = database.prepare(`SELECT file_name, mime_type, url, status
    FROM message_attachment ORDER BY file_name`).all() as Array<Record<string, unknown>>;
  assert.equal(z.length, 2);
  assert.equal(z[0].file_name, "szarpak.jpeg");
  assert.equal(z[0].status, "SAFE");
  /* Brak adresu ma zostać brakiem, a nie pustym napisem: panel rozróżnia
     „nie ma czego pobrać" od „adres jest, tylko pusty". */
  assert.equal(z[1].url, null);
  assert.equal(z[1].status, "EXPIRED");
});

test("powtórna synchronizacja nie dubluje załączników", async () => {
  const database = mkDb();
  const zal = { attachments: [{ fileName: "a.jpg", status: "SAFE", url: "https://u/1" }] };
  for (let i = 0; i < 2; i++) {
    await synchronizujAllegroInbox({
      database, apiUrl: "https://api.test",
      query: fake([[thread(1)]], new Map([["t-1", ["m-1"]]]), zal).query,
    });
  }
  assert.equal((database.prepare("SELECT count(*) n FROM message_attachment")
    .get() as { n: number }).n, 1);
});

/* ── Załączniki przy KAŻDYM przebiegu (przyrost „zdjęcia w rozmowach") ──────
   Do 0.242.0 wchodziły wyłącznie z nową wiadomością: `NEW` („Allegro jeszcze
   sprawdza") zostawało zamrożone, a wiadomości sprzed 0.155.0 nie miały
   zdjęć wcale. Allegro nie przestawia daty wątku, gdy kończy sprawdzać plik,
   więc `NEW` dociąga się osobno, po samym statusie.                        */
test("NEW → SAFE aktualizuje wiersz załącznika, choć wiadomość już istnieje", async () => {
  const database = mkDb();
  const url = "https://upload.allegro.pl/message-center/message-attachments/97dc0b60-2da4-4247-92ba-b748630ba0f6";
  await synchronizujAllegroInbox({ database, apiUrl: "https://api.test",
    query: fake([[thread(1)]], new Map([["t-1", ["m-1"]]]),
      { attachments: [{ fileName: "a.jpg", status: "NEW" }] }).query });
  const stan = () => ({ ...(database.prepare("SELECT file_name, mime_type, url, status FROM message_attachment")
    .get() as Record<string, unknown>) });
  assert.deepEqual(stan(), { file_name: "a.jpg", mime_type: null, url: null, status: "NEW" });

  /* Data wątku BEZ zmiany: główna pętla go nie czyta. Dociąg pyta o wiadomości
     wyłącznie przez `NEW` w bazie. */
  const drugi = fake([[thread(1)]], new Map([["t-1", ["m-1"]]]),
    { attachments: [{ fileName: "a.jpg", mimeType: "image/jpeg", status: "SAFE", url }] });
  await synchronizujAllegroInbox({ database, apiUrl: "https://api.test", query: drugi.query });
  assert.equal(drugi.urls.filter((u) => u.includes("/messages")).length, 1, "dociąg NEW pyta o wątek mimo niezmienionej daty");
  assert.deepEqual(stan(), { file_name: "a.jpg", mime_type: "image/jpeg", url, status: "SAFE" });
  assert.equal((database.prepare("SELECT count(*) n FROM message_attachment").get() as { n: number }).n, 1);
  assert.equal((database.prepare("SELECT count(*) n FROM message").get() as { n: number }).n, 1, "wiadomość nietknięta");

  /* Po `SAFE` nikt już o ten wątek nie pyta. */
  const trzeci = fake([[thread(1)]], new Map([["t-1", ["m-1"]]]));
  await synchronizujAllegroInbox({ database, apiUrl: "https://api.test", query: trzeci.query });
  assert.equal(trzeci.urls.filter((u) => u.includes("/messages")).length, 0);
});

test("załącznik dochodzi do ISTNIEJĄCEJ wiadomości, gdy wątek wraca z nową datą", async () => {
  const database = mkDb();
  await synchronizujAllegroInbox({ database, apiUrl: "https://api.test",
    query: fake([[thread(1)]], new Map([["t-1", ["m-1"]]])).query });
  assert.equal((database.prepare("SELECT count(*) n FROM message_attachment").get() as { n: number }).n, 0);
  await synchronizujAllegroInbox({ database, apiUrl: "https://api.test",
    query: fake([[thread(1, "2026-09-30T12:00:00.000Z")]], new Map([["t-1", ["m-1", "m-2"]]]),
      { attachments: [{ fileName: "a.jpg", status: "SAFE", url: "https://u/1" }] }).query });
  assert.equal((database.prepare("SELECT count(*) n FROM message_attachment").get() as { n: number }).n, 2,
    "po jednym na każdą z dwóch wiadomości, także na tę sprzed przebiegu");
});

test("dwa pliki o tej samej nazwie w jednej wiadomości to jeden wiersz — ostatni wygrywa", async () => {
  const database = mkDb();
  await synchronizujAllegroInbox({ database, apiUrl: "https://api.test",
    query: fake([[thread(1)]], new Map([["t-1", ["m-1"]]]), { attachments: [
      { fileName: "a.jpg", status: "NEW" }, { fileName: "a.jpg", status: "SAFE", url: "https://u/2" },
    ] }).query });
  const w = database.prepare("SELECT status, url FROM message_attachment").all() as Array<Record<string, unknown>>;
  assert.deepEqual(w.map((x) => ({ ...x })), [{ status: "SAFE", url: "https://u/2" }]);
});

test("wiadomość bez załączników nie zakłada pustych wierszy", async () => {
  const database = mkDb();
  await synchronizujAllegroInbox({
    database, apiUrl: "https://api.test", query: fake([[thread(1)]]).query,
  });
  assert.equal((database.prepare("SELECT count(*) n FROM message_attachment")
    .get() as { n: number }).n, 0);
});

/* ── Status rozmowy budzi się z synchronizacji (0.158.0) ─────────────────────
   Przejście samo w sobie ma test w `conversations.test.ts`; ten sprawdza, że
   synchronizator NAPRAWDĘ je woła. Bez tego funkcja byłaby poprawna i martwa —
   dokładnie tak, jak `odkodujEncje` przez trzynaście wydań. */
test("nowa wiadomość klienta otwiera rozmowę uznaną za rozwiązaną", async () => {
  const database = mkDb();
  const agent = Number(database.prepare(
    "INSERT INTO app_user(login,name,role) VALUES ('ala','Ala','biuro')").run().lastInsertRowid);

  await synchronizujAllegroInbox({
    database, apiUrl: "https://api.test", query: fake([[thread(1)]]).query,
  });
  const rozmowa = Number((database.prepare("SELECT id FROM conversation").get() as { id: number }).id);

  const { statusRozmowy, ustawStatus } = await import("./conversations.js");
  ustawStatus(database, rozmowa, "resolved", agent, null);
  assert.equal(statusRozmowy(database, rozmowa), "resolved");

  /* Drugi przebieg z DOPISANĄ wiadomością klienta. */
  await synchronizujAllegroInbox({
    database, apiUrl: "https://api.test",
    query: fake([[thread(1, "2026-09-30T12:00:00Z")]],
      new Map([["t-1", ["m-1", "m-2"]]])).query,
  });

  /* Od 0.225.0 obudzona rozmowa mówi WPROST, kto ma ruch: klient właśnie
     dopisał pytanie, więc czeka na nas. Kolumna wraca do `open` jak dotąd. */
  assert.equal(statusRozmowy(database, rozmowa), "waiting_for_us",
    "rozmowa została rozwiązana mimo nowego pytania klienta");
});

/* ── Sufit stron i zapis po stronie (0.164.1) ────────────────────────────────
   BLIZNA Z PRODUKCJI: 315 986 żądań do Allegro w ciągu jednej doby, przy 0%
   błędów po ich stronie. Skrzynka była jedyną z czterech pętli bez
   ogranicznika, a zapis czekał do ostatniej strony — więc przebieg przerwany
   w połowie nie zostawiał NICZEGO i następny pytał o to samo od nowa.       */

/** Pełna strona listy — 20 wątków o tej samej dacie, różnych identyfikatorach. */
const strona = (od: number, data = "2026-09-15T12:00:00.000Z") =>
  Array.from({ length: 20 }, (_, i) => ({
    id: `p-${od + i}`, read: false, lastMessageDateTime: data,
    interlocutor: { login: `anon-${od + i}` },
  }));

test("PIERWSZE zejście do dna idzie bez sufitu — zaległość musi się nadrobić", async () => {
  /* Gdyby sufit obowiązywał od pierwszego przebiegu, instalacja z zaległością
     większą niż 25 stron czytałaby w kółko te same 500 wątków i nigdy nie
     zobaczyła reszty. Sufit włącza się dopiero, gdy `dno_at` już stoi. */
  const database = mkDb();
  const api = fake(Array.from({ length: 30 }, (_, s) => strona(s * 20)));

  await synchronizujAllegroInbox({ database, query: api.query, apiUrl: "https://api.test" });

  assert.ok(api.urls.some((u) => u.includes("offset=500")),
    "przebieg stanął na sufcie, choć dna jeszcze nie było");
  const dno = database.prepare("SELECT dno_at d FROM allegro_inbox_sync_state").get() as { d: string };
  assert.ok(dno.d, "zejście do dna musi zostawić ślad — inaczej sufit nigdy się nie włączy");
});

test("po zejściu do dna SUFIT ucina przebieg, a kursor i tak idzie do przodu", async () => {
  const database = mkDb();
  // przebieg pierwszy: krótka lista, czyli zejście do dna i zapis `dno_at`
  await synchronizujAllegroInbox({
    database, apiUrl: "https://api.test", query: fake([[thread(1)]]).query,
  });

  /* Przebieg drugi: 30 pełnych stron samych NOWYCH wątków, czyli z datą późniejszą
     niż kursor z pierwszego przebiegu. Dokładnie ten stan zjadł dobę
     żądań: pętla szła do końca historii, bo nie miała się o co zatrzymać. */
  const api = fake(Array.from({ length: 30 }, (_, s) => strona(s * 20, "2026-10-01T12:00:00.000Z")));
  await synchronizujAllegroInbox({ database, apiUrl: "https://api.test", query: api.query });

  const strony = api.urls.filter((u) => u.includes("/threads?"));
  assert.equal(strony.length, 25, "sufit ma uciąć przebieg na 25 stronach");
  assert.ok(!api.urls.some((u) => u.includes("offset=500")), "szósta setka wątków to już nadmiar");

  /* KURSOR PRZESUWA SIĘ MIMO OBCIĘCIA i to jest sedno: bez tego następny
     przebieg czytałby te same 25 stron w kółko, co minutę. Wolno, bo `dno_at`
     mówi, że niżej wszystko już przez nas przeszło, a wątek, w którym coś się
     dzieje, wraca na GÓRĘ listy — nie zostaje pod sufitem. */
  const kursor = database.prepare("SELECT cursor_id id FROM allegro_inbox_sync_state")
    .get() as { id: string };
  assert.equal(kursor.id, "p-0", "kursor stoi na najnowszym wątku obciętego przebiegu");
});

test("strona, która przeszła, ZOSTAJE w bazie mimo awarii następnej", async () => {
  /* Do 0.164.0 wszystko czekało w pamięci do ostatniej strony. Awaria na
     stronie trzechsetnej kasowała dorobek dwustu dziewięćdziesięciu dziewięciu
     i następny przebieg pytał Allegro o te same wiadomości raz jeszcze. */
  const database = mkDb();
  const pierwsza = strona(0);
  await assert.rejects(synchronizujAllegroInbox({
    database, apiUrl: "https://api.test",
    query: async (url: string) => {
      if (url.includes("/messages")) {
        // identyfikator BIERZE SIĘ ZE ŚCIEŻKI, nie z `includes`: „p-2" siedzi
        // też w „p-20", więc dopasowanie po fragmencie wywracałoby pierwszą
        // stronę zamiast drugiej i test mierzyłby co innego, niż opisuje
        const id = decodeURIComponent(url.split("/").at(-2)!);
        if (id === "p-25") throw new Error("awaria drugiej strony");
        // identyfikator wiadomości MUSI zależeć od wątku: `allegro_inbox_message.id`
        // jest kluczem, więc wspólne „m-1" wywracałoby zapis 19 z 20 wątków
        // i test pokazywałby awarię fixture'u zamiast zachowania kodu
        return { messages: [message(`m-${id}`)] };
      }
      return { threads: Number(new URL(url).searchParams.get("offset")) === 0
        ? pierwsza : strona(20) };
    },
  }));

  const n = (database.prepare("SELECT count(*) n FROM allegro_inbox_thread").get() as { n: number }).n;
  assert.equal(n, 20, "pierwsza strona miała zostać zapisana przed pobraniem drugiej");
  const stan = database.prepare("SELECT cursor_id c, dno_at d FROM allegro_inbox_sync_state")
    .get() as { c: string | null; d: string | null };
  assert.equal(stan.c, null, "przebieg się nie udał, więc kursor stoi");
  assert.equal(stan.d, null, "do dna nie zeszliśmy, więc sufit dalej nie obowiązuje");
});

/* ── Czego synchronizator nie mówił panelowi (0.257.0) ───────────────────────
   Skrzynka nie woła `zapiszWiadomosc`, więc omijała wszystko, co tamta funkcja
   robi poza samym `INSERT`-em. Dwa wydania okazały się przez to puste:
   0.228.0 dołożyło pasek „Klient dopisał nową wiadomość", który na prawdziwej
   wiadomości z Allegro nie zapalił się ani razu, a 0.227.0 dołożyło kolumnę
   `auto_odpowiedz`, która tą drogą zostawała zerem do najbliższego restartu.

   Oba testy patrzą na TĘ ścieżkę, nie na `zapiszWiadomosc` — usterka polegała
   właśnie na tym, że strażnik pilnował funkcji, której produkcja nie woła. */

test("zdarzenie o nowej wiadomości niesie KIERUNEK, inaczej pasek nie zapala się nigdy", async () => {
  const database = mkDb();
  const zdarzenia: Array<{ type: string; data: unknown }> = [];
  const odepnij = onConversationEvent((z) => zdarzenia.push({ type: z.type, data: z.data }));
  try {
    await synchronizujAllegroInbox({
      database, apiUrl: "https://api.test",
      query: fake([[thread(1)]], new Map([["t-1", ["m-1", "m-2"]]])).query,
    });
  } finally { odepnij(); }

  const nowe = zdarzenia.filter((z) => z.type === "message.created")
    .map((z) => z.data as { odKlienta?: boolean });
  assert.equal(nowe.length, 2, "synchronizator nie ogłosił obu wiadomości");
  assert.ok(nowe.every((d) => d.odKlienta === true),
    "zdarzenie nie niosło `odKlienta`, więc panel nie miał czym zapalić paska");
});

test("wiadomość WYCHODZĄCA ogłasza się jako nie-klient", async () => {
  const database = mkDb();
  const zdarzenia: Array<{ type: string; data: unknown }> = [];
  const odepnij = onConversationEvent((z) => zdarzenia.push({ type: z.type, data: z.data }));
  try {
    await synchronizujAllegroInbox({
      database, apiUrl: "https://api.test",
      query: fake([[thread(1)]], new Map(),
        { author: { login: "wertis", isInterlocutor: false } }).query,
    });
  } finally { odepnij(); }

  const nowe = zdarzenia.filter((z) => z.type === "message.created")
    .map((z) => z.data as { odKlienta?: boolean });
  assert.equal(nowe.length, 1);
  assert.equal(nowe[0]!.odKlienta, false, "nasza odpowiedź ogłosiła się jako dopisek klienta");
});

test("nasza autoodpowiedź dostaje flagę PRZY ZAPISIE, bez czekania na restart", async () => {
  /* Do 0.256.0 kolumny w tej wstawce nie było, więc zostawało `DEFAULT 0`,
     a flagę dosypywała dopiero migracja przy starcie procesu. Między
     restartami „Dziękujemy za kontakt" liczyło się jako ruch biura
     i przestawiało rozmowę na „czeka na klienta". */
  const database = mkDb();
  await synchronizujAllegroInbox({
    database, apiUrl: "https://api.test",
    query: fake([[thread(1)]], new Map(), {
      author: { login: "wertis", isInterlocutor: false },
      text: "Dziękujemy za kontakt. Wiadomość jest generowana automatycznie.",
    }).query,
  });

  assert.equal((database.prepare("SELECT auto_odpowiedz a FROM message").get() as { a: number }).a, 1,
    "odbicie naszego autorespondera weszło jako zwykła odpowiedź biura");
});

test("klient CYTUJĄCY nasz autoresponder nie jest autoodpowiedzią", async () => {
  /* Kierunek rozstrzyga, treść nie rozstrzyga wcale: pod pytaniem klienta
     wisi zwykle cały nasz poprzedni list razem z podpisem. Zwinięcie takiej
     wiadomości byłoby zgubieniem sprawy. */
  const database = mkDb();
  await synchronizujAllegroInbox({
    database, apiUrl: "https://api.test",
    query: fake([[thread(1)]], new Map(), {
      text: "To dalej nie działa.\n> Wiadomość jest generowana automatycznie.",
    }).query,
  });

  assert.equal((database.prepare("SELECT auto_odpowiedz a FROM message").get() as { a: number }).a, 0,
    "pytanie klienta zwinięto jako nasze echo");
});


/* ── Struktura wątku z beta.v1 (22 września 2026) ────────────────────────────
   Lista chodzi po public.v1; typ i podtyp ma tylko beta, więc czytamy je
   osobnym żądaniem przy wątku, w którym coś się zmieniło. Cztery rzeczy:
   wartości zostają, jak przyszły; loginy uczestników nie wchodzą; awaria bety
   nie psuje skrzynki; odmowa konta wstrzymuje betę, zamiast bić w nią
   przy każdym wątku. */

const strukturaBeta = (n: Record<string, unknown> = {}) => ({
  id: "t-1", type: "POST_PURCHASE_ISSUE", read: false,
  createdAt: "2026-09-28T10:00:00Z", lastMessageDateTime: "2026-09-29T12:00:00Z",
  participants: [{ role: "BUYER", login: "kupujacy-anon" }, { role: "SELLER", login: "my" }],
  orders: [{ id: "zam-1", offers: [{ id: "of-1", quantity: 1 }] }],
  subType: "MISSING_PRODUCT_ELEMENTS", status: "OPEN", ...n,
});

test("struktura wątku zapisuje się tak, jak przyszła — bez loginów uczestników", async () => {
  _zdejmijWstrzymanieStruktury();
  const database = mkDb();
  const api = fake([[thread(1)]]);
  const pytane: string[] = [];
  await synchronizujAllegroInbox({ database, query: api.query, apiUrl: "https://api.test",
    struktura: async (id) => { pytane.push(id); return strukturaBeta({ subType: "NOWY_PODTYP_2027" }); } });
  assert.deepEqual(pytane, ["t-1"]);
  const w = database.prepare("SELECT * FROM allegro_inbox_thread WHERE id='t-1'").get() as any;
  assert.equal(w.watek_typ, "POST_PURCHASE_ISSUE");
  assert.equal(w.watek_podtyp, "NOWY_PODTYP_2027", "nieznana wartość zostaje — rozstrzyga rejestr, nie sync");
  assert.equal(w.watek_status, "OPEN");
  assert.deepEqual(JSON.parse(w.watek_zamowienia), ["zam-1"]);
  assert.ok(w.struktura_at);
  assert.doesNotMatch(JSON.stringify(w), /kupujacy-anon/, "lądowisko nie bierze loginów uczestników");
});

test("awaria bety nie psuje skrzynki i nie zamazuje poprzedniej struktury", async () => {
  _zdejmijWstrzymanieStruktury();
  const database = mkDb();
  await synchronizujAllegroInbox({ database, query: fake([[thread(1)]]).query, apiUrl: "https://api.test",
    struktura: async () => strukturaBeta() });
  const zmieniony = { ...thread(1), lastMessageDateTime: "2026-09-30T12:00:00Z" };
  await synchronizujAllegroInbox({ database,
    query: fake([[zmieniony]], new Map([["t-1", ["m-t-1", "m-2"]]])).query, apiUrl: "https://api.test",
    struktura: async () => { throw new Error("Allegro odpowiedziało 500"); } });
  const w = database.prepare("SELECT watek_podtyp FROM allegro_inbox_thread WHERE id='t-1'").get() as any;
  assert.equal(w.watek_podtyp, "MISSING_PRODUCT_ELEMENTS");
  assert.equal((database.prepare("SELECT COUNT(*) n FROM message").get() as any).n, 2,
    "wiadomości weszły mimo awarii bety");
});

test("odmowa bety (406) wstrzymuje ją dla reszty przebiegu — jedno żądanie, nie dwadzieścia", async () => {
  _zdejmijWstrzymanieStruktury();
  const database = mkDb();
  let pytan = 0;
  await synchronizujAllegroInbox({ database, query: fake([[thread(1), thread(2), thread(3)]]).query,
    apiUrl: "https://api.test",
    struktura: async () => {
      pytan++;
      throw new Error("Allegro nie akceptuje żadnej znanej wersji zasobu (406/415) dla threads.");
    } });
  assert.equal(pytan, 1);
  assert.equal((database.prepare("SELECT COUNT(*) n FROM allegro_inbox_thread").get() as any).n, 3);
  _zdejmijWstrzymanieStruktury();
});

test("odpowiedź bez `type` to nie ten kształt — struktury nie ma", () => {
  assert.equal(strukturaZOdpowiedzi({ id: "t-1", read: false }), null);
  assert.equal(strukturaZOdpowiedzi(null), null);
  assert.deepEqual(strukturaZOdpowiedzi({ type: "COMMON" }),
    { typ: "COMMON", podtyp: null, status: null, zamowienia: [] });
});

/* ── Niepewna wysyłka rozstrzyga się sama (22 września 2026) ─────────────────
   Specyfikacja: timeout po możliwym wysłaniu to UNKNOWN, a przed ponowieniem
   trzeba go uzgodnić z wiadomościami wychodzącymi. Synchronizacja przynosi
   naszą odpowiedź — i to ona zamyka wiersz `send_uncertain`. */
test("nasza wiadomość z synchronizacji zamyka niepewną wysyłkę tej samej treści", async () => {
  const database = mkDb();
  await synchronizujAllegroInbox({ database, query: fake([[thread(1)]]).query, apiUrl: "https://api.test" });
  const rozmowa = Number((database.prepare("SELECT id FROM conversation").get() as { id: number }).id);
  const agent = Number(database.prepare("INSERT INTO app_user(login,name,role) VALUES ('ala','Ala','biuro')")
    .run().lastInsertRowid);
  const niepewna = (klucz: string, body: string) => Number(database.prepare(`INSERT INTO outbox
    (conversation_id,idempotency_key,body,expected_version,status,created_by)
    VALUES (?,?,?,1,'send_uncertain',?)`).run(rozmowa, klucz, body, agent).lastInsertRowid);
  const trafiona = niepewna("k-1", "Dzień dobry,\nnóż pasuje.");
  const inna = niepewna("k-2", "Zupełnie inna odpowiedź");

  const zmieniony = { ...thread(1), lastMessageDateTime: "2026-09-30T12:00:00Z" };
  const api = fake([[zmieniony]], new Map([["t-1", ["m-t-1", "m-nasza"]]]));
  await synchronizujAllegroInbox({ database, apiUrl: "https://api.test", query: async (url) => {
    const odp = await api.query(url) as { messages?: Array<Record<string, unknown>> };
    for (const m of odp.messages ?? []) {
      if (m.id === "m-nasza") {
        m.author = { login: "my", isInterlocutor: false };
        m.text = "Dzień dobry, nóż pasuje.";
      }
    }
    return odp;
  } });

  const w = database.prepare("SELECT id, status, external_message_id FROM outbox ORDER BY id").all() as any[];
  const t = w.find((x) => x.id === trafiona);
  assert.equal(t.status, "sent");
  assert.equal(t.external_message_id, "m-nasza");
  assert.equal(w.find((x) => x.id === inna).status, "send_uncertain", "inna treść zostaje do decyzji człowieka");
  assert.ok(database.prepare("SELECT 1 FROM events WHERE type='rozmowa_wysylka_uzgodniona'").get());
});

/* ── Kursor jako próg daty ───────────────────────────────────────────────────
   Kolejna wiadomość w wątku, który był kursorem (nasza odpowiedź albo klienta),
   zmienia jego datę. Para (data, id) z poprzedniego przebiegu nie występuje już
   nigdzie na liście, więc przebieg czytał cały sufit stron po każdej wiadomości
   w najnowszym wątku. Atrapa niżej zwraca listę posortowaną tak jak Allegro:
   od najnowszej daty. */

type WatekAtrapy = { id: string; data: string; wiadomosci: string[] };

/** Konto z `n` wątkami, każdy o minutę starszy od poprzedniego. */
function konto(n: number): WatekAtrapy[] {
  const t0 = Date.parse("2026-09-29T12:00:00Z");
  return Array.from({ length: n }, (_, i) => ({
    id: `k-${i}`, data: new Date(t0 - i * 60_000).toISOString(), wiadomosci: [`m-k-${i}-0`],
  }));
}

/** Nowa wiadomość: data wątku przeskakuje ponad wszystkie inne. */
function dopisz(watki: WatekAtrapy[], id: string, minuty = 1): void {
  const w = watki.find((x) => x.id === id)!;
  const maks = Math.max(...watki.map((x) => Date.parse(x.data)));
  w.data = new Date(maks + minuty * 60_000).toISOString();
  w.wiadomosci.push(`m-${id}-${w.wiadomosci.length}`);
}

function atrapaKonta(watki: WatekAtrapy[]) {
  const licznik = { listy: 0, wiadomosci: [] as string[] };
  const query = async (url: string): Promise<unknown> => {
    if (url.includes("/messages")) {
      const id = decodeURIComponent(url.split("/").at(-2)!);
      licznik.wiadomosci.push(id);
      const w = watki.find((x) => x.id === id)!;
      return { messages: w.wiadomosci.map((m) => message(m, { createdAt: w.data, thread: { id } })), offset: 0, limit: 20 };
    }
    licznik.listy++;
    const offset = Number(new URL(url).searchParams.get("offset"));
    const posortowane = [...watki].sort((a, b) => b.data.localeCompare(a.data));
    return {
      threads: posortowane.slice(offset, offset + 20).map((w) => ({
        id: w.id, read: false, lastMessageDateTime: w.data, interlocutor: { login: `anon-${w.id}` } })),
      offset, limit: 20,
    };
  };
  return { licznik, query, zeruj: () => { licznik.listy = 0; licznik.wiadomosci = []; } };
}

/** Jeden przebieg z wyciszonym `console.warn`; zwraca, czy dziennik doniósł o obcięciu. */
async function przebiegKonta(database: DatabaseSync, a: ReturnType<typeof atrapaKonta>): Promise<boolean> {
  a.zeruj();
  const ostrzezenia: string[] = [];
  const oryginal = console.warn;
  console.warn = (...x: unknown[]) => { ostrzezenia.push(x.join(" ")); };
  try {
    await synchronizujAllegroInbox({ database, query: a.query, apiUrl: "https://api.test", inboxOd: null });
  } finally {
    console.warn = oryginal;
  }
  return ostrzezenia.some((z) => z.includes("obcięty"));
}

test("wiadomość w wątku będącym kursorem kończy przebieg na pierwszej stronie", async () => {
  const database = mkDb(); const watki = konto(50); const a = atrapaKonta(watki);
  await przebiegKonta(database, a);
  assert.equal(a.licznik.listy, 3, "pierwsze zejście czyta całą listę");

  dopisz(watki, "k-0");
  const obciety = await przebiegKonta(database, a);

  assert.equal(a.licznik.listy, 1, "wątek starszy od kursora kończy czytanie listy");
  assert.deepEqual(a.licznik.wiadomosci, ["k-0"], "pobrane są wiadomości tylko wątku, który się zmienił");
  assert.equal(obciety, false, "to nie jest zaległość, więc dziennik milczy");
  const zapisane = database.prepare("SELECT count(*) n FROM allegro_inbox_message WHERE thread_id='k-0'").get() as { n: number };
  assert.equal(zapisane.n, 2, "nowa wiadomość jest w bazie");
  const kursor = database.prepare("SELECT cursor_id id, cursor_at at FROM allegro_inbox_sync_state").get() as { id: string; at: string };
  assert.equal(kursor.id, "k-0");
  assert.equal(kursor.at, watki.find((w) => w.id === "k-0")!.data, "kursor idzie za nową datą");
});

test("rozmowa w jednym wątku, wiadomość co przebieg, nie kosztuje więcej niż jedną stronę", async () => {
  const database = mkDb(); const watki = konto(50); const a = atrapaKonta(watki);
  await przebiegKonta(database, a);
  dopisz(watki, "k-7");
  await przebiegKonta(database, a);
  for (let i = 0; i < 4; i++) {
    dopisz(watki, "k-7");
    const obciety = await przebiegKonta(database, a);
    assert.equal(a.licznik.listy, 1, `wiadomość ${i + 1} w kursorze`);
    assert.equal(obciety, false);
  }
  const zapisane = database.prepare("SELECT count(*) n FROM allegro_inbox_message WHERE thread_id='k-7'").get() as { n: number };
  assert.equal(zapisane.n, 6, "żadna wiadomość nie zginęła");
});

test("wiadomość w innym wątku niż kursor też kończy przebieg na pierwszej stronie", async () => {
  const database = mkDb(); const watki = konto(50); const a = atrapaKonta(watki);
  await przebiegKonta(database, a);
  dopisz(watki, "k-30");
  await przebiegKonta(database, a);
  assert.equal(a.licznik.listy, 1);
  assert.deepEqual(a.licznik.wiadomosci, ["k-30"]);
});

test("nowy wątek o dokładnie tej samej dacie co kursor nie zostaje pominięty", async () => {
  const database = mkDb(); const watki = konto(5); const a = atrapaKonta(watki);
  await przebiegKonta(database, a);
  const kursorAt = watki[0]!.data;
  /* Kursor (k-0) dostaje wiadomość, a obok pojawia się nieznany wątek z datą
     równą starej dacie kursora. Nie jest starszy od progu, więc musi być
     przeczytany. Dopiero pierwszy starszy wątek kończy przebieg. */
  dopisz(watki, "k-0");
  watki.push({ id: "nowy", data: kursorAt, wiadomosci: ["m-nowy-0"] });
  await przebiegKonta(database, a);
  assert.deepEqual([...a.licznik.wiadomosci].sort(), ["k-0", "nowy"]);
  const nowy = database.prepare("SELECT count(*) n FROM allegro_inbox_message WHERE thread_id='nowy'").get() as { n: number };
  assert.equal(nowy.n, 1);
});

test("wątek bez daty i data, której nie da się odczytać, nie kończą przebiegu przed czasem", async () => {
  const database = mkDb();
  const bezDaty = { id: "bez-daty", read: false, interlocutor: { login: "anon-bd" } };
  const zepsuta = { id: "zla-data", read: false, lastMessageDateTime: "nie-data", interlocutor: { login: "anon-zd" } };
  /* Kursor z pierwszego przebiegu stoi na k-1. Wątki bez daty i z nieczytelną
     datą są nowsze w kolejności listy, więc przebieg ma przejść przez nie
     do kursora zamiast uznać je za „starsze od progu". */
  const pierwszy = atrapaKonta(konto(2));
  await przebiegKonta(database, pierwszy);
  const api = fake([[bezDaty, zepsuta, thread(1, "2026-09-29T12:00:00.000Z"), thread(2, "2026-09-01T12:00:00.000Z")]]);
  await synchronizujAllegroInbox({ database, query: api.query, apiUrl: "https://api.test", inboxOd: null });
  assert.ok(api.urls.some((u) => u.includes("/threads/bez-daty/messages")), "wątek bez daty jest czytany");
  assert.ok(api.urls.some((u) => u.includes("/threads/zla-data/messages")), "nieczytelna data nie jest progiem");
  assert.ok(api.urls.some((u) => u.includes("/threads/t-1/messages")), "przebieg doszedł do wątku pod nimi");
  assert.ok(!api.urls.some((u) => u.includes("/threads/t-2/messages")), "wątek starszy od kursora kończy przebieg");
});

/* ── Lista wątków w beta.v1: Problemy z zakupem ──────────────────────────────
   Od 28 października 2026 Allegro zakłada nowe sprawy kupujących jako
   Problemy z zakupem w Centrum Wiadomości i pokazuje je wyłącznie w `beta.v1`.
   Kształty niżej idą WPROST ze schematów `ThreadsListVBeta1`, `ThreadVBeta1`
   i `MessageVBeta1` w docs/allegro/swagger.yaml. Wiadomość bety nie ma pola
   `thread`, a autora opisuje rolą, nie `isInterlocutor`. */

const BETA = "application/vnd.allegro.beta.v1+json";

const watekBeta = (id: string, n: Record<string, unknown> = {}) => ({
  id, type: "COMMON", read: false,
  createdAt: "2026-10-01T10:00:00Z", lastMessageDateTime: "2026-10-02T12:00:00Z",
  participants: [{ role: "USER", login: "my-sklep" }, { role: "USER", login: "Kupujacy-Anon" }],
  status: "OPEN", ...n,
});
const problemBeta = (id: string, n: Record<string, unknown> = {}) => watekBeta(id, {
  type: "POST_PURCHASE_ISSUE",
  participants: [{ role: "BUYER", login: "kupujacy-anon" }, { role: "SELLER", login: "my-sklep" }],
  orders: [{ id: "zam-1", offers: [{ id: "of-1", quantity: 1 }] }],
  subType: "PRODUCT_ARRIVED_DAMAGED", ...n,
});
const wiadomoscBeta = (id: string, role: unknown, login: string | null, n: Record<string, unknown> = {}) => ({
  id, status: "DELIVERED", type: "MESSAGE_CENTER", createdAt: "2026-10-02T11:00:00Z",
  author: { role, login }, text: `treść ${id}`, subject: null,
  relatesTo: { offer: null, order: null }, hasAdditionalAttachments: false,
  attachments: [], additionalInformation: null, ...n,
});

type Wiadomosci = Record<string, { beta?: object[]; public?: object[] }>;

/** Atrapa konta, które zna betę: lista tylko w `beta.v1`, kursorem `page.id`. */
function atrapaBety(strony: object[][], wiadomosci: Wiadomosci = {}) {
  const zadania: Array<{ url: string; akcept: string | null }> = [];
  const query = async (url: string, opcje?: { akcept?: string }): Promise<unknown> => {
    zadania.push({ url, akcept: opcje?.akcept ?? null });
    if (url.includes("/messages")) {
      const w = wiadomosci[decodeURIComponent(url.split("/").at(-2)!)] ?? {};
      return opcje?.akcept === BETA
        ? { messages: w.beta ?? [], nextPage: null }
        : { messages: w.public ?? [], offset: 0, limit: 20 };
    }
    assert.equal(opcje?.akcept, BETA, "lista idzie betą");
    const strona = Number(new URL(url).searchParams.get("page.id") ?? "0");
    return { threads: strony[strona] ?? [],
      nextPage: strona + 1 < strony.length ? { id: String(strona + 1) } : null };
  };
  return { zadania, query };
}

const przebiegBety = (database: DatabaseSync, query: unknown) => synchronizujAllegroInbox({
  database, query: query as never, apiUrl: "https://api.test", listaBeta: true, inboxOd: null,
});

test("lista w beta.v1 idzie kursorem page.id, a strukturę bierze z listy, bez żądania o wątek", async () => {
  _zdejmijWstrzymanieStruktury();
  const database = mkDb();
  const strona1 = Array.from({ length: 20 }, (_, i) => watekBeta(`w-${i}`,
    { lastMessageDateTime: `2026-10-02T12:${String(59 - i).padStart(2, "0")}:00Z` }));
  const a = atrapaBety([strona1, [problemBeta("p-1", { lastMessageDateTime: "2026-10-02T11:00:00Z" })]], {
    "p-1": { beta: [wiadomoscBeta("pm-1", "BUYER", "kupujacy-anon")] },
  });
  let pytanOWatek = 0;
  await synchronizujAllegroInbox({ database, query: a.query as never, apiUrl: "https://api.test",
    listaBeta: true, inboxOd: null, struktura: async () => { pytanOWatek++; return null; } });

  const listy = a.zadania.filter((z) => !z.url.includes("/messages")).map((z) => z.url);
  assert.deepEqual(listy, ["https://api.test/messaging/threads?limit=20",
    "https://api.test/messaging/threads?limit=20&page.id=1"]);
  assert.equal(pytanOWatek, 0, "lista bety niesie typ i podtyp — osobne żądanie byłoby zbędne");
  const w = database.prepare("SELECT * FROM allegro_inbox_thread WHERE id='p-1'").get() as any;
  assert.equal(w.watek_typ, "POST_PURCHASE_ISSUE");
  assert.equal(w.watek_podtyp, "PRODUCT_ARRIVED_DAMAGED");
  assert.equal(w.watek_status, "OPEN");
  assert.deepEqual(JSON.parse(w.watek_zamowienia), ["zam-1"]);
  assert.equal(w.interlocutor_login, "kupujacy-anon", "rozmówcą Problemu z zakupem jest kupujący");
  assert.doesNotMatch(w.surowe_json, /participants|my-sklep/, "loginów uczestników nie zapisujemy");
  assert.equal((database.prepare("SELECT COUNT(*) n FROM allegro_inbox_thread").get() as any).n, 21);
});

test("Problem z zakupem: wiadomości w beta.v1, kierunek z roli, doradca podpisany rolą", async () => {
  _zdejmijWstrzymanieStruktury();
  const database = mkDb();
  const a = atrapaBety([[problemBeta("p-1")]], { "p-1": { beta: [
    wiadomoscBeta("pm-3", "CONSULTANT", "doradca-allegro", { createdAt: "2026-10-02T11:30:00Z" }),
    wiadomoscBeta("pm-2", "SELLER", "my-sklep", { createdAt: "2026-10-02T11:10:00Z" }),
    wiadomoscBeta("pm-1", "BUYER", "kupujacy-anon", { createdAt: "2026-10-02T11:00:00Z",
      relatesTo: { offer: { id: "of-1" }, order: null } }),
  ] } });
  await przebiegBety(database, a.query);

  const pytanie = a.zadania.find((z) => z.url.includes("/threads/p-1/messages"));
  assert.equal(pytanie?.akcept, BETA, "Problem z zakupem czytamy wersją, którą Allegro go obsługuje");
  const w = database.prepare(`SELECT external_message_id x, direction, autor_rola, related_order_id
    FROM message ORDER BY sent_at`).all() as any[];
  assert.deepEqual(w.map((m) => [m.x, m.direction, m.autor_rola]), [
    ["pm-1", "incoming", "BUYER"], ["pm-2", "outgoing", "SELLER"], ["pm-3", "incoming", "CONSULTANT"],
  ]);
  assert.ok(w.every((m) => m.related_order_id === "zam-1"),
    "zamówienie wątku wiąże każdą wiadomość, bo `relatesTo.order` w becie bywa puste");
  const l = database.prepare("SELECT author_login, author_is_interlocutor i FROM allegro_inbox_message WHERE id='pm-2'")
    .get() as any;
  assert.equal(l.i, 0, "nasza wiadomość w lądowisku ma ten sam znacznik co z public.v1");
});

test("wiadomość od Allegro bez loginu wchodzi jako przychodząca", async () => {
  _zdejmijWstrzymanieStruktury();
  const database = mkDb();
  const a = atrapaBety([[problemBeta("p-1")]], { "p-1": { beta: [wiadomoscBeta("pm-1", "ALLEGRO", null)] } });
  await przebiegBety(database, a.query);
  const m = database.prepare("SELECT direction, autor_rola FROM message").get() as any;
  assert.deepEqual([m.direction, m.autor_rola], ["incoming", "ALLEGRO"]);
  assert.equal((database.prepare("SELECT author_login l FROM allegro_inbox_message").get() as any).l, "");
});

test("rola USER z loginem sprzedawcy wątku to nasza wiadomość", async () => {
  _zdejmijWstrzymanieStruktury();
  const database = mkDb();
  const a = atrapaBety([[problemBeta("p-1")]], { "p-1": { beta: [wiadomoscBeta("pm-1", "USER", "MY-SKLEP")] } });
  await przebiegBety(database, a.query);
  assert.equal((database.prepare("SELECT direction d FROM message").get() as any).d, "outgoing");
});

test("zamykające zdanie doradcy nie budzi rozmowy zakończonej przez agenta", async () => {
  _zdejmijWstrzymanieStruktury();
  const database = mkDb();
  await przebiegBety(database, atrapaBety([[problemBeta("p-1", { lastMessageDateTime: "2026-10-02T11:00:00Z" })]],
    { "p-1": { beta: [wiadomoscBeta("pm-1", "BUYER", "kupujacy-anon")] } }).query);
  const rozmowa = Number((database.prepare("SELECT id FROM conversation").get() as any).id);
  database.prepare("UPDATE conversation SET status='resolved' WHERE id=?").run(rozmowa);
  const zdarzenia: Array<Record<string, unknown>> = [];
  const wypisz = onConversationEvent((e) => { zdarzenia.push(e as unknown as Record<string, unknown>); });
  try {
    await przebiegBety(database, atrapaBety([[problemBeta("p-1", { status: "CLOSED" })]], { "p-1": { beta: [
      wiadomoscBeta("pm-2", "CONSULTANT", "doradca", { createdAt: "2026-10-02T11:30:00Z" }),
      wiadomoscBeta("pm-1", "BUYER", "kupujacy-anon"),
    ] } }).query);
  } finally {
    wypisz();
  }
  assert.equal((database.prepare("SELECT status FROM conversation WHERE id=?").get(rozmowa) as any).status,
    "resolved", "zamknięty wątek: głos Allegro nie jest ruchem");
  const nowa = zdarzenia.find((e) => e.type === "message.created") as any;
  assert.equal(nowa?.data?.odKlienta, false, "pasek nowej wiadomości klienta się nie zapala");
});

test("Problem z zakupem z kilkoma zamówieniami nie zgaduje numeru", async () => {
  _zdejmijWstrzymanieStruktury();
  const database = mkDb();
  const a = atrapaBety([[problemBeta("p-1", { orders: [
    { id: "zam-1", offers: [] }, { id: "zam-2", offers: [] }] })]],
  { "p-1": { beta: [
    wiadomoscBeta("pm-1", "BUYER", "kupujacy-anon"),
    wiadomoscBeta("pm-2", "BUYER", "kupujacy-anon", { relatesTo: { offer: null, order: { id: "zam-2" } } }),
  ] } });
  await przebiegBety(database, a.query);
  const w = database.prepare("SELECT external_message_id x, related_order_id z FROM message ORDER BY x").all() as any[];
  assert.deepEqual(w.map((m) => [m.x, m.z]), [["pm-1", null], ["pm-2", "zam-2"]]);
});

test("wiadomość bety bez roli pomija wątek, zamiast zgadywać kierunek", async () => {
  _zdejmijWstrzymanieStruktury();
  const database = mkDb();
  const ostrzezenia: string[] = [];
  const oryginal = console.warn;
  console.warn = (...x: unknown[]) => { ostrzezenia.push(x.join(" ")); };
  try {
    const a = atrapaBety([[problemBeta("p-1"), problemBeta("p-2", { lastMessageDateTime: "2026-10-02T10:00:00Z" })]],
      { "p-1": { beta: [wiadomoscBeta("pm-1", undefined, "kupujacy-anon")] },
        "p-2": { beta: [wiadomoscBeta("pm-2", "BUYER", "kupujacy-anon")] } });
    await przebiegBety(database, a.query);
  } finally {
    console.warn = oryginal;
  }
  assert.deepEqual((database.prepare("SELECT id FROM allegro_inbox_thread").all() as any[]).map((w) => w.id), ["p-2"]);
  assert.equal((database.prepare("SELECT error_thread_count n FROM allegro_inbox_sync_state").get() as any).n, 1);
  assert.ok(ostrzezenia.some((z) => z.includes("p-1")));
});

test("zwykły wątek z listy bety: wiadomości w public.v1, rozmówca z uczestników", async () => {
  _zdejmijWstrzymanieStruktury();
  const database = mkDb();
  const a = atrapaBety([[watekBeta("w-1"), watekBeta("w-2", { lastMessageDateTime: "2026-10-02T11:00:00Z" })]], {
    /* Odpisaliśmy: rozmówcą jest jedyny uczestnik, który nie pisał naszych wiadomości. */
    "w-1": { public: [message("m-1", { author: { login: "my-sklep", isInterlocutor: false }, thread: { id: "w-1" } })] },
    /* Jeszcze nie odpisaliśmy: rozmówcą jest ten, kto pisał przychodzące. */
    "w-2": { public: [message("m-2", { author: { login: "Kupujacy-Anon", isInterlocutor: true }, thread: { id: "w-2" } })] },
  });
  await przebiegBety(database, a.query);
  for (const id of ["w-1", "w-2"]) {
    const z = a.zadania.find((x) => x.url.includes(`/threads/${id}/messages`));
    assert.equal(z?.akcept, null, "zwykły wątek zostaje na public.v1 i jego isInterlocutor");
  }
  const loginy = database.prepare("SELECT id, interlocutor_login l FROM allegro_inbox_thread ORDER BY id").all() as any[];
  assert.deepEqual(loginy.map((w) => [w.id, w.l]), [["w-1", "Kupujacy-Anon"], ["w-2", "Kupujacy-Anon"]]);
  assert.equal((database.prepare("SELECT autor_rola r FROM message WHERE external_message_id='m-1'").get() as any).r, null);
});

test("rozmówca, którego nie da się ustalić, nie kasuje loginu z poprzedniego przebiegu", async () => {
  _zdejmijWstrzymanieStruktury();
  const database = mkDb();
  await synchronizujAllegroInbox({ database, query: fake([[{ ...thread(1), id: "w-1",
    lastMessageDateTime: "2026-10-01T12:00:00Z", interlocutor: { login: "Kupujacy-Anon" } }]]).query,
  apiUrl: "https://api.test", inboxOd: null });
  /* Dwóch uczestników z rolą USER i żadnej wiadomości, która by ich rozdzieliła. */
  const a = atrapaBety([[watekBeta("w-1")]], { "w-1": { public: [] } });
  await przebiegBety(database, a.query);
  assert.equal((database.prepare("SELECT interlocutor_login l FROM allegro_inbox_thread").get() as any).l,
    "Kupujacy-Anon");
});

test("odmowa listy w beta.v1 schodzi na public.v1 w tym samym przebiegu i wstrzymuje betę", async () => {
  _zdejmijWstrzymanieStruktury();
  const database = mkDb();
  const zadania: Array<string | null> = [];
  const query = async (url: string, opcje?: { akcept?: string }) => {
    zadania.push(opcje?.akcept ?? null);
    if (opcje?.akcept === BETA) throw new Error("Allegro nie akceptuje żadnej znanej wersji zasobu (406/415) dla threads.");
    return fake([[thread(1)]]).query(url);
  };
  const ostrzezenia: string[] = [];
  const oryginal = console.warn;
  console.warn = (...x: unknown[]) => { ostrzezenia.push(x.join(" ")); };
  try {
    await przebiegBety(database, query);
    assert.equal((database.prepare("SELECT COUNT(*) n FROM allegro_inbox_thread").get() as any).n, 1,
      "skrzynka działa dalej na public.v1");
    assert.equal(ostrzezenia.filter((z) => z.includes("lista wątków z beta.v1 wstrzymana")).length, 1);
    assert.equal(zadania.filter((a) => a === BETA).length, 1);
    /* Ta sama atrapa: gdyby wstrzymanie nie działało, drugi przebieg
       zapytałby betę znowu i dostał tę samą odmowę. */
    await przebiegBety(database, query);
    assert.equal(zadania.filter((a) => a === BETA).length, 1, "wstrzymana beta nie jest pytana przy każdym przebiegu");
    assert.equal(ostrzezenia.filter((z) => z.includes("wstrzymana")).length, 1);
  } finally {
    console.warn = oryginal;
    _zdejmijWstrzymanieStruktury();
  }
});

test("wstrzymanie bety widać w stanie skrzynki, a udana lista bety je zdejmuje", async () => {
  _zdejmijWstrzymanieStruktury();
  const database = mkDb();
  const teraz = Date.parse("2026-10-07T10:00:00Z");
  const oryginal = console.warn;
  console.warn = () => {};
  try {
    await synchronizujAllegroInbox({ database, apiUrl: "https://api.test", listaBeta: true, inboxOd: null,
      now: () => new Date(teraz),
      query: async (url: string, opcje?: { akcept?: string }) => {
        if (opcje?.akcept === BETA) throw new Error("Allegro nie akceptuje żadnej znanej wersji zasobu (406/415) dla threads.");
        return fake([[thread(1)]]).query(url);
      } });
  } finally {
    console.warn = oryginal;
  }
  const st = stanProblemowZakupu(database, true, teraz);
  assert.equal(st?.przyczyna, "wstrzymana");
  assert.equal(st?.doKiedy, "2026-10-07T16:00:00.000Z", "sześć godzin od odmowy");
  assert.match(st?.szczegol ?? "", /406\/415/);
  assert.equal(stanProblemowZakupu(database, true, teraz + 6 * 3_600_000 + 1), null,
    "po terminie beta jest pytana znowu, więc stan nie straszy");

  /* Restart procesu zdejmuje wstrzymanie z pamięci; udany przebieg betą
     zdejmuje je też z bazy. */
  _zdejmijWstrzymanieStruktury();
  await przebiegBety(database, atrapaBety([[watekBeta("w-1")]], { "w-1": { public: [] } }).query);
  assert.equal(stanProblemowZakupu(database, true, teraz), null);
});

test("wyłączona beta to stan „wyłączona”, niezależnie od bazy", () => {
  const database = mkDb();
  assert.deepEqual(stanProblemowZakupu(database, false),
    { przyczyna: "wylaczona", doKiedy: null, szczegol: null });
  assert.equal(stanProblemowZakupu(database, true), null, "pusta baza: nic nie wstrzymane");
});

test("błąd serwera Allegro na liście bety: ten przebieg idzie public.v1, następny pyta betę znowu", async () => {
  _zdejmijWstrzymanieStruktury();
  const database = mkDb();
  const zadania: Array<string | null> = [];
  const query = async (url: string, opcje?: { akcept?: string }) => {
    zadania.push(opcje?.akcept ?? null);
    if (opcje?.akcept === BETA) throw new BladOdpowiedziAllegro("Allegro odpowiedziało 503: chwilowo", 503);
    return fake([[thread(1)]]).query(url);
  };
  const oryginal = console.warn;
  console.warn = () => {};
  try {
    await przebiegBety(database, query);
    await przebiegBety(database, query);
  } finally {
    console.warn = oryginal;
    _zdejmijWstrzymanieStruktury();
  }
  assert.equal(zadania.filter((a) => a === BETA).length, 2, "chwilowa awaria nie wstrzymuje bety na sześć godzin");
  assert.equal((database.prepare("SELECT COUNT(*) n FROM allegro_inbox_thread").get() as any).n, 1);
});

test("odmowa tokena i limit na liście bety przerywają przebieg, nie schodzą na public.v1", async () => {
  for (const blad of [new BladOdpowiedziAllegro("Allegro odrzuciło token (401)", 401),
    new BladLimituAllegro("429", 10_000)]) {
    _zdejmijWstrzymanieStruktury();
    const database = mkDb();
    let publicznych = 0;
    await assert.rejects(przebiegBety(database, async (_url: string, opcje?: { akcept?: string }) => {
      if (opcje?.akcept === BETA) throw blad;
      publicznych++;
      return { threads: [], offset: 0, limit: 20 };
    }));
    assert.equal(publicznych, 0, "public.v1 skończyłoby tak samo — przebieg zapisuje prawdziwy powód");
    assert.equal((database.prepare("SELECT error_count n FROM allegro_inbox_sync_state").get() as any).n, 1);
  }
});

test("lista bety bez nextPage to inny kształt — przebieg schodzi na public.v1", async () => {
  _zdejmijWstrzymanieStruktury();
  const database = mkDb();
  const pub = fake([[thread(1)]]);
  const oryginal = console.warn;
  console.warn = () => {};
  try {
    await przebiegBety(database, async (url: string, opcje?: { akcept?: string }) =>
      opcje?.akcept === BETA && !url.includes("/messages")
        ? { threads: [watekBeta("w-1")] } : pub.query(url));
  } finally {
    console.warn = oryginal;
    _zdejmijWstrzymanieStruktury();
  }
  assert.deepEqual((database.prepare("SELECT id FROM allegro_inbox_thread").all() as any[]).map((w) => w.id), ["t-1"]);
});

test("odmowa bety na drugiej stronie przerywa przebieg, nie zmienia wersji w połowie listy", async () => {
  _zdejmijWstrzymanieStruktury();
  const database = mkDb();
  const strona1 = Array.from({ length: 20 }, (_, i) => watekBeta(`w-${i}`,
    { lastMessageDateTime: `2026-10-02T12:${String(59 - i).padStart(2, "0")}:00Z` }));
  const a = atrapaBety([strona1, []]);
  await assert.rejects(przebiegBety(database, async (url: string, opcje?: { akcept?: string }) => {
    if (url.includes("page.id=")) throw new Error("Allegro nie akceptuje żadnej znanej wersji zasobu (406/415) dla threads.");
    return a.query(url, opcje);
  }), /406\/415/);
  assert.equal((database.prepare("SELECT cursor_id c FROM allegro_inbox_sync_state").get() as any).c, null);
  _zdejmijWstrzymanieStruktury();
});

test("dociąg załącznika NEW w Problemie z zakupem pyta betą", async () => {
  _zdejmijWstrzymanieStruktury();
  const database = mkDb();
  const zal = (status: string) => [{ id: "z-1", fileName: "zdjecie.jpg", mimeType: "image/jpeg",
    url: "https://upload.allegro.pl/message-center/message-attachments/z-1", status }];
  await przebiegBety(database, atrapaBety([[problemBeta("p-1")]], { "p-1": { beta: [
    wiadomoscBeta("pm-1", "BUYER", "kupujacy-anon", { attachments: zal("NEW") })] } }).query);
  const a = atrapaBety([[problemBeta("p-1")]], { "p-1": { beta: [
    wiadomoscBeta("pm-1", "BUYER", "kupujacy-anon", { attachments: zal("SAFE") })] } });
  await przebiegBety(database, a.query);
  const dociag = a.zadania.filter((z) => z.url.includes("/threads/p-1/messages"));
  assert.deepEqual(dociag.map((z) => z.akcept), [BETA]);
  assert.equal((database.prepare("SELECT status s FROM message_attachment").get() as any).s, "SAFE");
});

test("rozmówca wątku: kupujący, potem ten, kto nie pisał naszych, potem jedyny piszący", () => {
  const w = (login: string, isInterlocutor: boolean) =>
    ({ author: { login, isInterlocutor } }) as unknown as Parameters<typeof rozmowcaWatku>[1][number];
  assert.equal(rozmowcaWatku([{ rola: "SELLER", login: "my" }, { rola: "BUYER", login: "kup" }], []), "kup");
  assert.equal(rozmowcaWatku([{ rola: "USER", login: "my" }, { rola: "USER", login: "kup" }],
    [w("MY", false)]), "kup", "login porównuje się bez wielkości liter");
  assert.equal(rozmowcaWatku([{ rola: "USER", login: "my" }, { rola: "USER", login: "kup" }],
    [w("kup", true)]), "kup");
  assert.equal(rozmowcaWatku([{ rola: "USER", login: "my" }, { rola: "USER", login: "kup" }],
    [w("doradca", true)]), null, "doradca nie jest uczestnikiem, więc nie zostaje rozmówcą");
  assert.equal(rozmowcaWatku([{ rola: "SELLER", login: "my" }, { rola: "USER", login: "kup" }], []), "kup");
});
