import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/* ── „Przyjechało, ale jeszcze nie na półce" ─────────────────────────────────
   Sedno tych testów: pozycja znika z karty dokładnie wtedy, gdy towar TRAFIŁ
   W REGAŁ — a nie wtedy, gdy ktoś się nim zajął. Pominięcie i zgłoszony wyjątek
   zostawiają towar tam, gdzie leżał, więc mają zostać widoczne. Odwrotna reguła
   dawałaby błąd bez objawu: magazynier pytający „gdzie to jest" dostawałby
   ciszę, bo ktoś inny właśnie odpuścił tę pozycję.                            */

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "wertis-dost-")), "t.db");
process.env.MAG_ID_MAG = "1";
process.env.MAG_ID_MGP = "2";
process.env.MAG_ID_ZWROTY = "3";

let db: typeof import("../db/db.js").db;
let D: typeof import("./dostawy-towaru.js");

before(async () => {
  ({ db } = await import("../db/db.js"));
  D = await import("./dostawy-towaru.js");
});

const TOWAR = 7;

/** Data sprzed N dni w formacie `data_wyst` (ISO, sama data). */
const dniTemu = (n: number): string =>
  new Date(Date.now() - n * 86400_000).toISOString().slice(0, 10);

beforeEach(() => {
  const d = db();
  d.prepare("DELETE FROM delivery_line").run();
  d.prepare("DELETE FROM delivery").run();
  d.prepare("DELETE FROM sgt_pozycja").run();
  d.prepare("DELETE FROM sgt_dokument").run();
});

/** Dokument dostawy z jedną pozycją naszego towaru. */
function dokument(opts: {
  dokId: number;
  ilosc: number;
  dni?: number;
  magId?: number;
  typ?: string;
  nr?: string;
}) {
  const d = db();
  d.prepare(
    `INSERT INTO sgt_dokument(dok_id, typ, nr_pelny, data_wyst, mag_id, dostawca, w_buforze)
     VALUES (?,?,?,?,?,?,0)`
  ).run(
    opts.dokId,
    opts.typ ?? "FZ",
    opts.nr ?? `FZ ${opts.dokId}/MAG/07/2026`,
    dniTemu(opts.dni ?? 1),
    opts.magId ?? 1,
    "Dostawca sp. z o.o."
  );
  d.prepare("INSERT INTO sgt_pozycja(dok_id, tw_id, ilosc) VALUES (?,?,?)").run(
    opts.dokId,
    TOWAR,
    opts.ilosc
  );
}

/** Otwarte rozkładanie tego dokumentu z zadanym postępem linii. */
function rozkladanie(dokId: number, iloscDok: number, odlozona: number, status: string) {
  const d = db();
  const id = Number(
    d
      .prepare(
        `INSERT INTO delivery(sgt_dok_id, sgt_dok_numer, status, opened_at, source_mag_id)
         VALUES (?,?, 'open', ?, 1)`
      )
      .run(dokId, `FZ ${dokId}/MAG/07/2026`, new Date().toISOString()).lastInsertRowid
  );
  d.prepare(
    `INSERT INTO delivery_line(delivery_id, tw_id, tw_symbol, tw_nazwa, ilosc_dok, ilosc_odlozona, status)
     VALUES (?,?,?,?,?,?,?)`
  ).run(id, TOWAR, "W32-0203", "Kosa spalinowa", iloscDok, odlozona, status);
}

test("dokumentu nikt nie otwierał — na karcie stoi całość", () => {
  dokument({ dokId: 100, ilosc: 6 });
  const w = D.nierozlozoneZDostaw(TOWAR);
  assert.equal(w.length, 1);
  assert.equal(w[0].ilosc, 6);
  assert.equal(w[0].status, null, "brak wiersza w delivery_line = nikt nie zaczął");
  assert.equal(w[0].nrPelny, "FZ 100/MAG/07/2026");
});

test("częściowo odłożone — zostaje reszta, nie całość", () => {
  dokument({ dokId: 101, ilosc: 6 });
  rozkladanie(101, 6, 4, "partial");
  const w = D.nierozlozoneZDostaw(TOWAR);
  assert.equal(w.length, 1);
  assert.equal(w[0].ilosc, 2);
  assert.equal(w[0].status, "partial");
});

test("odłożone w całości — pozycja ZNIKA z karty", () => {
  // to jest cały sens tej sekcji: ma odpowiadać na „czego jeszcze nie ma
  // na półce", a nie robić z karty historii przyjęć
  dokument({ dokId: 102, ilosc: 6 });
  rozkladanie(102, 6, 6, "done");
  assert.deepEqual(D.nierozlozoneZDostaw(TOWAR), []);
});

test("odłożono więcej niż na dokumencie (INNA ILOŚĆ w górę) — też znika", () => {
  // różnica wychodzi ujemna; to nie jest „minus na półce", tylko zero do zrobienia
  dokument({ dokId: 103, ilosc: 6 });
  rozkladanie(103, 6, 8, "done");
  assert.deepEqual(D.nierozlozoneZDostaw(TOWAR), []);
});

test("dostawa starsza niż okno 14 dni nie zaśmieca karty", () => {
  dokument({ dokId: 104, ilosc: 5, dni: 20 });
  assert.deepEqual(D.nierozlozoneZDostaw(TOWAR), []);
});

test("dwie dostawy — obie widoczne, najświeższa pierwsza", () => {
  // najświeższa jest najbardziej prawdopodobną odpowiedzią na „gdzie to jest"
  dokument({ dokId: 105, ilosc: 3, dni: 9 });
  dokument({ dokId: 106, ilosc: 4, dni: 2 });
  const w = D.nierozlozoneZDostaw(TOWAR);
  assert.deepEqual(
    w.map((p) => p.dokId),
    [106, 105]
  );
});

test("zgłoszony problem ZOSTAJE — towaru nadal nie ma w regale", () => {
  dokument({ dokId: 108, ilosc: 5 });
  rozkladanie(108, 5, 0, "problem");
  const w = D.nierozlozoneZDostaw(TOWAR);
  assert.equal(w.length, 1, "wyjątek nie kładzie towaru na półkę");
  assert.equal(w[0].status, "problem");
  assert.equal(w[0].ilosc, 5);
});

test("pominięta pozycja ZOSTAJE — tak samo nie trafiła do regału", () => {
  dokument({ dokId: 109, ilosc: 5 });
  rozkladanie(109, 5, 0, "skipped");
  assert.equal(D.nierozlozoneZDostaw(TOWAR)[0].status, "skipped");
});

test("kontener na MGP tu NIE wchodzi — ma własny kafel strefy przyjęć", () => {
  // dublowanie tej samej liczby w dwóch miejscach ekranu jest gorsze
  // od pokazania jej raz; kryterium jest to samo co w liście rozkładania
  dokument({ dokId: 110, ilosc: 9, magId: 2, typ: "PZ" });
  assert.deepEqual(D.nierozlozoneZDostaw(TOWAR), []);
});

test("dokument bez tego towaru nie trafia na jego kartę", () => {
  dokument({ dokId: 111, ilosc: 4 });
  db().prepare("DELETE FROM sgt_pozycja WHERE dok_id = ?").run(111);
  db().prepare("INSERT INTO sgt_pozycja(dok_id, tw_id, ilosc) VALUES (?,?,?)").run(111, 999, 4);
  assert.deepEqual(D.nierozlozoneZDostaw(TOWAR), []);
});

test("ten sam towar w kilku pozycjach jednego dokumentu sumuje się", () => {
  // różne partie i ceny dają osobne wiersze na FZ; magazyniera obchodzi suma
  dokument({ dokId: 112, ilosc: 3 });
  db().prepare("INSERT INTO sgt_pozycja(dok_id, tw_id, ilosc) VALUES (?,?,?)").run(112, TOWAR, 2);
  const w = D.nierozlozoneZDostaw(TOWAR);
  assert.equal(w.length, 1, "jeden dokument = jeden wiersz na karcie");
  assert.equal(w[0].ilosc, 5);
});
