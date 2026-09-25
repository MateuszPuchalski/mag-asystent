import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/* ── DO DECYZJI ──────────────────────────────────────────────────────────────
   Dwie gwarancje trzymają ten plik. Pierwsza: lista jest ODCZYTEM — nie ma
   własnej tabeli ani statusu i nie zmienia bazy (`CLAUDE.md`, zakaz piątej
   tabeli nad kolejkami, i umowa „zero zapisu przy patrzeniu"). Druga: sprawa
   GAŚNIE razem z przyczyną, bo lista nie ma własnego „załatwione" — gdyby
   miała, wyjątek zamknięty w dostawie wisiałby tu dalej. */

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "wertis-do-decyzji-")), "t.db");

let db: typeof import("../db/db.js").db;
let D: typeof import("./do-decyzji.js");

before(async () => {
  ({ db } = await import("../db/db.js"));
  D = await import("./do-decyzji.js");
});

beforeEach(() => {
  const d = db();
  for (const t of ["problem", "delivery_line", "delivery", "delivery_note", "sfera_queue", "events",
    "kosz_pozycja", "kosz"]) {
    d.prepare(`DELETE FROM ${t}`).run();
  }
});

function dostawa(dokId: number, dostawca = "Rosa-Pol"): number {
  return Number(db().prepare(
    `INSERT INTO delivery(sgt_dok_id, sgt_dok_numer, dostawca, data_dok, status, opened_at, source_mag_id)
     VALUES (?,?,?,?, 'open', '2026-09-20T08:00:00.000Z', 1)`,
  ).run(dokId, `FZ ${dokId}/MAG/09/2026`, dostawca, "2026-09-20").lastInsertRowid);
}

function wyjatek(deliveryId: number | null, createdAt: string): number {
  return Number(db().prepare(
    `INSERT INTO problem(delivery_id, typ, opis, created_at, created_by)
     VALUES (?, 'damaged', 'pęknięta donica', ?, 'm.nowak')`,
  ).run(deliveryId, createdAt).lastInsertRowid);
}

test("wyjątki jednej faktury dają JEDEN wiersz z adresem dokumentu w panelu", () => {
  const id = dostawa(802);
  wyjatek(id, "2026-09-21T14:02:00.000Z");
  wyjatek(id, "2026-09-21T14:05:00.000Z");
  const w = D.doDecyzji().pozycje.filter((p) => p.zrodlo === "dostawy");
  assert.equal(w.length, 1, "reklamuje się fakturę, nie pojedynczą pozycję");
  assert.deepEqual(w[0].cel, { panel: "/obsluga/dostawy/802" });
  assert.match(w[0].co, /FZ 802\/MAG\/09\/2026 · Rosa-Pol · 2 wyjątki/);
  assert.equal(w[0].od, "2026-09-21T14:02:00.000Z", "wiek liczy się od NAJSTARSZEGO wyjątku");
});

test("zamknięty wyjątek gaśnie na liście bez żadnego zapisu po jej stronie", () => {
  const p = wyjatek(dostawa(803), "2026-09-21T10:00:00.000Z");
  assert.equal(D.doDecyzji().liczniki.magazyn, 1);
  db().prepare("UPDATE problem SET resolved_at='2026-09-21T12:00:00.000Z' WHERE id=?").run(p);
  assert.equal(D.doDecyzji().liczniki.magazyn, 0,
    "lista nie ma własnego „załatwione” — gaśnie razem z przyczyną");
});

test("wyjątek bez dostawy nie ginie — ma własny wiersz", () => {
  wyjatek(null, "2026-09-21T10:00:00.000Z");
  const w = D.doDecyzji().pozycje.find((p) => p.klucz === "dostawa:bez-dokumentu");
  assert.ok(w, "towar spoza dokumentu dalej czeka na decyzję");
  assert.deepEqual(w.cel, { panel: "/obsluga/dostawy" });
});

test("odpowiedź hali prowadzi do dokumentu, a przeczytana znika", () => {
  const n = Number(db().prepare(
    `INSERT INTO delivery_note(sgt_dok_id, tresc, created_at, created_by, odpowiedz, odp_at, odp_by)
     VALUES (815, 'Dosłali?', '2026-09-21T15:10:00.000Z', 'a.kowalska', 'Tak, dwie sztuki',
             '2026-09-21T15:44:00.000Z', 'j.wrona')`,
  ).run().lastInsertRowid);
  const w = D.doDecyzji().pozycje.find((p) => p.zrodlo === "odpowiedzi");
  assert.deepEqual(w?.cel, { panel: "/obsluga/dostawy/815" });
  db().prepare("UPDATE delivery_note SET odp_widziana_at='2026-09-21T16:00:00.000Z' WHERE id=?").run(n);
  assert.equal(D.doDecyzji().pozycje.filter((p) => p.zrodlo === "odpowiedzi").length, 0);
});

test("zapis do Subiekta w błędzie jest pilny i idzie przed starszą sprawą", () => {
  wyjatek(dostawa(804), "2026-09-01T10:00:00.000Z");
  db().prepare(
    `INSERT INTO sfera_queue(type, status, payload, label, error_msg, created_at, created_by)
     VALUES ('set_location', 'error', '{}', 'RP-2201 → R-07-1', 'brak stanu', '2026-09-21T10:00:00.000Z', 'x')`,
  ).run();
  const [pierwsza, druga] = D.doDecyzji().pozycje;
  assert.equal(pierwsza.zrodlo, "zapisy", "pilne przebija wiek");
  assert.equal(pierwsza.pilne, true);
  assert.deepEqual(pierwsza.cel, { panel: "/obsluga/stan?karta=kolejka" },
    "zapis w błędzie prowadzi do karty kolejki w stanie systemu (0.441.0)");
  assert.equal(druga.zrodlo, "dostawy");
});

test("pominięta pozycja kosza prowadzi do koszy w zakładce Zwroty (0.438.0)", () => {
  /* Kosze przeszły z MAGAZYNU ZWROTÓW w biurze do panelu — wiersz ma
     prowadzić tam, gdzie leży ZAŁATWIONE, a nie do widoku, którego już nie ma. */
  const k = Number(db().prepare(`INSERT INTO kosz(kod, status, utworzono_at, utworzono_przez)
    VALUES ('Z-14', 'zamkniety', '2026-09-20T08:00:00.000Z', 'Ala')`).run().lastInsertRowid);
  db().prepare(`INSERT INTO kosz_pozycja(kosz_id, tw_id, symbol, nazwa, ilosc, status, powod, pominieto_at)
    VALUES (?, 8, 'HM-0520', 'Gaźnik', 2, 'skipped', 'brak w pudle', '2026-09-21T09:00:00.000Z')`).run(k);
  const w = D.doDecyzji().pozycje.find((p) => p.zrodlo === "kosze");
  assert.ok(w, "pominięcie czeka na biuro");
  assert.deepEqual(w.cel, { panel: `/obsluga/zwroty/kosze/${k}?kubelek=pominiete` },
    "kosz i kubełek pominiętych — 0.502.0; wcześniej wiersz lądował w kubełku „praca”");
  assert.match(w.co, /HM-0520 · Z-14 · brak w pudle/);
});

test("liczniki obszarów sumują się do całości", () => {
  wyjatek(dostawa(805), "2026-09-21T10:00:00.000Z");
  const { pozycje, liczniki } = D.doDecyzji();
  assert.equal(liczniki.wszystko, pozycje.length);
  assert.equal(liczniki.magazyn + liczniki.obsluga, liczniki.wszystko);
});

test("odczyt nie zmienia bazy — ani jednego wiersza", () => {
  wyjatek(dostawa(806), "2026-09-21T10:00:00.000Z");
  const zmian = () => (db().prepare("SELECT total_changes() AS n").get() as { n: number }).n;
  const przed = zmian();
  D.doDecyzji();
  assert.equal(zmian(), przed, "patrzenie na listę niczego nie mutuje");
});

test("serwis nie zakłada tabeli ani nie pisze — sprawdzone po źródle", () => {
  /* Zakaz z `CLAUDE.md`: piątej tabeli ze wspólnym statusem nad kolejkami nie
     było i nie będzie. Test po źródle, bo taka tabela zaczyna się od jednej
     linijki „na razie tylko pamięć odczytu". */
  const zrodlo = fs.readFileSync(path.join(import.meta.dirname, "do-decyzji.ts"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  assert.doesNotMatch(zrodlo, /CREATE\s+TABLE/i);
  assert.doesNotMatch(zrodlo, /\b(INSERT|UPDATE|DELETE)\b/i);
  assert.doesNotMatch(zrodlo, /logEvent/, "odczyt nie zostawia śladu w dzienniku");
});
