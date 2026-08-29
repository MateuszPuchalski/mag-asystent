import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/* ── Metadane wątku ──────────────────────────────────────────────────────────
   Piłka liczy się z metadanych, nie z treści — więc testy pilnują wyliczeń
   (kto ostatni, ile, które id klienta) i tego, że upsert nie gubi wiedzy:
   stempel wysyłki bez rozmowy nie ma prawa wyzerować licznika ani id.        */

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "wertis-meta-")), "t.db");
process.env.SGT_MODE = "seeded";

let db: typeof import("../db/db.js").db;
let M: typeof import("./watek-meta.js");

before(async () => {
  ({ db } = await import("../db/db.js"));
  M = await import("./watek-meta.js");
});

beforeEach(() => {
  db().prepare("DELETE FROM watek_meta").run();
});

const wiadDyskusji = (
  id: string,
  odNas: boolean,
  at: string,
  autorRola: string | null = odNas ? "SELLER" : "BUYER"
) => ({ id, odNas, autorLogin: null, autorRola, tresc: "x", at, zalacznik: null });

const wiadPytania = (id: string, odKupujacego: boolean, at: string) => ({
  id,
  odKupujacego,
  autor: null,
  tresc: "x",
  at,
  zalacznikow: 0,
  ofertaId: null,
});

test("dyskusja: głos, licznik i id ostatniej wiadomości klienta", () => {
  M.zapiszMetaDyskusji(
    "d1",
    [
      wiadDyskusji("m1", false, "2026-08-01T10:00:00Z"),
      wiadDyskusji("m2", true, "2026-08-01T11:00:00Z"),
      wiadDyskusji("m3", false, "2026-08-02T09:00:00Z"),
    ],
    "odczyt"
  );
  const m = M.metaWatku("dyskusja", "d1");
  assert.ok(m);
  assert.equal(m.ostatniGlos, "klient");
  assert.equal(m.ostatniaKlientId, "m3");
  assert.equal(m.wiadomosci, 3);
  assert.equal(m.zrodlo, "odczyt");
});

test("dyskusja: ALLEGRO_ADVISOR to trzeci głos, nie klient", () => {
  M.zapiszMetaDyskusji(
    "d2",
    [
      wiadDyskusji("m1", false, "2026-08-01T10:00:00Z"),
      wiadDyskusji("m2", false, "2026-08-01T12:00:00Z", "ALLEGRO_ADVISOR"),
    ],
    "sync"
  );
  const m = M.metaWatku("dyskusja", "d2");
  assert.equal(m?.ostatniGlos, "allegro", "głos mediatora ma własną nazwę — to nie klient");
  assert.equal(
    m?.ostatniaKlientId,
    "m2",
    "punkt odniesienia świeżości to ostatni CUDZY głos, mediator włącznie"
  );
});

test("pytanie: ostatni głos nasz, ale id klienta zostaje jego", () => {
  M.zapiszMetaPytania(
    "t1",
    [wiadPytania("w1", true, "2026-08-01T10:00:00Z"), wiadPytania("w2", false, "2026-08-01T11:00:00Z")],
    "sync"
  );
  const m = M.metaWatku("pytanie", "t1");
  assert.equal(m?.ostatniGlos, "my");
  assert.equal(m?.ostatniaKlientId, "w1");
  assert.equal(m?.wiadomosci, 2);
});

test("stempel wysyłki bez rozmowy nie zeruje licznika ani id klienta", () => {
  M.zapiszMetaDyskusji("d3", [wiadDyskusji("m1", false, "2026-08-01T10:00:00Z")], "odczyt");
  M.stempelWyslano("dyskusja", "d3");
  const m = M.metaWatku("dyskusja", "d3");
  assert.equal(m?.ostatniGlos, "my");
  assert.equal(m?.ostatniaKlientId, "m1", "COALESCE w upsercie chroni punkt odniesienia");
  assert.equal(m?.wiadomosci, 1);
  assert.equal(m?.zrodlo, "wysylka");
});

test("pusta rozmowa niczego nie zapisuje", () => {
  M.zapiszMetaDyskusji("d4", [], "odczyt");
  assert.equal(M.metaWatku("dyskusja", "d4"), null);
});

test("metaHurtem oddaje mapę tylko swojego rodzaju", () => {
  M.zapiszMetaDyskusji("d9", [wiadDyskusji("m1", false, "2026-08-01T10:00:00Z")], "sync");
  M.zapiszMetaPytania("t9", [wiadPytania("w1", true, "2026-08-01T10:00:00Z")], "sync");
  const dysk = M.metaHurtem("dyskusja");
  assert.equal(dysk.size, 1);
  assert.equal(dysk.get("d9")?.ostatniGlos, "klient");
  assert.equal(dysk.get("t9"), undefined, "wątek pytania nie przecieka do dyskusji");
  assert.equal(M.metaHurtem("pytanie").size, 1);
});

test("metaHurtem na pustej tabeli daje pustą mapę, nie null", () => {
  db().prepare("DELETE FROM watek_meta").run();
  assert.equal(M.metaHurtem("dyskusja").size, 0);
});
