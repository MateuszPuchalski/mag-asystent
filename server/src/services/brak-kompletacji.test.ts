import { before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "wertis-brak-")), "t.db");
process.env.SGT_MODE = "seeded";
process.env.STREFA_CZASU = "Europe/Warsaw";

/* ── Brak z kompletacji po godzinie granicznej ───────────────────────────────
   Pilnujemy reguły właściciela:
   - kurier inny niż InPost o 12:00, InPost o 15:00, czasu magazynu;
   - InPost poznajemy po metodzie dostawy albo po etykiecie;
   - wejście po godzinie granicznej staje od razu;
   - „Klient powiadomiony” gasi to wejście, a nowe wejście wraca;
   - tylko oryginały zamówień z Allegro. */

let db: typeof import("../db/db.js").db;
let B: typeof import("./brak-kompletacji.js");

/* 20 października to jeszcze czas letni: magazyn = UTC + 2 h. */
const U = { statusyBrak: [12], brakGodzina: 12, brakGodzinaInpost: 15 };
const RANO = "2026-10-20T06:30:00.000Z"; // 8:30 w magazynie

before(async () => {
  ({ db } = await import("../db/db.js"));
  B = await import("./brak-kompletacji.js");
});

let autor = { id: 0, name: "Ola" };

beforeEach(() => {
  for (const t of ["sellasist_pozycja", "sellasist_przesylka", "sellasist_zamowienie", "sellasist_brak_powiadomiony",
    "events", "klient_prowadzenie", "zamowienie_klienta", "channel_account", "app_user"]) db().exec(`DELETE FROM ${t}`);
  const konto = Number(db().prepare("INSERT INTO channel_account(channel, external_account_id) VALUES ('allegro','b')")
    .run().lastInsertRowid);
  /* Profil i sprawa znają klienta z zamówienia Allegro, nie z lustra Sellasist. */
  db().prepare(`INSERT INTO zamowienie_klienta(channel_account_id, external_id, kupujacy_login, synced_at)
    VALUES (?, ?, 'Ogrodnik_77', 'x')`).run(konto, uuid(1));
  autor = { id: Number(db().prepare("INSERT INTO app_user(login, name, role) VALUES ('ola', 'Ola', 'biuro')")
    .run().lastInsertRowid), name: "Ola" };
});

const uuid = (n: number) => `29a1c2b0-0000-11ef-9a00-${String(n).padStart(12, "0")}`;

function zamowienie(id: number, n: Partial<Record<string, unknown>> = {}) {
  const w = { external_id: uuid(id), kupujacy_login: "Ogrodnik_77", zrodlo: "allegro", status_id: 12,
    status_at: RANO, dostawa: "Allegro Kurier DPD", skopiowane_z: null, ...n };
  db().prepare(`INSERT INTO sellasist_zamowienie(id, external_id, kupujacy_login, zrodlo, status_id, status_at,
      dostawa, skopiowane_z, pobrano_at) VALUES (?,?,?,?,?,?,?,?,'x')`)
    .run(id, w.external_id as string, w.kupujacy_login as string, w.zrodlo as string, w.status_id as number,
      w.status_at as string, w.dostawa as string | null, w.skopiowane_z as number | null);
}

function pozycja(zam: number, koszyk: number, nazwa: string, ilosc: number, brakuje: number) {
  db().prepare(`INSERT INTO sellasist_pozycja(koszyk_id, zamowienie_id, nazwa, ilosc, brakuje) VALUES (?,?,?,?,?)`)
    .run(koszyk, zam, nazwa, ilosc, brakuje);
}

const o = (iso: string) => new Date(iso);

test("godzina graniczna: 12:00 przy kurierze, 15:00 przy InPost, wejście po niej staje od razu", () => {
  assert.equal(B.terminBraku(RANO, false, U), "2026-10-20T10:00:00.000Z");
  assert.equal(B.terminBraku(RANO, true, U), "2026-10-20T13:00:00.000Z");
  assert.equal(B.terminBraku("2026-10-20T11:00:00.000Z", false, U), "2026-10-20T11:00:00.000Z",
    "13:00 w magazynie, kurier już pojechał");
  /* Po zmianie czasu godzina zostaje godziną na ścianie magazynu. */
  assert.equal(B.terminBraku("2026-10-27T07:00:00.000Z", false, U), "2026-10-27T11:00:00.000Z");
});

test("przed godziną graniczną wiersza nie ma, po niej jest z brakami i resztą zamówienia", () => {
  zamowienie(1);
  pozycja(1, 10, "Pasek klinowy", 2, 2);
  pozycja(1, 11, "Nóż do kosiarki", 1, 0);
  assert.deepEqual(B.brakiPoTerminie(db(), o("2026-10-20T09:59:00.000Z"), U), []);
  assert.deepEqual(B.brakiPoTerminie(db(), o("2026-10-20T10:00:00.000Z"), U), [{
    zamowienieId: 1, externalId: uuid(1), login: "Ogrodnik_77", statusAt: RANO,
    terminAt: "2026-10-20T10:00:00.000Z", inpost: false,
    braki: [{ nazwa: "Pasek klinowy", potrzeba: 2, jest: 0 }], reszta: ["Nóż do kosiarki ×1"],
  }]);
});

test("InPost po metodzie dostawy albo po etykiecie czeka do 15:00", () => {
  zamowienie(1, { dostawa: "Allegro Paczkomaty InPost" });
  zamowienie(2, { dostawa: null });
  db().prepare(`INSERT INTO sellasist_przesylka(zamowienie_id, waybill, usluga, przewoznik) VALUES (2, 'A1', 'x', 'INPOST')`)
    .run();
  zamowienie(3, { dostawa: null });
  const o14 = B.brakiPoTerminie(db(), o("2026-10-20T12:00:00.000Z"), U);
  assert.deepEqual(o14.map((b) => b.zamowienieId), [3], "nieznany przewoźnik dostaje wcześniejszą godzinę");
  assert.deepEqual(B.brakiPoTerminie(db(), o("2026-10-20T13:00:00.000Z"), U).map((b) => [b.zamowienieId, b.inpost]),
    [[1, true], [2, true], [3, false]]);
});

test("tylko oryginały z Allegro w statusie braku; bez ustawienia nic", () => {
  zamowienie(1);
  zamowienie(2, { zrodlo: "emag" });
  zamowienie(3, { skopiowane_z: 1 });
  zamowienie(4, { status_id: 13 });
  zamowienie(5, { external_id: "ALG-5" });
  const po = o("2026-10-20T11:00:00.000Z");
  assert.deepEqual(B.brakiPoTerminie(db(), po, U).map((b) => b.zamowienieId), [1]);
  assert.deepEqual(B.brakiPoTerminie(db(), po, { ...U, statusyBrak: [] }), []);
});

test("„Klient powiadomiony” stawia krok w sprawie klienta i gasi to wejście w brak; ponowny brak wraca", () => {
  zamowienie(1);
  const po = o("2026-10-20T11:00:00.000Z");
  const w = B.oznaczPowiadomiony(db(), 1, RANO, autor, po, [12]);
  assert.deepEqual(w, { zalozona: true, login: "Ogrodnik_77",
    krok: "Brak z kompletacji przy zamówieniu 29a1c2b0: czekamy na decyzję klienta",
    krokDo: w.krokDo, zastapil: null });
  assert.ok(Date.parse(w.krokDo) > po.getTime(), "termin to następny dzień roboczy");
  const sprawa = db().prepare("SELECT krok, prowadzi_user_id FROM klient_prowadzenie WHERE login = 'Ogrodnik_77'")
    .get() as { krok: string; prowadzi_user_id: number };
  assert.equal(sprawa.krok, w.krok, "sprawa na profilu i w „Moje” mówi, że czekamy na klienta");
  assert.equal(sprawa.prowadzi_user_id, autor.id);
  B.oznaczPowiadomiony(db(), 1, RANO, autor, po, [12]);
  assert.deepEqual(B.brakiPoTerminie(db(), po, U), []);
  const zdarzenia = db().prepare("SELECT type, payload FROM events WHERE type = 'sellasist_brak_powiadomiony'")
    .all() as Array<{ type: string; payload: string }>;
  assert.equal(zdarzenia.length, 1, "drugie kliknięcie bez wpisu");
  assert.ok(!zdarzenia[0].payload.includes("Ogrodnik"), "do dziennika idzie numer, nie login");
  db().prepare("UPDATE sellasist_zamowienie SET status_at = '2026-10-21T06:00:00.000Z' WHERE id = 1").run();
  assert.deepEqual(B.brakiPoTerminie(db(), o("2026-10-21T10:30:00.000Z"), U).map((b) => b.zamowienieId), [1]);
});

test("przycisk przy zmienionym zamówieniu to 409, przy nieznanym 404", () => {
  zamowienie(1);
  assert.throws(() => B.oznaczPowiadomiony(db(), 99, RANO, autor, new Date(), [12]),
    (e: unknown) => e instanceof B.BladBraku && e.kod === 404);
  assert.throws(() => B.oznaczPowiadomiony(db(), 1, "2026-10-19T06:30:00.000Z", autor, new Date(), [12]),
    (e: unknown) => e instanceof B.BladBraku && e.kod === 409, "inne wejście w status");
  db().prepare("UPDATE sellasist_zamowienie SET status_id = 43 WHERE id = 1").run();
  assert.throws(() => B.oznaczPowiadomiony(db(), 1, RANO, autor, new Date(), [12]),
    (e: unknown) => e instanceof B.BladBraku && e.kod === 409, "towar się znalazł");
  assert.equal((db().prepare("SELECT COUNT(*) AS n FROM sellasist_brak_powiadomiony").get() as { n: number }).n, 0);
});

test("klient nieznany WERTIS: 409 bez zapisu, bo powiadomienie bez kroku zgubiłoby sprawę", () => {
  zamowienie(1, { kupujacy_login: "Nowy_Kupiec" });
  assert.throws(() => B.oznaczPowiadomiony(db(), 1, RANO, autor, new Date(), [12]),
    (e: unknown) => e instanceof B.BladBraku && e.kod === 409 && /nie zna jeszcze/.test(e.message));
  assert.equal((db().prepare("SELECT COUNT(*) AS n FROM sellasist_brak_powiadomiony").get() as { n: number }).n, 0);
});
