import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/* ── Szukanie zgubionego kolektora ───────────────────────────────────────────
   Pilnuje trzech rzeczy, których nie widać z ekranu:
   - pytanie kolektora nie zapisuje do bazy (zero zapisu przy patrzeniu);
   - wezwanie wygasa samo i nie dzwoni po czasie;
   - odnalezienie i odwołanie to dwa różne wpisy audytu.               */

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "wertis-szukanie-")), "t.db");

let db: typeof import("../db/db.js").db;
let S: typeof import("./szukanie-kolektora.js");
let createUser: typeof import("./users.js").createUser;

before(async () => {
  ({ db } = await import("../db/db.js"));
  S = await import("./szukanie-kolektora.js");
  ({ createUser } = await import("./users.js"));
});

const T0 = Date.parse("2026-09-23T08:00:00.000Z");
const iso = (ms: number) => new Date(ms).toISOString();

beforeEach(() => {
  for (const t of ["events", "device_session", "app_user"]) db().prepare(`DELETE FROM ${t}`).run();
  S.wyczyscSzukanie();
});

function sesja(osoba: string, device: string | null, lastSeen: number, wylogowana = false): void {
  const u = createUser(osoba, "magazynier", `l${Math.random()}`, "tajnehaslo");
  db()
    .prepare(
      "INSERT INTO device_session(token,user_id,device_id,created_at,last_seen,revoked_at) VALUES (?,?,?,?,?,?)"
    )
    .run(`t${Math.random()}`, u.userId, device, iso(lastSeen), iso(lastSeen), wylogowana ? iso(lastSeen) : null);
}

const zdarzenia = () =>
  db().prepare("SELECT type, payload FROM events ORDER BY id").all() as Array<{ type: string; payload: string }>;

test("etykieta: cztery ostatnie znaki, bez kresek, wielkimi literami", () => {
  assert.equal(S.etykietaUrzadzenia("3f2a9c1e-7b4d-4e0a-9f1b-0c2d5e6fa3f9"), "#A3F9");
  assert.equal(S.etykietaUrzadzenia("TC21-07"), "#2107");
  assert.equal(S.etykietaUrzadzenia("---"), "#????");
});

test("lista: jeden wiersz na urządzenie, najświeższa osoba, bez sesji panelu i bez starych", () => {
  sesja("Jan", "kol-aaaa", T0 - 3_600_000);
  sesja("Ola", "kol-aaaa", T0 - 60_000); // ten sam kolektor, później
  sesja("Biuro", null, T0 - 1_000); // panel nie niesie x-device
  sesja("Piotr", "kol-bbbb", T0 - 40 * 86_400_000); // wycofany dawno temu
  const l = S.kolektory(T0);
  assert.equal(l.length, 1);
  assert.equal(l[0].osoba, "Ola");
  assert.equal(l[0].etykieta, "#AAAA");
  assert.equal(l[0].zalogowany, true);
  assert.equal(l[0].slucha, false, "bez pytania o wezwanie kolektor nie słucha");
});

test("wylogowany kolektor jest na liście, ale jako wylogowany", () => {
  sesja("Jan", "kol-aaaa", T0 - 60_000, true);
  assert.equal(S.kolektory(T0)[0].zalogowany, false);
});

test("wezwanie → kolektor pyta → dzwoni, a szukający widzi odebranie", () => {
  sesja("Jan", "kol-aaaa", T0 - 60_000);
  const w = S.wezwij("kol-aaaa", "Ola", T0);
  assert.ok(!("error" in w));
  assert.equal(w.wezwanie?.odebrane, false, "kolektor jeszcze nie zapytał");

  const u = S.sprawdzWezwanie("kol-aaaa", T0 + 5_000);
  assert.equal(u?.przez, "Ola");
  const k = S.kolektory(T0 + 6_000)[0];
  assert.equal(k.wezwanie?.odebrane, true);
  assert.equal(k.slucha, true);
});

test("pytanie kolektora nie zapisuje do bazy", () => {
  sesja("Jan", "kol-aaaa", T0 - 60_000);
  S.wezwij("kol-aaaa", "Ola", T0);
  const przed = zdarzenia().length;
  const zmiany = () => (db().prepare("SELECT total_changes() AS n").get() as { n: number }).n;
  const z0 = zmiany();
  S.sprawdzWezwanie("kol-aaaa", T0 + 1_000);
  S.sprawdzWezwanie("kol-aaaa", T0 + 11_000);
  S.kolektory(T0 + 12_000);
  assert.equal(zmiany(), z0, "ani jednego wiersza zmienionego przy patrzeniu");
  assert.equal(zdarzenia().length, przed);
});

test("wezwanie wygasa samo — kolektor po czasie nie dzwoni", () => {
  sesja("Jan", "kol-aaaa", T0 - 60_000);
  S.wezwij("kol-aaaa", "Ola", T0);
  assert.ok(S.sprawdzWezwanie("kol-aaaa", T0 + S.CZAS_WEZWANIA_MS - 1));
  assert.equal(S.sprawdzWezwanie("kol-aaaa", T0 + S.CZAS_WEZWANIA_MS), null);
  assert.equal(S.kolektory(T0 + S.CZAS_WEZWANIA_MS)[0].wezwanie, null);
});

test("kolektor przestaje słuchać po trzech przegapionych pytaniach", () => {
  sesja("Jan", "kol-aaaa", T0 - 60_000);
  S.sprawdzWezwanie("kol-aaaa", T0);
  assert.equal(S.kolektory(T0 + S.SLUCHA_MS)[0].slucha, true);
  assert.equal(S.kolektory(T0 + S.SLUCHA_MS + 1)[0].slucha, false);
});

test("ponowne wezwanie przedłuża czas i zostawia odebranie", () => {
  sesja("Jan", "kol-aaaa", T0 - 60_000);
  S.wezwij("kol-aaaa", "Ola", T0);
  S.sprawdzWezwanie("kol-aaaa", T0 + 1_000);
  const w = S.wezwij("kol-aaaa", "Piotr", T0 + 60_000);
  assert.ok(!("error" in w));
  assert.equal(w.wezwanie?.przez, "Piotr");
  assert.equal(w.wezwanie?.odebrane, true, "kolektor już dzwoni — nie wraca do „czeka”");
  assert.equal(w.wezwanie?.doKiedy, iso(T0 + 60_000 + S.CZAS_WEZWANIA_MS));
  const p = JSON.parse(zdarzenia().at(-1)!.payload) as { ponownie: boolean };
  assert.equal(p.ponownie, true);
});

test("nieznany i wycofany kolektor — odmowa zdaniem, bez wpisu do audytu", () => {
  sesja("Piotr", "kol-stary", T0 - 40 * 86_400_000); // poza oknem listy
  for (const id of ["nie-ma-takiego", "kol-stary"]) {
    const r = S.wezwij(id, "Ola", T0);
    assert.ok("error" in r, id);
  }
  assert.equal(zdarzenia().length, 0);
  assert.equal(S.sprawdzWezwanie("kol-stary", T0 + 1_000), null, "odmowa niczego nie zostawia");
});

test("odnalezienie z kolektora i odwołanie przez szukającego to dwa różne zdarzenia", () => {
  sesja("Jan", "kol-aaaa", T0 - 60_000);
  sesja("Ewa", "kol-bbbb", T0 - 60_000);
  S.wezwij("kol-aaaa", "Ola", T0);
  S.wezwij("kol-bbbb", "Ola", T0);
  assert.deepEqual(S.zakonczSzukanie("kol-aaaa", "Jan", true, T0 + 42_000), { bylo: true });
  assert.deepEqual(S.zakonczSzukanie("kol-bbbb", "Ola", false, T0 + 50_000), { bylo: true });
  // drugi raz nie ma czego kończyć — i nie ma czego logować
  assert.deepEqual(S.zakonczSzukanie("kol-bbbb", "Ola", false, T0 + 51_000), { bylo: false });

  const typy = zdarzenia().map((z) => z.type);
  assert.deepEqual(typy, [
    "kolektor_wezwany",
    "kolektor_wezwany",
    "kolektor_odnaleziony",
    "kolektor_wezwanie_odwolane",
  ]);
  const p = JSON.parse(zdarzenia()[2].payload) as { wezwal: string; poSekundach: number };
  assert.equal(p.wezwal, "Ola");
  assert.equal(p.poSekundach, 42);
  assert.equal(S.sprawdzWezwanie("kol-aaaa", T0 + 60_000), null);
});
