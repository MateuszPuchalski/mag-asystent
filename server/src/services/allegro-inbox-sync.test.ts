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

  assert.equal(statusRozmowy(database, rozmowa), "open",
    "rozmowa została rozwiązana mimo nowego pytania klienta");
});

/* ── Sufit stron i zapis po stronie (0.164.1) ────────────────────────────────
   BLIZNA Z PRODUKCJI: 315 986 żądań do Allegro w ciągu jednej doby, przy 0%
   błędów po ich stronie. Skrzynka była jedyną z czterech pętli bez
   ogranicznika, a zapis czekał do ostatniej strony — więc przebieg przerwany
   w połowie nie zostawiał NICZEGO i następny pytał o to samo od nowa.       */

/** Pełna strona listy — 20 wątków o tej samej dacie, różnych identyfikatorach. */
const strona = (od: number) =>
  Array.from({ length: 20 }, (_, i) => ({
    id: `p-${od + i}`, read: false, lastMessageDateTime: "2026-09-15T12:00:00.000Z",
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

  /* Przebieg drugi: 30 pełnych stron samych NOWYCH wątków, więc kursor
     z pierwszego przebiegu nie trafi nigdzie. Dokładnie ten stan zjadł dobę
     żądań: pętla szła do końca historii, bo nie miała się o co zatrzymać. */
  const api = fake(Array.from({ length: 30 }, (_, s) => strona(s * 20)));
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
