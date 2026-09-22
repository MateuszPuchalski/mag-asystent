import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import type { Rola } from "../services/users.js";

/* ── Trasy cofania pomyłek przy dostawie ─────────────────────────────────────
   Logika siedzi w `services/cofanie-dostawy.test.ts`. Tu dwie rzeczy, których
   test serwisu nie widzi:
   - trasy działają na roli MAGAZYNIER — to hala poprawia własną pracę;
   - trzy z nich są BEZ CIAŁA, a kolektor wysyła je bez typu treści. Żądanie
     bez ciała z `content-type: application/json` kończy się gołym „Bad
     Request" i to kupiliśmy już dwa razy (CLAUDE.md, reguła klienta HTTP). */

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "wertis-cofr-")), "t.db");
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

const DOK = 64_001;

beforeEach(() => {
  const d = db();
  for (const t of ["problem", "delivery_note", "delivery_line", "delivery", "sgt_pozycja", "sgt_dokument",
                   "sgt_towar", "sfera_queue", "events", "device_session", "app_user"]) {
    d.prepare(`DELETE FROM ${t}`).run();
  }
  d.prepare("INSERT INTO sgt_towar(tw_id, symbol, nazwa, lokalizacja) VALUES (?,?,?,?)")
    .run(64_101, "KOSA-64", "Kosa spalinowa", "A01-02-03");
  d.prepare(
    `INSERT INTO sgt_dokument(dok_id,typ,nr_pelny,data_wyst,mag_id,dostawca,w_buforze)
     VALUES (?,'FZ',?,?,1,'Dostawca',0)`
  ).run(DOK, `FZ ${DOK}/09/2026`, new Date().toISOString().slice(0, 10));
  d.prepare("INSERT INTO sgt_pozycja(dok_id,tw_id,ilosc) VALUES (?,?,?)").run(DOK, 64_101, 3);
});

function zalogowany(rola: Rola, login = `k${rola}`): Record<string, string> {
  const u = createUser(`Ktoś ${login}`, rola, login, "tajnehaslo");
  const token = `tok-${u.userId}-${Math.random().toString(16).slice(2)}`;
  const teraz = new Date().toISOString();
  db()
    .prepare("INSERT INTO device_session(token, user_id, device_id, created_at, last_seen) VALUES (?,?,?,?,?)")
    .run(token, u.userId, "kolektor-1", teraz, teraz);
  return { "x-session": token };
}

/** Dostawa otwarta i jej jedyna pozycja odłożona w całości — czyli zamknięta. */
async function odlozonaCala(h: Record<string, string>): Promise<{ id: number; lineId: number }> {
  let r = await app.inject({ method: "POST", url: `/api/delivery/documents/${DOK}/open`, headers: h });
  assert.equal(r.statusCode, 200, r.body);
  const id = (r.json() as { deliveryId: number }).deliveryId;
  r = await app.inject({ method: "GET", url: `/api/delivery/${id}`, headers: h });
  const lineId = (r.json() as { lines: Array<{ id: number }> }).lines[0].id;
  r = await app.inject({
    method: "POST",
    url: `/api/delivery/${id}/lines/${lineId}/putaway`,
    headers: h,
    payload: { location: "B02-02-02" },
  });
  assert.equal(r.statusCode, 200, r.body);
  return { id, lineId };
}

test("COFNIJ bez ciała działa na magazynierze i oddaje pozycję gotową do skanu", async () => {
  const h = zalogowany("magazynier");
  const { id, lineId } = await odlozonaCala(h);

  const r = await app.inject({ method: "POST", url: `/api/delivery/${id}/lines/${lineId}/cofnij`, headers: h });
  assert.equal(r.statusCode, 200, r.body);
  const b = r.json() as { otwartaPonownie: boolean; line: { id: number; qtyDone: number; cofnij: unknown } };
  assert.equal(b.otwartaPonownie, true, "ostatnia pozycja domknęła dostawę — cofnięcie ją otwiera");
  assert.equal(b.line.id, lineId);
  assert.equal(b.line.qtyDone, 0);
  assert.equal(b.line.cofnij, null);
});

test("OTWÓRZ PONOWNIE bez ciała — i widok dostawy mówi, że wolno", async () => {
  const h = zalogowany("magazynier");
  const { id } = await odlozonaCala(h);
  let r = await app.inject({ method: "GET", url: `/api/delivery/${id}`, headers: h });
  assert.deepEqual((r.json() as { otwarcie: unknown }).otwarcie, { mozna: true, powod: null });

  r = await app.inject({ method: "POST", url: `/api/delivery/${id}/otworz-ponownie`, headers: h });
  assert.equal(r.statusCode, 200, r.body);
  r = await app.inject({ method: "GET", url: `/api/delivery/${id}`, headers: h });
  assert.equal((r.json() as { status: string }).status, "open");

  // drugi raz: dostawa już otwarta — zdanie, nie 500
  r = await app.inject({ method: "POST", url: `/api/delivery/${id}/otworz-ponownie`, headers: h });
  assert.equal(r.statusCode, 400);
  assert.match((r.json() as { error: string }).error, /otwarta/);
});

test("ZMIEŃ PÓŁKĘ wymaga kodu i odrzuca symbol towaru", async () => {
  const h = zalogowany("magazynier");
  const { id, lineId } = await odlozonaCala(h);
  const url = `/api/delivery/${id}/lines/${lineId}/polka`;
  let r = await app.inject({ method: "POST", url, headers: h, payload: {} });
  assert.equal(r.statusCode, 400);
  r = await app.inject({ method: "POST", url, headers: h, payload: { location: "KOSA-64" } });
  assert.equal(r.statusCode, 400);
  r = await app.inject({ method: "POST", url, headers: h, payload: { location: "B02-02-03" } });
  assert.equal(r.statusCode, 200, r.body);
  assert.equal((r.json() as { lok: string }).lok, "B02-02-03");
});

test("WYCOFAJ zgłoszenie: bez ciała, tylko dla zgłaszającego", async () => {
  const jan = zalogowany("magazynier", "jan");
  const ola = zalogowany("magazynier", "ola");
  // druga pozycja: zgłoszenie na jedynej domknęłoby dostawę (tak ma być)
  db().prepare("INSERT INTO sgt_towar(tw_id, symbol, nazwa, lokalizacja) VALUES (?,?,?,?)")
    .run(64_102, "GRABIE-64", "Grabie", "A01-02-04");
  db().prepare("INSERT INTO sgt_pozycja(dok_id,tw_id,ilosc) VALUES (?,?,?)").run(DOK, 64_102, 2);
  let r = await app.inject({ method: "POST", url: `/api/delivery/documents/${DOK}/open`, headers: jan });
  const id = (r.json() as { deliveryId: number }).deliveryId;
  r = await app.inject({ method: "GET", url: `/api/delivery/${id}`, headers: jan });
  const lineId = (r.json() as { lines: Array<{ id: number; sym: string }> }).lines
    .find((l) => l.sym === "KOSA-64")!.id;
  // częściowe odłożenie, żeby zgłoszenie nie domknęło dostawy
  await app.inject({
    method: "POST",
    url: `/api/delivery/${id}/lines/${lineId}/putaway`,
    headers: jan,
    payload: { location: "A01-02-03", qty: 1 },
  });
  r = await app.inject({
    method: "POST",
    url: `/api/delivery/${id}/problems`,
    headers: jan,
    payload: { lineId, typ: "qty_mismatch", qty: 1 },
  });
  assert.equal(r.statusCode, 200, r.body);
  const problemId = (r.json() as { id: number }).id;

  r = await app.inject({ method: "GET", url: `/api/delivery/${id}`, headers: jan });
  const linia = (r.json() as { lines: Array<{ id: number; zgloszenie: { id: number } | null }> }).lines
    .find((l) => l.id === lineId)!;
  assert.equal(linia.zgloszenie?.id, problemId, "widok niesie zgłoszenie do wycofania");

  r = await app.inject({ method: "POST", url: `/api/problems/${problemId}/wycofaj`, headers: ola });
  assert.equal(r.statusCode, 400, "cudzego zgłoszenia magazynier nie zdejmuje");
  r = await app.inject({ method: "POST", url: `/api/problems/${problemId}/wycofaj`, headers: jan });
  assert.equal(r.statusCode, 200, r.body);
  assert.equal((r.json() as { statusLinii: string }).statusLinii, "partial");
});
