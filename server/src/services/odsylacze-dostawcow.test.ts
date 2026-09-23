import { before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "wertis-odsylacze-")), "t.db");
process.env.SGT_MODE = "seeded";

/* ── Import odsyłaczy od dostawców, na PRAWDZIWEJ kartotece ─────────────────
   Pilnujemy czterech obietnic. Podgląd nie zostawia śladu, choć liczy
   kandydatów zamienności w punkcie zapisu. Zapis bierze wyłącznie mapowanie
   potwierdzone przez człowieka. Nowy plik dostawcy zastępuje stary, a numery
   z opisu i wpisane ręcznie zostają nietknięte. Numer z pliku działa jak numer
   z opisu: w szukaniu i w węźle zamienności.                              */

let db: typeof import("../db/db.js").db;
let O: typeof import("./odsylacze-dostawcow.js");
let I: typeof import("./identyfikatory.js");
let Z: typeof import("./zamiennosc-oem.js");
let Zb: typeof import("./zbiorki.js");
let biuro = 0;
let hala = 0;
const ID: Record<string, number> = {};

before(async () => {
  ({ db } = await import("../db/db.js"));
  const { config } = await import("../config.js");
  O = await import("./odsylacze-dostawcow.js");
  I = await import("./identyfikatory.js");
  Z = await import("./zamiennosc-oem.js");
  Zb = await import("./zbiorki.js");
  const d = db();
  const rows = JSON.parse(fs.readFileSync(config.seedProducts, "utf8")) as string[][];
  const ins = d.prepare("INSERT INTO sgt_towar(tw_id,symbol,nazwa,ean,opis) VALUES (?,?,?,?,?)");
  d.exec("BEGIN");
  rows.forEach((r, i) => ins.run(i + 1, r[0], r[1], r[2] || "", r[9] || ""));
  d.exec("COMMIT");
  I.przebudujIdentyfikatory(d);
  for (const s of ["W80-2005", "W80-2002", "14-45007"]) {
    ID[s] = (d.prepare("SELECT tw_id FROM sgt_towar WHERE symbol=?").get(s) as { tw_id: number }).tw_id;
  }
});

beforeEach(() => {
  const d = db();
  d.prepare("DELETE FROM towar_identyfikator WHERE zrodlo='dostawca'").run();
  for (const t of ["import_odsylaczy", "zamiennosc_oem", "events", "app_user"]) d.prepare(`DELETE FROM ${t}`).run();
  biuro = Number(d.prepare("INSERT INTO app_user(login,name,role) VALUES ('ala','A. Lewandowska','biuro')").run().lastInsertRowid);
  hala = Number(d.prepare("INSERT INTO app_user(login,name,role) VALUES ('bob','B. Nowak','magazynier')").run().lastInsertRowid);
});

/* Cennik z polskiego Excela: średnik, cudzysłowy, kilka numerów w komórce. */
const CENNIK = [
  "Indeks;Nazwa;EAN;Numery OEM",
  "W80-2005;Worek WD3;;\"6.904-143.0, 2.863-006.0\"",
  ";Worek WD3 (po EAN);5905947596249;6.904-143.0",
  "XX-NIEMA;Czego nie mamy;;123456789",
  "14-45007;Nóż JD;;AM141035",
  "W80-2002;bez numerów;;",
].join("\r\n");
const MAPA = { symbol: 0, ean: 2, numery: [3], rodzaj: "oem" as const };
const licz = (t: string) => (db().prepare(`SELECT count(*) n FROM ${t}`).get() as { n: number }).n;
const importuj = (n: Partial<Parameters<typeof O.importujOdsylacze>[0]> = {}, zastosuj = true) =>
  O.importujOdsylacze({ dostawca: "Kärcher-hurt", plik: "cennik.csv", tresc: { csv: CENNIK }, mapowanie: MAPA, ...n },
    zastosuj, biuro);

test("komórka z numerami: zapis STIHL i Husqvarny ze spacjami, lista rozdzielona spacją, marka odpada", () => {
  assert.deepEqual(O.numeryZKomorki("1130 400 1300"), ["1130 400 1300"]);
  assert.deepEqual(O.numeryZKomorki("532 16 56-30"), ["532 16 56-30"]);
  assert.deepEqual(O.numeryZKomorki("499486S 806232"), ["499486S", "806232"]);
  assert.deepEqual(O.numeryZKomorki("Stihl 1130 400 1300, 4137 120 1800"), ["1130 400 1300", "4137 120 1800"]);
  assert.deepEqual(O.numeryZKomorki("Honda 16100-ZH8-W61 / 16100-ZE2-W71"), ["16100-ZH8-W61", "16100-ZE2-W71"]);
  assert.deepEqual(O.numeryZKomorki("x2, S, 021, brak"), [], "krótkie kody i słowa to nie numery");
  assert.deepEqual(O.numeryZKomorki("592800;592800"), ["592800"], "dubel w komórce liczy się raz");
});

test("separator CSV: średnik polskiego Excela, tabulator i przecinek; cudzysłów nie myli", () => {
  assert.equal(Zb.wykryjSeparator("a;b;c\n1;2;3"), ";");
  assert.equal(Zb.wykryjSeparator("a\tb\tc"), "\t");
  assert.equal(Zb.wykryjSeparator("a,b,c"), ",");
  assert.equal(Zb.wykryjSeparator("\"a;b;c\",d,e"), ",", "średniki w cudzysłowie to treść, nie separator");
  assert.deepEqual(Zb.parsujCsv("a;\"b;c\"\n1;2", ";"), [["a", "b;c"], ["1", "2"]]);
});

test("mapowanie zgadnięte z nagłówków — i zamienniki bez słowa o oryginale to katalog obcy", () => {
  assert.deepEqual(O.zgadnijMapowanie(["Indeks", "Nazwa", "EAN", "Numery OEM"]),
    { symbol: 0, ean: 2, numery: [3], rodzaj: "oem" });
  assert.deepEqual(O.zgadnijMapowanie(["Symbol", "Zamienniki"]), { symbol: 0, ean: null, numery: [1], rodzaj: "katalog_obcy" });
  assert.equal(O.zgadnijMapowanie(["Nazwa", "Opis"]), null, "bez kolumny numerów nie ma czego zgadywać");
});

test("podgląd liczy raport i nowych kandydatów zamienności — i niczego nie zostawia", () => {
  const przed = [licz("towar_identyfikator"), licz("import_odsylaczy"), licz("events"), licz("zamiennosc_oem")];
  const r = importuj({}, false);
  assert.deepEqual(r.naglowki, ["Indeks", "Nazwa", "EAN", "Numery OEM"]);
  assert.equal(r.wierszy, 5);
  assert.equal(r.dopasowanych, 3, "symbol, EAN i nóż JD");
  assert.equal(r.kartotek, 3);
  assert.deepEqual(r.bezKartoteki, { liczba: 1, przyklady: ["XX-NIEMA"] });
  assert.equal(r.bezNumerow, 1);
  /* AM141035 stoi już w opisie 14-45007 — import go nie dubluje. */
  assert.deepEqual(r.numerow, { nowych: 3, znanych: 1 });
  assert.equal(r.noweKandydaty, 1, "W80-2005 i W80-2002 dostają wspólny numer 6.904-143.0");
  assert.equal(r.zapisano, null);
  assert.deepEqual([licz("towar_identyfikator"), licz("import_odsylaczy"), licz("events"), licz("zamiennosc_oem")], przed);
});

test("zapis: wymaga potwierdzonego mapowania, nazwy dostawcy i ręki biura", () => {
  assert.throws(() => importuj({ mapowanie: null }), /Potwierdź mapowanie/);
  assert.throws(() => importuj({ dostawca: " " }), /nazwę dostawcy/);
  assert.throws(() => O.importujOdsylacze({ dostawca: "X", tresc: { csv: CENNIK }, mapowanie: MAPA }, true, hala),
    /człowiek z biura/);
  assert.throws(() => importuj({ mapowanie: { ...MAPA, numery: [0] } }), /jednocześnie kolumną numerów/);
  assert.throws(() => importuj({ mapowanie: { ...MAPA, numery: [9] } }), /której w pliku nie ma/);
  assert.equal(licz("import_odsylaczy"), 0);
});

test("zapis: numery działają jak numer z opisu — w szukaniu i w węźle zamienności", () => {
  const r = importuj();
  assert.ok(r.zapisano);
  assert.equal(r.zapisano.numerow, 3);
  const trafienia = I.szukajPoIdentyfikatorze("6904-1430");
  assert.deepEqual(trafienia.map((t) => t.symbol).sort(), ["W80-2002", "W80-2005"]);
  assert.ok(trafienia.every((t) => t.zrodlo === "dostawca" && t.dostawca === "Kärcher-hurt"));
  const para = Z.kandydaciZamiennosci().kandydaci
    .find((k) => [k.a.twId, k.b.twId].sort().join() === [ID["W80-2005"], ID["W80-2002"]].sort().join());
  assert.ok(para, "wspólny numer z pliku robi kandydata w kolejce wiedzy");
  const ev = db().prepare("SELECT type FROM events WHERE type LIKE 'odsylacze%'").all() as Array<{ type: string }>;
  assert.deepEqual(ev.map((e) => e.type), ["odsylacze_import"]);
});

test("nowy plik tego samego dostawcy zastępuje stary; numery z opisu i przebudowa po imporcie nietknięte", () => {
  const pierwszy = importuj();
  const opisPrzed = (db().prepare("SELECT count(*) n FROM towar_identyfikator WHERE zrodlo='opis'").get() as { n: number }).n;
  const nowy = ["Indeks;Numery OEM", "W80-2005;6.904-322.0"].join("\n");
  const r = O.importujOdsylacze({ dostawca: "kärcher-HURT", tresc: { csv: nowy },
    mapowanie: { symbol: 0, ean: null, numery: [1], rodzaj: "oem" } }, true, biuro);
  assert.equal(r.zastapi, 3, "nazwa dostawcy bez względu na wielkość liter");
  assert.deepEqual(I.szukajPoIdentyfikatorze("6.904-143.0"), [], "numer ze starego cennika znika");
  assert.equal(I.szukajPoIdentyfikatorze("6904322-0").length, 1);
  const hist = O.historiaImportow();
  assert.deepEqual(hist.map((h) => [h.id, h.stan]), [[r.zapisano!.importId, "aktywny"], [pierwszy.zapisano!.importId, "zastapiony"]]);
  assert.equal((db().prepare("SELECT count(*) n FROM towar_identyfikator WHERE zrodlo='opis'").get() as { n: number }).n, opisPrzed);
  I.przebudujIdentyfikatory(db());
  assert.equal(I.szukajPoIdentyfikatorze("6904322-0").length, 1, "przebudowa po imporcie z Subiekta kasuje tylko `opis`");
});

test("wycofanie: aktywny import znika w całości, zastąpionego się nie wycofuje", () => {
  const a = importuj();
  const b = importuj();
  assert.throws(() => O.wycofajImport(a.zapisano!.importId, biuro), /tylko aktywny/);
  const w = O.wycofajImport(b.zapisano!.importId, biuro);
  assert.equal(w.stan, "wycofany");
  assert.equal(w.wycofal, "A. Lewandowska");
  assert.deepEqual(I.szukajPoIdentyfikatorze("6.904-143.0"), []);
  assert.throws(() => O.wycofajImport(b.zapisano!.importId, biuro), /tylko aktywny/);
  assert.throws(() => O.wycofajImport(b.zapisano!.importId, hala), /człowiek z biura/);
});

test("symbol zdublowany w Subiekcie nie wskazuje cudzej części — wiersz idzie do niejednoznacznych", () => {
  const d = db();
  d.prepare("INSERT INTO sgt_towar(tw_id,symbol,nazwa,ean,opis) VALUES (990001,'W80-2005','dubel','','')").run();
  try {
    const r = importuj({}, false);
    assert.deepEqual(r.niejednoznaczne, { liczba: 1, przyklady: ["W80-2005"] });
    assert.equal(r.dopasowanych, 2);
  } finally {
    d.prepare("DELETE FROM sgt_towar WHERE tw_id=990001").run();
  }
});

test("pusty plik, sam nagłówek i plik ponad limit odbijają się zdaniem", () => {
  assert.throws(() => O.tabelaZTresci({}), /Brak pliku/);
  assert.throws(() => O.tabelaZTresci({ csv: "Indeks;OEM\n" }), /nie ma wierszy danych/);
  const duzo = ["Indeks;OEM", ...Array.from({ length: O.LIMIT_WIERSZY + 1 }, (_, i) => `S${i};123456`)].join("\n");
  assert.throws(() => O.tabelaZTresci({ csv: duzo }), /podziel go/);
  assert.deepEqual(O.tabelaZTresci({ tabela: [["Symbol", "OEM"], ["  W80-2005 ", " 123 456 "], ["", ""]] }),
    [["Symbol", "OEM"], ["W80-2005", "123 456"]], "arkusz z przeglądarki: przycięte komórki, puste wiersze odpadają");
});
