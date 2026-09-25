import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { FastifyInstance } from "fastify";

/* ── Aktualizacja z panelu (0.492.0) ─────────────────────────────────────────
   Trasy w `routes/konfiguracja.ts`, logika w `services/aktualizacja-serwera.ts`.
   Gwarancje od strony HTTP:
   1. wgląd i zlecenie tylko dla admina;
   2. zlecenie wymaga hasła — złe hasło nie zostawia pliku zlecenia;
   3. patrzenie niczego nie zapisuje, także wpisu `privileged`;
   4. poza NSSM (w teście zawsze) przycisk odmawia zdaniem, nie 500;
   5. udane zlecenie: plik zlecenia, uruchomione zadanie, wpis w dzienniku. */

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wertis-akt-trasy-"));
process.env.WERTIS_ENV_FILE = path.join(dir, "brak.env");
process.env.DB_PATH = path.join(dir, "t.db");
process.env.LOG_LEVEL = "silent";

type Serwis = typeof import("../services/aktualizacja-serwera.js");
let app: FastifyInstance;
let db: typeof import("../db/db.js").db;
let createUser: typeof import("../services/users.js").createUser;
let serwis: Serwis;
const zlecenie = path.join(dir, "aktualizacja", "zlecenie.json");

/* Wersja z przyszłości, żeby lista „nowszych" nie zależała od numeru
   bieżącego wydania. */
const WYDANIA = [{ tag_name: "v9.0.0", published_at: "2026-09-22T10:00:00Z",
  assets: [{ name: "wertis-9.0.0.zip" }, { name: "wertis-9.0.0.zip.sha256" }] }];

before(async () => {
  ({ db } = await import("../db/db.js"));
  ({ createUser } = await import("../services/users.js"));
  serwis = await import("../services/aktualizacja-serwera.js");
  app = await (await import("../index.js")).buildApp();
});

beforeEach(async () => {
  serwis._wyczyscPamiec();
  serwis.ustawUruchamiacz(null);
  fs.rmSync(zlecenie, { force: true });
  await serwis.sprawdzWydania(async (url) => ({
    ok: true, status: 200,
    text: async () => (url.includes("api.github.com") ? JSON.stringify(WYDANIA) : "## 9.0.0 — jutro\n\nNowe.\n"),
  }));
});

let kolejny = 0;
function jako(rola: "admin" | "biuro" | "magazynier"): { "x-session": string } {
  const u = createUser(`Ktoś ${rola}`, rola, `a${rola}-${++kolejny}`, "tajnehaslo");
  const token = `tok-${u.userId}-${kolejny}`;
  const teraz = new Date().toISOString();
  db().prepare("INSERT INTO device_session(token, user_id, device_id, created_at, last_seen) VALUES (?,?,?,?,?)")
    .run(token, u.userId, "biuro-pc", teraz, teraz);
  return { "x-session": token };
}

const zlec = (naglowki: Record<string, string>, haslo: string, wersja = "9.0.0") =>
  app.inject({ method: "POST", url: "/api/biuro/aktualizacja", headers: naglowki, payload: { wersja, haslo } });
const ileZdarzen = () => (db().prepare("SELECT COUNT(*) AS n FROM events").get() as { n: number }).n;

test("wgląd tylko dla admina", async () => {
  assert.equal((await app.inject({ method: "GET", url: "/api/biuro/aktualizacja" })).statusCode, 401);
  for (const rola of ["biuro", "magazynier"] as const) {
    const naglowki = jako(rola);
    assert.equal((await app.inject({ method: "GET", url: "/api/biuro/aktualizacja", headers: naglowki })).statusCode, 403);
    assert.equal((await app.inject({ method: "POST", url: "/api/biuro/aktualizacja/sprawdz", headers: naglowki })).statusCode, 403);
  }
});

test("patrzenie niczego nie zapisuje", async () => {
  const naglowki = jako("admin");
  const przed = ileZdarzen();
  const r = await app.inject({ method: "GET", url: "/api/biuro/aktualizacja", headers: naglowki });
  assert.equal(r.statusCode, 200, r.body);
  const s = r.json() as { wydania: Array<{ wersja: string }>; zmiany: unknown[]; blokada: string | null;
    auto: { tryb: string; okno: { od: number; do: number }; kandydat: string | null; teraz: boolean; powod: string } };
  assert.deepEqual(s.wydania.map((w) => w.wersja), ["9.0.0"]);
  /* Decyzja automatu (0.494.0) w odpowiedzi — to samo zdanie, którym kieruje
     się takt. Wydanie z testu ma dwa dni, więc jest dojrzałe. */
  assert.deepEqual([s.auto.tryb, s.auto.okno, s.auto.kandydat], ["noc", { od: 3, do: 5 }, "9.0.0"]);
  assert.ok(s.auto.powod.length > 0);
  assert.equal(s.zmiany.length, 1);
  assert.equal(ileZdarzen(), przed);
  assert.ok(!fs.existsSync(path.dirname(zlecenie)) || !fs.existsSync(zlecenie));
});

test("zleca tylko admin; biuro nie dochodzi nawet do hasła", async () => {
  serwis.ustawUruchamiacz(async () => {});
  assert.equal((await zlec(jako("biuro"), "tajnehaslo")).statusCode, 403);
  assert.ok(!fs.existsSync(zlecenie));
});

test("złe hasło — 403 zdaniem, bez zlecenia i bez uruchomienia", async () => {
  const wolane: string[] = [];
  serwis.ustawUruchamiacz(async (n) => { wolane.push(n); });
  const r = await zlec(jako("admin"), "zgadywane");
  assert.equal(r.statusCode, 403);
  assert.match(r.json().error, /Błędne hasło/);
  assert.ok(!fs.existsSync(zlecenie));
  assert.deepEqual(wolane, []);
});

test("poza NSSM przycisk odmawia zdaniem, nie błędem serwera", async () => {
  const r = await zlec(jako("admin"), "tajnehaslo");
  assert.equal(r.statusCode, 409, r.body);
  assert.match(r.json().error, /usługa Windows/);
  assert.ok(!fs.existsSync(zlecenie));
});

test("udane zlecenie: plik, zadanie, wpis w dzienniku", async () => {
  const wolane: string[] = [];
  serwis.ustawUruchamiacz(async (n) => { wolane.push(n); });
  const r = await zlec(jako("admin"), "tajnehaslo");
  assert.equal(r.statusCode, 200, r.body);
  assert.deepEqual(r.json(), { ok: true, wersja: "9.0.0" });
  assert.equal(JSON.parse(fs.readFileSync(zlecenie, "utf8")).wersja, "9.0.0");
  assert.deepEqual(wolane, ["WERTIS aktualizacja"]);
  const wpis = db().prepare("SELECT payload FROM events WHERE type = 'aktualizacja_zlecona' ORDER BY id DESC")
    .get() as { payload: string };
  assert.equal(JSON.parse(wpis.payload).na, "9.0.0");
  /* W trakcie przycisk jest zablokowany — drugie kliknięcie to 409. */
  assert.equal((await zlec(jako("admin"), "tajnehaslo")).statusCode, 409);
});
