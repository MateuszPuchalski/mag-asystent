import { before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import type { Rola } from "../services/users.js";

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "wertis-pomylki-tras-")), "t.db");
process.env.LOG_LEVEL = "silent";
process.env.SGT_MODE = "seeded";

/* Trasy pomyłek pilnują tu tego, czego serwis nie widzi:
   1. bramka roli na KAŻDEJ trasie, także odczytu, i 401 przed 403;
   2. zero zapisu przy patrzeniu — trzy odczyty nie ruszają bazy;
   3. zestawienie win na osobę widzi całe biuro, a przypisanie numeru Sellasist tylko admin;
   4. tłumaczenie błędów serwisu: 400, 404 i 409 z bieżącym stanem. */

let app: FastifyInstance;
let db: typeof import("../db/db.js").db;
let createUser: typeof import("../services/users.js").createUser;
let konto = 0;

before(async () => {
  ({ db } = await import("../db/db.js"));
  ({ createUser } = await import("../services/users.js"));
  app = await (await import("../index.js")).buildApp();
});

beforeEach(() => {
  const d = db();
  for (const t of ["pomylka_wysylki", "zamowienie_klienta_pozycja", "zamowienie_klienta", "channel_account",
    "events", "device_session", "app_user"]) {
    d.prepare(`DELETE FROM ${t}`).run();
  }
  konto = Number(d.prepare("INSERT INTO channel_account(channel,external_account_id) VALUES ('allegro','s')")
    .run().lastInsertRowid);
  const z = Number(d.prepare(`INSERT INTO zamowienie_klienta(channel_account_id,external_id,kupujacy_login,synced_at)
      VALUES (?,'ord-1','Kupiec_77','x')`).run(konto).lastInsertRowid);
  d.prepare(`INSERT INTO zamowienie_klienta_pozycja(zamowienie_id,nazwa,sku,ilosc,cena_grosze,waluta)
      VALUES (?,'Nóż NAC 46','NAC-46',1,4999,'PLN')`).run(z);
});

function login(role: Rola, name: string) {
  const u = createUser(name, role, `${role}${Math.random()}`, "tajnehaslo");
  const token = `t-${u.userId}`;
  const n = new Date().toISOString();
  db().prepare("INSERT INTO device_session(token,user_id,created_at,last_seen) VALUES(?,?,?,?)")
    .run(token, u.userId, n, n);
  return { naglowki: { "x-session": token }, userId: u.userId };
}

const TRASY = [
  { method: "GET" as const, url: "/api/pomylki" },
  { method: "GET" as const, url: "/api/pomylki/licznik" },
  { method: "GET" as const, url: "/api/pomylki/1/pozycje" },
  { method: "POST" as const, url: "/api/pomylki" },
  { method: "PATCH" as const, url: "/api/pomylki/1" },
  { method: "POST" as const, url: "/api/pomylki/1/zakoncz" },
  { method: "POST" as const, url: "/api/pomylki/1/wznow" },
  { method: "POST" as const, url: "/api/pomylki/1/usun" },
];

test("bez sesji 401, hala 403 — na każdej trasie, także odczytu", async () => {
  const hala = login("magazynier", "Marek");
  for (const t of TRASY) {
    const bez = await app.inject({ ...t, payload: t.method === "GET" ? undefined : {} });
    assert.equal(bez.statusCode, 401, `${t.method} ${t.url}`);
    const r = await app.inject({ ...t, headers: hala.naglowki, payload: t.method === "GET" ? undefined : {} });
    assert.equal(r.statusCode, 403, `${t.method} ${t.url}`);
  }
});

test("pełna droga: zgłoszenie, uzupełnienie, zakończenie, wznowienie; odczyty bez zapisu", async () => {
  const { naglowki } = login("biuro", "Ala");
  const marek = login("magazynier", "Marek");

  let r = await app.inject({ method: "POST", url: "/api/pomylki", headers: naglowki,
    payload: { login: "", zamowienie: "ord-1" } });
  assert.equal(r.statusCode, 201, r.body);
  const p = r.json().pomylka;
  assert.deepEqual([p.login, p.konto, p.zamowienie, p.zrodlo, p.stan], ["Kupiec_77", konto, "ord-1", "recznie",
    "do_uzupelnienia"]);

  r = await app.inject({ method: "POST", url: "/api/pomylki", headers: naglowki, payload: { zamowienie: "ord-1" } });
  assert.equal(r.statusCode, 200, "drugie zgłoszenie oddaje istniejącą");
  assert.equal(r.json().pomylka.id, p.id);

  /* Zero zapisu przy patrzeniu: trzy odczyty, ta sama liczba zmian bazy. */
  const zmiany = () => (db().prepare("SELECT total_changes() AS n").get() as { n: number }).n;
  const przed = zmiany();
  const lista = await app.inject({ method: "GET", url: "/api/pomylki?stan=do_uzupelnienia", headers: naglowki });
  const licznik = await app.inject({ method: "GET", url: "/api/pomylki/licznik", headers: naglowki });
  const pozycje = await app.inject({ method: "GET", url: `/api/pomylki/${p.id}/pozycje`, headers: naglowki });
  assert.equal(zmiany(), przed);
  assert.deepEqual(lista.json().pomylki.map((x: { id: number }) => x.id), [p.id]);
  assert.equal(lista.json().doUzupelnienia, 1);
  assert.deepEqual(licznik.json(), { doUzupelnienia: 1 });
  assert.deepEqual(pozycje.json(), { pozycje: [{ nazwa: "Nóż NAC 46", ilosc: 1, sku: "NAC-46" }], podpowiedz: null });

  r = await app.inject({ method: "PATCH", url: `/api/pomylki/${p.id}`, headers: naglowki,
    payload: { wersja: p.wersja, coZamowil: "Nóż NAC 46", coDostal: "nóż 40", zbieralUserId: marek.userId,
      winaZbierajacego: true } });
  assert.equal(r.statusCode, 200, r.body);
  const z = r.json().pomylka;
  assert.deepEqual([z.opis, z.zbieral, z.winaZbierajacego, z.stan],
    ["Dostał nóż 40 zamiast Nóż NAC 46", { userId: marek.userId, nazwa: "Marek" }, true, "w_toku"]);

  r = await app.inject({ method: "PATCH", url: `/api/pomylki/${p.id}`, headers: naglowki,
    payload: { wersja: p.wersja, coDostal: "grabie" } });
  assert.equal(r.statusCode, 409);
  assert.equal(r.json().kod, "konflikt");
  assert.equal(r.json().pomylka.coDostal, "nóż 40", "konflikt niesie bieżący stan");

  r = await app.inject({ method: "POST", url: `/api/pomylki/${p.id}/zakoncz`, headers: naglowki,
    payload: { wersja: z.wersja } });
  assert.equal(r.json().pomylka.stan, "zakonczona");
  r = await app.inject({ method: "POST", url: `/api/pomylki/${p.id}/wznow`, headers: naglowki,
    payload: { wersja: r.json().pomylka.wersja } });
  assert.deepEqual([r.json().pomylka.stan, r.json().pomylka.zakonczonaRecznie], ["w_toku", false]);

  const dziennik = db().prepare("SELECT type, payload FROM events WHERE type LIKE 'pomylka_%' ORDER BY id")
    .all() as Array<{ type: string; payload: string }>;
  assert.deepEqual(dziennik.map((e) => e.type),
    ["pomylka_dodana", "pomylka_zmieniona", "pomylka_zakonczona", "pomylka_wznowiona"]);
  assert.doesNotMatch(JSON.stringify(dziennik), /kupiec|nóż/i, "dziennik bez loginu i bez treści");
});

test("błędy serwisu: 400 przy złych danych, 404 bez pomyłki", async () => {
  const { naglowki } = login("biuro", "Ala");
  let r = await app.inject({ method: "POST", url: "/api/pomylki", headers: naglowki, payload: { login: " " } });
  assert.equal(r.statusCode, 400);
  r = await app.inject({ method: "POST", url: "/api/pomylki", headers: naglowki, payload: { zamowienie: "nieznane" } });
  assert.equal(r.statusCode, 400, "zamówienie bez loginu w bazie i w ciele");
  r = await app.inject({ method: "PATCH", url: "/api/pomylki/999", headers: naglowki, payload: { wersja: 1 } });
  assert.equal(r.statusCode, 404);
  r = await app.inject({ method: "GET", url: "/api/pomylki/999/pozycje", headers: naglowki });
  assert.equal(r.statusCode, 404);
  r = await app.inject({ method: "GET", url: "/api/pomylki?stan=otwarte", headers: naglowki });
  assert.equal(r.statusCode, 400);
  const p = (await app.inject({ method: "POST", url: "/api/pomylki", headers: naglowki, payload: { login: "x" } }))
    .json().pomylka;
  r = await app.inject({ method: "PATCH", url: `/api/pomylki/${p.id}`, headers: naglowki,
    payload: { wersja: p.wersja, pakowalUserId: 99999 } });
  assert.equal(r.statusCode, 400, "nieistniejący pracownik");
});

test("zestawienie win na osobę widzi całe biuro", async () => {
  const biuro = login("biuro", "Ala");
  const marek = login("magazynier", "Marek");
  const p = (await app.inject({ method: "POST", url: "/api/pomylki", headers: biuro.naglowki,
    payload: { login: "x" } })).json().pomylka;
  await app.inject({ method: "PATCH", url: `/api/pomylki/${p.id}`, headers: biuro.naglowki,
    payload: { wersja: p.wersja, pakowalUserId: marek.userId, winaPakujacego: true } });

  const dlaBiura = (await app.inject({ method: "GET", url: "/api/pomylki", headers: biuro.naglowki })).json();
  assert.equal(dlaBiura.podsumowanie.razem, 1);
  assert.match(dlaBiura.podsumowanie.miesiac, /^\d{4}-\d{2}$/);
  assert.deepEqual(dlaBiura.podsumowanie.osoby,
    [{ userId: marek.userId, nazwa: "Marek", zbieral: 0, pakowal: 1, winny: 1 }]);
});

test("złapane przy pakowaniu: bramka biura, a bez Sellasist pusta odpowiedź bez zer", async () => {
  assert.equal((await app.inject({ method: "GET", url: "/api/pomylki/zlapane" })).statusCode, 401);
  const hala = login("magazynier", "Hala Z");
  assert.equal((await app.inject({ method: "GET", url: "/api/pomylki/zlapane", headers: hala.naglowki })).statusCode, 403);
  const biuro = login("biuro", "Ola Z");
  const r = await app.inject({ method: "GET", url: "/api/pomylki/zlapane", headers: biuro.naglowki });
  assert.equal(r.statusCode, 200);
  assert.deepEqual(r.json(), { wlaczone: false, dni: [], razem: null, doKlienta: null, osoby: [], bezOsoby: null });
});

test("złapane przy pakowaniu: włączone tylko z kontem, chodzącym lustrem i statusem pomyłki", async () => {
  const { config } = await import("../config.js");
  const bylo = { ...config.sellasist };
  const biuro = login("biuro", "Ola W");
  const wlaczone = async () => (await app.inject({ method: "GET", url: "/api/pomylki/zlapane",
    headers: biuro.naglowki })).json().wlaczone;
  try {
    Object.assign(config.sellasist, { konto: "firma", apiKey: "k", syncMs: 251_000, statusyPomylka: [30] });
    assert.equal(await wlaczone(), true);
    Object.assign(config.sellasist, { statusyPomylka: [] });
    assert.equal(await wlaczone(), false, "bez statusu pomyłki nie ma czego liczyć");
    Object.assign(config.sellasist, { statusyPomylka: [30], syncMs: 0 });
    assert.equal(await wlaczone(), false, "zatrzymane lustro nie czyta dziennika");
  } finally {
    Object.assign(config.sellasist, bylo);
  }
});

test("kto zbierał złapane: osoby widzi całe biuro, numer Sellasist przypisuje tylko admin", async () => {
  const { config } = await import("../config.js");
  const bylo = { ...config.sellasist };
  const d = db();
  d.exec("DELETE FROM sellasist_sync_state; DELETE FROM sellasist_pomylka_zlapana; DELETE FROM sellasist_pracownik");
  const teraz = Date.now();
  d.prepare("INSERT INTO sellasist_sync_state(id, pomylki_od_at, last_success_at) VALUES (1, ?, ?)")
    .run(new Date(teraz - 4 * 86_400_000).toISOString(), new Date(teraz).toISOString());
  d.prepare(`INSERT INTO sellasist_pomylka_zlapana(log_id, zamowienie_id, at, zbieral_sellasist_id, zbieral_sprawdzono_at)
      VALUES (1, 800, ?, 7, ?)`).run(new Date(teraz - 86_400_000).toISOString(), new Date(teraz).toISOString());
  const biuro = login("biuro", "Ola P");
  const admin = login("admin", "Szef P");
  const marek = login("magazynier", "Marek P");
  const odczyt = async (h: Record<string, string>) =>
    (await app.inject({ method: "GET", url: "/api/pomylki/zlapane", headers: h })).json();
  try {
    Object.assign(config.sellasist, { konto: "firma", apiKey: "k", syncMs: 251_000, statusyPomylka: [30] });
    const dlaBiura = await odczyt(biuro.naglowki);
    assert.equal(dlaBiura.razem, 1);
    assert.equal(dlaBiura.bezOsoby, 0);
    assert.deepEqual(dlaBiura.osoby,
      [{ sellasistId: 7, userId: null, nazwa: null, zlapanych: 1 }]);

    const przypisz = (h: Record<string, string>, payload: unknown) =>
      app.inject({ method: "POST", url: "/api/pomylki/zlapane/pracownik", headers: h, payload: payload as object });
    assert.equal((await przypisz(biuro.naglowki, { sellasistId: 7, userId: marek.userId })).statusCode, 403);
    assert.equal((await przypisz(admin.naglowki, { sellasistId: 7, userId: 999999 })).statusCode, 400);
    assert.equal((await przypisz(admin.naglowki, { sellasistId: 7, userId: marek.userId })).statusCode, 200);
    assert.deepEqual((await odczyt(biuro.naglowki)).osoby,
      [{ sellasistId: 7, userId: marek.userId, nazwa: "Marek P", zlapanych: 1 }]);
  } finally {
    Object.assign(config.sellasist, bylo);
  }
});
