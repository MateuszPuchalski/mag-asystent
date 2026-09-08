import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/* ── Archiwum dostaw ─────────────────────────────────────────────────────────
   Jeden niezmiennik trzyma cały ten plik: DOKUMENT JEST W DOKŁADNIE JEDNYM
   MIEJSCU. Dopóki stoi w read-modelu, należy do listy pracy; gdy z niej
   wypadnie, przechodzi do archiwum. Rozjazd tych dwóch zbiorów daje albo
   dziurę (dostawa nie do znalezienia nigdzie), albo dublet (ta sama faktura
   w dwóch zakładkach z dwoma różnymi postępami) — i obie awarie wyglądają
   z ekranu jak zwykły stan rzeczy.

   Druga sprawa to wyszukiwarka. Archiwum rośnie z każdym rokiem, więc szuka
   SERWER i tylko on zna pełny zbiór. Wzorzec `LIKE` z niewyłączonymi znakami
   wieloznacznymi zwracałby przy wpisaniu `%` całe archiwum — czyli szukanie
   działałoby inaczej, niż wygląda.                                           */

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "wertis-archiwum-")), "t.db");
process.env.MAG_ID_MAG = "1";
process.env.MAG_ID_MGP = "2";
process.env.MAG_ID_ZWROTY = "3";

let db: typeof import("../db/db.js").db;
let A: typeof import("./archiwum-dostaw.js");
let P: typeof import("./podglad-dostawy.js");

before(async () => {
  ({ db } = await import("../db/db.js"));
  A = await import("./archiwum-dostaw.js");
  P = await import("./podglad-dostawy.js");
});

const TOWAR = 31;

beforeEach(() => {
  const d = db();
  for (const t of [
    "problem", "delivery_line", "delivery", "sfera_queue", "events",
    "sgt_pozycja", "sgt_dokument", "sgt_towar",
  ]) {
    d.prepare(`DELETE FROM ${t}`).run();
  }
  d.prepare(
    "INSERT INTO sgt_towar(tw_id, symbol, nazwa, lokalizacja) VALUES (?,?,?,?)"
  ).run(TOWAR, "LS51-139", "Gaźnik kompletny", "A01-02-03");
});

/** Dostawa w NASZEJ bazie — bez dokumentu w read-modelu, czyli archiwalna. */
function dostawa(
  dokId: number,
  opcje: {
    dostawca?: string;
    data?: string;
    status?: string;
    linie?: Array<{ status: string }>;
  } = {}
): number {
  const { dostawca = "OGRÓD-POL", data = "2026-01-15", status = "done", linie = [] } = opcje;
  const id = Number(
    db()
      .prepare(
        `INSERT INTO delivery(sgt_dok_id, sgt_dok_numer, dostawca, data_dok, status,
                              opened_at, closed_at, source_mag_id)
         VALUES (?,?,?,?,?,?,?,1)`
      )
      .run(
        dokId,
        `FZ ${dokId}/MAG/01/2026`,
        dostawca,
        data,
        status,
        `${data}T08:00:00.000Z`,
        `${data}T12:00:00.000Z`
      ).lastInsertRowid
  );
  const ins = db().prepare(
    `INSERT INTO delivery_line(delivery_id, tw_id, tw_symbol, tw_nazwa, ilosc_dok,
                               ilosc_odlozona, lok_oczekiwana, lok_faktyczna, status, done_at, done_by)
     VALUES (?,?, 'LS51-139', 'Gaźnik kompletny', 4, 4, 'A01-02-03', 'A01-02-03', ?, ?, 'Krzysiek')`
  );
  for (const l of linie) ins.run(id, TOWAR, l.status, `${data}T10:00:00.000Z`);
  return id;
}

/** Ten sam dokument, ale wciąż w oknie importu. */
function wOknie(dokId: number): void {
  db()
    .prepare(
      `INSERT INTO sgt_dokument(dok_id, typ, nr_pelny, data_wyst, mag_id, dostawca, w_buforze)
       VALUES (?,'FZ',?,?,1,'OGRÓD-POL',0)`
    )
    .run(dokId, `FZ ${dokId}/MAG/01/2026`, "2026-01-15");
}

/* ── Granica: read-model, nie kalendarz ───────────────────────────────────── */

test("dostawa z dokumentem w oknie importu NIE jest w archiwum", () => {
  /* Gdyby granicę wyznaczała data, zmiana `DOK_DNI_WSTECZ` rozjechałaby oba
     zbiory: ta sama faktura stanęłaby i na liście pracy, i w archiwum. */
  dostawa(801, { linie: [{ status: "done" }] });
  wOknie(801);
  assert.deepEqual(A.archiwumDostaw().documents, [], "to jest pozycja listy pracy, nie historii");
});

test("dostawa bez dokumentu w read-modelu wchodzi do archiwum z postępem", () => {
  dostawa(802, { linie: [{ status: "done" }, { status: "problem" }, { status: "todo" }] });
  const { documents, ile } = A.archiwumDostaw();
  assert.equal(ile, 1);
  assert.equal(documents.length, 1);
  const w = documents[0];
  assert.equal(w.dokId, 802);
  assert.equal(w.nrPelny, "FZ 802/MAG/01/2026");
  assert.equal(w.dostawca, "OGRÓD-POL");
  assert.equal(w.dataWyst, "2026-01-15");
  assert.equal(w.linesTotal, 3);
  // `problem` liczy się jako domknięta (D8) — dokładnie jak na liście pracy
  assert.equal(w.linesDone, 2, "done + problem, bez todo");
  assert.equal(w.positions, 3, "faktury już nie ma — snapshot JEST liczbą pozycji");
  assert.equal(w.status, "done");
});

test("dostawa zdjęta poza WERTIS zostaje w archiwum i pokazuje zero pozycji", () => {
  /* Pominięcie całej klasy dostaw czyniłoby z archiwum niepełną historię —
     a niepełna historia wygląda dokładnie jak kompletna. Zero pozycji jest
     tu prawdą: zamknięcie świadomie nie robi snapshotu. */
  dostawa(803, { status: "external" });
  const [w] = A.archiwumDostaw().documents;
  assert.equal(w.status, "external");
  assert.equal(w.linesTotal, 0);
  assert.equal(w.linesDone, 0);
});

test("otwarte wyjątki jadą na wiersz archiwum", () => {
  /* Bez tej liczby dostawa z nierozwiązaną reklamacją wygląda w historii
     dokładnie jak bezproblemowa — a po to się do historii wraca. */
  const id = dostawa(804, { linie: [{ status: "problem" }] });
  const lineId = (
    db().prepare("SELECT id FROM delivery_line WHERE delivery_id = ?").get(id) as { id: number }
  ).id;
  db()
    .prepare(
      `INSERT INTO problem(delivery_id, line_id, typ, opis, created_at, created_by)
       VALUES (?,?, 'qty_mismatch', 'brak 2 szt.', ?, 'Krzysiek')`
    )
    .run(id, lineId, "2026-01-15T10:00:00.000Z");
  assert.equal(A.archiwumDostaw().documents[0].wyjatkiOtwarte, 1);
});

test("archiwum idzie od najnowszej dostawy", () => {
  dostawa(805, { data: "2026-01-10" });
  dostawa(806, { data: "2026-03-02" });
  dostawa(807, { data: "2026-02-01" });
  assert.deepEqual(
    A.archiwumDostaw().documents.map((w) => w.dokId),
    [806, 807, 805]
  );
});

/* ── Wyszukiwanie ─────────────────────────────────────────────────────────── */

test("szuka po numerze dokumentu i po dostawcy", () => {
  dostawa(810, { dostawca: "OGRÓD-POL" });
  dostawa(811, { dostawca: "STIHL Polska" });
  assert.deepEqual(A.archiwumDostaw("811").documents.map((w) => w.dokId), [811]);
  assert.deepEqual(A.archiwumDostaw("stihl").documents.map((w) => w.dokId), [811]);
  assert.deepEqual(A.archiwumDostaw("nie ma takiego").documents, []);
});

test("znak wieloznaczny w wyszukiwarce nie otwiera całego archiwum", () => {
  dostawa(812);
  dostawa(813);
  assert.deepEqual(A.archiwumDostaw("%").documents, [], "`%` to znak do znalezienia, nie wzorzec");
  assert.deepEqual(A.archiwumDostaw("_").documents, []);
});

test("`ile` liczy CAŁE dopasowanie, także poza limitem", () => {
  /* Panel mówi „pokazano 2 z 5" właśnie z tej liczby. Bez niej obcięta lista
     wygląda jak pełna — czyli faktura sprzed roku jest „nieobecna". */
  for (const dok of [820, 821, 822, 823, 824]) dostawa(dok);
  const a = A.archiwumDostaw("", 2);
  assert.equal(a.documents.length, 2);
  assert.equal(a.ile, 5);
  assert.equal(a.limit, 2);
});

/* ── Wejście w dostawę archiwalną ─────────────────────────────────────────── */

test("podgląd dokumentu spoza okna importu czyta NASZ snapshot", () => {
  /* Do 0.235.0 była tu odmowa 404 — dostawa sprzed trzech tygodni wyglądała
     w panelu identycznie jak dokument, którego nigdy nie było. */
  dostawa(830, { linie: [{ status: "done" }] });
  const p = P.podgladDokumentu(830);
  assert.ok(p, "dostawa archiwalna daje się otworzyć");
  assert.equal(p.archiwalny, true, "panel ma czym powiedzieć, skąd są te pozycje");
  assert.equal(p.nrPelny, "FZ 830/MAG/01/2026");
  assert.equal(p.dostawca, "OGRÓD-POL");
  assert.equal(p.zrodlo, "snapshot");
  assert.equal(p.lines.length, 1);
  assert.equal(p.lines[0].doneBy, "Krzysiek", "nazwisko odkładającego przeżyło okno importu");
  assert.equal(p.lines[0].locActual, "A01-02-03");
  assert.equal(p.khId, null, "płatnika `delivery` nie przepisuje — panel nie pyta o logo");
});

test("dokument w oknie importu nadal czyta się z read-modelu", () => {
  dostawa(831, { linie: [{ status: "done" }] });
  wOknie(831);
  const p = P.podgladDokumentu(831);
  assert.ok(p);
  assert.equal(p.archiwalny, false);
  assert.equal(p.typ, "FZ", "typ dokumentu jest tylko po stronie Subiekta");
});

test("dokument, o którym nie wiemy nic, nadal jest brakiem", () => {
  assert.equal(P.podgladDokumentu(999_999), undefined);
});

/* ── Zero zapisu ──────────────────────────────────────────────────────────── */

test("archiwum NICZEGO nie zapisuje", () => {
  /* Ta sama umowa co przy podglądzie dokumentu: otwarcie ekranu nie mutuje
     stanu magazynu. Zdarzenia liczymy razem z wierszami, bo `logEvent` jest
     zapisem tak samo jak każdy inny. */
  dostawa(840, { linie: [{ status: "done" }] });
  const ile = (t: string) => (db().prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n;
  const przed = ["delivery", "delivery_line", "events", "sfera_queue"].map(ile);
  A.archiwumDostaw();
  A.archiwumDostaw("840");
  P.podgladDokumentu(840);
  assert.deepEqual(["delivery", "delivery_line", "events", "sfera_queue"].map(ile), przed);
});
