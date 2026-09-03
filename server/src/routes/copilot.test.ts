import { before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import type { Rola } from "../services/users.js";

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "wertis-copilot-tras-")), "t.db");
process.env.LOG_LEVEL = "silent";
process.env.SGT_MODE = "seeded";
/* Copilot zostaje WYŁĄCZONY na cały ten plik i to jest celowe: dzięki temu
   żaden test nie ma jak wyjść do Anthropic, a bramka „wyłączony" jest
   sprawdzana na tej samej ścieżce, którą pójdzie produkcja. Ścieżkę szczęśliwą
   pokrywają testy serwisu, ze wstrzykniętym nadawcą. */
delete process.env.COPILOT_MODE;

/* ── Trasy Copilota (etap F) — trzy umowy ───────────────────────────────────
   1. Bramka roli na KAŻDEJ trasie, także na odczycie; 401 przed 403.
   2. Otwarcie ekranu niczego nie zapisuje, a tras zapisu są DWIE.
   3. Wyłączony Copilot odmawia zdaniem, nie wywrotką — i nie wychodzi do sieci.
*/

let app: FastifyInstance;
let db: typeof import("../db/db.js").db;
let createUser: typeof import("../services/users.js").createUser;
let rozmowa = 0;

before(async () => {
  ({ db } = await import("../db/db.js"));
  ({ createUser } = await import("../services/users.js"));
  app = await (await import("../index.js")).buildApp();
});

beforeEach(() => {
  const d = db();
  for (const t of ["klasyfikacja_rozmowy", "copilot_wywolanie", "message", "conversation",
    "events", "device_session", "app_user"]) {
    d.prepare(`DELETE FROM ${t}`).run();
  }
  d.prepare("INSERT OR IGNORE INTO channel_account(id,channel,external_account_id) VALUES (1,'allegro','k')").run();
  rozmowa = Number(d.prepare(`INSERT INTO conversation
    (channel_account_id,external_conversation_id,subject) VALUES (1,'w-1','zielony_ogrod')`)
    .run().lastInsertRowid);
  d.prepare(`INSERT INTO message
    (conversation_id,channel_account_id,external_message_id,direction,body,sent_at)
    VALUES (?,1,'m-1','incoming','Czy nóż pasuje do NAC LS 46-450?','2026-09-03T08:00:00Z')`)
    .run(rozmowa);
});

function login(role: Rola, name: string) {
  const u = createUser(name, role, `${role}${Math.random()}`, "tajnehaslo");
  const token = `t-${u.userId}`;
  const n = new Date().toISOString();
  db().prepare("INSERT INTO device_session(token,user_id,created_at,last_seen) VALUES(?,?,?,?)")
    .run(token, u.userId, n, n);
  return { naglowki: { "x-session": token } };
}

const liczba = (tabela: string) => (db().prepare(`SELECT count(*) n FROM ${tabela}`).get() as { n: number }).n;

const TRASY = () => [
  { method: "GET" as const, url: "/api/obsluga/copilot" },
  { method: "GET" as const, url: "/api/obsluga/copilot/pomiar" },
  { method: "POST" as const, url: "/api/obsluga/copilot/klasyfikacja",
    payload: { rozmowyId: [rozmowa] } },
  { method: "POST" as const, url: `/api/obsluga/copilot/klasyfikacja/${rozmowa}/ocena`,
    payload: { ocena: "trafna" } },
];

test("bez sesji żadna trasa Copilota nie odpowiada danymi", async () => {
  for (const t of TRASY()) {
    const r = await app.inject({ method: t.method, url: t.url, payload: t.payload });
    assert.equal(r.statusCode, 401, `${t.method} ${t.url} przepuścił brak sesji`);
  }
});

test("hala nie widzi Copilota — bramka stoi też na odczycie", async () => {
  const m = login("magazynier", "Marek");
  for (const t of TRASY()) {
    const r = await app.inject({ method: t.method, url: t.url, headers: m.naglowki, payload: t.payload });
    assert.equal(r.statusCode, 403, `${t.method} ${t.url} wpuścił halę`);
    assert.match(r.json<{ error: string }>().error, /biuro/);
  }
});

/* ── Umowa: DWIE trasy zapisu ───────────────────────────────────────────────
   Licznik jest umową, jak przy zwrotach. Każdy nowy zapis podnosi liczbę
   i dostaje zdanie uzasadnienia.

   PIERWSZA to partia klasyfikacji — jedyne miejsce, z którego treść rozmowy
   wychodzi poza firmę, i dlatego jedyne, przed którym stoi warstwa maskowania.

   DRUGA to werdykt człowieka o trafności. Wygląda na drobiazg, a jest
   warunkiem pomiaru: bez niej da się policzyć, ILE Copilot kosztuje, ale nie
   da się policzyć, CZY jest dobry — a decyzja właściciela brzmi „zejdź na
   tańszy model po pomiarze". Pomiar bez trafności odpowiadałby na pytanie,
   którego nikt nie zadał.                                                    */
test("Copilot ma DWIE trasy zapisu", async () => {
  const zrodlo = fs.readFileSync(new URL("./copilot.ts", import.meta.url), "utf8");
  const posty = zrodlo.match(/app\.post[<(]/g) ?? [];
  assert.equal(posty.length, 2, `tras POST jest ${posty.length}, a umowa mówi o dwóch`);
  for (const slowo of ["klasyfikacja", "ocena"]) {
    assert.equal(zrodlo.includes(slowo), true, `brak trasy ${slowo}`);
  }
});

test("patrzenie na Copilota niczego nie mutuje", async () => {
  const b = login("biuro", "Ala");
  const przed = [liczba("klasyfikacja_rozmowy"), liczba("copilot_wywolanie"), liczba("events")];
  for (const t of TRASY().filter((t) => t.method === "GET")) {
    await app.inject({ method: t.method, url: t.url, headers: b.naglowki });
    await app.inject({ method: t.method, url: t.url, headers: b.naglowki });
  }
  assert.deepEqual(
    [liczba("klasyfikacja_rozmowy"), liczba("copilot_wywolanie"), liczba("events")], przed,
    "otwarcie ekranu Copilota coś zapisało",
  );
});

/* ── Wyłączony Copilot ──────────────────────────────────────────────────── */

test("wyłączony Copilot mówi, co włączyć, i nie wychodzi do sieci", async () => {
  const b = login("biuro", "Ala");
  const r = await app.inject({
    method: "POST", url: "/api/obsluga/copilot/klasyfikacja",
    headers: b.naglowki, payload: { rozmowyId: [rozmowa] },
  });
  assert.equal(r.statusCode, 400, "wyłączony Copilot ma odmówić zdaniem, nie wywrotką 500");
  assert.match(r.json<{ error: string }>().error, /COPILOT_MODE|wertis\.env/);
  assert.equal(liczba("copilot_wywolanie"), 0, "odmowa nie ma prawa nic kosztować");
});

test("stan mówi wprost, dlaczego przycisku nie ma", async () => {
  const b = login("biuro", "Ala");
  const r = await app.inject({ method: "GET", url: "/api/obsluga/copilot", headers: b.naglowki });
  const s = r.json<{ wlaczony: boolean; powod: string | null; maxPartia: number }>();
  assert.equal(s.wlaczony, false);
  assert.match(String(s.powod), /wertis\.env/);
  /* Limit idzie na ekran z konfiguracji, żeby przycisk nie powtarzał liczby
     wpisanej w panelu — inaczej rozjechałby się z hamulcem po stronie serwera. */
  assert.ok(s.maxPartia > 0);
});

/* Kolejność bramek jest DECYZJĄ: wyłączony Copilot odmawia, ZANIM zajrzy do
   listy rozmów. Człowiek ma najpierw usłyszeć o problemie fundamentalnym,
   a nie o pustym polu w żądaniu, które i tak nie miałoby czego zrobić. */
test("wyłączony Copilot odmawia przed sprawdzeniem listy, a nie po", async () => {
  const b = login("biuro", "Ala");
  const r = await app.inject({
    method: "POST", url: "/api/obsluga/copilot/klasyfikacja",
    headers: b.naglowki, payload: { rozmowyId: [] },
  });
  assert.equal(r.statusCode, 400);
  assert.match(r.json<{ error: string }>().error, /wertis\.env/,
    "przy wyłączonym Copilocie odmowa ma nazwać wyłączenie, nie pustą listę");
  /* Sam strażnik pustej listy stoi w trasie i pilnuje go czytanie źródła —
     ścieżki z włączonym Copilotem ten plik świadomie nie uruchamia, żeby
     żaden test nie miał jak wyjść do Anthropic. */
  const zrodlo = fs.readFileSync(new URL("./copilot.ts", import.meta.url), "utf8");
  assert.match(zrodlo, /Nie podano rozmów/);
});

test("ocena bez rozpoznanej kategorii odmawia zdaniem", async () => {
  const b = login("biuro", "Ala");
  const r = await app.inject({
    method: "POST", url: `/api/obsluga/copilot/klasyfikacja/${rozmowa}/ocena`,
    headers: b.naglowki, payload: { ocena: "trafna" },
  });
  assert.equal(r.statusCode, 400);
  assert.match(r.json<{ error: string }>().error, /nie ma jeszcze rozpoznanej/);
});
