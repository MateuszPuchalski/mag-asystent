import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/* ── Jednostka miary na ścieżce dostawy (0.51.0) ─────────────────────────────
   Do 0.51.0 kolektor wpisywał „szt" na sztywno w dwunastu miejscach, bo żadne
   DTO dostawy jednostki nie niosło. W kartotece 18 pozycji na 3415 mierzy się
   inaczej (`kpl.`, `par`) — dla nich „3 szt" na liście rozkładania znaczyło
   trzy sztuki tam, gdzie na dokumencie stały trzy KOMPLETY, czyli trzydzieści
   sześć sztuk towaru.

   Ten plik pilnuje, że jednostka DOJEŻDŻA wszystkimi czterema drogami, którymi
   ilość trafia na ekran kolektora. Każda ma osobne zapytanie i osobny moment
   w pracy, więc każda może zgubić pole niezależnie od pozostałych.            */

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "wertis-jedn-")), "t.db");
process.env.MAG_ID_MAG = "1";
process.env.MAG_ID_MGP = "2";
process.env.MAG_ID_ZWROTY = "3";

let db: typeof import("../db/db.js").db;
let D: typeof import("./delivery.js");
let P: typeof import("./problems.js");

const DOK = 800;
/** Komplet — towar, dla którego wbite „szt" kłamało najgłośniej. */
const TW_KPL = 100;
/** Kartoteka BEZ jednostki — pole ma wyjść puste, a nie zniknąć. */
const TW_BEZ = 101;

before(async () => {
  ({ db } = await import("../db/db.js"));
  D = await import("./delivery.js");
  P = await import("./problems.js");
});

beforeEach(() => {
  const d = db();
  for (const t of ["problem", "delivery_line", "delivery", "events", "sgt_towar", "sgt_dokument"]) {
    d.prepare(`DELETE FROM ${t}`).run();
  }
  const ins = d.prepare(
    "INSERT INTO sgt_towar(tw_id, symbol, nazwa, ean, unit, lokalizacja) VALUES (?,?,?,?,?,?)"
  );
  ins.run(TW_KPL, "W32-KPL", "Uszczelki O-ring, komplet 12", "5900000000011", "kpl.", "A01-02-03");
  ins.run(TW_BEZ, "W32-BEZ", "Towar bez jednostki", "5900000000028", "", "A01-02-04");
});

/** Dostawa otwarta z dwiema pozycjami: komplet i towar bez jednostki. */
function dostawa(odlozoneKpl = 0): number {
  const id = Number(
    db()
      .prepare(
        `INSERT INTO delivery(sgt_dok_id, sgt_dok_numer, status, opened_at, source_mag_id)
         VALUES (?,?, 'open', ?, 1)`
      )
      .run(DOK, `FZ ${DOK}/MAG/08/2026`, new Date().toISOString()).lastInsertRowid
  );
  const ins = db().prepare(
    `INSERT INTO delivery_line(delivery_id, tw_id, tw_symbol, tw_nazwa, ilosc_dok, ilosc_odlozona, status, lok_oczekiwana)
     VALUES (?,?,?,?,?,?,?,?)`
  );
  ins.run(id, TW_KPL, "W32-KPL", "Uszczelki O-ring, komplet 12", 3, odlozoneKpl,
    odlozoneKpl > 0 ? "partial" : "todo", "A01-02-03");
  ins.run(id, TW_BEZ, "W32-BEZ", "Towar bez jednostki", 5, 0, "todo", "A01-02-04");
  return id;
}

test("lista pozycji niesie jednostkę z kartoteki, nie domysł", () => {
  const widok = D.getDelivery(dostawa())!;
  const kpl = widok.lines.find((l) => l.sym === "W32-KPL")!;
  assert.equal(kpl.unit, "kpl.", "trzy komplety to nie trzy sztuki");
  // kartoteka bez jednostki daje pusty łańcuch — regułę zapasową ma kolektor
  // w jednym miejscu (`:core`, `jednostka()`), a nie serwer w każdym zapytaniu
  assert.equal(widok.lines.find((l) => l.sym === "W32-BEZ")!.unit, "");
});

test("skan towaru w dostawie odpowiada z jednostką", () => {
  // to inna droga niż lista: własne zapytanie, wołane przy każdym skanie
  const r = D.resolveScan(dostawa(), "5900000000011", "Jan") as { kind: string; line: { unit: string } };
  assert.equal(r.kind, "line");
  assert.equal(r.line.unit, "kpl.");
});

test("kandydat przy kolizji kodu też zna swoją jednostkę", () => {
  const id = dostawa();
  // ten sam EAN na dwóch kartotekach — kolizja, kolektor pokazuje obie z ilością
  db()
    .prepare("UPDATE sgt_towar SET ean = '5900000000011' WHERE tw_id = ?")
    .run(TW_BEZ);
  const r = D.resolveScan(id, "5900000000011", "Jan") as {
    kind: string;
    candidates: Array<{ sym: string; unit: string }>;
  };
  assert.equal(r.kind, "conflict");
  assert.equal(r.candidates.find((c) => c.sym === "W32-KPL")!.unit, "kpl.");
});

test("podsumowanie zamknięcia niesie jednostkę w brakach i w pominiętych", () => {
  const p = D.podgladZakonczenia(dostawa(1));
  assert.equal(p.braki[0].unit, "kpl.", "brak ilościowy bez jednostki idzie do dostawcy");
  assert.equal(p.nietkniete[0].unit, "");
});

test("wyjątek na liście nierozwiązanych podpisuje swoją ilość", () => {
  const id = dostawa(1);
  const lineId = (
    db().prepare("SELECT id FROM delivery_line WHERE tw_id = ?").get(TW_KPL) as { id: number }
  ).id;
  P.raiseProblem(
    { deliveryId: id, lineId, typ: "qty_mismatch", qty: 1, opis: "przyszedł jeden komplet" },
    "Jan"
  );
  const w = P.listUnresolved().find((x) => x.lineId === lineId)!;
  assert.equal(w.unit, "kpl.");
});

test("wyjątek bez pozycji dostawy nie wywraca zapytania", () => {
  // złączenia są LEWE: zgłoszenie luzem nie ma pozycji ani kartoteki
  const id = dostawa();
  // `missing_item` nie wymaga zdjęcia ani pozycji — zgłasza się je o czymś,
  // czego w przesyłce NIE MA, więc nie ma też wiersza dostawy do wskazania
  const r = P.raiseProblem(
    { deliveryId: id, typ: "missing_item", qty: 1, opis: "brakuje całej palety" },
    "Jan"
  );
  assert.ok(!("error" in r), `zgłoszenie odrzucone: ${JSON.stringify(r)}`);
  const w = P.listUnresolved().find((x) => x.lineId == null)!;
  assert.equal(w.unit, "");
});
