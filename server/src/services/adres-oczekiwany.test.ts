import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/* ── Ten sam towar na dwóch dostawach ────────────────────────────────────────
   ZGŁOSZENIE Z HALI: magazynier rozkłada pierwszą dostawę i nadaje towarowi
   nowy adres; w drugiej dostawie ten sam towar dalej pokazuje STARY.

   Przyczyny były dwie i każda osobno wystarczyła, więc obie mają tu swój test:

     1. `lok_oczekiwana` zapisywała się RAZ, przy otwarciu dostawy;
     2. zapis adresu leży najpierw w KOLEJCE — kartoteka dowiaduje się o nim
        dopiero po workerze i po synchronizacji read-modelu.

   Trzeci test pilnuje skutku ubocznego, którego nikt nie łączył z tą samą
   przyczyną: rozjazd (§4.3) liczył się względem zamrożonej wartości, więc
   odłożenie towaru pod adresem AKTUALNYM podnosiło fałszywy alarm.           */

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "wertis-adres-")), "t.db");
process.env.MAG_ID_MAG = "1";
process.env.MAG_ID_MGP = "2";
process.env.MAG_ID_ZWROTY = "3";

let db: typeof import("../db/db.js").db;
let D: typeof import("./delivery.js");

before(async () => {
  ({ db } = await import("../db/db.js"));
  D = await import("./delivery.js");
});

const TW = 31;
const DOK_A = 811;
const DOK_B = 812;
const dzis = () => new Date().toISOString().slice(0, 10);

/** Adres oczekiwany jedynej pozycji dostawy. */
const adres = (id: number) => D.getDelivery(id)!.lines[0].locExpected;
const pozycja = (id: number) => D.getDelivery(id)!.lines[0];

/** To, co dzieje się PO workerze i po synchronizacji read-modelu z Subiektem. */
function workerZapisal(kod: string) {
  db().prepare("UPDATE sgt_towar SET lokalizacja=? WHERE tw_id=?").run(kod, TW);
  db().prepare("UPDATE sfera_queue SET status='done', processed_at=? WHERE status='pending'")
    .run(new Date().toISOString());
}

beforeEach(() => {
  const d = db();
  for (const t of ["events", "sfera_queue", "delivery_line", "delivery",
                   "sgt_pozycja", "sgt_dokument", "sgt_towar"]) {
    d.prepare(`DELETE FROM ${t}`).run();
  }
  d.prepare("INSERT INTO sgt_towar(tw_id,symbol,nazwa,lokalizacja) VALUES (?,?,?,?)")
    .run(TW, "GAZ-1", "Gaźnik kompletny", "A01-02-03");
  for (const dok of [DOK_A, DOK_B]) {
    d.prepare(
      `INSERT INTO sgt_dokument(dok_id,typ,nr_pelny,data_wyst,mag_id,dostawca,w_buforze)
       VALUES (?,'FZ',?,?,1,'Dostawca sp. z o.o.',0)`
    ).run(dok, `FZ ${dok}/08/2026`, dzis());
    d.prepare("INSERT INTO sgt_pozycja(dok_id,tw_id,ilosc) VALUES (?,?,?)").run(dok, TW, 5);
  }
});

test("druga dostawa otwarta WCZEŚNIEJ też widzi nowy adres", () => {
  /* Przyczyna nr 1. Obie dostawy otwarte, więc obie mają w snapshocie stary
     adres. Zamrożony pokazywałby go już na zawsze — także długo po tym, jak
     kartoteka jest poprawna. */
  const a = D.openDelivery(DOK_A, "jan");
  const b = D.openDelivery(DOK_B, "jan");
  D.putawayLine(pozycja(a).id, "B02-01-01", "jan");
  workerZapisal("B02-01-01");
  assert.equal(adres(b), "B02-01-01");
});

test("nowy adres widać ZANIM worker zdąży go zapisać", () => {
  /* Przyczyna nr 2. Kartoteka mówi jeszcze starą prawdę, bo zadanie stoi
     w kolejce — a magazynier idzie do regału TERAZ, nie za minutę. */
  const a = D.openDelivery(DOK_A, "jan");
  D.putawayLine(pozycja(a).id, "B02-01-01", "jan");
  const kartoteka = (db().prepare("SELECT lokalizacja l FROM sgt_towar WHERE tw_id=?")
    .get(TW) as { l: string }).l;
  assert.equal(kartoteka, "A01-02-03", "kartoteka ma być jeszcze nieodświeżona");

  const b = D.openDelivery(DOK_B, "jan");
  assert.equal(adres(b), "B02-01-01");
});

test("odłożenie pod aktualnym adresem NIE jest rozjazdem", () => {
  /* Skutek uboczny obu przyczyn: aplikacja pytała ZAMIEŃ/DODAJ przy odłożeniu
     tam, gdzie kartoteka każe, i dopisywała `location_mismatch` do raportu
     przepełnionych gniazd. */
  const a = D.openDelivery(DOK_A, "jan");
  const b = D.openDelivery(DOK_B, "jan");
  D.putawayLine(pozycja(a).id, "B02-01-01", "jan");
  workerZapisal("B02-01-01");

  const w = D.putawayLine(pozycja(b).id, "B02-01-01", "jan");
  assert.deepEqual(w, { ok: true, queueId: undefined, mismatch: false, status: "done" });
  const ile = (db().prepare(
    "SELECT COUNT(*) n FROM events WHERE type='location_mismatch'"
  ).get() as { n: number }).n;
  assert.equal(ile, 1, "jedyny rozjazd to ten prawdziwy, z pierwszej dostawy");
});

test("PRAWDZIWY rozjazd nadal jest wykrywany", () => {
  // kontrola przeciwna — poprawka nie ma prawa wyłączyć §4.3
  const a = D.openDelivery(DOK_A, "jan");
  const w = D.putawayLine(pozycja(a).id, "Z09-01-01", "jan");
  assert.equal("ok" in w && w.mismatch, true);
});

test("pozycja W TOKU nie goni już kartoteki", () => {
  /* `partial` nie jest nietknięta: część partii leży na półce, a reszta ma
     dojechać TAM SAMO. Gonienie kartoteki przerzucałoby resztę partii na inną
     półkę w połowie pracy — dlatego linia zostaje przy swoim snapshocie,
     a gdzie towar naprawdę poszedł, mówi `locActual` (i to jego pokazuje
     kolektor przez `adresWiersza`). */
  const a = D.openDelivery(DOK_A, "jan");
  D.putawayLine(pozycja(a).id, "B02-01-01", "jan", { qty: 2 });
  assert.equal(pozycja(a).status, "partial");

  db().prepare("UPDATE sgt_towar SET lokalizacja='Z09-01-01' WHERE tw_id=?").run(TW);
  const l = pozycja(a);
  assert.equal(l.locExpected, "A01-02-03", "snapshot ma zostać nietknięty");
  assert.equal(l.locActual, "B02-01-01", "reszta partii jedzie tam, gdzie poszła pierwsza");
});

test("skan towaru daje ten sam adres co lista", () => {
  /* Panel odkładania to ekran, na który magazynier patrzy PRZED pójściem do
     regału. Rozjazd tych dwóch dróg wysyłałby go gdzie indziej, niż pokazywała
     lista sekundę wcześniej. */
  const a = D.openDelivery(DOK_A, "jan");
  D.putawayLine(pozycja(a).id, "B02-01-01", "jan");
  const b = D.openDelivery(DOK_B, "jan");
  const r = D.resolveScan(b, "GAZ-1", "jan");
  assert.equal(r.kind, "line");
  assert.equal(r.kind === "line" ? r.line.locExpected : null, adres(b));
  assert.equal(r.kind === "line" ? r.line.locExpected : null, "B02-01-01");
});

test("zadanie sprzed dawna nie nadpisuje adresu w nieskończoność", () => {
  /* Okno zaufania do kolejki musi być SKOŃCZONE. Bez tego zadanie wykonane
     tydzień temu przebijałoby adres zmieniony potem ręcznie w Subiekcie. */
  const a = D.openDelivery(DOK_A, "jan");
  D.putawayLine(pozycja(a).id, "B02-01-01", "jan");
  db().prepare("UPDATE sfera_queue SET status='done', processed_at=? WHERE type='set_location'")
    .run(new Date(Date.now() - 7 * 86400_000).toISOString());
  db().prepare("UPDATE sgt_towar SET lokalizacja='C03-03-03' WHERE tw_id=?").run(TW);

  const b = D.openDelivery(DOK_B, "jan");
  assert.equal(adres(b), "C03-03-03");
});

test("towar bez adresu w kartotece i bez kolejki zostaje bez adresu", () => {
  db().prepare("UPDATE sgt_towar SET lokalizacja='' WHERE tw_id=?").run(TW);
  const a = D.openDelivery(DOK_A, "jan");
  assert.equal(adres(a), null);
});

test("linia niesie godzinę odłożenia — po niej kolektor układa zrobione", () => {
  /* Kolektor stawia ostatnio odłożoną na górze grupy zrobionych (0.113.0),
     więc bez tego pola cała ta kolejność wraca po cichu do alejkowej —
     wygląda poprawnie i jest nie ta. */
  const a = D.openDelivery(DOK_A, "jan");
  assert.equal(pozycja(a).doneAt, null, "nietknięta linia nie ma godziny");

  D.putawayLine(pozycja(a).id, "B02-01-01", "jan");
  const po = pozycja(a);
  assert.equal(po.status, "done");
  assert.ok(po.doneAt, "odłożona linia ma znacznik czasu");
  assert.match(String(po.doneAt), /^\d{4}-\d{2}-\d{2}T/, "ISO, bo po nim się sortuje");
});
