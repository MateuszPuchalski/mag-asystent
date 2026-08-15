import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import type { Rola } from "../services/users.js";

/* ── Trasy zbiórek i strefy złotej ───────────────────────────────────────────
   Rachunek jest przedmiotem `services/zbiorki.test.ts`; tutaj bramka, ślad
   i pełny łańcuch: import → adnotacja wyjeżdża z `/api/products/:twId`.
   Bramka jest tu orzekająca — import podmienia dane, z których liczą się
   adnotacje na kartach całej kartoteki, a reguły strefy decydują, kto w ogóle
   może być kandydatem.                                                       */

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "wertis-zbrr-")), "t.db");
process.env.LOG_LEVEL = "silent";
process.env.MAG_ID_MAG = "1";
process.env.MAG_ID_MGP = "2";
process.env.MAG_ID_ZWROTY = "3";

let app: FastifyInstance;
let db: typeof import("../db/db.js").db;
let createUser: typeof import("../services/users.js").createUser;
let zresetujKandydatow: typeof import("../services/zbiorki.js").zresetujKandydatow;
let zapiszReguly: typeof import("../services/strefa-zlota.js").zapiszReguly;
/** Ziarno reguł — odtwarzane przed każdym testem, bo PUT je podmienia. */
let ziarno: Array<{ alejka?: string; od?: string; do?: string; poziomy: string }>;

before(async () => {
  ({ db } = await import("../db/db.js"));
  ({ createUser } = await import("../services/users.js"));
  ({ zresetujKandydatow } = await import("../services/zbiorki.js"));
  const S = await import("../services/strefa-zlota.js");
  ({ zapiszReguly } = S);
  ziarno = S.regulyStrefy().map((r) => ({
    ...(r.alejka ? { alejka: r.alejka } : {}),
    ...(r.od ? { od: r.od } : {}),
    ...(r.do ? { do: r.do } : {}),
    poziomy: r.poziomy.join(","),
  }));
  const { buildApp } = await import("../index.js");
  app = await buildApp();
});

beforeEach(() => {
  const d = db();
  for (const t of ["zbiorka", "sgt_towar", "events", "device_session", "app_user"]) {
    d.prepare(`DELETE FROM ${t}`).run();
  }
  d.prepare(
    "INSERT INTO sgt_towar(tw_id, symbol, nazwa, ean, lokalizacja) VALUES (1,'W32-0203','Kosa spalinowa','5901234567890','A01-01-05')"
  ).run();
  zapiszReguly(ziarno);
  zresetujKandydatow();
});

function zalogowany(rola: Rola): string {
  const u = createUser(`Ktoś ${rola}`, rola, `k${rola}`, "tajnehaslo");
  const token = `tok-${u.userId}-${Math.random().toString(16).slice(2)}`;
  const teraz = new Date().toISOString();
  db()
    .prepare(
      "INSERT INTO device_session(token, user_id, device_id, created_at, last_seen) VALUES (?,?,?,?,?)"
    )
    .run(token, u.userId, "kolektor-7", teraz, teraz);
  return token;
}

const CSV = [
  "ID Koszyka,Data zebrania,EAN,Symbol,Ilość",
  "5001,2026-08-10,,W32-0203,1",
  "5002,2026-08-10,,W32-0203,1",
  "5003,2026-08-10,,W32-0203,2",
].join("\r\n");

const TRASY = [
  { method: "POST" as const, url: "/api/biuro/zbiorki/import", body: { csv: CSV } },
  { method: "GET" as const, url: "/api/biuro/zbiorki/kandydaci" },
  { method: "GET" as const, url: "/api/biuro/zbiorki/kandydaci/csv" },
  { method: "GET" as const, url: "/api/biuro/strefa" },
  { method: "PUT" as const, url: "/api/biuro/strefa", body: { reguly: [{ alejka: "A", poziomy: "2" }] } },
];

test("bez sesji 401 na każdej trasie — import i reguły orzekają o magazynie", async () => {
  for (const t of TRASY) {
    const r = await app.inject({ method: t.method, url: t.url, payload: t.body });
    assert.equal(r.statusCode, 401, t.url);
  }
});

test("magazynier dostaje 403 — to operacje biura, nie hali", async () => {
  const token = zalogowany("magazynier");
  for (const t of TRASY) {
    const r = await app.inject({
      method: t.method, url: t.url, payload: t.body, headers: { "x-session": token },
    });
    assert.equal(r.statusCode, 403, `${t.method} ${t.url}`);
  }
});

test("pełny łańcuch: import → kandydat na liście → adnotacja na karcie towaru", async () => {
  const token = zalogowany("biuro");
  const imp = await app.inject({
    method: "POST", url: "/api/biuro/zbiorki/import",
    payload: { csv: CSV }, headers: { "x-session": token },
  });
  assert.equal(imp.statusCode, 200);
  const w = imp.json();
  assert.equal(w.wierszy, 3);
  assert.equal(w.nowych, 3);
  assert.equal(w.niedopasowanych, 0);
  assert.deepEqual(w.okres, { od: "2026-08-10", do: "2026-08-10" });

  // ślad: kto wgrał i ile — import podmienia dane decyzyjne, więc zostawia wpis
  const ev = db()
    .prepare("SELECT payload FROM events WHERE type = 'zbiorki_import'")
    .get() as { payload: string };
  assert.match(ev.payload, /"wierszy":3/);

  const kand = (await app.inject({
    method: "GET", url: "/api/biuro/zbiorki/kandydaci", headers: { "x-session": token },
  })).json();
  assert.equal(kand.kandydaci.length, 1);
  assert.equal(kand.kandydaci[0].sym, "W32-0203");
  assert.equal(kand.kandydaci[0].poziomy, "2 albo 3 albo 4");

  // adnotacja wyjeżdża TRASĄ karty — kolektor nie widzi serwisów, widzi JSON
  const karta = (await app.inject({
    method: "GET", url: "/api/products/1", headers: { "x-session": token },
  })).json();
  assert.deepEqual(karta.zlotaStrefa, { zbiorekNaDzien: 3, poziomy: "2 albo 3 albo 4" });
});

test("towar poniżej progu albo w strefie NIE dostaje pola na karcie", async () => {
  const token = zalogowany("biuro");
  // drugi towar w strefie złotej (poziom 3) zbierany częściej — on ustawia próg
  db().prepare(
    "INSERT INTO sgt_towar(tw_id, symbol, nazwa, ean, lokalizacja) VALUES (2,'W-ZLOTY','Nóż','','A01-01-03')"
  ).run();
  const wiersze = ["ID Koszyka,Data zebrania,EAN,Symbol,Ilość"];
  for (let i = 0; i < 20; i++) wiersze.push(`${6000 + i},2026-08-10,,W-ZLOTY,1`);
  wiersze.push("7001,2026-08-10,,W32-0203,1");
  await app.inject({
    method: "POST", url: "/api/biuro/zbiorki/import",
    payload: { csv: wiersze.join("\r\n") }, headers: { "x-session": token },
  });

  for (const twId of [1, 2]) {
    const karta = (await app.inject({
      method: "GET", url: `/api/products/${twId}`, headers: { "x-session": token },
    })).json();
    assert.equal("zlotaStrefa" in karta, false, `tw ${twId}`);
  }
});

test("zły plik to 400 z komunikatem, nie 500 — i nic nie wchodzi do bazy", async () => {
  const token = zalogowany("biuro");
  for (const csv of ["Symbol,EAN\r\nW32-0203,590", "5001,2026-08-10,,OBCY,1"]) {
    const r = await app.inject({
      method: "POST", url: "/api/biuro/zbiorki/import",
      payload: { csv: `${csv}` }, headers: { "x-session": token },
    });
    assert.equal(r.statusCode, 400);
    assert.ok(r.json().error);
  }
  const r = await app.inject({
    method: "POST", url: "/api/biuro/zbiorki/import",
    payload: { nie: "to" }, headers: { "x-session": token },
  });
  assert.equal(r.statusCode, 400);
  assert.equal((db().prepare("SELECT COUNT(*) AS n FROM zbiorka").get() as { n: number }).n, 0);
});

test("eksport CSV kandydatów: BOM, średniki i nagłówek — otwiera się w Excelu", async () => {
  const token = zalogowany("biuro");
  await app.inject({
    method: "POST", url: "/api/biuro/zbiorki/import",
    payload: { csv: CSV }, headers: { "x-session": token },
  });
  const r = await app.inject({
    method: "GET", url: "/api/biuro/zbiorki/kandydaci/csv", headers: { "x-session": token },
  });
  assert.equal(r.statusCode, 200);
  assert.match(r.headers["content-disposition"] as string, /wertis-strefa-kandydaci\.csv/);
  assert.ok(r.body.startsWith("﻿"), "BOM dla Excela");
  assert.match(r.body, /symbol;nazwa;zbiorki/);
  assert.match(r.body, /W32-0203;Kosa spalinowa;3;3;A01-01-05/);
});

test("GET/PUT reguł: walidacja wskazuje wiersz, zapis przelicza kandydatów", async () => {
  const token = zalogowany("biuro");
  await app.inject({
    method: "POST", url: "/api/biuro/zbiorki/import",
    payload: { csv: CSV }, headers: { "x-session": token },
  });

  const przed = (await app.inject({
    method: "GET", url: "/api/biuro/strefa", headers: { "x-session": token },
  })).json();
  assert.equal(przed.reguly.length, 10, "ziarno z notatek właściciela");

  const zle = await app.inject({
    method: "PUT", url: "/api/biuro/strefa",
    payload: { reguly: [{ alejka: "A", poziomy: "2" }, { od: "D01", do: "E05", poziomy: "2" }] },
    headers: { "x-session": token },
  });
  assert.equal(zle.statusCode, 400);
  assert.match(zle.json().error, /Reguła 2/);

  const ok = await app.inject({
    method: "PUT", url: "/api/biuro/strefa",
    payload: { reguly: [{ alejka: "A", poziomy: "5" }] }, headers: { "x-session": token },
  });
  assert.equal(ok.statusCode, 200);

  // poziom 5 stał się złoty, więc W32-0203 (A01-01-05) przestał być kandydatem
  const kand = (await app.inject({
    method: "GET", url: "/api/biuro/zbiorki/kandydaci", headers: { "x-session": token },
  })).json();
  assert.deepEqual(kand.kandydaci, []);
  assert.equal(kand.juzWStrefie, 1);

  const ev = db()
    .prepare("SELECT payload FROM events WHERE type = 'strefa_zapis'")
    .get() as { payload: string };
  assert.match(ev.payload, /"regul":1/);
});
