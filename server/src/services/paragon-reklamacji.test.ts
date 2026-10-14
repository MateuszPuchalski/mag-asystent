import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { migrate, type Db } from "../db/db.js";
import { config } from "../config.js";
import { paragonReklamacji, type SprawaParagonu } from "./paragon-reklamacji.js";
import { szczegolReklamacji } from "./reklamacje.js";

/* Ten plik pilnuje dwóch obietnic karty „Kupiony towar". Symbol pochodzi
   wyłącznie z dokumentu Subiekta, a bez dokumentu jest powód, nie zastępstwo.
   Sporna pozycja świeci się tylko przy jednoznacznym wskazaniu. Zgadnięte
   wyróżnienie odsyła reklamację do złego dostawcy. */

const schema = fs.readFileSync(new URL("../db/schema.sql", import.meta.url), "utf8");
const TERAZ = Date.parse("2026-10-14T12:00:00.000Z");
const ZAMOWIENIE = "3f2b6c1e-1111-4a5b-9c8d-000000000001";
const KUPIONO = "2026-10-01T09:00:00Z";

function stanowisko() {
  const d = new DatabaseSync(":memory:");
  d.exec(schema);
  migrate(d);
  const konto = Number(d.prepare(
    "INSERT INTO channel_account(channel,external_account_id) VALUES ('allegro','k')")
    .run().lastInsertRowid);
  return { d: d as unknown as Db, surowa: d, konto };
}

function towar(d: Db, twId: number, symbol = `SYM-${twId}`) {
  d.prepare("INSERT OR IGNORE INTO sgt_towar(tw_id,symbol,nazwa) VALUES (?,?,?)")
    .run(twId, symbol, `Towar ${twId}`);
}

function dokument(d: Db, dokId: number, w: {
  typ?: string; data?: string; zamowienie?: string; linie: Array<[number, number]>;
}) {
  d.prepare(`INSERT INTO sgt_faktura(dok_id,typ,nr_pelny,nr_oryg,data_wyst)
    VALUES (?,?,?,?,?)`).run(dokId, w.typ ?? "PA", `${w.typ ?? "PA"} ${dokId}/10/2026`,
    (w.zamowienie ?? ZAMOWIENIE).slice(0, 30), w.data ?? "2026-10-01");
  for (const [twId, ilosc] of w.linie) {
    towar(d, twId);
    d.prepare("INSERT INTO sgt_faktura_pozycja(dok_id,tw_id,ilosc) VALUES (?,?,?)")
      .run(dokId, twId, ilosc);
  }
}

function zamowienie(d: Db, konto: number,
  oferty: Array<{ offerId: string; ilosc?: number; sku?: string | null }>) {
  const id = Number(d.prepare(`INSERT INTO zamowienie_klienta
    (channel_account_id,external_id,kupiono_at,synced_at) VALUES (?,?,?,?)`)
    .run(konto, ZAMOWIENIE, KUPIONO, KUPIONO).lastInsertRowid);
  for (const o of oferty) {
    d.prepare(`INSERT INTO zamowienie_klienta_pozycja
      (zamowienie_id,external_id,offer_id,nazwa,sku,ilosc,cena_grosze,waluta)
      VALUES (?,?,?,?,?,?,5000,'PLN')`)
      .run(id, `li-${o.offerId}`, o.offerId, `Oferta ${o.offerId}`, o.sku ?? null, o.ilosc ?? 1);
  }
}

function mapowanie(d: Db, konto: number, offerId: string, twId: number) {
  d.prepare(`INSERT INTO oferta_kartoteka(channel_account_id,offer_id,tw_id,tw_symbol,
    wskazano_at,wskazano_przez) VALUES (?,?,?,?,'2026-10-01T08:00:00Z','A. L.')`)
    .run(konto, offerId, twId, `SYM-${twId}`);
}

const sprawa = (konto: number, inne: Partial<SprawaParagonu> = {}): SprawaParagonu => ({
  konto, orderId: ZAMOWIENIE, offerId: "of-1", kupionoAt: KUPIONO, kandydaci: [], ...inne,
});

const sporne = (p: ReturnType<typeof paragonReklamacji>) =>
  p.dokumenty.flatMap((d) => d.pozycje.filter((x) => x.sporna).map((x) => x.twId));

test("bez dokumentu: trzy powody i żadnego symbolu zastępczego", () => {
  const { d, konto } = stanowisko();
  /* Mapowanie oferty istnieje, a mimo to nic z niego nie wychodzi. */
  mapowanie(d, konto, "of-1", 11);

  const bez = paragonReklamacji(d, sprawa(konto, { orderId: null, kandydaci: [11] }), TERAZ);
  assert.deepEqual(bez, {
    dokumenty: [], spornaTwId: null, brak: "bez-zamowienia", oknoDni: config.mssql.fakturyDniWstecz,
  });

  /* Zakup starszy niż okno read-modelu: dokument jest tylko w Subiekcie. */
  const stary = new Date(TERAZ - (config.mssql.fakturyDniWstecz + 5) * 86_400_000).toISOString();
  const poza = paragonReklamacji(d, sprawa(konto, { kupionoAt: stary, kandydaci: [11] }), TERAZ);
  assert.equal(poza.brak, "poza-oknem");
  assert.equal(poza.spornaTwId, null);

  /* W oknie, ale żaden FS/PA nie niesie numeru zamówienia. Cudzy dokument
     z tego samego dnia nie ma prawa się podłączyć. */
  dokument(d, 1, { zamowienie: "inne-zamowienie-zupelnie", linie: [[11, 1]] });
  const nie = paragonReklamacji(d, sprawa(konto, { kandydaci: [11] }), TERAZ);
  assert.equal(nie.brak, "nie-znaleziono");
  assert.deepEqual(nie.dokumenty, []);

  /* Bez daty zakupu nie wiemy, czy to okno, więc nie mówimy „poza oknem". */
  assert.equal(paragonReklamacji(d, sprawa(konto, { kupionoAt: null }), TERAZ).brak, "nie-znaleziono");
});

test("jedna pozycja towarowa jest sporna, przesyłka jest usługą", () => {
  const { d, konto } = stanowisko();
  towar(d, 900, "PRZESYŁKA");
  dokument(d, 7, { linie: [[11, 1], [900, 1], [11, 1]] });

  const p = paragonReklamacji(d, sprawa(konto), TERAZ);
  assert.equal(p.brak, null);
  assert.equal(p.spornaTwId, 11);
  assert.deepEqual(p.dokumenty, [{
    dokId: 7, numer: "PA 7/10/2026", typ: "PA", data: "2026-10-01",
    pozycje: [
      { twId: 11, symbol: "SYM-11", nazwa: "Towar 11", ilosc: 2, usluga: false, sporna: true },
      { twId: 900, symbol: "PRZESYŁKA", nazwa: "Towar 900", ilosc: 1, usluga: true, sporna: false },
    ],
  }], "cały dokument, ilość zsumowana po kartotece, usługa zostaje z flagą");
});

test("kilka pozycji: rozstrzyga kandydat obecny na dokumencie", () => {
  const { d, konto } = stanowisko();
  dokument(d, 7, { linie: [[11, 1], [12, 1], [13, 1]] });

  const p = paragonReklamacji(d, sprawa(konto, { kandydaci: [12, null, 99] }), TERAZ);
  assert.equal(p.spornaTwId, 12);
  assert.deepEqual(sporne(p), [12]);
  assert.equal(p.dokumenty[0].pozycje.length, 3, "reszta dokumentu zostaje na ekranie");
});

test("wieloznaczność: żadna pozycja nie świeci się", () => {
  const { d, konto } = stanowisko();
  dokument(d, 7, { linie: [[11, 1], [12, 1], [13, 1]] });
  /* Inna oferta bez kartoteki — odejmowanie nie umie podzielić dokumentu. */
  zamowienie(d, konto, [{ offerId: "of-1" }, { offerId: "of-2" }, { offerId: "of-3" }]);
  mapowanie(d, konto, "of-3", 13);

  /* Bez kandydatów i z dwiema ofertami bez kartoteki. */
  const p = paragonReklamacji(d, sprawa(konto), TERAZ);
  assert.equal(p.spornaTwId, null);
  assert.deepEqual(sporne(p), []);
  assert.equal(p.brak, null, "dokument jest — brakuje tylko wskazania");

  /* Mapowanie i sygnatura wskazują dwa różne towary z dokumentu. To jest
     sprzeczność, nie wybór pierwszego. */
  const sprzeczne = paragonReklamacji(d, sprawa(konto, { kandydaci: [11, 12] }), TERAZ);
  assert.equal(sprzeczne.spornaTwId, null);

  /* Odejmowanie zostawiło jedną pozycję, ale mogła być oferty bez kartoteki.
     Jedna reszta przy dwóch ofertach bez kartoteki to wciąż zgadywanie. */
  const { d: d2, konto: k2 } = stanowisko();
  dokument(d2, 7, { linie: [[11, 1], [12, 1]] });
  zamowienie(d2, k2, [{ offerId: "of-1" }, { offerId: "of-2" }, { offerId: "of-3" }]);
  mapowanie(d2, k2, "of-3", 12);
  assert.equal(paragonReklamacji(d2, sprawa(k2), TERAZ).spornaTwId, null);
});

test("odejmowanie: inne oferty zabierają swoje pozycje, zostaje sporna", () => {
  const { d, konto } = stanowisko();
  towar(d, 900, "PRZESYŁKA");
  dokument(d, 7, { linie: [[11, 1], [12, 2], [13, 1], [900, 1]] });
  /* of-2 ma mapowanie, of-3 trafia po unikalnym SKU — tak jak przy komplecie. */
  d.prepare("UPDATE sgt_towar SET symbol='SEKATOR-13' WHERE tw_id=13").run();
  zamowienie(d, konto, [
    { offerId: "of-1" }, { offerId: "of-2", ilosc: 2 }, { offerId: "of-3", sku: "sekator-13" },
  ]);
  mapowanie(d, konto, "of-2", 12);

  const p = paragonReklamacji(d, sprawa(konto), TERAZ);
  assert.equal(p.spornaTwId, 11, "przesyłka nie jest resztą do przypisania");
  assert.deepEqual(sporne(p), [11]);
});

test("kilka dokumentów: każdy z pozycjami, od najstarszego, sporna po kartotece", () => {
  const { d, konto } = stanowisko();
  /* Zamówienie rozbite na dwa paragony i faktura. */
  dokument(d, 20, { typ: "FS", data: "2026-10-03", linie: [[12, 1]] });
  dokument(d, 10, { data: "2026-10-01", linie: [[11, 1]] });
  dokument(d, 15, { data: "2026-10-02", linie: [[12, 1]] });
  zamowienie(d, konto, [{ offerId: "of-1" }, { offerId: "of-2" }]);
  mapowanie(d, konto, "of-2", 12);

  const p = paragonReklamacji(d, sprawa(konto), TERAZ);
  assert.deepEqual(p.dokumenty.map((x) => [x.dokId, x.typ, x.data]), [
    [10, "PA", "2026-10-01"], [15, "PA", "2026-10-02"], [20, "FS", "2026-10-03"],
  ]);
  /* Odejmowanie sumuje dokumenty: of-2 kupiła jedną sztukę, a na dwóch
     dokumentach stoją dwie. Reszta zostaje, więc krok milczy. */
  assert.equal(p.spornaTwId, null);

  /* Z kandydatem obecnym na dokumentach sporna świeci się na każdym z nich. */
  const zKandydatem = paragonReklamacji(d, sprawa(konto, { kandydaci: [12] }), TERAZ);
  assert.equal(zKandydatem.spornaTwId, 12);
  assert.deepEqual(sporne(zKandydatem), [12, 12]);
});

test("korekta z numerem zamówienia nie jest dokumentem sprzedaży", () => {
  const { d, konto } = stanowisko();
  dokument(d, 7, { linie: [[11, 1]] });
  dokument(d, 8, { typ: "KPA", data: "2026-10-05", linie: [[11, -1]] });

  const p = paragonReklamacji(d, sprawa(konto), TERAZ);
  assert.deepEqual(p.dokumenty.map((x) => x.numer), ["PA 7/10/2026"]);

  /* Sama korekta to brak dokumentu, nie dokument. */
  const { d: d2, konto: k2 } = stanowisko();
  dokument(d2, 8, { typ: "KPA", data: "2026-10-05", linie: [[11, -1]] });
  assert.equal(paragonReklamacji(d2, sprawa(k2), TERAZ).brak, "nie-znaleziono");
});

test("okno: dokument sprzed zakupu ani z daleka po nim nie należy do zamówienia", () => {
  const { d, konto } = stanowisko();
  dokument(d, 1, { data: "2026-09-20", linie: [[11, 1]] });
  dokument(d, 2, { data: "2026-12-30", linie: [[12, 1]] });
  /* Dzień przed zakupem wchodzi: data zakupu jest w UTC, a dokumentu lokalna. */
  dokument(d, 3, { data: "2026-09-30", linie: [[13, 1]] });

  const p = paragonReklamacji(d, sprawa(konto), TERAZ);
  assert.deepEqual(p.dokumenty.map((x) => x.dokId), [3]);
});

test("szczegół reklamacji niesie paragon i otwiera się bez zapisu", () => {
  const { d, surowa, konto } = stanowisko();
  /* Mapowanie dzisiejsze wskazuje 77, a sygnatura z pozycji zamówienia
     wskazuje 11. Na dokumencie stoi 11 i 12, więc wygrywa sygnatura. */
  towar(d, 77, "NOWY-DOSTAWCA");
  towar(d, 11, "STARY-DOSTAWCA");
  dokument(d, 7, { linie: [[11, 1], [12, 1]] });
  zamowienie(d, konto, [{ offerId: "of-1", sku: "STARY-DOSTAWCA" }, { offerId: "of-2" }]);
  d.prepare(`INSERT INTO oferta_kartoteka(channel_account_id,offer_id,tw_id,tw_symbol,
    wskazano_at,wskazano_przez) VALUES (?,'of-1',77,'NOWY-DOSTAWCA','2026-10-01T08:00:00Z','A. L.')`)
    .run(konto);
  const id = Number(d.prepare(`INSERT INTO reklamacja_klienta
    (channel_account_id,external_id,reference_number,order_id,offer_id,kupujacy_login,
     status_allegro,otwarto_at,synced_at)
    VALUES (?,'c-1','nr-1',?,'of-1','kupujacy1','CLAIM_SUBMITTED','2026-10-10T08:00:00Z',
     '2026-10-10T08:00:00Z')`).run(konto, ZAMOWIENIE).lastInsertRowid);

  const przed = (surowa.prepare("SELECT total_changes() AS n").get() as { n: number }).n;
  const s = szczegolReklamacji(d, id, TERAZ);
  const po = (surowa.prepare("SELECT total_changes() AS n").get() as { n: number }).n;

  assert.equal(po, przed, "zero zapisu przy patrzeniu");
  assert.equal(s.paragon.brak, null);
  assert.equal(s.paragon.spornaTwId, 11);
  assert.deepEqual(s.paragon.dokumenty[0].pozycje.map((x) => [x.symbol, x.sporna]),
    [["STARY-DOSTAWCA", true], ["SYM-12", false]]);
});
