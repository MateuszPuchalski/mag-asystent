import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/* ── Encja sprawy — rekoncyliacja ────────────────────────────────────────────
   Sedno modelu: sklejanie automatyczne WYŁĄCZNIE po order_id (dwa pytania
   jednego klienta to dwie sprawy), stabilne id sprawy między przebiegami
   (na id staną zdarzenia etapu D) i idempotencja pełnej przebudowy.         */

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "wertis-encja-")), "t.db");
process.env.SGT_MODE = "seeded";

let db: typeof import("../db/db.js").db;
let S: typeof import("./sprawa.js");

before(async () => {
  ({ db } = await import("../db/db.js"));
  S = await import("./sprawa.js");
});

beforeEach(() => {
  const d = db();
  for (const t of ["sprawa_zrodlo", "sprawa", "zwrot_pozycja", "zwrot", "dyskusja", "pytanie", "events"]) {
    d.prepare(`DELETE FROM ${t}`).run();
  }
});

const dzis = "2026-08-20T10:00:00.000Z";

function pytanie(login: string | null, id?: string | null): number {
  const w = db()
    .prepare(
      `INSERT INTO pytanie (zrodlo, thread_id, wiadomosc_id, kupujacy_login, kupujacy_id,
         tresc, otrzymano_at, status, utworzono_at, utworzono_przez)
       VALUES ('allegro', ?, ?, ?, ?, 'treść', ?, 'nowe', ?, 'sync')`
    )
    .run(`t-${Math.random()}`, `w-${Math.random()}`, login, id ?? null, dzis, dzis);
  return Number(w.lastInsertRowid);
}

function zwrot(orderId: string | null, login = "jan_wraca", kupujacyId: string | null = "44300001"): number {
  const w = db()
    .prepare(
      `INSERT INTO zwrot (allegro_order_id, kupujacy_login, kupujacy_id, waybill, status,
         utworzono_at, utworzono_przez)
       VALUES (?, ?, ?, ?, 'nowy', ?, 'Test')`
    )
    .run(orderId, login, kupujacyId, `WB-${Math.random()}`, dzis);
  return Number(w.lastInsertRowid);
}

function dyskusja(orderId: string | null, login = "jan_wraca"): number {
  const w = db()
    .prepare(
      `INSERT INTO dyskusja (allegro_id, typ, status, temat, kupujacy_login, order_id,
         widziano_at, utworzono_at)
       VALUES (?, 'DISCUSSION', 'nowa', 'temat', ?, ?, ?, ?)`
    )
    .run(`iss-${Math.random()}`, login, orderId, dzis, dzis);
  return Number(w.lastInsertRowid);
}

function reklamacja(zwrotId: number): number {
  const w = db()
    .prepare(
      `INSERT INTO zwrot_pozycja (zwrot_id, nazwa, ilosc, decyzja)
       VALUES (?, 'Towar', 1, 'reklamacja')`
    )
    .run(zwrotId);
  return Number(w.lastInsertRowid);
}

function sprawy(): Array<Record<string, unknown>> {
  return db().prepare("SELECT * FROM sprawa ORDER BY id").all() as Array<Record<string, unknown>>;
}

test("auto-sklejanie WYŁĄCZNIE po order_id; dwa pytania jednego klienta to dwie sprawy", () => {
  const z = zwrot("zam-1");
  dyskusja("zam-1");
  reklamacja(z);
  pytanie("client:44300001", "44300001");
  pytanie("client:44300001", "44300001");
  S.przebudujSprawy();

  const lista = sprawy();
  assert.equal(lista.length, 3, "zam-1 skleja trójkę; pytania zostają osobno mimo tego samego kupującego");
  const zamowienie = lista.find((s) => s.order_id === "zam-1")!;
  const zrodla = db()
    .prepare("SELECT rodzaj FROM sprawa_zrodlo WHERE sprawa_id = ? ORDER BY rodzaj")
    .all(zamowienie.id as number) as Array<{ rodzaj: string }>;
  assert.deepEqual(zrodla.map((x) => x.rodzaj), ["dyskusja", "reklamacja", "zwrot"]);
  assert.equal(zamowienie.kupujacy_id, "44300001");
  assert.equal(zamowienie.kupujacy_login, "jan_wraca", "prawdziwy login przed maską");
});

test("rekoncyliacja jest idempotentna i nie zmienia id spraw", () => {
  const z = zwrot("zam-7");
  S.przebudujSprawy();
  const przed = sprawy();
  const idZwrotu = przed[0].id as number;

  /* Dołącza dyskusja tego samego zamówienia — sprawa ma zostać TA SAMA. */
  dyskusja("zam-7");
  db().prepare("UPDATE sprawa SET prowadzi = 'anna', prowadzi_at = ? WHERE id = ?").run(dzis, idZwrotu);
  S.przebudujSprawy();
  S.przebudujSprawy();

  const po = sprawy();
  assert.equal(po.length, 1);
  assert.equal(po[0].id, idZwrotu, "grupa przejmuje sprawę o najmniejszym id");
  assert.equal(po[0].prowadzi, "anna", "prowadzący przeżywa dołączenie źródła");
  const wiazan = db().prepare("SELECT COUNT(*) AS n FROM sprawa_zrodlo").get() as { n: number };
  assert.equal(wiazan.n, 2);
  void z;
});

test("zwrot ręczny bez zamówienia trzyma swoje reklamacje w jednej sprawie", () => {
  const z = zwrot(null, "ewa_oddaje", null);
  reklamacja(z);
  reklamacja(z);
  S.przebudujSprawy();
  const lista = sprawy();
  assert.equal(lista.length, 1, "klucz zastępczy zwrot:<id> skleja paczkę");
  assert.equal(lista[0].order_id, null);
  const n = db().prepare("SELECT COUNT(*) AS n FROM sprawa_zrodlo").get() as { n: number };
  assert.equal(n.n, 3);
});

test("zamknięcie wszystkich źródeł stempluje sprawę; otwarcie zdejmuje stempel", () => {
  const z = zwrot("zam-3");
  S.przebudujSprawy();
  db().prepare("UPDATE zwrot SET status = 'rozliczony' WHERE id = ?").run(z);
  S.przebudujSprawy();
  assert.ok(sprawy()[0].zamknieto_at, "sprawa bez otwartych źródeł jest zamknięta");
  db().prepare("UPDATE zwrot SET status = 'nowy' WHERE id = ?").run(z);
  S.przebudujSprawy();
  assert.equal(sprawy()[0].zamknieto_at, null, "reaktywacja źródła otwiera sprawę z powrotem");
});

test("skasowane źródło znika z wiązań, sprawa-sierota znika z tabeli", () => {
  const p = pytanie("client:44300009", "44300009");
  S.przebudujSprawy();
  assert.equal(sprawy().length, 1);
  db().prepare("DELETE FROM pytanie WHERE id = ?").run(p);
  S.przebudujSprawy();
  assert.equal(sprawy().length, 0);
  const n = db().prepare("SELECT COUNT(*) AS n FROM sprawa_zrodlo").get() as { n: number };
  assert.equal(n.n, 0);
});

test("kupujacyIdZMaski: maska oddaje liczbę, prawdziwy login NULL", () => {
  assert.equal(S.kupujacyIdZMaski("client:44300444"), "44300444");
  assert.equal(S.kupujacyIdZMaski("jan_wraca"), null);
  assert.equal(S.kupujacyIdZMaski("client:abc"), null, "maska bez liczby to nie identyfikator");
  assert.equal(S.kupujacyIdZMaski(null), null);
});

test("stempelProwadziSprawy pisze sprawę i loguje zdarzenie", () => {
  zwrot("zam-5");
  S.przebudujSprawy();
  const id = sprawy()[0].id as number;
  S.stempelProwadziSprawy(id, "ola");
  assert.equal(sprawy()[0].prowadzi, "ola");
  const zdarzen = db()
    .prepare("SELECT COUNT(*) AS n FROM events WHERE type = 'sprawa_prowadzi'")
    .get() as { n: number };
  assert.equal(zdarzen.n, 1, "przejęcie to mutacja z klika — loguje się");
  assert.throws(() => S.stempelProwadziSprawy(999_999, "ola"), /Nie ma takiej sprawy/);
});
