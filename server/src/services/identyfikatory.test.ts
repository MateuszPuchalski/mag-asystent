import { before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "wertis-identyfikatory-")), "t.db");
process.env.SGT_MODE = "seeded";

/* ── Identyfikatory z opisów (§11.2, E3) ─────────────────────────────────────
   Opis to pole swobodne, więc parser jest przybliżeniem — ale kosztowna jest
   tylko jedna strona pomyłki. Numer przeoczony to kandydat mniej; numer
   ZMYŚLONY (`19` z `532 19 93-77`) prowadzi agenta do cudzej kartoteki.
   Dlatego tabela pilnuje kształtów, w których opis kusi, żeby powiedzieć za
   dużo, a strażnik na pełnym seedzie pilnuje, że reguły trafiają w dane.  */

let db: typeof import("../db/db.js").db;
let I: typeof import("./identyfikatory.js");
let W: typeof import("./wiedza.js");
let config: typeof import("../config.js").config;
let biuro = 0;
const FTC272 = 14;

before(async () => {
  ({ db } = await import("../db/db.js"));
  ({ config } = await import("../config.js"));
  I = await import("./identyfikatory.js");
  W = await import("./wiedza.js");
  const d = db();
  const rows = JSON.parse(fs.readFileSync(config.seedProducts, "utf8")) as string[][];
  assert.ok(rows.length > 3000, `kartoteka wygląda na niekompletną: ${rows.length}`);
  const ins = d.prepare("INSERT INTO sgt_towar(tw_id,symbol,nazwa,ean,opis) VALUES (?,?,?,?,?)");
  d.exec("BEGIN");
  rows.forEach((r, i) => ins.run(i + 1, r[0], r[1], r[2] || "", r[9] || ""));
  d.exec("COMMIT");
});

beforeEach(() => {
  const d = db();
  for (const t of ["model_z_opisu", "towar_identyfikator", "dowod_zastosowania", "zastosowanie", "model_urzadzenia", "events", "app_user"]) {
    d.prepare(`DELETE FROM ${t}`).run();
  }
  biuro = Number(d.prepare("INSERT INTO app_user(login,name,role) VALUES ('ala','A. Lewandowska','biuro')").run().lastInsertRowid);
});

const liczba = (t: string) => (db().prepare(`SELECT count(*) n FROM ${t}`).get() as { n: number }).n;

const TABELA: Array<{ opis: string; sym: string; oczekiwane: Array<[string, string]>; po: string }> = [
  { opis: "OEM: 41307131600 Modele: FS200 FS250 Zamiennik: 24-04003", sym: "FTC272",
    oczekiwane: [["oem", "41307131600"]], po: "Modele: i Zamiennik: to granice sekcji OEM" },
  { opis: "OEM: 165630 // 532 16 56-30  Zamiennik: RO15136", sym: "20-05017",
    oczekiwane: [["oem", "165630"], ["oem", "532 16 56-30"]], po: "cyfry ze spacjami po ≤3 to JEDEN numer Husqvarny" },
  { opis: "OEM: 84001990 259291", sym: "10-01033",
    oczekiwane: [["oem", "84001990"], ["oem", "259291"]], po: "dwie długie grupy to dwa numery" },
  { opis: "OEM: 14-083-26-S // 1408326S // 14 083 26-S", sym: "04-21003",
    oczekiwane: [["oem", "14-083-26-S"]], po: "trzy zapisy jednego numeru zwijają się do jednego wiersza" },
  { opis: "OEM: 81001145 / 81001145/0 Zamiennie: 18-11010  Castel Garden: SP535", sym: "470002",
    oczekiwane: [["oem", "81001145"], ["oem", "81001145/0"]], po: "`/0` to sufiks GGP, nie separator; `Castel Garden:` to granica" },
  { opis: "OEM: 493629 / 691035 / 2505002 / AM108356 / 34279A 84001895", sym: "W07-1301",
    oczekiwane: [["oem", "493629"], ["oem", "691035"], ["oem", "2505002"], ["oem", "AM108356"], ["oem", "34279A"], ["oem", "84001895"]],
    po: "ukośnik między długimi członami dzieli; spacja po literze też" },
  { opis: "Nr. oryg.: 29100109903 HORTMASZ 1578 1576 ; MAKITA PLM", sym: "18-99008",
    oczekiwane: [["nr_oryg", "29100109903"], ["nr_oryg", "1578"], ["nr_oryg", "1576"]], po: "słowa bez cyfry odpadają, numery modeli zostają — to decyzja człowieka przy kolejce, nie parsera" },
  { opis: "Numery oryginalnej części: 503-91-34-01, 530-05-63-63 Modele: 236; 240", sym: "100-008",
    oczekiwane: [["nr_oryg", "503-91-34-01"], ["nr_oryg", "530-05-63-63"]], po: "etykieta wielosłowna z liczbą mnogą" },
  { opis: "OEM: Zamiennie: 101-024", sym: "X", oczekiwane: [], po: "pusta sekcja OEM nie zjada sekcji zamienników" },
  { opis: "OEM:", sym: "18-11011", oczekiwane: [], po: "pusta sekcja na końcu" },
  { opis: "Stare SKU: FTC272 W zestawiie: 3 szt", sym: "FTC272", oczekiwane: [], po: "własny symbol odpada; literówka etykiety to nadal granica" },
  { opis: "silnik OEM Honda GX160 Zamiennik: 76-064", sym: "Y", oczekiwane: [], po: "OEM bez dwukropka nie jest etykietą" },
];

test("parser identyfikatorów: kształty z prawdziwych opisów", () => {
  for (const w of TABELA) {
    const got = I.identyfikatoryZOpisu(w.opis, w.sym).map((i) => [i.rodzaj, i.wartosc]);
    assert.deepEqual(got, w.oczekiwane, `${w.sym}: ${w.po}`);
  }
});

test("sekcja Modele: to jeden wiersz, pusta sekcja nie wraca", () => {
  assert.deepEqual(I.modeleZOpisu("OEM: 41307131600 Modele: FS200 FS250 Zamiennik: 24-04003"), ["FS200 FS250"]);
  assert.deepEqual(I.modeleZOpisu("60 mikronów  Modele: OEM: 493629"), []);
  assert.deepEqual(I.modeleZOpisu("Modele: HUSQVARNA 345 FR, 545 FR //JONSERED // CC2245 OEM: 1"), ["HUSQVARNA 345 FR, 545 FR //JONSERED // CC2245"]);
  assert.deepEqual(I.modeleZOpisu("Model: 021 Zamiennik: X"), ["021"]);
});

test("na pełnej kartotece przebudowa daje setki identyfikatorów, nie zero i nie tysiące", () => {
  const w = I.przebudujIdentyfikatory(db());
  assert.ok(w.kartotek >= 350 && w.kartotek <= 550, `kartotek z identyfikatorem: ${w.kartotek}`);
  assert.ok(w.identyfikatorow >= 800 && w.identyfikatorow < 3000, `identyfikatorów: ${w.identyfikatorow}`);
  assert.ok(w.ms < 5000, `przebudowa trwała ${w.ms} ms — rytm importu to 60 s`);
  const m = I.przebudujModeleZOpisu(db());
  assert.ok(m.nowych >= 25 && m.nowych <= 45, `sekcji Modele: ${m.nowych}`);
  /* Numer z pytania klienta prowadzi do kartoteki — w obu zapisach. */
  /* Zamiennik `24-04003` ma w opisie ten sam numer OEM — oba wracają, człowiek wybiera. */
  assert.ok(I.szukajPoIdentyfikatorze("41307131600").map((i) => i.symbol).includes("FTC272"));
  assert.equal(I.szukajPoIdentyfikatorze("532 16 56-30").length, I.szukajPoIdentyfikatorze("5321656-30").length);
  assert.ok(I.szukajPoIdentyfikatorze("532 16 56-30").length >= 1);
});

test("przebudowa jest idempotentna, omija wpisy ręczne i nie wskrzesza odrzuconych sekcji", () => {
  I.przebudujIdentyfikatory(db()); I.przebudujModeleZOpisu(db());
  const reczny = I.dodajIdentyfikator(FTC272, "katalog_obcy", "HQ-12345", biuro);
  assert.equal(reczny.zrodlo, "reczne");
  assert.throws(() => I.dodajIdentyfikator(FTC272, "katalog_obcy", "hq 12345", biuro), W.WiedzaConflict);
  assert.throws(() => I.dodajIdentyfikator(FTC272, "oem", "12", biuro), /cztery znaki/);
  assert.throws(() => I.dodajIdentyfikator(999999, "oem", "12345", biuro), /Nie ma takiej kartoteki/);

  const wiersz = I.listaModeliZOpisow().wiersze.find((m) => m.twId === FTC272)!;
  assert.equal(wiersz.tekst, "FS200 FS250");
  I.odrzucModelZOpisu(wiersz.id, biuro);

  const przed = [liczba("towar_identyfikator"), liczba("model_z_opisu")];
  I.przebudujIdentyfikatory(db()); I.przebudujModeleZOpisu(db());
  assert.deepEqual([liczba("towar_identyfikator"), liczba("model_z_opisu")], przed, "druga przebudowa nie mnoży wierszy");
  assert.equal(I.identyfikatoryTowaru(FTC272).some((i) => i.wartosc === "HQ-12345" && i.zrodlo === "reczne"), true);
  assert.equal(I.listaModeliZOpisow().wiersze.some((m) => m.twId === FTC272), false, "odrzucony nie wraca");
  /* Ręczny wpis tego, co stoi w opisie: zostaje wpis ręczny z podpisem człowieka. */
  db().prepare("DELETE FROM towar_identyfikator WHERE tw_id=? AND wartosc_norm='41307131600'").run(FTC272);
  I.dodajIdentyfikator(FTC272, "oem", "41307131600", biuro);
  I.przebudujIdentyfikatory(db());
  const oem = I.identyfikatoryTowaru(FTC272).filter((i) => i.wartosc === "41307131600");
  assert.equal(oem.length, 1); assert.equal(oem[0].zrodlo, "reczne");
});

test("przerobienie sekcji Modele: rodzi propozycję ze źródłem opis i dowodem decyzji biura", () => {
  I.przebudujModeleZOpisu(db());
  const wiersz = I.listaModeliZOpisow().wiersze.find((m) => m.twId === FTC272)!;
  const z = I.przerobModelZOpisu(wiersz.id, { rodzaj: "maszyna", marka: "STIHL", nazwa: "FS 250" }, biuro);
  assert.equal(z.stan, "propozycja", "człowiek wskazał model, ale zatwierdza osobno");
  assert.equal(z.zrodlo, "opis");
  assert.equal(z.dowody[0].rodzaj, "decyzja_biura");
  assert.match(z.dowody[0].tresc, /z opisu kartoteki „FTC272”: Modele: FS200 FS250/);
  assert.equal(z.pewnosc, "potwierdzone");
  assert.throws(() => I.przerobModelZOpisu(wiersz.id, { rodzaj: "maszyna", marka: "STIHL", nazwa: "FS 200" }, biuro), W.WiedzaConflict);
  assert.throws(() => I.odrzucModelZOpisu(wiersz.id, biuro), W.WiedzaConflict);
  /* Hala nie rozstrzyga (ta sama bramka co przy zastosowaniach). */
  const hala = Number(db().prepare("INSERT INTO app_user(login,name,role) VALUES ('m','Marek','magazynier')").run().lastInsertRowid);
  const inny = I.listaModeliZOpisow().wiersze[0];
  assert.throws(() => I.odrzucModelZOpisu(inny.id, hala), /człowiek z biura/);
  const p = I.pokrycieWiedzy();
  assert.equal(p.modeleZOpisu.przerobionych, 1);
  assert.equal(p.zastosowania.propozycji, 1);
  assert.equal(p.fts.dostepne, true);
});

test("odczyt niczego nie zapisuje", () => {
  I.przebudujIdentyfikatory(db()); I.przebudujModeleZOpisu(db());
  const przed = liczba("events");
  I.szukajPoIdentyfikatorze("41307131600"); I.identyfikatoryTowaru(FTC272); I.listaModeliZOpisow(); I.pokrycieWiedzy();
  assert.equal(liczba("events"), przed);
});
