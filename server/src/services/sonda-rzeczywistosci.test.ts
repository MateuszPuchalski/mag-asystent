import { before, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/* ── Test na żywym Allegro (24 września 2026) ────────────────────────────────
   Tu, i TYLKO tu, drogi są podstawione — w produkcji sonda woła te same
   funkcje co Copilot i synchronizacja, bez atrap. Pilnujemy czterech rzeczy:
   błąd drogi jest czerwony i ma powód bez adresu, limit 429 NIE jest błędem,
   brak danych to „pominięty”, a błąd trafia do DO DECYZJI i gaśnie sam. */

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "wertis-sonda-")), "t.db");

let db: typeof import("../db/db.js").db;
let S: typeof import("./sonda-rzeczywistosci.js");
let D: typeof import("./do-decyzji.js");
let BladLimitu: typeof import("../adapters/allegro.js").BladLimituAllegro;

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

before(async () => {
  ({ db } = await import("../db/db.js"));
  S = await import("./sonda-rzeczywistosci.js");
  D = await import("./do-decyzji.js");
  ({ BladLimituAllegro: BladLimitu } = await import("../adapters/allegro.js"));
  const d = db();
  const konto = Number(d.prepare(
    "INSERT INTO channel_account(channel,external_account_id) VALUES ('allegro','s-sonda')").run().lastInsertRowid);
  const r = Number(d.prepare(
    "INSERT INTO conversation(channel_account_id,external_conversation_id) VALUES (?,'w-s')").run(konto).lastInsertRowid);
  const m = Number(d.prepare(`INSERT INTO message(conversation_id,channel_account_id,external_message_id,
    direction,body,sent_at) VALUES (?,?,'m-s','incoming','zdjęcie','2026-09-24T08:00:00Z')`)
    .run(r, konto).lastInsertRowid);
  d.prepare(`INSERT INTO message_attachment(message_id,file_name,mime_type,url,status)
    VALUES (?,'tabliczka.png','image/png','https://upload.allegro.pl/message-center/message-attachments/x','SAFE')`)
    .run(m);
  const s = Number(d.prepare(`INSERT INTO reklamacja_klienta(channel_account_id,external_id,typ,
    otwarto_at,synced_at) VALUES (?,'i-s','CLAIM','2026-09-20T08:00:00Z','x')`).run(konto).lastInsertRowid);
  d.prepare(`INSERT INTO reklamacja_zalacznik(reklamacja_id,nazwa,url)
    VALUES (?,'usterka.jpg','https://api.allegro.pl/sale/issues/attachments/a-1')`).run(s);
});

const dobreAllegro = async (url: string) =>
  (url.includes("/messaging/threads") ? { threads: [{ id: "t" }] } : { id: "i-s" });

test("wszystkie drogi działają: pięć kroków, zapis wyniku i ślad w dzienniku", async () => {
  const w = await S.sondujRzeczywistosc({
    zapytaj: dobreAllegro, pobierzZdjecieRozmowy: async () => PNG.buffer.slice(0),
    pobierzZalacznikSprawy: async () => PNG.buffer.slice(0), teraz: () => new Date("2026-09-24T10:00:00Z"),
  });
  assert.deepEqual(w.kroki.map((k) => [k.krok, k.wynik]), [
    ["watki", "ok"], ["sprawa", "ok"], ["zdjecie_rozmowy", "ok"], ["zdjecie_reklamacji", "ok"],
    ["zdjecia_copilota", "pominiety"],
  ]);
  assert.deepEqual(S.stanSondy().kroki.map((k) => k.wynik), w.kroki.map((k) => k.wynik));
  const e = db().prepare("SELECT payload FROM events WHERE type='sonda_rzeczywistosci'").get() as { payload: string };
  assert.deepEqual(JSON.parse(e.payload), { ok: 4, blad: 0, pominiety: 1 });
  assert.equal(D.doDecyzji().pozycje.some((p) => p.zrodlo === "sonda"), false);
});

test("zdjęcie, które nie doszło: czerwień z powodem bez adresu i wiersz w DO DECYZJI", async () => {
  const w = await S.sondujRzeczywistosc({
    zapytaj: dobreAllegro,
    pobierzZdjecieRozmowy: async () => {
      throw new Error("Allegro odmówiło 403 dla https://upload.allegro.pl/message-center/x");
    },
    pobierzZalacznikSprawy: async () => PNG.buffer.slice(0),
    teraz: () => new Date("2026-09-25T10:00:00Z"),
  });
  const k = w.kroki.find((x) => x.krok === "zdjecie_rozmowy")!;
  assert.equal(k.wynik, "blad");
  assert.match(k.szczegol!, /1 z 1 zdjęć nie pobrało się: Allegro odmówiło 403/);
  assert.equal(/https?:/.test(k.szczegol!), false, "adres nie idzie do bazy ani na ekran");
  const p = D.doDecyzji().pozycje.find((x) => x.zrodlo === "sonda");
  assert.ok(p, "błąd drogi produkcji ląduje w DO DECYZJI");
  assert.match(p!.co, /zdjęcie z rozmowy/);
  assert.equal(p!.cel.panel, "/obsluga/stan?karta=sonda");
});

test("limit 429 to nie wada kodu, a dziennik z doby mówi o prawdziwych szkicach", async () => {
  db().prepare(`INSERT INTO events(type,user_id,payload,created_at)
    VALUES ('copilot_szkic','ala','{"zdjec":2,"zdjecBledow":1}','2026-09-26T09:00:00Z')`).run();
  const w = await S.sondujRzeczywistosc({
    zapytaj: async () => { throw new BladLimitu("Limit Allegro", 60_000); },
    pobierzZdjecieRozmowy: async () => PNG.buffer.slice(0),
    pobierzZalacznikSprawy: async () => PNG.buffer.slice(0),
    teraz: () => new Date("2026-09-26T10:00:00Z"),
  });
  const wynik = Object.fromEntries(w.kroki.map((k) => [k.krok, k.wynik]));
  assert.equal(wynik.watki, "pominiety");
  assert.equal(wynik.sprawa, "pominiety");
  assert.equal(wynik.zdjecia_copilota, "blad", "zdjęcie klienta, które nie doszło do modelu w szkicu");
  /* Wiersz w DO DECYZJI gaśnie razem z przyczyną — po udanym przebiegu. */
  await S.sondujRzeczywistosc({
    zapytaj: dobreAllegro, pobierzZdjecieRozmowy: async () => PNG.buffer.slice(0),
    pobierzZalacznikSprawy: async () => PNG.buffer.slice(0), teraz: () => new Date("2026-09-28T10:00:00Z"),
  });
  assert.equal(D.doDecyzji().pozycje.some((p) => p.zrodlo === "sonda"), false);
});

test("zdanie bez adresów i nie dłuższe niż 300 znaków", () => {
  assert.equal(S.bezAdresow("x https://a.b/c?d=1 y"), "x [adres] y");
  assert.equal(S.bezAdresow("a".repeat(500)).length, 300);
});
