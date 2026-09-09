import { before, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "wertis-wymiary-")), "t.db");
process.env.SGT_MODE = "seeded";
process.env.LOG_LEVEL = "silent";

/* ── Wymiary z nazw i opisów kartotek — szczebel „zgodne wymiary" ───────────
   Na REALNYM seedzie, jak identyfikatory: blizna linki 148 cm jest w nim
   kompletna (18-11010 i 470002 „…1170x1480"). Pilnujemy parsera (jednostka
   obowiązkowa, metry tylko małą literą, para z trzech cyfr), przebudowy
   w widełkach i rytmie importu, odczytu po dokładnym milimetrze i tego, że
   odczyt niczego nie pisze.                                                */

let db: typeof import("../db/db.js").db;
let config: typeof import("../config.js").config;
let W: typeof import("./wymiary.js");
let I: typeof import("./identyfikatory.js");
const ID: Record<string, number> = {};

before(async () => {
  ({ db } = await import("../db/db.js"));
  ({ config } = await import("../config.js"));
  W = await import("./wymiary.js");
  I = await import("./identyfikatory.js");
  const d = db();
  const rows = JSON.parse(fs.readFileSync(config.seedProducts, "utf8")) as string[][];
  assert.ok(rows.length > 3000, "test wymaga realnego eksportu kartoteki");
  const ins = d.prepare("INSERT INTO sgt_towar(tw_id,symbol,nazwa,ean,opis) VALUES (?,?,?,?,?)");
  d.exec("BEGIN");
  rows.forEach((r, i) => ins.run(i + 1, r[0], r[1], r[2] || "", r[9] || ""));
  d.exec("COMMIT");
  for (const s of ["18-11010", "470002", "18-12005", "18-11013"]) {
    const w = d.prepare("SELECT tw_id FROM sgt_towar WHERE symbol=?").get(s) as { tw_id: number } | undefined;
    assert.ok(w, `blizna linki 148 cm wymaga kartoteki ${s} w seedzie`);
    ID[s] = w.tw_id;
  }
});

const mm = (t: string) => W.wymiaryZTekstu(t).map((w) => w.mm);

test("parser: para, liczba z jednostką, metry małą literą; bez jednostki nic", () => {
  const TABELA: Array<[string, number[]]> = [
    ["Linka napędu Castel Garden 81000668/1 1170x1480", [1170, 1480]],
    ["linka hamulca 1410mm x 1230mm linka napędu 1480mm x 1280mm", [1410, 1230, 1480, 1280]],
    ["Linka napędu CastelGarden STIGA 1420x1250mm", [1420, 1250]],
    ["Nóż do kosiarki NAC 40 cm 16\" LS1210", [400]],
    ["Linka napędu uniwersalna stalowa 2,5m - sprężynka", [2500]],
    ["1,48 m", [1480]],
    ["Koła kosiarki uniwersalne 12.7mm x 28.6mm", [13, 29]],
    ["ZAMA 102 MM - HUSQVARNA 323", [102]],
    /* Model Mountfield, nie 1330 metrów: metry wyłącznie małą literą. */
    ["Mountfield 1330M", []],
    /* Gwint i przekrój przewodu to nie wymiary: para z trzech cyfr, `x` odcina jednostkę. */
    ["Zestaw mocowań M12x1,5", []],
    ["Przewód paliwa 4x9mm", []],
    /* Bez jednostki nie wiadomo, czy to centymetry — nie zgadujemy. */
    ["148", []],
    ["długość 148", []],
    /* Numer katalogowy ze slashem nie jest wymiarem. */
    ["OEM: 81001145/0", []],
    ["", []],
  ];
  for (const [t, oczekiwane] of TABELA) assert.deepEqual(mm(t), oczekiwane, `„${t}”`);
  const raz = W.wymiaryZTekstu("1170x1480 i znowu 1480mm");
  assert.deepEqual(raz.map((w) => w.mm), [1170, 1480], "ten sam milimetr raz");
  assert.equal(raz[1]!.zapis, "1170x1480", "z pierwszym zapisem, nie z powtórki");
});

test("parametry doboru: wartość z jednostką daje milimetry z etykietą, bez jednostki nic", () => {
  assert.deepEqual(W.wymiaryZParametrow({ "długość": "148 cm", "zakończenie": "sprężyna" }),
    [{ mm: 1480, zapis: "148 cm", etykieta: "długość: 148 cm" }]);
  assert.deepEqual(W.wymiaryZParametrow({ "długość": "148" }), []);
  assert.deepEqual(W.wymiaryZParametrow({}), []);
});

test("przebudowa na seedzie: linki Castel Garden mają 1170 i 1480, liczniki w widełkach, rytm importu", () => {
  const w = W.przebudujWymiary(db());
  assert.ok(w.kartotek >= 800 && w.kartotek <= 1100, `kartotek z wymiarem: ${w.kartotek}`);
  assert.ok(w.wymiarow >= 1000 && w.wymiarow <= 1600, `wymiarów: ${w.wymiarow}`);
  assert.ok(w.ms < 5000, `przebudowa trwała ${w.ms} ms — rytm importu to 60 s`);
  const linki = (tw: number) => (db().prepare("SELECT mm, pole FROM wymiar_kartoteki WHERE tw_id=? ORDER BY mm").all(tw) as Array<{ mm: number; pole: string }>)
    .map((x) => ({ mm: Number(x.mm), pole: String(x.pole) }));
  assert.deepEqual(linki(ID["18-11010"]), [{ mm: 1170, pole: "nazwa" }, { mm: 1480, pole: "nazwa" }]);
  assert.deepEqual(linki(ID["470002"]).map((x) => x.mm), [1170, 1480]);
  /* Linka do COMBI nie ma wymiaru ani w nazwie, ani w opisie — o to poszło w bliźnie. */
  assert.deepEqual(linki(ID["18-11013"]), []);
  const drugi = W.przebudujWymiary(db());
  assert.equal(drugi.wymiarow, w.wymiarow, "przebudowa jest idempotentna");
});

test("szukanie po dokładnym milimetrze: 1480 daje obie linki Castel Garden i linkę NAC z opisu, z polem i zapisem", () => {
  W.przebudujWymiary(db());
  const t = W.szukajPoWymiarach([1480], 8);
  const symbole = t.map((x) => x.symbol);
  assert.ok(symbole.includes("18-11010") && symbole.includes("470002"), symbole.join(", "));
  const nac = t.find((x) => x.symbol === "18-12005")!;
  assert.ok(nac, "linka NAC ma 1480 w OPISIE");
  assert.deepEqual(nac.trafienia, [{ mm: 1480, zapis: "1480mm", pole: "opis" }]);
  /* Dwa wymiary naraz: kartoteka z oboma stoi pierwsza. */
  const oba = W.szukajPoWymiarach([1170, 1480], 8);
  assert.equal(oba[0]!.trafienia.length, 2);
  assert.ok(["18-11010", "470002"].includes(oba[0]!.symbol));
  /* 1481 to nie 1480 — bez tolerancji. */
  assert.deepEqual(W.szukajPoWymiarach([1481], 8), []);
  assert.deepEqual(W.szukajPoWymiarach([], 8), []);
});

test("odczyt niczego nie zapisuje; pokrycie liczy kartoteki i wymiary", () => {
  W.przebudujWymiary(db());
  const licz = () => (db().prepare("SELECT count(*) n FROM events").get() as { n: number }).n;
  const przed = licz();
  W.szukajPoWymiarach([1480], 8); W.indeksWymiarowPusty();
  assert.equal(licz(), przed);
  const p = I.pokrycieWiedzy();
  assert.ok(p.wymiary.kartotek >= 800 && p.wymiary.wymiarow >= p.wymiary.kartotek);
  assert.equal(W.indeksWymiarowPusty(), false);
  db().prepare("DELETE FROM wymiar_kartoteki").run();
  assert.equal(W.indeksWymiarowPusty(), true, "pusty indeks przy niepustym katalogu");
});
