import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import { synchronizujAllegroInbox } from "./allegro-inbox-sync.js";
import { BladLimituAllegro } from "../adapters/allegro.js";

const schema = fs.readFileSync(new URL("../db/schema.sql", import.meta.url), "utf8");
const mkDb = () => { const d = new DatabaseSync(":memory:"); d.exec(schema); return d; };
const thread = (n: number, date = `2026-08-${String(30 - n).padStart(2, "0")}T12:00:00.000Z`) => ({
  id: `t-${n}`, read: false, lastMessageDate: date, interlocutor: { login: `anon-${n}` },
});
const message = (id: string) => ({ id, author: { login: "anon", role: "BUYER" },
  text: "zanonimizowane", relatedObject: null, attachments: [], read: false });

function fake(pages: Array<ReturnType<typeof thread>[]>, messageIds = new Map<string, string[]>()) {
  const urls: string[] = [];
  return { urls, query: async (url: string): Promise<unknown> => {
    urls.push(url);
    if (url.includes("/messages")) {
      const id = decodeURIComponent(url.split("/").at(-2)!);
      return { messages: (messageIds.get(id) ?? [`m-${id}`]).map(message) };
    }
    const offset = Number(new URL(url).searchParams.get("offset"));
    return { threads: pages[offset / 20] ?? [], totalCount: pages.flat().length };
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

test("błąd jednego wątku wycofuje całą partię i pozostawia ją do ponowienia", async () => {
  const database = mkDb();
  await assert.rejects(synchronizujAllegroInbox({ database, apiUrl: "https://api.test", query: async (url) => {
    if (!url.includes("/messages")) return { threads: [thread(1), thread(2)] };
    if (url.includes("t-2")) throw new Error("awaria jednego wątku");
    return { messages: [message("m-1")] };
  }}));
  assert.equal((database.prepare("SELECT count(*) n FROM allegro_inbox_thread").get() as {n:number}).n, 0);
  assert.equal((database.prepare("SELECT cursor_id id FROM allegro_inbox_sync_state").get() as {id:null}).id, null);
});
