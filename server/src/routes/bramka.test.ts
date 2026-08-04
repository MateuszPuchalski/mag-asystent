import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { FastifyInstance } from "fastify";

/* ── Bramka sesji ───────────────────────────────────────────────────────────
   Do lipca token był ROZPOZNAWANY, ale nie WYMAGANY: sesji żądały trzy
   miejsca, a `POST /api/products/:id/location` — jedyna trasa zmieniająca
   lokalizację w Subiekcie — i `GET /api/wydajnosc` (dane per pracownik)
   przechodziły bez niczego.

   Ten plik pilnuje OBU stron bramki. Sprawdzanie samej ścieżki pozytywnej
   („z tokenem działa") przepuściłoby regresję, która otwiera API na oścież,
   bo wtedy też działa. Dlatego każdy test ma parę: przechodzi TO, co ma
   przechodzić, i odpada TO, co ma odpadać.

   Lista wyjątków jest tu zaasertowana wprost, bo jest jedynym miejscem, gdzie
   błąd w jedną stronę zostawia dziurę, a w drugą — blokuje instalację
   u klienta (pierwszego konta nie da się założyć sesją, której jeszcze nie
   ma). Testy jednostkowe tego nie widzą; ten plik widzi.                     */

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "wertis-bramka-")), "t.db");
process.env.LOG_LEVEL = "silent";

let app: FastifyInstance;
let db: typeof import("../db/db.js").db;
let createUser: typeof import("../services/users.js").createUser;

before(async () => {
  ({ db } = await import("../db/db.js"));
  ({ createUser } = await import("../services/users.js"));
  const { buildApp } = await import("../index.js");
  app = await buildApp();
});

beforeEach(() => {
  db().prepare("DELETE FROM events").run();
  db().prepare("DELETE FROM device_session").run();
  db().prepare("DELETE FROM app_user").run();
  db().prepare("DELETE FROM sfera_queue").run();
  /* Jedna kartoteka, żeby zapis lokalizacji miał co zmienić. Bez niej trasa
     kończy się 404 — czyli PO bramce — i test „przeszło" byłby prawdziwy
     z niewłaściwego powodu. */
  db()
    .prepare(
      "INSERT OR REPLACE INTO sgt_towar(tw_id, symbol, nazwa, ean, lokalizacja) VALUES (1,'W32-0203','Testowy towar','5901234567890','')"
    )
    .run();
});

/** Konto + świeża sesja; zwraca token do nagłówka `x-session`. */
function zalogowany(rola: "magazynier" | "biuro" = "magazynier"): string {
  const u =
    rola === "biuro"
      ? createUser("Biuro Testowe", rola, "biuro", "tajnehaslo")
      : createUser("Jan Testowy", rola, "jtestowy", "tajnehaslo");
  const token = `tok-${u.userId}-${Math.random().toString(16).slice(2)}`;
  const teraz = new Date().toISOString();
  db()
    .prepare(
      "INSERT INTO device_session(token, user_id, device_id, created_at, last_seen) VALUES (?,?,?,?,?)"
    )
    .run(token, u.userId, "test-device", teraz, teraz);
  return token;
}

/** Sesja bez ruchu od godziny — kiedyś zablokowana, dziś zwyczajnie czynna. */
function bezczynny(): { token: string; userId: number } {
  const u = createUser("Stary Testowy", "magazynier", "stestowy", "tajnehaslo");
  const token = `tok-old-${u.userId}`;
  const dawno = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  db()
    .prepare(
      "INSERT INTO device_session(token, user_id, device_id, created_at, last_seen) VALUES (?,?,?,?,?)"
    )
    .run(token, u.userId, "test-device", dawno, dawno);
  return { token, userId: u.userId };
}

// ── Bez sesji ───────────────────────────────────────────────────────────────

test("zapis bez sesji odpada — to jest cała zmiana", async () => {
  const r = await app.inject({
    method: "POST",
    url: "/api/products/1/location",
    payload: { action: "replace", value: "A01-02-03" },
  });
  assert.equal(r.statusCode, 401);
});

test("nagłówek x-user NIE jest tożsamością — sam nie otwiera bramki", async () => {
  // dokładnie ten sposób podpisywania operacji był możliwy wcześniej
  const r = await app.inject({
    method: "POST",
    url: "/api/products/1/location",
    headers: { "x-user": "Jan Kowalski" },
    payload: { action: "replace", value: "A01-02-03" },
  });
  assert.equal(r.statusCode, 401);
});

test("odczyt bez sesji też odpada — w tym raport wydajności per pracownik", async () => {
  // art. 22² KP: to są dane osobowe pracowników, nie statystyka magazynu
  assert.equal((await app.inject({ url: "/api/wydajnosc?days=7" })).statusCode, 401);
  assert.equal((await app.inject({ url: "/api/metrics" })).statusCode, 401);
});

test("nieznany token jest traktowany jak brak tokenu", async () => {
  const r = await app.inject({
    url: "/api/wydajnosc",
    headers: { "x-session": "zmyslony-token" },
  });
  assert.equal(r.statusCode, 401);
});

// ── Lista wyjątków ──────────────────────────────────────────────────────────

test("health i setup działają bez sesji — instalator pyta o nie przed konfiguracją", async () => {
  assert.equal((await app.inject({ url: "/api/health" })).statusCode, 200);

  const setup = await app.inject({ url: "/api/setup" });
  assert.equal(setup.statusCode, 200);
  assert.equal(setup.json().potrzebne, true); // baza pusta po beforeEach
});

test("pierwsze konto powstaje bez sesji, drugie już nie", async () => {
  const pierwsze = await app.inject({
    method: "POST",
    url: "/api/users",
    payload: { name: "Biuro Zakupy", login: "biuro", haslo: "tajnehaslo" },
  });
  assert.equal(pierwsze.statusCode, 200);
  assert.equal(pierwsze.json().user.role, "biuro");

  /* Furtka zamyka się sama — i to jest najgroźniejsze miejsce tej zmiany:
     bramka zbyt szczelna zablokowałaby instalację u klienta, zbyt luźna
     zostawiłaby otwarte zakładanie kont. */
  const drugie = await app.inject({
    method: "POST",
    url: "/api/users",
    payload: { name: "Ktoś Obcy", login: "obcy", haslo: "tajnehaslo" },
  });
  assert.equal(drugie.statusCode, 401);
});

test("pierwsze konto BEZ hasła nie powstaje — inaczej instalacja jest martwa", async () => {
  /* Konto bez hasła zamyka furtkę i samo się nie loguje. Powstałaby
     instalacja, której nie da się odblokować niczym poza ręczną zmianą
     w bazie — dlatego walidacja idzie PRZED założeniem konta. */
  const r = await app.inject({
    method: "POST",
    url: "/api/users",
    payload: { name: "Biuro Zakupy", login: "biuro" },
  });
  assert.equal(r.statusCode, 400);
  assert.equal((await app.inject({ url: "/api/setup" })).json().potrzebne, true);
});

test("logowanie loginem i hasłem działa bez sesji, bo inaczej nie dałoby się zalogować", async () => {
  createUser("Jan Testowy", "magazynier", "jtestowy", "tajnehaslo");
  const r = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: { login: "jtestowy", haslo: "tajnehaslo" },
  });
  assert.equal(r.statusCode, 200);
  assert.ok(r.json().token);
});

test("trasy logowania plakietką już nie ma", async () => {
  /* Pilnuje, że stara droga wejścia nie została po cichu obok nowej.
     Odpowiada BRAMKA, nie trasa — dlatego 401 z jej komunikatem, a nie 404:
     bramka odrzuca wszystko pod `/api/` bez sesji, także ścieżki, których
     nikt nie zarejestrował. */
  const r = await app.inject({
    method: "POST",
    url: "/api/auth/badge",
    payload: { badge: "PRC-0001-9" },
  });
  assert.equal(r.statusCode, 401);
  assert.match(r.json().error, /Brak sesji/, "to bramka, nie logowanie plakietką");
});

// ── Z sesją ─────────────────────────────────────────────────────────────────

test("z sesją zapis przechodzi i podpisuje się kontem z tokenu, nie nagłówkiem", async () => {
  const token = zalogowany();
  const r = await app.inject({
    method: "POST",
    url: "/api/products/1/location",
    headers: { "x-session": token, "x-user": "Ktoś Podszywający Się" },
    payload: { action: "replace", value: "A01-02-03" },
  });
  assert.equal(r.statusCode, 200);

  const ev = db()
    .prepare("SELECT user_id FROM events WHERE type = 'location_set' ORDER BY id DESC LIMIT 1")
    .get() as { user_id: string } | undefined;
  assert.equal(ev?.user_id, "Jan Testowy");
});

// ── Sesja bezczynna ─────────────────────────────────────────────────────────

test("sesja bezczynna od godziny pisze tak samo jak świeża", async () => {
  /* Regresja na usunięty TTL. Do sierpnia 2026 zapis z takiej sesji dostawał
     423 („Sesja zablokowana — zeskanuj badge"), a kolektor pokazywał wtedy
     pełnoekranową blokadę. Bramka zna dziś dwa stany: jest sesja albo jej nie
     ma. */
  const { token } = bezczynny();

  assert.equal(
    (await app.inject({ url: "/api/metrics", headers: { "x-session": token } })).statusCode,
    200
  );

  const zapis = await app.inject({
    method: "POST",
    url: "/api/products/1/location",
    headers: { "x-session": token },
    payload: { action: "replace", value: "A01-02-03" },
  });
  assert.equal(zapis.statusCode, 200);
});

test("wysyłka z bufora offline przechodzi — inaczej praca znika", async () => {
  /* `OfflineQueue.flush()` na kolektorze opróżnia bufor z tykera co 15 s,
     niezależnie od tego, czy ktoś trzyma urządzenie. Przy odmowie uznaje ją za
     błąd serwera i KASUJE operację z bufora (core/offline/OfflineQueue.kt).
     Po usunięciu blokady nic już tej ścieżki nie odrzuca, ale `x-buffered-user`
     dalej rozstrzyga, KTO podpisuje operację wykonaną poza zasięgiem. */
  const { token, userId } = bezczynny();
  const r = await app.inject({
    method: "POST",
    url: "/api/products/1/location",
    headers: { "x-session": token, "x-buffered-user": String(userId) },
    payload: { action: "replace", value: "A01-02-03" },
  });
  assert.equal(r.statusCode, 200);
});

/* ── Tryb serwisowy jest DOMYŚLNIE WYŁĄCZONY ─────────────────────────────────
   Ten plik NIE ustawia `WERTIS_ADMIN`, więc opisuje instalację, która o trybie
   serwisowym nic nie wie — czyli każdą u klienta. Asercje są tu po to, żeby
   przełącznik nie zaczął kiedyś działać sam z siebie.                        */

test("bez WERTIS_ADMIN konto serwisowe w ogóle nie powstaje", () => {
  /* Sam wiersz w `app_user` jest dowodem, że tryb kiedykolwiek chodził na tej
     instalacji. Gdyby powstawał zawsze, dowód przestałby cokolwiek znaczyć. */
  const n = db()
    .prepare("SELECT COUNT(*) n FROM app_user WHERE name = 'ADMIN (TRYB SERWISOWY)'")
    .get() as { n: number };
  assert.equal(n.n, 0);
});

test("bez WERTIS_ADMIN /api/health nie zgłasza trybu serwisowego", async () => {
  const r = await app.inject({ method: "GET", url: "/api/health" });
  const b = r.json();
  assert.equal(b.adminMode, false);
  assert.ok(
    !(b.problemy ?? []).some((p: string) => p.includes("TRYB SERWISOWY")),
    "ostrzeżenie o trybie nie ma prawa się pojawić"
  );
});

test("bez WERTIS_ADMIN /api/setup milczy o trybie", async () => {
  const b = (await app.inject({ method: "GET", url: "/api/setup" })).json();
  assert.equal(b.adminMode, undefined, "pole nie istnieje, więc kolektor go nie zobaczy");
  assert.equal(b.admin, undefined);
});
