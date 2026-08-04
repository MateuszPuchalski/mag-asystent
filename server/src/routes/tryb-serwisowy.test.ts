import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { FastifyInstance } from "fastify";

/* ── Tryb serwisowy: logowanie wyłączone ─────────────────────────────────────
   Osobny plik, a nie kilka testów w `bramka.test.ts`, i to nie z wygody:
   `config.ts` czyta `process.env` PRZY IMPORCIE i zamraża wynik, więc trybu
   nie da się przełączyć w środku pliku. Dwa pliki opisują dwie instalacje —
   ta z flagą i ta bez — i obie muszą być opisane, bo dziura w którąkolwiek
   stronę jest kosztowna: brak obejścia znaczy „nie działa to, po co powstało",
   a nadmiar obejścia znaczy „otwarte API".

   `bramka.test.ts` pilnuje strony WYŁĄCZONEJ i tam siedzi najważniejsza
   asercja całej funkcji: bez zmiennej nic się nie zmienia.                   */

process.env.WERTIS_ADMIN = "1";
process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "wertis-serwis-")), "t.db");
process.env.LOG_LEVEL = "silent";

let app: FastifyInstance;
let db: typeof import("../db/db.js").db;
let createUser: typeof import("../services/users.js").createUser;
let brakKont: typeof import("../services/users.js").brakKont;
let setHaslo: typeof import("../services/users.js").setHaslo;
let NAZWA_SERWISOWA: string;
let wpisStartowy: Array<{ user_id: string; user_ref: number | null }> = [];
let idSerwisowego = 0;

before(async () => {
  ({ db } = await import("../db/db.js"));
  ({ createUser, brakKont, setHaslo } = await import("../services/users.js"));
  ({ NAZWA_SERWISOWA } = await import("../services/tryb-serwisowy.js"));
  const { buildApp } = await import("../index.js");
  app = await buildApp();
  /* Wpis startowy powstaje RAZ, przy budowie aplikacji — czyli zanim
     `beforeEach` wyczyści `events`. Zabieramy go tutaj, bo inaczej test
     poniżej sprawdzałby wyłącznie to, że `beforeEach` działa. */
  wpisStartowy = db()
    .prepare("SELECT user_id, user_ref FROM events WHERE type = 'tryb_serwisowy_start'")
    .all() as Array<{ user_id: string; user_ref: number | null }>;
  idSerwisowego = serwisowe()[0].user_id;
});

beforeEach(() => {
  db().prepare("DELETE FROM events").run();
  db().prepare("DELETE FROM device_session").run();
  db().prepare("DELETE FROM app_user WHERE login IS NOT NULL").run();
});

const serwisowe = () =>
  db()
    .prepare("SELECT user_id, login, haslo_hash, role FROM app_user WHERE name = ?")
    .all(NAZWA_SERWISOWA) as Array<{
    user_id: number;
    login: string | null;
    haslo_hash: string | null;
    role: string;
  }>;

/* ── Konto ───────────────────────────────────────────────────────────────── */

test("konto serwisowe powstaje raz i nie ma ani loginu, ani hasła", () => {
  /* `login TEXT UNIQUE` w SQLite przepuszcza wiele NULL-i, więc gdyby konto
     powstawało leniwie na ścieżce żądania, dwa równoległe żądania założyłyby
     dwa wiersze i audyt rozjechałby się na dwie tożsamości. */
  const k = serwisowe();
  assert.equal(k.length, 1);
  assert.equal(k[0].login, null, "bez loginu nie da się go znaleźć w `zaloguj`");
  assert.equal(k[0].haslo_hash, null, "i nie ma domyślnego hasła do wycieku");
  assert.equal(k[0].role, "biuro");
});

test("konto serwisowe nie zamyka furtki pierwszego konta", async () => {
  // `brakKont()` liczy konta Z LOGINEM, więc serwisowego nie widzi
  assert.equal(brakKont(), true);
  const b = (await app.inject({ method: "GET", url: "/api/setup" })).json();
  assert.equal(b.potrzebne, true, "kreator kont dalej ma sens");
  assert.equal(b.adminMode, true);
  assert.equal(b.admin.name, NAZWA_SERWISOWA);
});

/* ── Wszystkie drogi logowania zamknięte ─────────────────────────────────── */

test("kontem serwisowym nie da się zalogować, także po nadaniu hasła", async () => {
  const id = serwisowe()[0].user_id;
  // ktoś „naprawia" konto, nadając mu hasło — i dalej nic z tego nie ma,
  // bo hasło bez loginu nie ma jak trafić do `userByLogin`
  setHaslo(id, "cokolwiek12");
  for (const login of [NAZWA_SERWISOWA, "admin", "ADMIN (TRYB SERWISOWY)"]) {
    const r = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { login, haslo: "cokolwiek12" },
    });
    assert.equal(r.statusCode, 401, login);
  }
  assert.equal(serwisowe()[0].login, null, "i login dalej jest pusty");
});

test("konto serwisowe nie dostaje tokenu, więc nie ma czego unieważniać", () => {
  const n = db()
    .prepare("SELECT COUNT(*) n FROM device_session WHERE user_id = ?")
    .get(serwisowe()[0].user_id) as { n: number };
  assert.equal(n.n, 0);
});

test("tryb nie wyłącza dławienia logowania", async () => {
  const proba = () =>
    app.inject({ method: "POST", url: "/api/auth/login", payload: { login: "ktos", haslo: "zle12345" } });
  for (let i = 0; i < 5; i++) await proba();
  assert.equal((await proba()).statusCode, 429, "429, nie 401 — kolektor po 401 kasuje bufor");
});

/* ── Bramka ──────────────────────────────────────────────────────────────── */

test("żądanie bez sesji przechodzi i jest podpisane kontem serwisowym", async () => {
  const r = await app.inject({ method: "GET", url: "/api/queue" });
  assert.equal(r.statusCode, 200);
});

test("trasy sprawdzające rolę też przechodzą bez sesji", async () => {
  /* To jest test, który przed refaktorem sesji NIE przechodził: osiem miejsc
     pytało o sesję bazę zamiast kontekstu żądania, więc obejście bramki ich
     nie dotyczyło i tryb serwisowy nie robił tego, po co powstał. */
  for (const url of ["/api/auth/me", "/api/users", "/api/events", "/api/magazyny"]) {
    assert.equal((await app.inject({ method: "GET", url })).statusCode, 200, url);
  }
  const me = (await app.inject({ method: "GET", url: "/api/auth/me" })).json();
  assert.equal(me.user.name, NAZWA_SERWISOWA);
});

test("prawdziwa sesja ma pierwszeństwo nad obejściem", async () => {
  /* Właściciel siada do kolektora, loguje się swoim kontem — i jego praca ma
     być podpisana jego nazwiskiem, nie ADMIN-em. Bez tego tryb serwisowy
     odbierałby możliwość uczciwego podpisania czegokolwiek. */
  createUser("Jan Kowalski", "magazynier", "jan", "tajnehaslo1");
  const tok = (
    await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { login: "jan", haslo: "tajnehaslo1" },
    })
  ).json().token as string;
  const me = (
    await app.inject({ method: "GET", url: "/api/auth/me", headers: { "x-session": tok } })
  ).json();
  assert.equal(me.user.name, "Jan Kowalski");
});

/* ── Zakazy na koncie serwisowym ─────────────────────────────────────────── */

test("konta serwisowego nie da się wyłączyć ani obdarzyć hasłem przez API", async () => {
  /* Inaczej ktoś „wyłączyłby" je w ustawieniach, UI pokazałby konto nieczynne,
     a obejście działałoby dalej — bo bramka bierze tożsamość z konfiguracji,
     nie z flagi `active`. Tryb wyłącza się jedną drogą: WERTIS_ADMIN. */
  const id = serwisowe()[0].user_id;
  for (const url of [`/api/users/${id}/active`, `/api/users/${id}/haslo`]) {
    const r = await app.inject({ method: "POST", url, payload: { active: false, haslo: "abcdefgh" } });
    assert.equal(r.statusCode, 400, url);
    assert.match(r.json().error, /WERTIS_ADMIN/);
  }
});

/* ── Widoczność ──────────────────────────────────────────────────────────── */

test("/api/health krzyczy o trybie, i to na pierwszym miejscu", async () => {
  const b = (await app.inject({ method: "GET", url: "/api/health" })).json();
  assert.equal(b.adminMode, true);
  assert.equal(b.ok, false, "instalacja bez logowania nie jest „ok”");
  assert.match(b.problemy[0], /TRYB SERWISOWY/, "unieważnia wszystko poniżej, więc stoi pierwsze");
});

test("start trybu zostaje w dzienniku", () => {
  /* Audyt ma powiedzieć KIEDY instalacja przestała pytać o hasło, nie tylko
     że przestała. Wpis powstaje raz przy starcie — nie per żądanie, bo
     odpytywanie co 2 s utopiłoby resztę dziennika. */
  assert.equal(wpisStartowy.length, 1);
  assert.equal(wpisStartowy[0].user_id, NAZWA_SERWISOWA);
  assert.equal(wpisStartowy[0].user_ref, idSerwisowego);
});
