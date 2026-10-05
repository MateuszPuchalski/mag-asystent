import { before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "wertis-identyfikatory-")), "t.db");
process.env.SGT_MODE = "seeded";

/* ── Identyfikatory z opisów (§11.2, E3) ─────────────────────────────────────
   Opis to pole swobodne, więc parser jest przybliżeniem — ale kosztowna jest
   tylko jedna strona pomyłki. Numer przeoczony to trafienie mniej; numer
   ZMYŚLONY (`19` z `532 19 93-77`) prowadzi agenta do cudzej kartoteki.
   Dlatego tabela pilnuje kształtów, w których opis kusi, żeby powiedzieć za
   dużo, a strażnik na pełnym seedzie pilnuje, że reguły trafiają w dane.  */

let db: typeof import("../db/db.js").db;
let I: typeof import("./identyfikatory.js");
let config: typeof import("../config.js").config;
const FTC272 = 14;

before(async () => {
  ({ db } = await import("../db/db.js"));
  ({ config } = await import("../config.js"));
  I = await import("./identyfikatory.js");
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
  for (const t of ["towar_identyfikator", "events"]) d.prepare(`DELETE FROM ${t}`).run();
});

const liczba = (t: string) => (db().prepare(`SELECT count(*) n FROM ${t}`).get() as { n: number }).n;

const TABELA: Array<{ opis: string; sym: string; oczekiwane: Array<[string, string]>; po: string }> = [
  { opis: "OEM: 41307131600 Modele: FS200 FS250 Zamiennik: 24-04003", sym: "FTC272",
    oczekiwane: [["oem", "41307131600"], ["zamiennik", "24-04003"]],
    po: "Modele: i Zamiennik: to granice sekcji OEM — a sam zamiennik jest osobnym rodzajem (0.234.0)" },
  { opis: "OEM: 165630 // 532 16 56-30  Zamiennik: RO15136", sym: "20-05017",
    oczekiwane: [["oem", "165630"], ["oem", "532 16 56-30"], ["zamiennik", "RO15136"]],
    po: "cyfry ze spacjami po ≤3 to JEDEN numer Husqvarny" },
  { opis: "OEM: 84001990 259291", sym: "10-01033",
    oczekiwane: [["oem", "84001990"], ["oem", "259291"]], po: "dwie długie grupy to dwa numery" },
  { opis: "OEM: 14-083-26-S // 1408326S // 14 083 26-S", sym: "04-21003",
    oczekiwane: [["oem", "14-083-26-S"]], po: "trzy zapisy jednego numeru zwijają się do jednego wiersza" },
  { opis: "OEM: 81001145 / 81001145/0 Zamiennie: 18-11010  Castel Garden: SP535", sym: "470002",
    oczekiwane: [["oem", "81001145"], ["oem", "81001145/0"], ["zamiennik", "18-11010"]],
    po: "`/0` to sufiks GGP, nie separator; `Castel Garden:` to granica" },
  { opis: "OEM: 493629 / 691035 / 2505002 / AM108356 / 34279A 84001895", sym: "W07-1301",
    oczekiwane: [["oem", "493629"], ["oem", "691035"], ["oem", "2505002"], ["oem", "AM108356"], ["oem", "34279A"], ["oem", "84001895"]],
    po: "ukośnik między długimi członami dzieli; spacja po literze też" },
  { opis: "Nr. oryg.: 29100109903 HORTMASZ 1578 1576 ; MAKITA PLM", sym: "18-99008",
    oczekiwane: [["nr_oryg", "29100109903"], ["nr_oryg", "1578"], ["nr_oryg", "1576"]], po: "słowa bez cyfry odpadają, numery modeli zostają — to decyzja człowieka przy kolejce, nie parsera" },
  { opis: "Numery oryginalnej części: 503-91-34-01, 530-05-63-63 Modele: 236; 240", sym: "100-008",
    oczekiwane: [["nr_oryg", "503-91-34-01"], ["nr_oryg", "530-05-63-63"]], po: "etykieta wielosłowna z liczbą mnogą" },
  { opis: "OEM: Zamiennie: 101-024", sym: "X", oczekiwane: [["zamiennik", "101-024"]],
    po: "pusta sekcja OEM nie zjada sekcji zamienników — a ta sekcja od 0.234.0 wraca" },
  { opis: "OEM:", sym: "18-11011", oczekiwane: [], po: "pusta sekcja na końcu" },
  { opis: "Stare SKU: FTC272 W zestawiie: 3 szt", sym: "FTC272", oczekiwane: [], po: "własny symbol odpada; literówka etykiety to nadal granica" },
  { opis: "silnik OEM Honda GX160 Zamiennik: 76-064", sym: "Y", oczekiwane: [["zamiennik", "76-064"]],
    po: "OEM bez dwukropka nie jest etykietą; `GX160` bez etykiety też nie wchodzi" },
  { opis: "OME: 591852 // 793463 // 793493 Zamiennik: W09-0503", sym: "10-01022",
    oczekiwane: [["oem", "591852"], ["oem", "793463"], ["oem", "793493"], ["zamiennik", "W09-0503"]],
    po: "`OME:` to literówka od `OEM:`; NASZ symbol parser oddaje, odsiewa go dopiero przebudowa" },
  { opis: "Obrót w prawo OME: M145245, AM131560", sym: "Z", oczekiwane: [["oem", "M145245"], ["oem", "AM131560"]],
    po: "`OME:` w środku prozy" },
  { opis: "OEM: 1234567 W zestawie uszczelka - W53-0501", sym: "Q", oczekiwane: [["oem", "1234567"]],
    po: "„W zestawie” bez dwukropka kończy sekcję OEM — symbol z kompletu nie jest numerem OEM" },
  /* ── Rodzina „zamiennik" (0.234.0) ────────────────────────────────────────
     Te same etykiety co w `zamienniki.ts`, bo mówią o tej samej liście. Tamten
     parser zostawia z niej wyłącznie NASZE kartoteki; ten zatrzymuje resztę,
     czyli numery obcych katalogów — dotąd nie zapisywał ich nikt. */
  { opis: "Zam: 76-041 // 06-01001 // 510037", sym: "W24-0502",
    oczekiwane: [["zamiennik", "76-041"], ["zamiennik", "06-01001"], ["zamiennik", "510037"]],
    po: "`Zam:` z dwukropkiem otwiera listę" },
  { opis: "Zamiennie: 15-06002 / RO1205 / 17-1205", sym: "W28-0503",
    oczekiwane: [["zamiennik", "15-06002"], ["zamiennik", "RO1205"], ["zamiennik", "17-1205"]],
    po: "ukośnik dzieli listę zamienników tak samo jak listę OEM" },
  { opis: "PRO-491588-ZAM zestaw naprawczy", sym: "P1", oczekiwane: [],
    po: "`ZAM` BEZ dwukropka to część symbolu, nie etykieta — inaczej pół opisu byłoby listą" },
];

test("parser identyfikatorów: kształty z prawdziwych opisów", () => {
  for (const w of TABELA) {
    const got = I.identyfikatoryZOpisu(w.opis, w.sym).map((i) => [i.rodzaj, i.wartosc]);
    assert.deepEqual(got, w.oczekiwane, `${w.sym}: ${w.po}`);
  }
});

test("na pełnej kartotece przebudowa daje setki identyfikatorów, nie zero i nie tysiące", () => {
  const w = I.przebudujIdentyfikatory(db());
  /* PROGI PODNIESIONE W 0.234.0, bo doszła rodzina „zamiennik": z 530 kartotek
     zrobiło się 973, z 1742 numerów — 3443, z czego 1701 z sekcji zamienników.
     To nie jest rozluźnienie strażnika: dolna granica pilnuje, że reguły
     w ogóle trafiają w dane, a górna — że parser nie zaczął mielić prozy. */
  assert.ok(w.kartotek >= 800 && w.kartotek <= 1100, `kartotek z identyfikatorem: ${w.kartotek}`);
  assert.ok(w.identyfikatorow >= 3000 && w.identyfikatorow < 5000, `identyfikatorów: ${w.identyfikatorow}`);
  const zSekcjiZamiennikow = Number((db().prepare(
    "SELECT count(*) n FROM towar_identyfikator WHERE rodzaj='zamiennik'").get() as { n: number }).n);
  assert.ok(zSekcjiZamiennikow >= 1400, `z sekcji zamienników: ${zSekcjiZamiennikow}`);
  assert.ok(w.ms < 5000, `przebudowa trwała ${w.ms} ms — rytm importu to 60 s`);
  /* Numer z pytania klienta prowadzi do kartoteki — w obu zapisach. */
  /* Zamiennik `24-04003` ma w opisie ten sam numer OEM — oba wracają, człowiek wybiera. */
  assert.ok(I.szukajPoIdentyfikatorze("41307131600").map((i) => i.symbol).includes("FTC272"));
  assert.equal(I.szukajPoIdentyfikatorze("532 16 56-30").length, I.szukajPoIdentyfikatorze("5321656-30").length);
  assert.ok(I.szukajPoIdentyfikatorze("532 16 56-30").length >= 1);
});

test("z sekcji zamienników wchodzą OBCE numery, nasze kartoteki zostają zamiennikami", () => {
  /* Sekcja miesza dwie rzeczy: `Zamiennie: 15-06002 / W28-0503`. Nasz symbol
     czyta `zamienniki.ts` i pokazuje jako zamiennik; wpisany tu drugi raz
     mnożyłby ten sam fakt w dwóch tabelach, a szukanie po numerze i tak
     znajdzie kartotekę po symbolu. Filtr stoi w przebudowie, bo tylko ona
     wie, co jest naszą kartoteką. */
  const d = db();
  const nasz = String((d.prepare("SELECT symbol FROM sgt_towar WHERE tw_id=?").get(2) as
    { symbol: string }).symbol);
  d.prepare("UPDATE sgt_towar SET opis=? WHERE tw_id=1")
    .run(`Zamiennie: 15-06002 // ${nasz}`);

  I.przebudujIdentyfikatory(d);

  const zTejKartoteki = (d.prepare(
    "SELECT rodzaj, wartosc FROM towar_identyfikator WHERE tw_id=1 ORDER BY wartosc")
    .all() as Array<{ rodzaj: string; wartosc: string }>)
    .map((w) => `${w.rodzaj}:${w.wartosc}`);
  assert.deepEqual(zTejKartoteki, ["zamiennik:15-06002"],
    `nasz symbol ${nasz} nie ma prawa wejść jako identyfikator obcego katalogu`);
  /* Numer z pytania klienta prowadzi teraz do towaru — o to w tym chodzi. */
  assert.ok(I.szukajPoIdentyfikatorze("15-06002").some((i) => i.twId === 1));
});

test("przebudowa jest idempotentna i omija wpisy spoza opisów", () => {
  I.przebudujIdentyfikatory(db());
  db().prepare(`INSERT INTO towar_identyfikator(tw_id,tw_symbol,rodzaj,wartosc,wartosc_norm,zrodlo,dodal)
    VALUES (?, 'FTC272', 'katalog_obcy', 'HQ-12345', 'HQ12345', 'reczne', 'Ala')`).run(FTC272);
  const przed = liczba("towar_identyfikator");
  I.przebudujIdentyfikatory(db());
  assert.equal(liczba("towar_identyfikator"), przed, "druga przebudowa nie mnoży wierszy");
  assert.equal(I.identyfikatoryTowaru(FTC272).some((i) => i.wartosc === "HQ-12345" && i.zrodlo === "reczne"), true);
});

test("odczyt niczego nie zapisuje", () => {
  I.przebudujIdentyfikatory(db());
  const przed = liczba("events");
  I.szukajPoIdentyfikatorze("41307131600"); I.identyfikatoryTowaru(FTC272);
  assert.equal(liczba("events"), przed);
});
