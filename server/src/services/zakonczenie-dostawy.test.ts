import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/* ── Zakończenie dostawy ─────────────────────────────────────────────────────
   Sedno tych testów to JEDNO rozróżnienie, na którym stoi cała operacja:

     odłożono 7 z 10  → wyjątek „zła ilość"  (towar policzono, było go mniej),
     odłożono 0 z 10  → pominięte, BEZ zgłoszenia (nikt tego nie otworzył).

   Zatarcie tej granicy psuje się w jedną albo w drugą stronę, i obie są drogie.
   Zgłaszanie pozycji nietkniętych robi z porzuconej pracy reklamację do
   dostawcy — pismo o towarze, którego nikt nie widział. Pomijanie braków
   ilościowych gubi różnicę między dokumentem a półką bez śladu, a to jest
   jedyny moment, w którym ktoś ją jeszcze pamięta.                            */

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "wertis-zak-")), "t.db");
process.env.MAG_ID_MAG = "1";
process.env.MAG_ID_MGP = "2";
process.env.MAG_ID_ZWROTY = "3";

let db: typeof import("../db/db.js").db;
let D: typeof import("./delivery.js");
let P: typeof import("./problems.js");

before(async () => {
  ({ db } = await import("../db/db.js"));
  D = await import("./delivery.js");
  P = await import("./problems.js");
});

const DOK = 700;

beforeEach(() => {
  const d = db();
  for (const t of ["problem", "delivery_line", "delivery", "events"]) {
    d.prepare(`DELETE FROM ${t}`).run();
  }
});

/** Dostawa otwarta z zadanym zestawem pozycji. */
function dostawa(pozycje: Array<{ dok: number; odlozone: number; status?: string }>): number {
  const id = Number(
    db()
      .prepare(
        `INSERT INTO delivery(sgt_dok_id, sgt_dok_numer, status, opened_at, source_mag_id)
         VALUES (?,?, 'open', ?, 1)`
      )
      .run(DOK, `FZ ${DOK}/MAG/08/2026`, new Date().toISOString()).lastInsertRowid
  );
  pozycje.forEach((p, i) => {
    db()
      .prepare(
        `INSERT INTO delivery_line(delivery_id, tw_id, tw_symbol, tw_nazwa, ilosc_dok, ilosc_odlozona, status)
         VALUES (?,?,?,?,?,?,?)`
      )
      .run(
        id,
        100 + i,
        `W32-020${i}`,
        `Towar ${i}`,
        p.dok,
        p.odlozone,
        p.status ?? (p.odlozone > 0 ? "partial" : "todo")
      );
  });
  return id;
}

const statusy = (deliveryId: number): string[] =>
  (
    db()
      .prepare("SELECT status FROM delivery_line WHERE delivery_id = ? ORDER BY id")
      .all(deliveryId) as Array<{ status: string }>
  ).map((r) => r.status);

const stanDostawy = (id: number): string =>
  (db().prepare("SELECT status FROM delivery WHERE id = ?").get(id) as { status: string }).status;

/* ── podgląd ──────────────────────────────────────────────────────────────── */

test("podgląd dzieli otwarte pozycje na braki i nietknięte", () => {
  const id = dostawa([{ dok: 10, odlozone: 7 }, { dok: 5, odlozone: 0 }]);
  const p = D.podgladZakonczenia(id);
  assert.equal(p.braki.length, 1);
  assert.equal(p.braki[0].qtyDone, 7);
  assert.equal(p.braki[0].qtyDoc, 10);
  assert.equal(p.nietkniete.length, 1);
  assert.equal(p.nietkniete[0].qtyDoc, 5);
});

test("podgląd niczego nie zapisuje", () => {
  // przycisk pokazuje skutek PRZED zapisem, więc podgląd musi być czysty
  const id = dostawa([{ dok: 10, odlozone: 7 }]);
  D.podgladZakonczenia(id);
  assert.deepEqual(statusy(id), ["partial"]);
  assert.equal(P.listUnresolved().length, 0);
  assert.equal(stanDostawy(id), "open");
});

test("pozycje już domknięte nie wchodzą do podsumowania", () => {
  const id = dostawa([
    { dok: 10, odlozone: 10, status: "done" },
    { dok: 4, odlozone: 0, status: "skipped" },
    { dok: 3, odlozone: 1, status: "problem" },
  ]);
  const p = D.podgladZakonczenia(id);
  assert.deepEqual(p.braki, []);
  assert.deepEqual(p.nietkniete, []);
});

/* ── zapis ────────────────────────────────────────────────────────────────── */

test("brak ilościowy staje się wyjątkiem „zła ilość” z obiema liczbami", () => {
  const id = dostawa([{ dok: 10, odlozone: 7 }]);
  D.zakonczDostawe(id, "Jan z hali");
  const wyjatki = P.listUnresolved();
  assert.equal(wyjatki.length, 1);
  assert.equal(wyjatki[0].typ, "qty_mismatch");
  assert.equal(wyjatki[0].qty, 7, "ile faktycznie przyszło");
  assert.equal(wyjatki[0].qtyDok, 10, "ile stało na dokumencie");
  assert.deepEqual(statusy(id), ["problem"]);
});

test("pozycja nietknięta jest POMINIĘTA, a nie zgłoszona dostawcy", () => {
  /* To jest cała granica tej operacji: nikt nie otworzył tego kartonu, więc
     twierdzenie wobec dostawcy nie miałoby pokrycia. */
  const id = dostawa([{ dok: 5, odlozone: 0 }]);
  D.zakonczDostawe(id, "Jan z hali");
  assert.deepEqual(statusy(id), ["skipped"]);
  assert.equal(P.listUnresolved().length, 0, "brak pracy to nie brak towaru");
});

test("dostawa domyka się po zakończeniu, razem z pozycjami nietkniętymi", () => {
  // `raiseProblem` woła domknięcie po drodze, gdy nietknięte są jeszcze otwarte
  // — bez domknięcia NA KOŃCU dostawa zostawałaby otwarta mimo zakończenia
  const id = dostawa([{ dok: 10, odlozone: 7 }, { dok: 5, odlozone: 0 }]);
  D.zakonczDostawe(id, "Jan z hali");
  assert.deepEqual(statusy(id), ["problem", "skipped"]);
  assert.equal(stanDostawy(id), "done");
});

test("zakończenie oddaje to samo podsumowanie, co podgląd", () => {
  // kolektor pokazuje po zapisie dokładnie to, co obiecał przed nim
  const id = dostawa([{ dok: 10, odlozone: 7 }, { dok: 5, odlozone: 0 }]);
  const przed = D.podgladZakonczenia(id);
  const po = D.zakonczDostawe(id, "Jan z hali");
  assert.deepEqual(po, przed);
});

test("odłożone w całości zostaje odłożone — zakończenie go nie dotyka", () => {
  const id = dostawa([{ dok: 10, odlozone: 10, status: "done" }]);
  D.zakonczDostawe(id, "Jan z hali");
  assert.deepEqual(statusy(id), ["done"]);
  assert.equal(P.listUnresolved().length, 0);
});

test("drugie zakończenie odmawia zamiast zdublować wyjątki", () => {
  const id = dostawa([{ dok: 10, odlozone: 7 }]);
  D.zakonczDostawe(id, "Jan z hali");
  const drugie = D.zakonczDostawe(id, "Jan z hali");
  assert.ok("error" in drugie);
  assert.equal(drugie.kod, "juz_zamknieta", "kolektor rozpoznaje odmowę po kodzie");
  assert.equal(P.listUnresolved().length, 1, "jedna praca, jeden wyjątek");
});

/* Ta droga, a nie podwójne kliknięcie, jest przyczyną zgłoszenia z produkcji:
   „dostawa zostaje zamknięta, ale nie następuje wyjście do listy dostaw".
   Ostatnie odłożenie domyka dostawę SAMO (`closeIfComplete`), więc przycisk
   zakończenia trafia na dokument zamknięty sekundę wcześniej — przez tę samą
   osobę, bez żadnego drugiego kolektora w tle. */
test("dostawa domknięta po ostatnim odłożeniu odmawia z kodem, nie zdaniem", () => {
  const id = dostawa([{ dok: 10, odlozone: 10, status: "done" }]);
  D.closeIfComplete(id, "Jan z hali");
  const stan = db().prepare("SELECT status FROM delivery WHERE id=?").get(id) as {
    status: string;
  };
  assert.equal(stan.status, "done", "założenie testu: domknęła się sama");

  const r = D.zakonczDostawe(id, "Jan z hali");
  assert.ok("error" in r);
  assert.equal(r.kod, "juz_zamknieta");
});

test("zakończenie zostawia ślad w audycie z liczbami", () => {
  const id = dostawa([{ dok: 10, odlozone: 7 }, { dok: 5, odlozone: 0 }]);
  D.zakonczDostawe(id, "Jan z hali");
  const e = db()
    .prepare("SELECT user_id, payload FROM events WHERE type = 'delivery_finished'")
    .get() as { user_id: string; payload: string };
  assert.equal(e.user_id, "Jan z hali");
  const p = JSON.parse(e.payload);
  assert.equal(p.braki, 1);
  assert.equal(p.nietkniete, 1);
});

test("nieistniejąca dostawa to błąd, nie ciche nic", () => {
  const r = D.zakonczDostawe(999_999, "Jan z hali");
  assert.ok("error" in r);
});
