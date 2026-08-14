import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/* ── Korekta ilości odłożonej ────────────────────────────────────────────────
   Sedno: to poprawka POMYŁKI W LICZENIU, a nie twierdzenie o dostawie. Nie
   rusza Subiekta i nie tworzy zgłoszenia — bo do 0.45.0 jedyną drogą było
   właśnie zgłoszenie wyjątku, czyli zamiana pomyłki magazyniera w reklamację
   do dostawcy.

   Druga połowa to granice: pozycja z wyjątkiem i dostawa zamknięta zostają
   nietknięte. Obie są już częścią dokumentu, którego ta funkcja nie widzi.   */

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "wertis-kor-")), "t.db");
process.env.MAG_ID_MAG = "1";
process.env.MAG_ID_MGP = "2";
process.env.MAG_ID_ZWROTY = "3";

let db: typeof import("../db/db.js").db;
let D: typeof import("./delivery.js");

before(async () => {
  ({ db } = await import("../db/db.js"));
  D = await import("./delivery.js");
});

const DOK = 900;

beforeEach(() => {
  for (const t of ["delivery_note", "problem", "delivery_line", "delivery", "events"]) {
    db().prepare(`DELETE FROM ${t}`).run();
  }
});

/** Dostawa z jedną pozycją 10 szt; zwraca id linii. */
function linia(odlozone: number, status = "partial", stanDostawy = "open"): number {
  const id = Number(
    db()
      .prepare(
        `INSERT INTO delivery(sgt_dok_id, sgt_dok_numer, status, opened_at, source_mag_id)
         VALUES (?,?,?,?,1)`
      )
      .run(DOK, `FZ ${DOK}/MAG/08/2026`, stanDostawy, new Date().toISOString()).lastInsertRowid
  );
  return Number(
    db()
      .prepare(
        `INSERT INTO delivery_line(delivery_id, tw_id, tw_symbol, tw_nazwa, ilosc_dok,
                                   ilosc_odlozona, status, lok_faktyczna)
         VALUES (?,?,?,?,10,?,?, 'A01-02-03')`
      )
      .run(id, 101, "W32-0203", "Kosa", odlozone, status).lastInsertRowid
  );
}

const stanLinii = (lineId: number) =>
  db()
    .prepare("SELECT ilosc_odlozona AS qty, status, lok_faktyczna AS lok FROM delivery_line WHERE id=?")
    .get(lineId) as { qty: number; status: string; lok: string | null };

/* ── poprawianie w dół i w górę ───────────────────────────────────────────── */

test("korekta w dół otwiera pozycję z powrotem do dokończenia", () => {
  // „odłożyłem 7, a naprawdę 5" — zostaje 5 do zrobienia, nie wyjątek
  const l = linia(7);
  D.korygujIlosc(l, 5, "Jan z hali");
  const s = stanLinii(l);
  assert.equal(s.qty, 5);
  assert.equal(s.status, "partial");
});

test("korekta do zera wraca do stanu nietkniętego", () => {
  const l = linia(7);
  D.korygujIlosc(l, 0, "Jan z hali");
  assert.equal(stanLinii(l).status, "todo");
});

test("korekta do pełnej ilości domyka pozycję I dostawę", () => {
  const l = linia(7);
  D.korygujIlosc(l, 10, "Jan z hali");
  assert.equal(stanLinii(l).status, "done");
  const d = db().prepare("SELECT status FROM delivery LIMIT 1").get() as { status: string };
  assert.equal(d.status, "done", "ostatnia brakująca sztuka zamyka całą dostawę");
});

test("korekta ustawia wartość BEZWZGLĘDNĄ, nie różnicę", () => {
  // człowiek przy palecie wie, ile odłożył — nie o ile się pomylił
  const l = linia(7);
  D.korygujIlosc(l, 3, "Jan z hali");
  assert.equal(stanLinii(l).qty, 3);
});

/* ── granice ──────────────────────────────────────────────────────────────── */

test("nie da się odłożyć więcej, niż stoi na dokumencie", () => {
  const l = linia(7);
  const r = D.korygujIlosc(l, 11, "Jan z hali");
  assert.ok("error" in r);
  assert.match(r.error, /10/, "komunikat podaje liczbę z dokumentu");
  assert.equal(stanLinii(l).qty, 7, "odmowa niczego nie zmienia");
});

test("ujemna ilość odpada", () => {
  const l = linia(7);
  assert.ok("error" in D.korygujIlosc(l, -1, "Jan z hali"));
  assert.equal(stanLinii(l).qty, 7);
});

test("pozycja ze zgłoszonym wyjątkiem jest nietykalna", () => {
  /* Wyjątek to twierdzenie wobec dostawcy, które żyje w protokole. Ciche
     przestawienie pod nim liczby zmieniałoby dokument, którego ta funkcja
     nie widzi. */
  const l = linia(2, "problem");
  const r = D.korygujIlosc(l, 5, "Jan z hali");
  assert.ok("error" in r);
  assert.match(r.error, /wyjątek/i);
  assert.equal(stanLinii(l).qty, 2);
});

test("zamknięta dostawa nie przyjmuje korekty", () => {
  // „przed zakończeniem faktury" jest częścią zgłoszenia, nie ostrożnością
  const l = linia(7, "partial", "done");
  const r = D.korygujIlosc(l, 5, "Jan z hali");
  assert.ok("error" in r);
  assert.match(r.error, /zamknięta/i);
});

test("nieistniejąca pozycja to błąd, nie ciche nic", () => {
  assert.ok("error" in D.korygujIlosc(999_999, 1, "Jan z hali"));
});

/* ── czego korekta NIE robi ───────────────────────────────────────────────── */

test("nie tworzy zadania w kolejce Sfery", () => {
  /* Adres pojechał do Subiekta przy odkładaniu i zostaje. `ilosc_odlozona` to
     licznik postępu WERTIS — kolejka nie ma się o czym dowiadywać. */
  const l = linia(7);
  D.korygujIlosc(l, 3, "Jan z hali");
  const n = db().prepare("SELECT COUNT(*) AS n FROM sfera_queue").get() as { n: number };
  assert.equal(n.n, 0);
});

test("nie kasuje zapisanego adresu, nawet przy korekcie do zera", () => {
  // adres NAPRAWDĘ pojechał do Subiekta; zero znaczy „nic tu nie leży",
  // a nie „nigdy nie było tu skanu"
  const l = linia(7);
  D.korygujIlosc(l, 0, "Jan z hali");
  assert.equal(stanLinii(l).lok, "A01-02-03");
});

test("nie tworzy wyjątku — to pomyłka w liczeniu, nie reklamacja", () => {
  const l = linia(7);
  D.korygujIlosc(l, 3, "Jan z hali");
  const n = db().prepare("SELECT COUNT(*) AS n FROM problem").get() as { n: number };
  assert.equal(n.n, 0);
});

test("zostawia w audycie obie liczby", () => {
  const l = linia(7);
  D.korygujIlosc(l, 3, "Jan z hali");
  const e = db()
    .prepare("SELECT user_id, payload FROM events WHERE type='putaway_qty_fixed'")
    .get() as { user_id: string; payload: string };
  assert.equal(e.user_id, "Jan z hali");
  const p = JSON.parse(e.payload);
  assert.equal(p.qtyPrzed, 7);
  assert.equal(p.qtyPo, 3);
  assert.equal(p.qtyDok, 10);
});
