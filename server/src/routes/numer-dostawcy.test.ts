import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import type { Rola } from "../services/users.js";

/* ── Numer faktury dostawcy tylko dla biura ──────────────────────────────────
   Decyzja właściciela: numer hurtowni widzi biuro, bo to ono reklamuje.
   Kolektor czyta tę samą listę dostaw, więc pole zeruje serwer. Schowane
   w przeglądarce jechałoby dalej do każdego urządzenia w hali.            */

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "wertis-nrdost-")), "t.db");
process.env.LOG_LEVEL = "silent";
process.env.MAG_ID_MAG = "1";
process.env.MAG_ID_MGP = "2";

let app: FastifyInstance;
let db: typeof import("../db/db.js").db;
let createUser: typeof import("../services/users.js").createUser;

const DOK = 4410;

before(async () => {
  ({ db } = await import("../db/db.js"));
  ({ createUser } = await import("../services/users.js"));
  const { buildApp } = await import("../index.js");
  app = await buildApp();
});

beforeEach(() => {
  const d = db();
  for (const t of ["events", "device_session", "app_user", "delivery_line", "delivery", "sgt_pozycja", "sgt_dokument"]) {
    d.prepare(`DELETE FROM ${t}`).run();
  }
  d.prepare(`INSERT INTO sgt_dokument(dok_id, typ, nr_pelny, data_wyst, mag_id, dostawca, w_buforze, nr_oryg)
    VALUES (?, 'FZ', ?, ?, 1, 'GARDENPARTS', 0, 'FV/4410/09/2026')`)
    .run(DOK, `FZ ${DOK}/MAG/09/2026`, new Date().toISOString().slice(0, 10));
});

function zalogowany(rola: Rola): string {
  const u = createUser(`Ktoś ${rola}`, rola, `k${rola}`, "tajnehaslo");
  const token = `tok-${u.userId}-${Math.random().toString(16).slice(2)}`;
  const teraz = new Date().toISOString();
  db().prepare("INSERT INTO device_session(token, user_id, device_id, created_at, last_seen) VALUES (?,?,?,?,?)")
    .run(token, u.userId, "kolektor-7", teraz, teraz);
  return token;
}

const czytaj = async (url: string, token: string) =>
  (await app.inject({ method: "GET", url, headers: { "x-session": token } })).json();

test("lista dostaw: biuro dostaje numer dostawcy, magazynier nie", async () => {
  const biuro = await czytaj("/api/delivery/documents", zalogowany("biuro"));
  assert.equal(biuro.documents[0].nrDostawcy, "FV/4410/09/2026");
  const hala = await czytaj("/api/delivery/documents", zalogowany("magazynier"));
  assert.equal(hala.documents.length, 1, "lista pracy hali zostaje cała");
  assert.equal(hala.documents[0].nrDostawcy, null);
});

test("karta dokumentu: numer dostawcy tylko dla biura", async () => {
  assert.equal((await czytaj(`/api/biuro/dokument/${DOK}`, zalogowany("admin"))).nrDostawcy, "FV/4410/09/2026");
  assert.equal((await czytaj(`/api/biuro/dokument/${DOK}`, zalogowany("magazynier"))).nrDostawcy, null);
});

test("archiwum: magazynier nie znajduje dostawy po numerze dostawcy i go nie widzi", async () => {
  db().prepare("DELETE FROM sgt_dokument").run();
  db().prepare(`INSERT INTO delivery(sgt_dok_id, sgt_dok_numer, dostawca, data_dok, status, opened_at, source_mag_id, nr_oryg)
    VALUES (?, ?, 'GARDENPARTS', '2026-01-10', 'done', '2026-01-10T08:00:00Z', 1, 'FV/4410/09/2026')`)
    .run(DOK, `FZ ${DOK}/MAG/01/2026`);
  const biuro = await czytaj("/api/biuro/dostawy/archiwum?q=FV%2F4410", zalogowany("biuro"));
  assert.equal(biuro.documents[0].nrDostawcy, "FV/4410/09/2026");
  const magazynier = zalogowany("magazynier");
  const hala = await czytaj("/api/biuro/dostawy/archiwum?q=FV%2F4410", magazynier);
  assert.deepEqual(hala.documents, []);
  const halaWszystko = await czytaj("/api/biuro/dostawy/archiwum", magazynier);
  assert.equal(halaWszystko.documents[0].nrDostawcy, null);
});
