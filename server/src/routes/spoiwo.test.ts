import { before, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import type { Rola } from "../services/users.js";

/* Serwisy dynamicznie — powód przy `dyskusje.test.ts`: statyczny import
   biegnie przed ustawieniem `DB_PATH`. */
process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "wertis-spoiwo-tras-")), "t.db");
process.env.LOG_LEVEL = "silent";
process.env.SGT_MODE = "seeded";

/* ── Trasy ponad kolejkami (23 września 2026) ────────────────────────────────
   Szukanie Ctrl+K i historia ze zwrotu albo sprawy: bramka biura także na
   odczycie, 401 przed 403, i ani jednego zapisu przy patrzeniu. */

let app: FastifyInstance;
let db: typeof import("../db/db.js").db;
let createUser: typeof import("../services/users.js").createUser;
let zwrot = 0;
let sprawa = 0;

before(async () => {
  ({ db } = await import("../db/db.js"));
  ({ createUser } = await import("../services/users.js"));
  app = await (await import("../index.js")).buildApp();
  const d = db();
  const konto = Number(d.prepare(
    "INSERT INTO channel_account(channel,external_account_id) VALUES ('allegro','seller-a')").run().lastInsertRowid);
  zwrot = Number(d.prepare(`INSERT INTO zwrot_klienta(channel_account_id,external_id,reference_number,order_id,
    kupujacy_login,created_at,synced_at) VALUES (?,'z-1','ZW-1','ord-1','kupujacy1','2026-09-05T10:00:00Z','x')`)
    .run(konto).lastInsertRowid);
  sprawa = Number(d.prepare(`INSERT INTO reklamacja_klienta(channel_account_id,external_id,typ,order_id,
    kupujacy_login,otwarto_at,synced_at) VALUES (?,'r-1','CLAIM','ord-1','kupujacy1','2026-09-06T10:00:00Z','x')`)
    .run(konto).lastInsertRowid);
});

function login(role: Rola, name: string) {
  const u = createUser(name, role, `${role}${Math.random()}`, "tajnehaslo");
  const token = `t-${u.userId}`;
  const n = new Date().toISOString();
  db().prepare("INSERT INTO device_session(token,user_id,created_at,last_seen) VALUES(?,?,?,?)")
    .run(token, u.userId, n, n);
  return { "x-session": token };
}

const TRASY = () => ["/api/obsluga/szukaj?q=kupujacy1", `/api/obsluga/zwroty/${zwrot}/klient`,
  `/api/obsluga/sprawy/${sprawa}/klient`, "/api/obsluga/klient/kupujacy1"];

test("bez sesji 401, hala 403 — także na odczycie", async () => {
  const hala = login("magazynier", "Hala");
  for (const url of TRASY()) {
    assert.equal((await app.inject({ method: "GET", url })).statusCode, 401, url);
    assert.equal((await app.inject({ method: "GET", url, headers: hala })).statusCode, 403, url);
  }
});

test("biuro czyta szukanie i historię, a patrzenie niczego nie zapisuje", async () => {
  const b = login("biuro", "Ola");
  const przed = (db().prepare("SELECT COUNT(*) AS n FROM events").get() as { n: number }).n;
  const zmiany = (db().prepare("SELECT total_changes() AS n").get() as { n: number }).n;
  const s = await app.inject({ method: "GET", url: TRASY()[0], headers: b });
  assert.equal(s.statusCode, 200, s.body);
  assert.ok(s.json<{ trafienia: Array<{ rodzaj: string }> }>().trafienia.some((t) => t.rodzaj === "zwrot"));
  const h = await app.inject({ method: "GET", url: TRASY()[1], headers: b });
  assert.equal(h.json<{ login: string }>().login, "kupujacy1");
  const r = await app.inject({ method: "GET", url: TRASY()[2], headers: b });
  assert.ok(r.json<{ wpisy: Array<{ rodzaj: string }> }>().wpisy.some((w) => w.rodzaj === "zwrot"));
  assert.equal((db().prepare("SELECT COUNT(*) AS n FROM events").get() as { n: number }).n, przed);
  assert.equal((db().prepare("SELECT total_changes() AS n").get() as { n: number }).n, zmiany);
});

test("nieistniejący zwrot to 404 z treścią, nie 500", async () => {
  const b = login("biuro", "Ola2");
  const r = await app.inject({ method: "GET", url: "/api/obsluga/zwroty/999999/klient", headers: b });
  assert.equal(r.statusCode, 404);
});

/* ── Profil klienta (24 września 2026) ─────────────────────────────────────── */
test("profil: odczyt bez zapisu, nieznany login 404, notatka tylko dla biura", async () => {
  const b = login("biuro", "Ola3");
  const zmiany = (db().prepare("SELECT total_changes() AS n").get() as { n: number }).n;
  const r = await app.inject({ method: "GET", url: "/api/obsluga/klient/KUPUJACY1", headers: b });
  assert.equal(r.statusCode, 200, r.body);
  assert.equal(r.json<{ login: string }>().login, "kupujacy1");
  assert.equal((db().prepare("SELECT total_changes() AS n").get() as { n: number }).n, zmiany);
  assert.equal((await app.inject({ method: "GET", url: "/api/obsluga/klient/nikt", headers: b })).statusCode, 404);

  const hala = login("magazynier", "Hala2");
  const zakaz = await app.inject({ method: "POST", url: "/api/obsluga/klient/kupujacy1/notatka",
    headers: hala, payload: { tresc: "x" } });
  assert.equal(zakaz.statusCode, 403);
  const n = await app.inject({ method: "POST", url: "/api/obsluga/klient/kupujacy1/notatka",
    headers: b, payload: { tresc: "Prosi o fakturę" } });
  assert.equal(n.statusCode, 200, n.body);
  assert.ok(db().prepare("SELECT 1 FROM events WHERE type='klient_notatka'").get());
  const c = await app.inject({ method: "POST", url: "/api/obsluga/klient/kupujacy1/notatka/cofnij",
    headers: b, payload: {} });
  assert.equal(c.statusCode, 409, "nie było poprzedniej notatki");
});

/* ── Sprawa klienta (0.535.0, S6) ───────────────────────────────────────────
   Cztery zapisy: bramka osobno dla każdego (TRASY wyżej wysyłają tylko GET),
   każdy klucz ciała wymagany, konflikt to 409 ze świeżą sprawą, a login
   kupującego nie ląduje w `events` — ani z serwisu, ani z audytu odrzuceń. */
const SPRAWA = (login = "kupujacy1") => [
  { url: `/api/obsluga/klient/${login}/sprawa/krok`,
    payload: { krok: "czekamy na zwrot", krokDo: new Date(Date.now() + 3 * 86_400_000).toISOString(),
      wersja: 0, odcisk: "" } },
  { url: `/api/obsluga/klient/${login}/sprawa/zakoncz`, payload: { wersja: 1, odcisk: "" } },
  { url: `/api/obsluga/klient/${login}/sprawa/wznow`, payload: { wersja: 1, odcisk: "" } },
  { url: `/api/obsluga/klient/${login}/sprawa/przejmij`, payload: { wersja: 1, odcisk: "" } },
];
const wierszeSprawy = () => db().prepare("SELECT * FROM klient_prowadzenie ORDER BY id").all();
const zapisySprawy = () => (db().prepare(
  "SELECT count(*) n FROM events WHERE type LIKE 'klient_sprawa%'").get() as { n: number }).n;

test("sprawa klienta: bez sesji 401, hala 403 — na każdym z czterech zapisów, bez śladu w sprawie", async () => {
  const hala = login("magazynier", "Hala3");
  for (const t of SPRAWA()) {
    assert.equal((await app.inject({ method: "POST", url: t.url, payload: t.payload })).statusCode, 401, t.url);
    assert.equal((await app.inject({ method: "POST", url: t.url, payload: t.payload, headers: hala })).statusCode,
      403, t.url);
  }
  assert.deepEqual(wierszeSprawy(), []);
  assert.equal(zapisySprawy(), 0);
});

test("sprawa klienta: brak klucza albo zły typ to 400 bez zapisu", async () => {
  const b = login("biuro", "Ola4");
  const [krok, zakoncz, wznow, przejmij] = SPRAWA();
  const { odcisk: _o, ...bezOdcisku } = krok.payload;
  for (const [url, payload] of [
    [krok.url, bezOdcisku], [krok.url, { ...krok.payload, wersja: "0" }], [krok.url, { ...krok.payload, krok: null }],
    [zakoncz.url, { wersja: 1 }], [wznow.url, {}], [przejmij.url, { wersja: 1.5, odcisk: "" }],
    /* „Cofnij” i „Przejmij” bez odcisku — zgasiłyby, czego ekran nie narysował. */
    [wznow.url, { wersja: 1 }], [przejmij.url, { wersja: 1 }],
  ] as const) {
    const r = await app.inject({ method: "POST", url, payload, headers: b });
    assert.equal(r.statusCode, 400, `${url} ${JSON.stringify(payload)}: ${r.body}`);
  }
  assert.deepEqual(wierszeSprawy(), []);
  assert.equal(zapisySprawy(), 0);
});

test("sprawa klienta: pola ciała docierają do serwisu, rozjazd wersji to 409 ze sprawą", async () => {
  const ola = login("biuro", "Ola5");
  const ewa = login("biuro", "Ewa5");
  const [krok, zakoncz, wznow, przejmij] = SPRAWA();
  const r = await app.inject({ method: "POST", url: krok.url, payload: krok.payload, headers: ola });
  assert.equal(r.statusCode, 200, r.body);
  const s = r.json<{ sprawa: { id: number; wersja: number; krok: string; krokDo: string; odcisk: string;
    prowadzi: string } }>().sprawa;
  assert.deepEqual([s.wersja, s.krok, s.prowadzi], [1, "czekamy na zwrot", "Ola5"]);
  const w = db().prepare("SELECT krok_do, login FROM klient_prowadzenie WHERE id=?").get(s.id) as
    { krok_do: string; login: string };
  assert.equal(w.krok_do, krok.payload.krokDo, "termin z ciała zapisany co do milisekundy");
  assert.equal(w.login, "kupujacy1");

  /* Drugie „pierwsze” ustawienie kroku (wersja 0) przegrywa z 409 i dostaje sprawę. */
  const k = await app.inject({ method: "POST", url: krok.url, payload: krok.payload, headers: ewa });
  assert.equal(k.statusCode, 409, k.body);
  assert.equal(k.json<{ sprawa: { wersja: number } }>().sprawa.wersja, 1);

  /* Stary odcisk przy zakończeniu to 409, świeży przechodzi. */
  const z0 = await app.inject({ method: "POST", url: zakoncz.url, headers: ola,
    payload: { wersja: 1, odcisk: "{}" } });
  assert.equal(z0.statusCode, 409, z0.body);
  assert.equal(z0.json<{ error: string }>().error, "Klient dopisał coś po otwarciu ekranu");

  const p0 = await app.inject({ method: "POST", url: przejmij.url, headers: ewa, payload: { wersja: 1, odcisk: "{}" } });
  assert.equal(p0.statusCode, 409, p0.body);
  const p = await app.inject({ method: "POST", url: przejmij.url, headers: ewa,
    payload: { wersja: 1, odcisk: s.odcisk } });
  assert.equal(p.statusCode, 200, p.body);
  assert.equal(p.json<{ sprawa: { prowadzi: string } }>().sprawa.prowadzi, "Ewa5");
  const z = await app.inject({ method: "POST", url: zakoncz.url, headers: ola,
    payload: { wersja: 2, odcisk: s.odcisk } });
  assert.equal(z.statusCode, 200, z.body);
  const po = z.json<{ sprawa: { stan: string; odcisk: string } }>().sprawa;
  assert.equal(po.stan, "zakonczona");
  const c = await app.inject({ method: "POST", url: wznow.url, headers: ola,
    payload: { wersja: 3, odcisk: po.odcisk } });
  assert.equal(c.statusCode, 200, c.body);
  assert.equal(c.json<{ sprawa: { stan: string; krok: string } }>().sprawa.krok, "czekamy na zwrot");
  assert.equal(zapisySprawy(), 4);
});

test("sprawa klienta jedzie z profilem i z historią ze zwrotu i sprawy — odczyt bez zapisu", async () => {
  const b = login("biuro", "Ola6");
  const zmiany = (db().prepare("SELECT total_changes() AS n").get() as { n: number }).n;
  const p = await app.inject({ method: "GET", url: "/api/obsluga/klient/kupujacy1", headers: b });
  assert.equal(p.statusCode, 200, p.body);
  assert.equal(p.json<{ sprawa: { krok: string } }>().sprawa.krok, "czekamy na zwrot");
  assert.equal(typeof p.json<{ podpowiedzZakonczenia: boolean }>().podpowiedzZakonczenia, "boolean");
  for (const url of [TRASY()[1], TRASY()[2]]) {
    const h = await app.inject({ method: "GET", url, headers: b });
    assert.equal(h.statusCode, 200, h.body);
    assert.equal(h.json<{ sprawa: { login: string } | null }>().sprawa?.login, "kupujacy1", url);
  }
  assert.equal((db().prepare("SELECT total_changes() AS n").get() as { n: number }).n, zmiany);
});

test("audyt odrzuceń pod profilem klienta pisze wzorzec trasy, nie login", async () => {
  const b = login("biuro", "Ola7");
  const nieznany = await app.inject({ method: "POST", headers: b,
    url: "/api/obsluga/klient/nieznany-kupiec-777/sprawa/krok", payload: SPRAWA("nieznany-kupiec-777")[0].payload });
  assert.equal(nieznany.statusCode, 404, nieznany.body);
  const konflikt = await app.inject({ method: "POST", headers: b, url: SPRAWA()[2].url,
    payload: { wersja: 99, odcisk: "" } });
  assert.equal(konflikt.statusCode, 409, konflikt.body);
  const brak = await app.inject({ method: "GET", headers: b, url: "/api/obsluga/klient/nieznany-kupiec-777" });
  assert.equal(brak.statusCode, 404);

  const wpisy = db().prepare("SELECT type, payload FROM events WHERE type='http_rejected'")
    .all() as Array<{ payload: string }>;
  assert.ok(wpisy.some((w) => w.payload.includes("/api/obsluga/klient/:login/sprawa/krok")),
    "wpis odrzucenia jest — tylko bez loginu");
  assert.ok(wpisy.some((w) => w.payload.includes("/api/obsluga/klient/:login\"")));
  const zLoginem = db().prepare(`SELECT type FROM events
      WHERE payload LIKE '%nieznany-kupiec-777%' OR payload LIKE '%kupujacy1%'`).all();
  assert.deepEqual(zLoginem, [], "login kupującego nie ma prawa trafić do dziennika");
});

/* ── Dosyłka z profilu (0.536.0, S6) ───────────────────────────────────────
   Dwa zapisy obok czterech wyżej, z tymi samymi strażnikami: bramka biura,
   każdy klucz wymagany, 409 ze świeżą sprawą. Numer przesyłki jedzie
   w ciele, więc nie trafia ani do adresu, ani do audytu odrzuceń. */
const DOSYLKA = (login = "kupujacy2") => ({
  propozycja: `/api/obsluga/klient/${login}/sprawa/dosylka`,
  numer: `/api/obsluga/klient/${login}/sprawa/dosylka/numer`,
});
let zwrotDosylki = 0;

test("dosyłka z profilu: bramka, wymagane klucze, 409 ze sprawą, a w dzienniku ani loginu, ani numeru", async () => {
  const d = db();
  const konto = Number((d.prepare("SELECT id FROM channel_account LIMIT 1").get() as { id: number }).id);
  d.prepare(`INSERT INTO zamowienie_klienta(channel_account_id,external_id,kupujacy_login,przesylka_przewoznik,
    synced_at) VALUES (?,'ord-2','kupujacy2','INPOST','x')`).run(konto);
  zwrotDosylki = Number(d.prepare(`INSERT INTO zwrot_klienta(channel_account_id,external_id,reference_number,order_id,
      kupujacy_login,created_at,odmowa_kod,odmowa_at,synced_at)
    VALUES (?,'z-2','ZW-2','ord-2','kupujacy2','2026-09-20T10:00:00Z','NEW_ITEM_SENT','2026-09-26T10:00:00Z','x')`)
    .run(konto).lastInsertRowid);
  const hala = login("magazynier", "Hala8");
  const b = login("biuro", "Ola8");
  const { propozycja, numer } = DOSYLKA();
  for (const url of [propozycja, numer]) {
    assert.equal((await app.inject({ method: "POST", url, payload: {} })).statusCode, 401, url);
    assert.equal((await app.inject({ method: "POST", url, payload: {}, headers: hala })).statusCode, 403, url);
  }
  for (const [url, payload] of [
    [propozycja, { wersja: 0, odcisk: "" }], [propozycja, { zwrotId: String(zwrotDosylki), wersja: 0, odcisk: "" }],
    [numer, { zamowienie: "ord-2", przewoznik: "INPOST", wersja: 1, odcisk: "" }],
    [numer, { zamowienie: "ord-2", waybill: "AD-9", przewoznik: "INPOST", wersja: 1 }],
  ] as const) {
    const r = await app.inject({ method: "POST", url, payload, headers: b });
    assert.equal(r.statusCode, 400, `${url} ${JSON.stringify(payload)}: ${r.body}`);
  }
  assert.equal(db().prepare("SELECT count(*) n FROM klient_dosylka").get()!.n, 0);

  const r = await app.inject({ method: "POST", url: propozycja, headers: b,
    payload: { zwrotId: zwrotDosylki, wersja: 0, odcisk: "" } });
  assert.equal(r.statusCode, 200, r.body);
  const s = r.json<{ sprawa: { wersja: number; odcisk: string; krok: string; prowadzi: string;
    dosylki: Array<{ zamowienie: string; przewoznikZamowienia: string; opis: string }> } }>().sprawa;
  assert.deepEqual([s.krok, s.prowadzi, s.dosylki.map((x) => [x.zamowienie, x.przewoznikZamowienia])],
    ["Dosłać nowy towar (etykieta w Sellasist)", "Ola8", [["ord-2", "INPOST"]]]);

  /* Stara wersja to 409 ze świeżą sprawą — ekran rysuje ją bez drugiego żądania. */
  const k = await app.inject({ method: "POST", url: numer, headers: b,
    payload: { zamowienie: "ord-2", waybill: "AD-TAJNY", przewoznik: "INPOST", wersja: 0, odcisk: s.odcisk } });
  assert.equal(k.statusCode, 409, k.body);
  assert.equal(k.json<{ sprawa: { wersja: number } }>().sprawa.wersja, s.wersja);
  const zly = await app.inject({ method: "POST", url: numer, headers: b,
    payload: { zamowienie: "ord-2", waybill: " ", przewoznik: "INPOST", wersja: s.wersja, odcisk: s.odcisk } });
  assert.equal(zly.statusCode, 400, zly.body);

  const n = await app.inject({ method: "POST", url: numer, headers: b,
    payload: { zamowienie: "ord-2", waybill: " AD-TAJNY ", przewoznik: "INPOST", wersja: s.wersja, odcisk: s.odcisk } });
  assert.equal(n.statusCode, 200, n.body);
  const po = n.json<{ sprawa: { wersja: number; dosylki: Array<{ waybill: string; zrodlo: string }> } }>().sprawa;
  assert.deepEqual([po.wersja, po.dosylki[0].waybill, po.dosylki[0].zrodlo], [s.wersja + 1, "AD-TAJNY", "recznie"]);

  const wpisy = db().prepare("SELECT type, payload FROM events WHERE type LIKE 'klient_%' OR type = 'http_rejected'")
    .all() as Array<{ type: string; payload: string }>;
  assert.ok(wpisy.some((w) => w.payload.includes("/api/obsluga/klient/:login/sprawa/dosylka/numer")),
    "odrzucenie jest w audycie — pod wzorcem trasy");
  assert.doesNotMatch(JSON.stringify(wpisy), /kupujacy2|AD-TAJNY/);
});

test("profil niesie dosyłkę, propozycję i przewoźników — odczyt bez zapisu", async () => {
  const b = login("biuro", "Ola9");
  const zmiany = (db().prepare("SELECT total_changes() AS n").get() as { n: number }).n;
  const p = await app.inject({ method: "GET", url: "/api/obsluga/klient/kupujacy2", headers: b });
  assert.equal(p.statusCode, 200, p.body);
  const j = p.json<{ sprawa: { dosylki: unknown[] }; podpowiedzPowod: string | null; propozycjaDosylki: unknown;
    przewoznicy: string[] }>();
  assert.equal(j.sprawa.dosylki.length, 1);
  assert.equal(j.podpowiedzPowod, null);
  assert.equal(j.propozycjaDosylki, null, "dosyłkę tego zamówienia już śledzimy");
  assert.ok(j.przewoznicy.includes("INPOST"));
  assert.equal((db().prepare("SELECT total_changes() AS n").get() as { n: number }).n, zmiany);
});
