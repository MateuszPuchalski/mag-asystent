import { before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import type { Rola } from "../services/users.js";

/* Serwisy ładujemy dynamicznie: `DB_PATH` musi stanąć przed pierwszym
   dotknięciem modułów serwera (patrz `reklamacje.test.ts`). */
process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "wertis-droga-zakupu-")), "t.db");
process.env.LOG_LEVEL = "silent";
process.env.SGT_MODE = "seeded";

/* Trasa drogi zakupu pilnuje trzech rzeczy: bramki roli (dane klienta to dane
   biura, nie hali), 404 dla nieznanego numeru (pusta droga wyglądałaby jak
   zakup bez spraw) i ZERA ZAPISU przy patrzeniu. */

let app: FastifyInstance;
let db: typeof import("../db/db.js").db;
let createUser: typeof import("../services/users.js").createUser;
let konto = 0;
const ZAM = "ord-1";

before(async () => {
  ({ db } = await import("../db/db.js"));
  ({ createUser } = await import("../services/users.js"));
  app = await (await import("../index.js")).buildApp();
});

beforeEach(() => {
  const d = db();
  for (const t of ["reklamacja_klienta", "zwrot_klienta", "zamowienie_klienta", "message",
    "conversation_event", "conversation", "channel_account", "events", "device_session",
    "klient_prowadzenie", "app_user"]) d.prepare(`DELETE FROM ${t}`).run();
  konto = Number(d.prepare(
    "INSERT INTO channel_account(channel,external_account_id) VALUES ('allegro','seller-a')")
    .run().lastInsertRowid);
});

function login(role: Rola, name: string) {
  const u = createUser(name, role, `${role}${Math.random()}`, "tajnehaslo");
  const token = `t-${u.userId}`;
  const n = new Date().toISOString();
  db().prepare("INSERT INTO device_session(token,user_id,created_at,last_seen) VALUES(?,?,?,?)")
    .run(token, u.userId, n, n);
  return { "x-session": token };
}

const zamowienie = () => db().prepare(`INSERT INTO zamowienie_klienta(channel_account_id,
  external_id,kupujacy_login,kupiono_at,synced_at)
  VALUES (?,?,'kupujacy1','2026-09-01T10:00:00Z','2026-09-01')`).run(konto, ZAM);

const sprawa = (typ: "CLAIM" | "DISPUTE", ext: string, otwarto: string) =>
  Number(db().prepare(`INSERT INTO reklamacja_klienta(channel_account_id,external_id,typ,
    order_id,kupujacy_login,temat,status_allegro,otwarto_at,synced_at)
    VALUES (?,?,?,?,'kupujacy1','Nie działa','X',?,'2026-09-17T00:00:00Z')`)
    .run(konto, ext, typ, ZAM, otwarto).lastInsertRowid);

const pobierz = (naglowki: Record<string, string>, id = ZAM) =>
  app.inject({ method: "GET", url: `/api/obsluga/droga/${id}`, headers: naglowki });

test("zakup bez reklamacji: droga jest, reklamacja to null", async () => {
  zamowienie();
  const r = await pobierz(login("biuro", "Ala"));
  assert.equal(r.statusCode, 200);
  const b = r.json();
  assert.equal(b.orderId, ZAM);
  assert.equal(b.reklamacja, null);
  assert.deepEqual(b.sprawy, []);
  assert.ok("droga" in b && "zamowienie" in b && "przesylka" in b && "linkZamowienia" in b);
  assert.equal(typeof b.linkZamowienia, "string");
});

test("zakup z reklamacją: reklamacja w kształcie ekranu reklamacji", async () => {
  zamowienie();
  const id = sprawa("CLAIM", "c-1", "2026-09-10T08:00:00Z");
  const b = (await pobierz(login("biuro", "Ala"))).json();
  assert.equal(b.reklamacja.id, id);
  assert.equal(b.reklamacja.orderId, ZAM);
  assert.ok(Array.isArray(b.reklamacja.tagi));
  /* Bez `pomin`: reklamacja jest też na liście spraw zakupu. */
  assert.deepEqual(b.sprawy.map((s: { id: number }) => s.id), [id]);
  const szczegol = (await app.inject({ method: "GET", url: `/api/obsluga/reklamacje/${id}`,
    headers: login("biuro", "Ola") })).json();
  assert.deepEqual(b.reklamacja, szczegol.reklamacja);
});

test("wiersz dawnej dyskusji nie wchodzi do spraw zakupu, a reklamacja zostaje CLAIM", async () => {
  zamowienie();
  sprawa("DISPUTE", "d-1", "2026-09-05T08:00:00Z");
  const rek = sprawa("CLAIM", "c-1", "2026-09-06T08:00:00Z");
  const b = (await pobierz(login("admin", "Adam"))).json();
  assert.deepEqual(b.sprawy.map((s: { typ: string }) => s.typ), ["CLAIM"]);
  assert.equal(b.reklamacja.id, rek);
});

test("sama dyskusja nie tworzy zakupu: konta nie da się z niej odczytać", async () => {
  sprawa("DISPUTE", "d-1", "2026-09-05T08:00:00Z");
  const r = await pobierz(login("biuro", "Ala"));
  assert.equal(r.statusCode, 404);
});

test("sama reklamacja pozwala odczytać konto bez zamówienia", async () => {
  sprawa("CLAIM", "c-1", "2026-09-05T08:00:00Z");
  const r = await pobierz(login("biuro", "Ala"));
  assert.equal(r.statusCode, 200);
  assert.equal(r.json().sprawy.length, 1);
});

test("nieznane zamówienie: 404 ze zdaniem po polsku", async () => {
  const r = await pobierz(login("biuro", "Ala"), "nie-ma");
  assert.equal(r.statusCode, 404);
  assert.match(r.json().error, /zamówieni/i);
});

test("magazynier dostaje 403, a brak sesji 401", async () => {
  zamowienie();
  assert.equal((await pobierz(login("magazynier", "Mag"))).statusCode, 403);
  assert.equal((await pobierz({})).statusCode, 401);
});

test("otwarcie drogi niczego nie zapisuje", async () => {
  zamowienie();
  sprawa("CLAIM", "c-1", "2026-09-10T08:00:00Z");
  const naglowki = login("biuro", "Ala");
  const zmiany = () => Number(db().prepare("SELECT total_changes() AS n").get()!.n);
  const przed = zmiany();
  assert.equal((await pobierz(naglowki)).statusCode, 200);
  assert.equal(zmiany(), przed);
});
