import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { FastifyInstance } from "fastify";

/* ── Ślad audytowy: odczyt i to, co NIE MOŻE się w nim znaleźć ───────────────
   Log powstał po to, żeby odpowiedzieć na reklamację „aplikacja zjadła mi 30
   sztuk" faktem, a nie hipotezą. Ten plik pilnuje trzech rzeczy naraz:

   1. że filtr zwraca dokładnie to, o co poproszono — bo audyt, który gubi albo
      dokłada wiersze, jest gorszy od jego braku: prowadzi do pewnego wniosku
      z niepewnych danych,
   2. że hala go nie ogląda — log mówi, kto ile zeskanował, więc jest narzędziem
      nadzoru i ma bramkę na rolę,
   3. że NIE WYCIEKAJĄ HASŁA. To asercja bezpieczeństwa, nie kosmetyka:
      `http_rejected` zapisuje odrzucone żądania, a przez `/api/users`
      przechodzi hasło zakładanego konta. Log audytowy z hasłami w środku jest
      gorszy niż brak logu.                                                   */

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "wertis-audyt-")), "t.db");
process.env.LOG_LEVEL = "silent";

let app: FastifyInstance;
let db: typeof import("../db/db.js").db;
let createUser: typeof import("../services/users.js").createUser;
type Rola = import("../services/users.js").Rola;

before(async () => {
  ({ db } = await import("../db/db.js"));
  ({ createUser } = await import("../services/users.js"));
  const { buildApp } = await import("../index.js");
  app = await buildApp();
});

beforeEach(() => {
  for (const t of ["events", "device_session", "app_user", "sfera_queue"]) {
    db().prepare(`DELETE FROM ${t}`).run();
  }
  db()
    .prepare(
      "INSERT OR REPLACE INTO sgt_towar(tw_id, symbol, nazwa, ean, lokalizacja) VALUES (1,'W32-0203','Testowy','5901234567890','')"
    )
    .run();
});

function zalogowany(rola: Rola): { token: string; userId: number } {
  const u = createUser(`Ktoś ${rola}`, rola, `k${rola}`, "tajnehaslo");
  const token = `tok-${u.userId}-${Math.random().toString(16).slice(2)}`;
  const teraz = new Date().toISOString();
  db()
    .prepare(
      "INSERT INTO device_session(token, user_id, device_id, created_at, last_seen) VALUES (?,?,?,?,?)"
    )
    .run(token, u.userId, "kolektor-7", teraz, teraz);
  return { token, userId: u.userId };
}

/** Zdarzenie wprost w bazie — testy filtra nie mają udawać ruchu aplikacji. */
function zdarzenie(o: {
  typ: string;
  twId?: number | null;
  userRef?: number | null;
  device?: string | null;
  czas?: string;
  payload?: unknown;
}) {
  db()
    .prepare(
      "INSERT INTO events(type, tw_id, payload, user_id, device_id, user_ref, created_at) VALUES (?,?,?,?,?,?,?)"
    )
    .run(
      o.typ,
      o.twId ?? null,
      o.payload === undefined ? null : JSON.stringify(o.payload),
      "Ktoś",
      o.device ?? null,
      o.userRef ?? null,
      o.czas ?? new Date().toISOString()
    );
}

const get = (url: string, token: string) =>
  app.inject({ method: "GET", url, headers: { "x-session": token } });

// ── Bramka ──────────────────────────────────────────────────────────────────

test("magazynier NIE widzi śladu audytowego", async () => {
  const { token } = zalogowany("magazynier");
  assert.equal((await get("/api/events", token)).statusCode, 403);
  assert.equal((await get("/api/events/csv", token)).statusCode, 403);
});

test("brygadzista i biuro widzą", async () => {
  assert.equal((await get("/api/events", zalogowany("brygadzista").token)).statusCode, 200);
  assert.equal((await get("/api/events", zalogowany("biuro").token)).statusCode, 200);
});

test("bez sesji nie ma audytu", async () => {
  const r = await app.inject({ method: "GET", url: "/api/events" });
  assert.equal(r.statusCode, 401);
});

// ── Filtr ───────────────────────────────────────────────────────────────────

test("filtr po towarze zwraca TYLKO jego zdarzenia", async () => {
  const { token } = zalogowany("biuro");
  zdarzenie({ typ: "location_set", twId: 1 });
  zdarzenie({ typ: "location_set", twId: 2 });
  const r = await get("/api/events?twId=1", token);
  const b = r.json();
  assert.equal(b.wpisy.length, 1);
  assert.equal(b.wpisy[0].twId, 1);
});

test("zakres dat obejmuje CAŁY dzień końcowy", async () => {
  /* Reguła najłatwiejsza do ustawienia odwrotnie: `do=2026-07-20` porównane
     z pełnym znacznikiem czasu odcięłoby wszystko po północy, czyli dokładnie
     ten dzień, o który człowiek pytał. */
  const { token } = zalogowany("biuro");
  zdarzenie({ typ: "scan", czas: "2026-07-20T15:30:00.000Z" });
  zdarzenie({ typ: "scan", czas: "2026-07-21T08:00:00.000Z" });
  const b = (await get("/api/events?od=2026-07-20&do=2026-07-20", token)).json();
  assert.equal(b.wpisy.length, 1, "zdarzenie z popołudnia dnia końcowego MA wejść");
  assert.equal(b.razem, 1);
});

test("filtr po typie i po urządzeniu", async () => {
  const { token } = zalogowany("biuro");
  zdarzenie({ typ: "scan", device: "kolektor-1" });
  zdarzenie({ typ: "queue_failed", device: "kolektor-1" });
  zdarzenie({ typ: "scan", device: "kolektor-2" });
  assert.equal((await get("/api/events?typ=queue_failed", token)).json().wpisy.length, 1);
  assert.equal((await get("/api/events?device=kolektor-2", token)).json().wpisy.length, 1);
  assert.equal((await get("/api/events?typ=scan,queue_failed", token)).json().wpisy.length, 3);
});

test("`razem` liczy WSZYSTKIE pasujące, nie długość strony", async () => {
  // bez tego czytelnik widzi 2 wiersze i nie wie, czy to komplet
  const { token } = zalogowany("biuro");
  for (let i = 0; i < 5; i++) zdarzenie({ typ: "scan" });
  const b = (await get("/api/events?limit=2", token)).json();
  assert.equal(b.wpisy.length, 2);
  assert.equal(b.razem, 5);
});

test("limit ponad sufit jest PRZYCINANY, nie odrzucany", async () => {
  const { token } = zalogowany("biuro");
  for (let i = 0; i < 3; i++) zdarzenie({ typ: "scan" });
  const r = await get("/api/events?limit=999999", token);
  assert.equal(r.statusCode, 200, "pomyłka w skrypcie nie ma kończyć się błędem");
  assert.equal(r.json().wpisy.length, 3);
});

// ── CSV ─────────────────────────────────────────────────────────────────────

test("CSV: nagłówki, BOM i typ treści", async () => {
  const { token } = zalogowany("biuro");
  zdarzenie({ typ: "location_set", payload: { result: "A01, B02" } });
  const r = await get("/api/events/csv", token);
  assert.equal(r.statusCode, 200);
  assert.match(r.headers["content-type"] as string, /text\/csv/);
  assert.match(r.body, /^﻿id,czas,typ/, "BOM, inaczej Excel psuje polskie znaki");
  // przecinek w payloadzie NIE MOŻE rozbić wiersza na dodatkowe kolumny
  assert.match(r.body, /,"\{""result"":""A01, B02""\}"/);
});

test("cytowanie CSV wg RFC 4180 — przecinek, cudzysłów, nowa linia", async () => {
  /* Reguła sprawdzana WPROST na funkcji, nie przez trasę: payload z bazy jest
     JSON-em, więc cudzysłowy są w nim już eskejpowane backslashem i asercja na
     surowym wyniku trasy sprawdzałaby dwie reguły naraz, myląc je ze sobą. */
  const { csv } = await import("../services/audyt.js");
  const wiersz = {
    id: 1,
    typ: "t",
    czas: "2026-07-29",
    uzytkownik: 'Jan "Janek", Kowalski',
    userRef: null,
    device: null,
    twId: null,
    payload: "linia1\nlinia2",
  };
  const out = csv([wiersz]);
  assert.match(out, /"Jan ""Janek"", Kowalski"/, "cudzysłów podwojony, całość cytowana");
  assert.match(out, /"linia1\nlinia2"/, "nowa linia w polu musi zostać ocytowana");
});

test("eksport sam trafia do śladu — kto wyniósł log, jest w logu", async () => {
  const { token } = zalogowany("biuro");
  zdarzenie({ typ: "scan" });
  await get("/api/events/csv", token);
  const n = db()
    .prepare("SELECT COUNT(*) AS n FROM events WHERE type = 'audyt_eksport'")
    .get() as { n: number };
  assert.equal(n.n, 1);
});

// ── Odrzucone żądania ───────────────────────────────────────────────────────

test("odrzucony zapis zostawia ślad z powodem", async () => {
  const { token } = zalogowany("brygadzista");
  const r = await app.inject({
    method: "POST",
    url: "/api/products/1/location",
    headers: { "x-session": token },
    payload: { action: "replace", value: "TO-NIE-JEST-KOD-POLKI!!!" },
  });
  assert.equal(r.statusCode, 400);
  const w = db()
    .prepare("SELECT payload FROM events WHERE type = 'http_rejected' ORDER BY id DESC LIMIT 1")
    .get() as { payload: string } | undefined;
  assert.ok(w, "odrzucenie MUSI zostawić ślad — inaczej „skanowałem i nie zapisało się\" jest bez odpowiedzi");
  const p = JSON.parse(w.payload);
  assert.equal(p.status, 400);
  assert.equal(p.sciezka, "/api/products/1/location");
  assert.ok(p.powod, "bez powodu wpis nie odpowiada na żadne pytanie");
});

test("401 na GET to szum pollingu i NIE jest logowane, na POST jest", async () => {
  await app.inject({ method: "GET", url: "/api/queue" });
  assert.equal(liczba("http_rejected"), 0, "karta odpytuje co 2 s — to utopiłoby audyt");

  await app.inject({ method: "POST", url: "/api/products/1/location", payload: {} });
  assert.equal(liczba("http_rejected"), 1, "próba ZAPISU bez sesji to zdarzenie, nie szum");
});

test("ślad odrzucenia NIE zawiera ciała żądania — hasło nie ma prawa tam trafić", async () => {
  /* `POST /api/users` przy niepustej bazie odrzuca bez sesji, a w ciele niesie
     hasło zakładanego konta. To jest ten moment, w którym nieostrożny audyt
     zapisuje hasła na zawsze. */
  zalogowany("biuro"); // baza przestaje być pusta, więc trasa odmawia
  await app.inject({
    method: "POST",
    url: "/api/users",
    payload: { name: "Ktoś Nowy", role: "biuro", login: "nowy", haslo: "sekret9137" },
  });
  const wiersze = db()
    .prepare("SELECT payload FROM events WHERE type = 'http_rejected'")
    .all() as Array<{ payload: string }>;
  assert.ok(wiersze.length > 0, "odrzucenie ma zostawić ślad");
  for (const w of wiersze) {
    assert.doesNotMatch(w.payload, /sekret9137/, "hasło w śladzie audytowym");
    assert.doesNotMatch(w.payload, /haslo/);
  }
});

// ── Meldunek kolektora ──────────────────────────────────────────────────────

test("kolektor melduje operację, której nie dało się wykonać", async () => {
  const { token } = zalogowany("magazynier");
  const r = await app.inject({
    method: "POST",
    url: "/api/events/kolektor",
    headers: { "x-session": token },
    payload: {
      operacje: [
        { rodzaj: "SET_LOCATION", twId: 1, powod: "Nieznana akcja", status: 400, proby: 1, at: "2026-07-29T06:00:00.000Z" },
      ],
    },
  });
  assert.equal(r.statusCode, 200);
  const w = db()
    .prepare("SELECT tw_id, payload FROM events WHERE type = 'klient_odrzucona'")
    .get() as { tw_id: number; payload: string };
  assert.equal(w.tw_id, 1);
  const p = JSON.parse(w.payload);
  // czas WYKONANIA, nie dosłania — operacja mogła czekać w buforze godzinami
  assert.equal(p.wykonanoNaKolektorze, "2026-07-29T06:00:00.000Z");
  assert.equal(p.status, 400);
});

test("meldunek bez operacji i przeładowany są odrzucane", async () => {
  const { token } = zalogowany("magazynier");
  const wyslij = (payload: object) =>
    app.inject({ method: "POST", url: "/api/events/kolektor", headers: { "x-session": token }, payload });
  assert.equal((await wyslij({ operacje: [] })).statusCode, 400);
  assert.equal((await wyslij({ operacje: new Array(500).fill({ rodzaj: "X" }) })).statusCode, 400);
});

function liczba(typ: string): number {
  return (
    db().prepare("SELECT COUNT(*) AS n FROM events WHERE type = ?").get(typ) as { n: number }
  ).n;
}
