import { test, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { FastifyInstance } from "fastify";

/* ── Konfiguracja w panelu (0.488.0) ─────────────────────────────────────────
   Cztery gwarancje, każda z powodem w `routes/konfiguracja.ts`:
   1. tylko admin — biuro dostaje 403, bez sesji 401;
   2. hasło z pliku nie pojawia się w odpowiedzi ani razu;
   3. źródło każdej wartości: plik, przykryte środowiskiem, domyślna;
   4. literówka w pliku wychodzi w odpowiedzi i w zdrowiu;
   5. patrzenie niczego nie zapisuje, także wpisu `privileged`. */

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wertis-konf-"));
const HASLO = "BardzoTajneHaslo#42";
fs.writeFileSync(path.join(dir, "wertis.env"), [
  "export MSSQL_SERVER=serwer-subiekta",
  `export MSSQL_PASSWORD="${HASLO}"`,
  "export ZWROT_TERMIN_DNI=9",
  "export ALEGRO_CLIENT_ID=literowka",
  "export PORT=4999",
].join("\n"));
process.env.WERTIS_ENV_FILE = path.join(dir, "wertis.env");
process.env.DB_PATH = path.join(dir, "t.db");
process.env.LOG_LEVEL = "silent";
/* Zmienna środowiskowa przykrywa plik — tak wygląda pozostałość NSSM. */
process.env.PORT = "3001";

let app: FastifyInstance;
let db: typeof import("../db/db.js").db;
let createUser: typeof import("../services/users.js").createUser;

before(async () => {
  ({ db } = await import("../db/db.js"));
  ({ createUser } = await import("../services/users.js"));
  app = await (await import("../index.js")).buildApp();
});

let kolejny = 0;
function jako(rola: "admin" | "biuro" | "magazynier"): { "x-session": string } {
  const u = createUser(`Ktoś ${rola}`, rola, `k${rola}-${++kolejny}`, "tajnehaslo");
  const token = `tok-${u.userId}-${kolejny}`;
  const teraz = new Date().toISOString();
  db().prepare("INSERT INTO device_session(token, user_id, device_id, created_at, last_seen) VALUES (?,?,?,?,?)")
    .run(token, u.userId, "biuro-pc", teraz, teraz);
  return { "x-session": token };
}

test("konfigurację ogląda tylko admin", async () => {
  assert.equal((await app.inject({ method: "GET", url: "/api/biuro/konfiguracja" })).statusCode, 401);
  for (const rola of ["biuro", "magazynier"] as const) {
    const r = await app.inject({ method: "GET", url: "/api/biuro/konfiguracja", headers: jako(rola) });
    assert.equal(r.statusCode, 403, rola);
  }
});

test("wartości ze źródłem, sekret bez wartości", async () => {
  const r = await app.inject({ method: "GET", url: "/api/biuro/konfiguracja", headers: jako("admin") });
  assert.equal(r.statusCode, 200, r.body);
  assert.ok(!r.body.includes(HASLO), "hasło z pliku wyszło w odpowiedzi");

  const k = r.json() as { plik: string; nieznane: string[];
    wiersze: Array<{ klucz: string; zrodlo: string; wartosc: string | null; tajny: boolean }> };
  const w = (klucz: string) => k.wiersze.find((x) => x.klucz === klucz)!;
  assert.equal(k.plik, process.env.WERTIS_ENV_FILE);
  assert.deepEqual([w("MSSQL_SERVER").zrodlo, w("MSSQL_SERVER").wartosc], ["plik", "serwer-subiekta"]);
  assert.deepEqual([w("MSSQL_PASSWORD").zrodlo, w("MSSQL_PASSWORD").wartosc, w("MSSQL_PASSWORD").tajny],
    ["plik", null, true]);
  assert.deepEqual([w("PORT").zrodlo, w("PORT").wartosc], ["przykryte", "3001"]);
  assert.deepEqual([w("ZWROT_WYGASA_DNI").zrodlo, w("ZWROT_WYGASA_DNI").wartosc], ["domyslna", null]);
  assert.deepEqual(k.nieznane, ["ALEGRO_CLIENT_ID"]);
});

test("literówka w pliku staje w zdrowiu jako problem", async () => {
  const h = (await app.inject({ method: "GET", url: "/api/health" })).json() as { problemy?: string[] };
  assert.ok((h.problemy ?? []).some((p) => p.includes("ALEGRO_CLIENT_ID")), JSON.stringify(h.problemy));
});

test("patrzenie niczego nie zapisuje — także wpisu privileged", async () => {
  const naglowki = jako("admin");
  const ile = () => (db().prepare("SELECT COUNT(*) AS n FROM events").get() as { n: number }).n;
  const przed = ile();
  await app.inject({ method: "GET", url: "/api/biuro/konfiguracja", headers: naglowki });
  assert.equal(ile(), przed);
});
