import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/* ── Przesunięcie stanu między magazynami ────────────────────────────────────
   Ta operacja zastąpiła całą sesję kontenerową i jest jedynym miejscem,
   w którym powstaje dokument MM. Tryb B nie miał ani jednego testu serwera
   przez cały czas swojego istnienia — nie powtarzamy tego.

   Testy pilnują strony SERWERA, i to jest ich cały powód: reguły arkusza są
   uprzejmością wobec człowieka w alejce, nie bramką. Stary APK albo `curl`
   z sieci hali trafia wprost tutaj.                                          */

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "wertis-przes-")), "t.db");

let db: typeof import("../db/db.js").db;
let nowIso: typeof import("../db/db.js").nowIso;
let P: typeof import("./przesuniecie.js");
let config: typeof import("../config.js").config;

const TW = 1;

before(async () => {
  ({ db, nowIso } = await import("../db/db.js"));
  ({ config } = await import("../config.js"));
  P = await import("./przesuniecie.js");
});

let deliveryId = 0;
let lineId = 0;

beforeEach(() => {
  for (const t of [
    "events", "sfera_queue", "delivery_line", "delivery",
    "sgt_stan", "sgt_towar", "sgt_magazyn", "magazyn_widocznosc",
  ]) {
    db().prepare(`DELETE FROM ${t}`).run();
  }
  const insMag = db().prepare("INSERT INTO sgt_magazyn(mag_id, kod, nazwa) VALUES (?,?,?)");
  insMag.run(config.magId.MAG, "MAG", "Hala");
  insMag.run(config.magId.MGP, "MGP", "Strefa przyjęć");
  insMag.run(config.magId.ZWROTY, "ZWROTY", "Zwroty od klientów");
  insMag.run(90, "SERWIS", "Warsztat");

  db()
    .prepare(
      `INSERT INTO sgt_towar(tw_id, symbol, nazwa, ean, unit, lokalizacja)
       VALUES (?,?,?,?,?,?)`
    )
    .run(TW, "W32-0401", "Zestaw podkładek", "5905947595303", "szt", "E08-03-01");
  const insStan = db().prepare("INSERT INTO sgt_stan(tw_id, mag_id, stan, stan_rez) VALUES (?,?,?,0)");
  insStan.run(TW, config.magId.MAG, 4);
  insStan.run(TW, config.magId.MGP, 10);
  insStan.run(TW, 90, 3);

  deliveryId = Number(
    db()
      .prepare(
        `INSERT INTO delivery(sgt_dok_id, sgt_dok_numer, dostawca, data_dok, source_mag_id, opened_at)
         VALUES (4711,'FZ 4711/2026','FALON-TECH','2026-08-01',?,?)`
      )
      .run(config.magId.MGP, nowIso()).lastInsertRowid
  );
  lineId = Number(
    db()
      .prepare(
        `INSERT INTO delivery_line(delivery_id, tw_id, tw_symbol, tw_nazwa, ilosc_dok, lok_oczekiwana)
         VALUES (?,?,'W32-0401','Zestaw podkładek',5,'E08-03-01')`
      )
      .run(deliveryId, TW).lastInsertRowid
  );
});

const przesun = (wejscie: Partial<Parameters<typeof P.przesunStan>[0]> = {}) =>
  P.przesunStan(
    {
      twId: TW,
      qty: 2,
      magFrom: config.magId.MGP,
      magTo: config.magId.MAG,
      location: "E08-03-01",
      ...wejscie,
    },
    "Jan Kowalski"
  );

const zadania = () =>
  db().prepare("SELECT id, type, payload, source_doc_id FROM sfera_queue ORDER BY id").all() as Array<{
    id: number;
    type: string;
    payload: string;
    source_doc_id: number | null;
  }>;

/* ── Walidacje ───────────────────────────────────────────────────────────── */

test("przesunięcie z magazynu do niego samego to nie czynność", () => {
  const r = przesun({ magFrom: config.magId.MAG, magTo: config.magId.MAG, location: null });
  assert.ok("error" in r);
  assert.match(r.error, /ten sam magazyn/);
});

test("nieznany magazyn odpada z podaniem identyfikatora", () => {
  const r = przesun({ magFrom: 777 });
  assert.ok("error" in r);
  assert.match(r.error, /777/, "człowiek ma wiedzieć, o który magazyn chodzi");
});

test("ilość ponad stan to 409, nie 400", () => {
  /* 409 zostaje zarezerwowane dla braku stanu: to jedyna odmowa, którą
     naprawia się CZEKANIEM albo mniejszą ilością, a nie poprawieniem żądania. */
  const r = przesun({ qty: 11 });
  assert.ok("error" in r);
  assert.equal(r.status, 409);
  assert.match(r.error, /MGP dostępne tylko 10/);
});

test("magazyn ukryty w ustawieniach odrzuca SERWER, nie ekran", () => {
  /* Widoczność jest ustawieniem globalnym (patrz `magazyny.ts`), więc filtr po
     stronie kolektora znaczyłby, że jedna osoba może przesunąć tam, gdzie druga
     nawet nie widzi magazynu. */
  db().prepare("INSERT INTO magazyn_widocznosc(mag_id, ukryty) VALUES (90, 1)").run();
  const r = przesun({ magFrom: config.magId.MAG, magTo: 90, qty: 1, location: null });
  assert.ok("error" in r);
  assert.match(r.error, /ukryty/);
});

test("ilość zero i ujemna odpadają", () => {
  assert.ok("error" in przesun({ qty: 0 }));
  assert.ok("error" in przesun({ qty: -3 }));
});

test("drugie przesunięcie widzi stan pomniejszony o pierwsze", () => {
  /* Kolejka JEST rezerwacją. Bez tego dwa przesunięcia zrobione, zanim worker
     dobił do pierwszego, wysłałyby do Subiekta sumę większą niż stan — a odmowa
     przyszłaby godzinę później i bez człowieka przy palecie. */
  assert.ok("ok" in przesun({ qty: 7 }));
  const drugie = przesun({ qty: 7 });
  assert.ok("error" in drugie);
  assert.match(drugie.error, /dostępne tylko 3/);
});

test("zadanie w błędzie przestaje rezerwować stan", () => {
  assert.ok("ok" in przesun({ qty: 7 }));
  db().prepare("UPDATE sfera_queue SET status='error' WHERE type='mm'").run();
  // trwale nieudane MM nic już nie przeniesie, więc trzymanie stanu byłoby
  // kłamstwem w drugą stronę: towar leży, a system mówi, że go nie ma
  assert.ok("ok" in przesun({ qty: 7 }));
});

/* ── Adres a magazyn docelowy ────────────────────────────────────────────── */

test("przesunięcie na halę bez skanu półki odpada", () => {
  const r = przesun({ location: null });
  assert.ok("error" in r);
  assert.match(r.error, /Zeskanuj półkę/);
});

test("przesunięcie POZA halę z kodem półki to odmowa, nie ciche zignorowanie", () => {
  /* `tw_Lokalizacja` to jedno pole na kartotekę, bez wymiaru magazynu. Zapisany
     przy przesunięciu na inny magazyn nadpisałby adres hali adresem, którego na
     hali nie ma — kompletujący dostałby zlecenie na pustą półkę. */
  const r = przesun({ magFrom: config.magId.MAG, magTo: 90, location: "E08-03-01" });
  assert.ok("error" in r);
  assert.match(r.error, /SERWIS/);
});

test("przesunięcie poza halę przechodzi bez adresu i nie dotyka kartoteki", () => {
  const r = przesun({ magFrom: config.magId.MAG, magTo: 90, qty: 1, location: null });
  assert.ok("ok" in r);
  assert.deepEqual(
    zadania().map((z) => z.type),
    ["mm"],
    "sam stan, żadnego zapisu lokalizacji"
  );
});

test("zły kod półki odpada tak samo jak przy rozkładaniu", () => {
  assert.ok("error" in przesun({ location: "ZUPEŁNIE-NIE-PÓŁKA" }));
});

test("skan półki, którą towar już ma, jest dowodem, nie zapisem", () => {
  // kartoteka ma E08-03-01; ten sam kod nie potrzebuje zadania do Subiekta,
  // ale skan zostaje obowiązkowy — jest dowodem, że człowiek tam był
  const r = przesun({ location: "E08-03-01" });
  assert.ok("ok" in r);
  assert.deepEqual(
    zadania().map((z) => z.type),
    ["mm"]
  );
});

/* ── Niezmiennik kolejności ──────────────────────────────────────────────── */

test("adres idzie do kolejki PRZED stanem", () => {
  /* Worker bierze zadania po `id` rosnąco. MM czyni towar sprzedawalnym;
     zakolejkowane przed `set_location` dawałoby okno, w którym towar jest już
     do wzięcia, a jego adres w kartotece stary — i przy nieudanym zapisie
     lokalizacji stan ten byłby TRWAŁY. */
  const r = przesun({ location: "A01-01-01" });
  assert.ok("ok" in r);
  const z = zadania();
  assert.deepEqual(
    z.map((x) => x.type),
    ["set_location", "mm"]
  );
  assert.ok(z[0].id < z[1].id, "kolejność wstawienia JEST kolejnością wykonania");
});

test("zadanie MM niesie obie strony przesunięcia", () => {
  assert.ok("ok" in przesun({ qty: 4 }));
  const mm = zadania().find((z) => z.type === "mm")!;
  assert.deepEqual(JSON.parse(mm.payload), {
    magFrom: config.magId.MGP,
    magTo: config.magId.MAG,
    items: [{ twId: TW, qty: 4 }],
  });
});

/* ── Skrót z listy dostawy ───────────────────────────────────────────────── */

test("przesunięcie z wiersza dostawy odkłada linię i niesie dokument", () => {
  const r = przesun({ lineId, qty: 5, location: "A01-01-01" });
  assert.ok("ok" in r);
  const linia = db().prepare("SELECT status, lok_faktyczna FROM delivery_line WHERE id=?").get(lineId) as {
    status: string;
    lok_faktyczna: string;
  };
  assert.equal(linia.status, "done", "jedno dotknięcie robi obie rzeczy");
  assert.equal(linia.lok_faktyczna, "A01-01-01");

  /* Dokument źródłowy JEST tu istotny: `czekaNaDokument` wstrzymuje MM, dopóki
     faktura siedzi w buforze Subiekta. Adres nie czeka na bufor (D1), stan
     czeka — przesunięcie na nieksięgowanym dokumencie nie ma prawa wejść. */
  const mm = zadania().find((z) => z.type === "mm")!;
  assert.equal(mm.source_doc_id, 4711);
});

test("przesunięcie bez dostawy nie niesie dokumentu i nie czeka na bufor", () => {
  assert.ok("ok" in przesun({ location: "A01-01-01" }));
  assert.equal(zadania().find((z) => z.type === "mm")!.source_doc_id, null);
});

/* ── Ślad ────────────────────────────────────────────────────────────────── */

test("zdarzenie niesie obie strony, ilość i stan sprzed zapisu", () => {
  assert.ok("ok" in przesun({ qty: 3 }));
  const e = db()
    .prepare("SELECT type, payload FROM events WHERE type='przesuniecie'")
    .get() as { type: string; payload: string };
  const p = JSON.parse(e.payload);
  assert.equal(p.kodFrom, "MGP");
  assert.equal(p.kodTo, "MAG");
  assert.equal(p.qty, 3);
  // ile było dostępne PRZED zapisem — jeden wiersz ma wystarczyć do odpowiedzi
  // na reklamację, bez odtwarzania całej sekwencji
  assert.equal(p.dostepnePrzed, 10);
});
