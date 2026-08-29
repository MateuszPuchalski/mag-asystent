import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import type { Rola } from "../services/users.js";

/* ── Trasy zwrotów Allegro ───────────────────────────────────────────────────
   Logika jest przedmiotem `services/zwroty.test.ts`; tutaj bramka ról i pełny
   przepływ przez HTTP na adapterze dev: skan → decyzje → dokument → środki.
   Bramka jest orzekająca — zwroty wiążą się z pieniędzmi klienta, a parowanie
   konta to poświadczenia firmy (wyłącznie admin).                            */

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "wertis-zwrr-")), "t.db");
process.env.LOG_LEVEL = "silent";
process.env.SGT_MODE = "seeded";

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
  const d = db();
  for (const t of ["sprawa_zrodlo", "sprawa", 
    "zwrot_zam_pozycja", "zwrot_pozycja", "zwrot", "sgt_sprzedaz_pozycja", "sgt_sprzedaz",
    "sgt_towar", "sfera_queue", "events", "device_session", "app_user",
  ]) {
    d.prepare(`DELETE FROM ${t}`).run();
  }
  // kartoteki zestrojone z adapterem dev
  const ins = d.prepare("INSERT INTO sgt_towar(tw_id, symbol, nazwa, ean, lokalizacja) VALUES (?,?,?,?, '')");
  ins.run(900_036, "TEST-LINIA-TODO", "Pozycja jeszcze nietknięta", "5900000000036");
  ins.run(900_037, "TEST-LINIA-DONE", "Pozycja odłożona w całości", "5900000000037");
  // FS z numerem zamówienia dev-ord-1 → dopasowanie auto
  d.prepare(
    "INSERT INTO sgt_sprzedaz(dok_id, typ, nr_pelny, nr_oryg, data_wyst, kontrahent, uwagi) VALUES (101,'FS','FS 101/08/2026','dev-ord-1',?, 'ALLEGRO', NULL)"
  ).run(new Date(Date.now() - 8 * 86_400_000).toISOString().slice(0, 10));
  const poz = d.prepare("INSERT INTO sgt_sprzedaz_pozycja(dok_id, tw_id, ilosc) VALUES (101,?,?)");
  poz.run(900_036, 1);
  poz.run(900_037, 2);
});

function zalogowany(rola: Rola): string {
  const u = createUser(`Ktoś ${rola}`, rola, `k${rola}`, "tajnehaslo");
  const token = `tok-${u.userId}-${Math.random().toString(16).slice(2)}`;
  const teraz = new Date().toISOString();
  db()
    .prepare(
      "INSERT INTO device_session(token, user_id, device_id, created_at, last_seen) VALUES (?,?,?,?,?)"
    )
    .run(token, u.userId, "biurko-1", teraz, teraz);
  return token;
}

const TRASY = [
  { method: "POST" as const, url: "/api/biuro/zwroty/skan", body: { kod: "X" } },
  { method: "GET" as const, url: "/api/biuro/zwroty" },
  { method: "GET" as const, url: "/api/biuro/zwroty/licznik" },
  { method: "GET" as const, url: "/api/biuro/zwroty/1" },
  { method: "POST" as const, url: "/api/biuro/zwroty/1/zwrot-srodkow" },
  { method: "POST" as const, url: "/api/biuro/zwroty/1/dokumenty" },
  { method: "POST" as const, url: "/api/biuro/zwroty/reklamacje/1/prowadzi", body: {} },
  { method: "GET" as const, url: "/api/biuro/allegro/status" },
];

test("bez sesji 401 na każdej trasie", async () => {
  for (const t of TRASY) {
    const r = await app.inject({ method: t.method, url: t.url, payload: t.body });
    assert.equal(r.statusCode, 401, t.url);
  }
});

test("magazynier dostaje 403 — zwroty rozlicza biuro", async () => {
  const token = zalogowany("magazynier");
  for (const t of TRASY) {
    const r = await app.inject({
      method: t.method, url: t.url, payload: t.body, headers: { "x-session": token },
    });
    assert.equal(r.statusCode, 403, t.url);
  }
});

test("parowanie konta Allegro — biuro 403, admin przechodzi bramkę", async () => {
  const biuro = zalogowany("biuro");
  let r = await app.inject({
    method: "POST", url: "/api/biuro/allegro/parowanie", headers: { "x-session": biuro },
  });
  assert.equal(r.statusCode, 403);

  const admin = zalogowany("admin");
  r = await app.inject({
    method: "POST", url: "/api/biuro/allegro/parowanie", headers: { "x-session": admin },
  });
  // tryb dev nie paruje niczego — czytelna odmowa zamiast strzału w sieć
  assert.equal(r.statusCode, 400);
  assert.match(r.json().error, /dev/);
});

test("pełny przepływ: skan → decyzje → dokument auto → środki → rozliczony", async () => {
  const token = zalogowany("biuro");
  const naglowki = { "x-session": token };

  let r = await app.inject({
    method: "POST", url: "/api/biuro/zwroty/skan", payload: { kod: "DEVWB0001" }, headers: naglowki,
  });
  assert.equal(r.statusCode, 201);
  const zwrot = r.json().zwrot;
  assert.equal(zwrot.status, "nowy");
  assert.equal(zwrot.dokument.dokId, 101, "FS z numerem zamówienia miał wejść sam");
  assert.equal(zwrot.dokument.dopasowanie, "auto");

  // drugi skan → istniejący, nie duplikat
  r = await app.inject({
    method: "POST", url: "/api/biuro/zwroty/skan", payload: { kod: "DEVWB0001" }, headers: naglowki,
  });
  assert.equal(r.statusCode, 200);
  assert.equal(r.json().istniejacy, true);

  // środki przed oceną — odmowa
  r = await app.inject({
    method: "POST", url: `/api/biuro/zwroty/${zwrot.id}/zwrot-srodkow`, headers: naglowki,
  });
  assert.equal(r.statusCode, 400);

  for (const [i, decyzja] of [["pelnowartosciowy"], ["reklamacja"]].entries()) {
    r = await app.inject({
      method: "POST",
      url: `/api/biuro/zwroty/${zwrot.id}/pozycje/${zwrot.pozycje[i].id}/decyzja`,
      payload: { decyzja: decyzja[0], notatka: i ? "rysa" : undefined },
      headers: naglowki,
    });
    assert.equal(r.statusCode, 200, `decyzja ${i}`);
  }
  assert.equal(
    (await app.inject({ method: "GET", url: `/api/biuro/zwroty/${zwrot.id}`, headers: naglowki }))
      .json().zwrot.status,
    "oceniony"
  );

  r = await app.inject({
    method: "POST", url: `/api/biuro/zwroty/${zwrot.id}/zwrot-srodkow`, headers: naglowki,
  });
  assert.equal(r.statusCode, 200);
  assert.equal(r.json().zwrot.status, "rozliczony");

  // lista pokazuje rozliczony z licznikami
  r = await app.inject({ method: "GET", url: "/api/biuro/zwroty?status=rozliczony", headers: naglowki });
  assert.equal(r.json().zwroty.length, 1);
  assert.equal(r.json().zwroty[0].ocenionych, 2);
});

test("etykieta nieznana: 404 z mozliwyReczny, potem ścieżka ręczna z pozycją", async () => {
  const token = zalogowany("biuro");
  const naglowki = { "x-session": token };

  let r = await app.inject({
    method: "POST", url: "/api/biuro/zwroty/skan", payload: { kod: "OBCA-9" }, headers: naglowki,
  });
  assert.equal(r.statusCode, 404);
  assert.equal(r.json().mozliwyReczny, true);

  r = await app.inject({
    method: "POST", url: "/api/biuro/zwroty", payload: { reczny: true, waybill: "OBCA-9" }, headers: naglowki,
  });
  assert.equal(r.statusCode, 201);
  const id = r.json().zwrot.id;

  r = await app.inject({
    method: "POST", url: `/api/biuro/zwroty/${id}/pozycje`,
    payload: { twId: 900_036, ilosc: 1 }, headers: naglowki,
  });
  assert.equal(r.statusCode, 200);
  assert.equal(r.json().zwrot.pozycje.length, 1);
});

test("ręczny wybór dokumentu i cofnięcie wraca do kandydatów", async () => {
  const token = zalogowany("biuro");
  const naglowki = { "x-session": token };
  // zdejmujemy sygnał auto — zostaje sama nakładka pozycji na dwóch dokumentach
  db().prepare("UPDATE sgt_sprzedaz SET nr_oryg = NULL").run();
  db()
    .prepare(
      "INSERT INTO sgt_sprzedaz(dok_id, typ, nr_pelny, nr_oryg, data_wyst, kontrahent, uwagi) VALUES (102,'PA','PA 102/08/2026',NULL,?, 'DETAL', NULL)"
    )
    .run(new Date(Date.now() - 15 * 86_400_000).toISOString().slice(0, 10));
  const poz = db().prepare("INSERT INTO sgt_sprzedaz_pozycja(dok_id, tw_id, ilosc) VALUES (102,?,?)");
  poz.run(900_036, 1);
  poz.run(900_037, 2);

  let r = await app.inject({
    method: "POST", url: "/api/biuro/zwroty/skan", payload: { kod: "DEVWB0001" }, headers: naglowki,
  });
  const zwrot = r.json().zwrot;
  assert.equal(zwrot.dokument, null);
  assert.equal(zwrot.kandydaciDokumentu.length, 2);

  r = await app.inject({
    method: "PUT", url: `/api/biuro/zwroty/${zwrot.id}/dokument`,
    payload: { dokId: 102 }, headers: naglowki,
  });
  assert.equal(r.json().zwrot.dokument.dopasowanie, "reczne");

  r = await app.inject({
    method: "DELETE", url: `/api/biuro/zwroty/${zwrot.id}/dokument`, headers: naglowki,
  });
  assert.equal(r.json().zwrot.dokument, null);
  assert.ok(r.json().zwrot.kandydaciDokumentu.length >= 2);
});

test("status konta Allegro w trybie dev mówi wprost: adapter fikcyjny", async () => {
  const token = zalogowany("biuro");
  const r = await app.inject({ method: "GET", url: "/api/biuro/allegro/status", headers: { "x-session": token } });
  assert.equal(r.statusCode, 200);
  assert.equal(r.json().stan, "dev");
  assert.equal(r.json().tryb, "dev");
});

test("korekta z MM: zlecenie jednym POST-em, potem karta odmawia zmian", async () => {
  /* Cała ścieżka Etapu 2 przez HTTP: decyzje → zlecenie dokumentów → zadanie
     w kolejce. Ostatni krok jest tu najważniejszy — po zleceniu decyzja NIE
     wraca do edycji, bo korekta poszła na treść z chwili kliknięcia. */
  const token = zalogowany("biuro");
  const naglowki = { "x-session": token };

  let r = await app.inject({
    method: "POST", url: "/api/biuro/zwroty/skan", payload: { kod: "DEVWB0001" }, headers: naglowki,
  });
  const zwrot = r.json().zwrot;
  for (const p of zwrot.pozycje) {
    await app.inject({
      method: "POST",
      url: `/api/biuro/zwroty/${zwrot.id}/pozycje/${p.id}/decyzja`,
      payload: { decyzja: "pelnowartosciowy" },
      headers: naglowki,
    });
  }

  r = await app.inject({
    method: "POST", url: `/api/biuro/zwroty/${zwrot.id}/dokumenty`, headers: naglowki,
  });
  assert.equal(r.statusCode, 200);
  const dok = r.json().zwrot.dokumenty;
  assert.equal(dok.stan, "w_kolejce");
  assert.equal(dok.pozycje.length, 2);

  const zadanie = db()
    .prepare("SELECT type, created_by FROM sfera_queue WHERE id = ?")
    .get(dok.queueId) as { type: string; created_by: string };
  assert.equal(zadanie.type, "korekta_zwrot");
  assert.match(zadanie.created_by, /biuro/, "autor zlecenia idzie z sesji");

  r = await app.inject({
    method: "POST",
    url: `/api/biuro/zwroty/${zwrot.id}/pozycje/${zwrot.pozycje[0].id}/decyzja`,
    payload: { decyzja: "reklamacja" },
    headers: naglowki,
  });
  assert.equal(r.statusCode, 400);
  assert.match(r.json().error, /zlecone/i);
});

test("licznik uwagi i jawne przejęcie reklamacji przez HTTP", async () => {
  const biuro = { "x-session": zalogowany("biuro") };

  // reklamacja po terminie + świeża — pigułka liczy tylko przeterminowane
  const d = db();
  const zwrot = d
    .prepare(
      `INSERT INTO zwrot(waybill, status, utworzono_allegro, utworzono_at, utworzono_przez)
       VALUES ('WB-LICZ', 'oceniony', ?, ?, 'Test')`
    )
    .run(
      new Date(Date.now() - 20 * 86_400_000).toISOString(),
      new Date().toISOString()
    );
  const pozycja = d
    .prepare(
      `INSERT INTO zwrot_pozycja(zwrot_id, nazwa, ilosc, decyzja)
       VALUES (?, 'Uszkodzona piła', 1, 'reklamacja')`
    )
    .run(Number(zwrot.lastInsertRowid));
  const pozycjaId = Number(pozycja.lastInsertRowid);

  let r = await app.inject({ method: "GET", url: "/api/biuro/zwroty/licznik", headers: biuro });
  assert.equal(r.statusCode, 200);
  assert.deepEqual(r.json(), {
    reklamacjeOtwarte: 1,
    reklamacjePoTerminie: 1,
    dyskusjeNowe: 0,
    dyskusjeClaimyPoTerminie: 0,
  });

  r = await app.inject({
    method: "POST", url: `/api/biuro/zwroty/reklamacje/${pozycjaId}/prowadzi`,
    payload: {}, headers: biuro,
  });
  assert.equal(r.statusCode, 200);
  const wiersz = r.json().reklamacje.find(
    (x: { pozycjaId: number }) => x.pozycjaId === pozycjaId
  );
  assert.match(wiersz.prowadzi, /biuro/, "nazwisko z sesji, jak przy zleceniu korekty");

  r = await app.inject({
    method: "POST", url: "/api/biuro/zwroty/reklamacje/999999/prowadzi",
    payload: {}, headers: biuro,
  });
  assert.equal(r.statusCode, 404);
});
