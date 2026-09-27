import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/* ── Odłożenie PO zgłoszeniu wyjątku ─────────────────────────────────────────
   Pozycja z wyjątkiem zostaje `problem`, choćby odłożono na niej resztę sztuk
   (decyzja właściciela z 27 września 2026). Do @wydanie `putawayLine` liczył
   status wyłącznie z ilości i nadpisywał wyjątek po cichu. Na statusie
   `problem` stoją trzy reguły, które wtedy milkły:

   1. „Wyjątek czeka na ZAKOŃCZ" (`closeIfComplete`, decyzja z 22 września
      2026) — dostawa z otwartym zgłoszeniem zamykała się sama.
   2. Licznik wyjątków w postępie dostawy (`progress.problems`) spadał do zera.
   3. ZAKOŃCZ brał zgłoszony brak za nowy, bo `otwarteLinie` pomija pozycję
      wyłącznie po statusie `problem`. Szło drugie zgłoszenie i drugie MM.

   Drugą drogą było liczenie otwartych zgłoszeń w każdej z tych reguł.
   Odpadła, bo status czyta siedem miejsc, z kolektorem i panelem włącznie.
   Każde pominięte powtórzyłoby ten sam błąd.

   Scenariusze są z hali. Uszkodzone sztuki leżą na półce (`brakujaceSztuki`
   daje dla nich zero), więc magazynier odkłada całość. Przy braku odkłada
   tyle, ile przyjechało.                                                     */

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "wertis-odlw-")), "t.db");
process.env.MAG_ID_MAG = "1";
process.env.MAG_ID_MGP = "2";
process.env.MAG_ID_ZWROTY = "3";
// z magazynem serwisowym brak w dostawie rusza stan (MM) — to widać w scenariuszu braku
process.env.MAG_ID_SERWIS = "4";

let db: typeof import("../db/db.js").db;
let D: typeof import("./delivery.js");
let P: typeof import("./problems.js");
let C: typeof import("./cofanie-dostawy.js");

before(async () => {
  ({ db } = await import("../db/db.js"));
  D = await import("./delivery.js");
  P = await import("./problems.js");
  C = await import("./cofanie-dostawy.js");
});

const DOK = 951;
const KTO = "Jan z hali";
/** Najmniejszy poprawny PNG — uszkodzenie bez zdjęcia nie jest zgłoszeniem. */
const ZDJECIE =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

let dostawaId = 0;

beforeEach(() => {
  for (const t of ["delivery_note", "problem", "delivery_line", "delivery", "events", "sfera_queue"]) {
    db().prepare(`DELETE FROM ${t}`).run();
  }
  dostawaId = Number(
    db()
      .prepare(
        `INSERT INTO delivery(sgt_dok_id, sgt_dok_numer, status, opened_at, source_mag_id)
         VALUES (?,?, 'open', ?, 1)`
      )
      .run(DOK, `FZ ${DOK}/MAG/09/2026`, new Date().toISOString()).lastInsertRowid
  );
});

/** Pozycja: 10 szt. na dokumencie, nic jeszcze nie odłożono. */
function linia(sym = "W32-0501"): number {
  return Number(
    db()
      .prepare(
        `INSERT INTO delivery_line(delivery_id, tw_id, tw_symbol, tw_nazwa, ilosc_dok, ilosc_odlozona, status)
         VALUES (?,?,?,?,10,0,'todo')`
      )
      .run(dostawaId, 200 + Number(sym.slice(-1)), sym, "Sekator").lastInsertRowid
  );
}

const statusLinii = (lineId: number): string =>
  (db().prepare("SELECT status FROM delivery_line WHERE id=?").get(lineId) as { status: string }).status;

const odlozone = (lineId: number): number =>
  (db().prepare("SELECT ilosc_odlozona AS n FROM delivery_line WHERE id=?").get(lineId) as { n: number }).n;

const stanDostawy = (): string =>
  (db().prepare("SELECT status FROM delivery WHERE id=?").get(dostawaId) as { status: string }).status;

const otwarteZgloszenia = () => P.listByDelivery(dostawaId).filter((p) => p.resolvedAt == null);

/** Ile sztuk poszło na magazyn serwisowy jako brak — suma z dziennika zdarzeń. */
const naSerwis = (): number =>
  (db().prepare("SELECT payload FROM events WHERE type='brak_na_serwis'").all() as Array<{ payload: string }>)
    .map((e) => Number(JSON.parse(e.payload).brak))
    .reduce((a, b) => a + b, 0);

/** Zgłoszenie uszkodzenia 2 szt. — typ, który nie rusza stanu, więc da się go wycofać bez MM. */
function zglosUszkodzenie(lineId: number): number {
  const z = P.raiseProblem({ deliveryId: dostawaId, lineId, typ: "damaged", qty: 2, photoBase64: ZDJECIE }, KTO);
  assert.ok(!("error" in z), "zgłoszenie ma przejść");
  return z.id;
}

// ── uszkodzone: całość na półkę ──────────────────────────────────────────────

test("odłożenie reszty po zgłoszeniu nie domyka dostawy z otwartym wyjątkiem", () => {
  const l = linia();
  zglosUszkodzenie(l);
  assert.equal(stanDostawy(), "open", "wyjątek czeka na ZAKOŃCZ");

  const r = D.putawayLine(l, "A01-02-03", KTO);
  assert.ok(!("error" in r), "odłożenie ma przejść — towar leży na półce");

  assert.equal(r.status, "problem", "kolektor dostaje ten sam status, który stoi w bazie");
  assert.equal(statusLinii(l), "problem");
  assert.equal(odlozone(l), 10, "ilość zapisuje się jak przy każdym odłożeniu");
  assert.equal(otwarteZgloszenia().length, 1, "zgłoszenie nadal czeka na biuro");
  assert.equal(stanDostawy(), "open", "dostawa z otwartym wyjątkiem czeka na ZAKOŃCZ");
});

test("postęp dostawy liczy otwarty wyjątek także po odłożeniu reszty", () => {
  const l = linia();
  linia("W32-0502"); // druga pozycja trzyma dostawę otwartą — liczymy sam licznik
  zglosUszkodzenie(l);
  assert.equal(D.getDelivery(dostawaId)?.progress.problems, 1, "przed odłożeniem");

  D.putawayLine(l, "A01-02-03", KTO);

  assert.equal(D.getDelivery(dostawaId)?.progress.problems, 1, "po odłożeniu");
});

// ── brak: na półkę idzie tyle, ile przyjechało ───────────────────────────────

test("ZAKOŃCZ nie zgłasza drugi raz braku zgłoszonego przy pozycji", () => {
  const l = linia();
  P.raiseProblem({ deliveryId: dostawaId, lineId: l, typ: "missing_item", qty: 2 }, KTO);
  assert.equal(naSerwis(), 2, "brak 2 szt. zdjęty ze sprzedaży raz");

  D.putawayLine(l, "A01-02-03", KTO, { qty: 8 });
  const r = D.zakonczDostawe(dostawaId, KTO);
  assert.ok(!("error" in r), "ZAKOŃCZ ma przejść");

  // obie liczby naraz: drugie zgłoszenie to reklamacja, drugie MM to stan zdjęty ze sprzedaży
  assert.deepEqual(
    { zgloszenia: P.listByDelivery(dostawaId).length, naSerwis: naSerwis() },
    { zgloszenia: 1, naSerwis: 2 },
    "jeden brak 2 szt., jedno zgłoszenie i jedno MM"
  );
});

// ── pomyłka przy takim odłożeniu ─────────────────────────────────────────────

test("pomyłkę w ILOŚCI po odłożeniu na pozycji z wyjątkiem cofa się przez wycofanie zgłoszenia", () => {
  /* Skutek decyzji, nie przypadek. Pozycja `problem` nie daje COFNIJ ani
     POPRAW ILOŚĆ, tak jak przy odwrotnej kolejności — najpierw odłożenie,
     potem zgłoszenie. Droga powrotu jest jedna: wycofać własne zgłoszenie,
     po czym pozycja wraca do statusu z ilości i COFNIJ znów działa. */
  const l = linia();
  const z = zglosUszkodzenie(l);
  D.putawayLine(l, "A01-02-03", KTO);

  const odmowa = C.cofnijOdlozenie(l, KTO);
  assert.ok("error" in odmowa, "COFNIJ odmawia, póki stoi wyjątek");
  assert.match(odmowa.error, /wycofaj zgłoszenie/, "odmowa mówi, co zrobić zamiast");

  const w = C.wycofajZgloszenie(z, KTO);
  assert.ok(!("error" in w), "zgłaszający wycofuje własne zgłoszenie");
  assert.equal(w.statusLinii, "done", "bez wyjątku status wynika z ilości");

  assert.ok(!("error" in C.cofnijOdlozenie(l, KTO)), "teraz COFNIJ działa");
  assert.equal(odlozone(l), 0);
});

test("źle zeskanowaną PÓŁKĘ poprawia się przy wyjątku bez wycofania zgłoszenia", () => {
  /* Półka nie należy do zgłoszenia, więc jej poprawka nie ma prawa kosztować
     wycofania zgłoszenia ze zdjęciem. Kolektor pokazuje ZMIEŃ PÓŁKĘ przy
     wyjątku ze stosu `odlozenia` — ten test pilnuje, że stos tam jest,
     a serwer zmienia półkę i zostawia wyjątek w spokoju. */
  const l = linia();
  zglosUszkodzenie(l);
  D.putawayLine(l, "A01-02-03", KTO);

  const widok = D.getDelivery(dostawaId)?.lines.find((x) => x.id === l);
  assert.equal(widok?.cofnij, null, "COFNIJ ilości przy wyjątku nie ma");
  assert.deepEqual(widok?.odlozenia, [{ qty: 10, lok: "A01-02-03" }], "półka do zmiany jest w widoku");

  const r = C.zmienPolke(l, "B02-02-02", KTO);
  assert.ok(!("error" in r), "zmiana półki przechodzi mimo wyjątku");
  const po = db().prepare("SELECT lok_faktyczna AS lok, status FROM delivery_line WHERE id=?").get(l) as {
    lok: string;
    status: string;
  };
  // kopia, bo `node:sqlite` oddaje wiersz bez prototypu, a `deepEqual` porównuje i prototyp
  assert.deepEqual({ ...po }, { lok: "B02-02-02", status: "problem" }, "półka nowa, wyjątek bez zmian");
  assert.equal(otwarteZgloszenia().length, 1, "zgłoszenie nietknięte");
  assert.equal(odlozone(l), 10, "ilość bez zmian");
});
