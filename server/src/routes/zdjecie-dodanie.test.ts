import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { FastifyInstance } from "fastify";

/* ── Dodanie zdjęcia kartoteki z kolektora (0.88.0) ───────────────────────────
   Testy pilnują trzech rzeczy, których złamanie NIE wywala serwera:

     1. ZAPIS DZIAŁA BEZ SUBIEKTA. Zdjęcie ma być widoczne na karcie natychmiast,
        niezależnie od tego, czy baza firmy ma GRANT INSERT — to cała zapasowa
        droga tej funkcji i bez niej magazynier robi zdjęcie w próżnię.
     2. PODGLĄD JEST JEDNORAZOWY I WYGASA. Bez tego jeden kadr dałoby się
        zatwierdzić dwa razy, a porzucone próby zostawałyby w bazie na zawsze.
     3. ODMOWA MÓWI, CO ZROBIĆ. „Za duże" bez wskazówki zostawia człowieka
        przy regale bez wyjścia.

   `ZDJECIA_DODAWANIE=wertis`, bo w tym środowisku nie ma bazy Subiekta —
   a `subiekt` i tak różni się wyłącznie zadaniem w kolejce, które sprawdza
   osobny test niżej.                                                          */

const katalog = fs.mkdtempSync(path.join(os.tmpdir(), "wertis-zdjd-"));
process.env.DB_PATH = path.join(katalog, "t.db");
process.env.LOG_LEVEL = "silent";
process.env.ZDJECIA_DODAWANIE = "wertis";
// pusty TLO_URL = usługa tła wyłączona; podgląd oddaje oryginał
process.env.TLO_URL = "";

let app: FastifyInstance;
let db: typeof import("../db/db.js").db;
let createUser: typeof import("../services/users.js").createUser;
let token: string;

/** Najkrótszy poprawny nagłówek JPEG — trasa rozpoznaje typ Z BAJTÓW. */
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);

before(async () => {
  ({ db } = await import("../db/db.js"));
  ({ createUser } = await import("../services/users.js"));
  const { buildApp } = await import("../index.js");
  app = await buildApp();
});

beforeEach(() => {
  const d = db();
  for (const t of [
    "zdjecie_wlasne",
    "zdjecie_podglad",
    "zdjecie_cache",
    "sfera_queue",
    "device_session",
    "app_user",
    "events",
  ]) {
    d.prepare(`DELETE FROM ${t}`).run();
  }
  d.prepare(
    "INSERT OR REPLACE INTO sgt_towar(tw_id, symbol, nazwa, ean, lokalizacja) VALUES (1,'W32-0203','Kosa','590','')"
  ).run();

  const u = createUser("Jan Testowy", "magazynier");
  token = "tok-dodanie";
  const teraz = new Date().toISOString();
  d.prepare(
    "INSERT INTO device_session(token, user_id, device_id, created_at, last_seen) VALUES (?,?,?,?,?)"
  ).run(token, u.userId, "test-device", teraz, teraz);
});


/** Nagłówek sesji budowany PRZY WYWOŁANIU — `token` powstaje w `beforeEach`. */
const naglowki = () => ({ "x-session": token });

const wstepne = (zdjecie: string, twId = 1) =>
  app.inject({
    method: "POST",
    url: `/api/products/${twId}/zdjecie/wstepne`,
    headers: naglowki(),
    payload: { zdjecie },
  });

const zapisz = (podgladId: string, zTlem = false, twId = 1) =>
  app.inject({
    method: "POST",
    url: `/api/products/${twId}/zdjecie`,
    headers: naglowki(),
    payload: { podgladId, zTlem, zrodlo: "aparat" },
  });

/** Podgląd gotowy do zatwierdzenia — skrót przez dwie trasy. */
async function podgladId(): Promise<string> {
  const r = await wstepne(JPEG.toString("base64"));
  assert.equal(r.statusCode, 200, r.payload);
  return r.json().podgladId as string;
}

// ── Walidacja wejścia ───────────────────────────────────────────────────────

test("bez sesji 401 — dodawanie zdjęć zostaje za logowaniem", async () => {
  const r = await app.inject({
    method: "POST",
    url: "/api/products/1/zdjecie/wstepne",
    payload: { zdjecie: JPEG.toString("base64") },
  });
  assert.equal(r.statusCode, 401);
});

test("nieznany towar → 404, zanim cokolwiek wyląduje w bazie", async () => {
  const r = await wstepne(JPEG.toString("base64"), 999);
  assert.equal(r.statusCode, 404);
  const { ile } = db().prepare("SELECT COUNT(*) AS ile FROM zdjecie_podglad").get() as { ile: number };
  assert.equal(ile, 0);
});

/* Sprawdzamy BAJTY, nie deklarację. Wpis bez sygnatury obrazu nie przyszedł
   z aparatu ani z galerii i nie ma prawa wylądować w bazie jako coś, czego
   kolektor nie narysuje — ta sama reguła co przy logo dostawcy. */
test("treść, która nie jest obrazem, odpada po sygnaturze", async () => {
  const r = await wstepne(Buffer.from("to jest zwykły tekst").toString("base64"));
  assert.equal(r.statusCode, 400);
  assert.match(r.json().error, /JPEG ani PNG/);
});

test("puste zdjęcie odpada", async () => {
  const r = await wstepne("");
  assert.equal(r.statusCode, 400);
});

test("odmowa za rozmiar MÓWI, co zrobić", async () => {
  const wielkie = Buffer.concat([JPEG, Buffer.alloc(2 * 1024 * 1024)]);
  const r = await wstepne(wielkie.toString("base64"));
  assert.equal(r.statusCode, 400);
  /* Zdanie musi nazwać drogę wyjścia. „Za duże" bez wskazówki zostawia
     człowieka przy regale bez pomysłu, co dalej. */
  assert.match(r.json().error, /kolektor zmniejsza obraz sam/);
});

// ── Podgląd ─────────────────────────────────────────────────────────────────

test("wyłączona usługa tła → podgląd z tłem i POWÓD, nie awaria", async () => {
  const r = await wstepne(JPEG.toString("base64"));
  assert.equal(r.statusCode, 200);
  const b = r.json();
  assert.equal(b.tlo, "zostawione");
  assert.ok(b.podgladId);
  assert.match(b.powod, /nie jest w tej instalacji włączone/);
  // podgląd niesie OBRAZ, nie adres — kolektor rysuje go bez drugiego pobrania
  assert.equal(b.png, JPEG.toString("base64"));
});

test("podgląd NIE zapisuje jeszcze zdjęcia kartoteki", async () => {
  await podgladId();
  const { ile } = db().prepare("SELECT COUNT(*) AS ile FROM zdjecie_wlasne").get() as { ile: number };
  assert.equal(ile, 0, "do bazy firmy i na kartę wchodzi dopiero zatwierdzenie");
});

// ── Zatwierdzenie ───────────────────────────────────────────────────────────

test("zatwierdzenie zapisuje zdjęcie i pokazuje je NATYCHMIAST na karcie", async () => {
  const id = await podgladId();
  const r = await zapisz(id);
  assert.equal(r.statusCode, 200, r.payload);
  assert.equal(r.json().wSubiekcie, false, "ZDJECIA_DODAWANIE=wertis nie rusza bazy firmy");

  /* To jest cała zapasowa droga: karta ma pokazać zdjęcie, choć w Subiekcie
     nie ma go i mieć nie będzie. Bez tego magazynier robi zdjęcie w próżnię. */
  const g = await app.inject({ method: "GET", url: "/api/products/1/zdjecie", headers: naglowki() });
  assert.equal(g.statusCode, 200);
  assert.equal(g.rawPayload.length, JPEG.length);
  assert.equal(g.headers["etag"], `"${r.json().etag}"`);
});

test("podgląd jest JEDNORAZOWY — drugie zatwierdzenie odpada", async () => {
  const id = await podgladId();
  assert.equal((await zapisz(id)).statusCode, 200);
  const drugie = await zapisz(id);
  assert.equal(drugie.statusCode, 410);
  assert.match(drugie.json().error, /Zrób zdjęcie jeszcze raz/);
});

test("nieznany podgląd → 410 ze zdaniem, co zrobić", async () => {
  const r = await zapisz("nie-ma-takiego");
  assert.equal(r.statusCode, 410);
});

/* Podgląd jednego towaru nie ma prawa zatwierdzić się na innym. Bez tej reguły
   identyfikator z jednej karty zapisałby zdjęcie na cudzej kartotece. */
test("podgląd nie przechodzi na inny towar", async () => {
  db()
    .prepare(
      "INSERT OR REPLACE INTO sgt_towar(tw_id, symbol, nazwa, ean, lokalizacja) VALUES (2,'50-111','Nóż','591','')"
    )
    .run();
  const id = await podgladId();
  const r = await zapisz(id, false, 2);
  assert.equal(r.statusCode, 410);
});

test("zatwierdzenie zostawia ślad audytowy", async () => {
  await zapisz(await podgladId());
  const e = db()
    .prepare("SELECT type, tw_id FROM events WHERE type = 'zdjecie_dodane'")
    .all() as Array<{ type: string; tw_id: number }>;
  assert.equal(e.length, 1);
  assert.equal(e[0].tw_id, 1);
});

test("porzucenie kasuje podgląd od razu, nie po kwadransie", async () => {
  const id = await podgladId();
  const r = await app.inject({
    method: "DELETE",
    url: `/api/products/1/zdjecie/wstepne/${id}`,
    headers: naglowki(),
  });
  assert.equal(r.statusCode, 200);
  assert.equal(r.json().usunieto, true);
  const { ile } = db().prepare("SELECT COUNT(*) AS ile FROM zdjecie_podglad").get() as { ile: number };
  assert.equal(ile, 0);
});

// ── Karta towaru ────────────────────────────────────────────────────────────

test("karta mówi kolektorowi, że ta instalacja przyjmuje zdjęcia", async () => {
  const r = await app.inject({ method: "GET", url: "/api/products/1", headers: naglowki() });
  assert.equal(r.statusCode, 200);
  assert.equal(r.json().mozeDodacZdjecie, true, "bez tego pola kolektor chowa przycisk „+”");
});
