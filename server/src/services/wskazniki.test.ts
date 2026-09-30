import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { migrate } from "../db/db.js";
import { PRZERWA_SZUKANIA_MS, sesjeSzukania, wskazniki, type ZdarzenieSzukania } from "./wskazniki.js";

/* Pilnujemy reguł, od których zależy, czy trzy liczby mówią prawdę: seria
   szukań to jedno szukanie, zdarzenie bez `zAdresem` nie udaje zera, panel
   nie wchodzi do szukań, a poprzedni okres nie zachodzi na bieżący. */

const schema = fs.readFileSync(new URL("../db/schema.sql", import.meta.url), "utf8");
const TERAZ = Date.parse("2026-09-29T12:00:00Z");
const temu = (dni: number, godzin = 0) => new Date(TERAZ - dni * 86_400_000 - godzin * 3_600_000).toISOString();

function baza() {
  const d = new DatabaseSync(":memory:");
  d.exec(schema);
  migrate(d);
  return d;
}

let nrDok = 0;
function dostawa(d: DatabaseSync, o: { dataDok: string; otwarta: string; zamknieta: string; status?: string }) {
  d.prepare(`INSERT INTO delivery(sgt_dok_id, sgt_dok_numer, data_dok, status, opened_at, closed_at)
    VALUES (?,?,?,?,?,?)`).run(++nrDok, `FZ ${nrDok}`, o.dataDok, o.status ?? "done", o.otwarta, o.zamknieta);
}

function szukanie(d: DatabaseSync, at: string, payload: object, urzadzenie: string | null = "kol-1") {
  d.prepare("INSERT INTO events(type, payload, user_id, device_id, created_at) VALUES ('search', ?, 'ala', ?, ?)")
    .run(JSON.stringify(payload), urzadzenie, at);
}

const z = (at: string, wynikow: number, zAdresem: number | null, urzadzenie = "kol-1"): ZdarzenieSzukania =>
  ({ urzadzenie, at, wynikow, zAdresem });

test("seria zapytań w trakcie pisania to jedno szukanie, liczy się ostatnie", () => {
  const t0 = Date.parse("2026-09-29T10:00:00Z");
  const at = (ms: number) => new Date(t0 + ms).toISOString();
  const w = sesjeSzukania([
    z(at(0), 0, 0),
    z(at(2_000), 12, 0),
    z(at(4_000), 3, 2),
    z(at(4_000 + PRZERWA_SZUKANIA_MS), 0, 0),
  ]);
  assert.deepEqual(w, ["adres", "brak"], "„gaz”, „gazn”, „gaznik” to jedno szukanie z adresem; po przerwie nowe");
});

test("urządzenia mają osobne serie, a zdarzenie bez `zAdresem` nie ma wyniku", () => {
  const w = sesjeSzukania([
    z("2026-09-29T10:00:00.000Z", 4, 0, "kol-1"),
    z("2026-09-29T10:00:01.000Z", 4, 1, "kol-2"),
    z("2026-09-29T10:05:00.000Z", 4, null, "kol-1"),
  ]);
  assert.deepEqual(w.sort(), ["adres", "bez_adresu"]);
});

test("dostawa: dni od daty faktury i minuty pracy, bez dostaw rozłożonych poza WERTIS", () => {
  const d = baza();
  dostawa(d, { dataDok: "2026-09-21", otwarta: "2026-09-23T08:00:00Z", zamknieta: "2026-09-23T09:00:00Z" });
  dostawa(d, { dataDok: "2026-09-24", otwarta: "2026-09-24T08:00:00Z", zamknieta: "2026-09-24T08:30:00Z" });
  dostawa(d, { dataDok: "2026-09-25", otwarta: "2026-09-25T08:00:00Z", zamknieta: "2026-09-28T08:00:00Z",
    status: "external" });
  const w = wskazniki(7, d, TERAZ).teraz.dostawy;
  assert.equal(w.n, 2);
  assert.equal(w.medianaDni, 1, "mediana z 2 i 0 dni");
  assert.equal(w.medianaMinPracy, 45);
});

test("szukanie: tylko kolektor, odsetek z wyników serii", () => {
  const d = baza();
  szukanie(d, temu(1), { q: "gaźnik", wynikow: 2, zAdresem: 1 });
  szukanie(d, temu(2), { q: "linka", wynikow: 3, zAdresem: 0 });
  szukanie(d, temu(3), { q: "xyz", wynikow: 0, zAdresem: 0 });
  szukanie(d, temu(3, 2), { q: "stare", wynikow: 5 });
  szukanie(d, temu(4), { q: "biuro", wynikow: 1, zAdresem: 1 }, null);
  const s = wskazniki(7, d, TERAZ).teraz.szukanie;
  assert.deepEqual(s, { n: 3, zAdresem: 1, bezAdresu: 1, bezWyniku: 1, odsetekZAdresem: 33 });
});

test("brak próbki to null, a poprzedni okres nie zachodzi na bieżący", () => {
  const d = baza();
  dostawa(d, { dataDok: "2026-09-10", otwarta: "2026-09-18T08:00:00Z", zamknieta: "2026-09-18T10:00:00Z" });
  const w = wskazniki(7, d, TERAZ);
  assert.equal(w.teraz.dostawy.n, 0);
  assert.equal(w.teraz.dostawy.medianaDni, null);
  assert.equal(w.teraz.szukanie.odsetekZAdresem, null);
  assert.equal(w.teraz.odpowiedz.medianaMin, null);
  assert.equal(w.poprzednio.dostawy.n, 1, "dostawa sprzed 11 dni należy do poprzedniego tygodnia");
  assert.equal(w.poprzednio.dostawy.medianaDni, 8);
  assert.equal(w.poprzednio.do, w.teraz.od);
});
