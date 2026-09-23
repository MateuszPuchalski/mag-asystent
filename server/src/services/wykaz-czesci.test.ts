import { before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "wertis-wykaz-")), "t.db");
process.env.SGT_MODE = "seeded";

/* ── Wykaz części producenta → propozycje zastosowań ────────────────────────
   Pilnujemy pięciu obietnic. Podgląd nie zapisuje niczego, nawet modelu.
   Numer trafia w kartotekę przez OEM przy kartotece albo przez nasz symbol,
   a krótki numer nie trafia w nic. Wiersz z zepsutym zakresem nie wchodzi
   bez warunku. Zapis rodzi PROPOZYCJE z dowodem, a para już znana nie
   dubluje się — ale gdy wykaz daje jej inne warunki, raport to mówi.
   Wycofanie zdejmuje tylko to, co czeka.                                   */

let db: typeof import("../db/db.js").db;
let Wk: typeof import("./wykaz-czesci.js");
let W: typeof import("./wiedza.js");
let biuro = 0;

const GAZNIK = 701; const GAZNIK_ZAM = 702; const FILTR = 703; const ORYGINAL = 704;

before(async () => {
  ({ db } = await import("../db/db.js"));
  Wk = await import("./wykaz-czesci.js");
  W = await import("./wiedza.js");
  const d = db();
  const t = d.prepare("INSERT INTO sgt_towar(tw_id,symbol,nazwa) VALUES (?,?,?)");
  t.run(GAZNIK, "W09-0211", "Gaźnik GX160");
  t.run(GAZNIK_ZAM, "EX055", "Gaźnik GX160 zamiennik");
  t.run(FILTR, "F-160", "Filtr powietrza GX160");
  /* Kartoteka, której SYMBOL jest numerem producenta — oryginał na półce. */
  t.run(ORYGINAL, "4238 141 0300", "Linka rozrusznika STIHL oryginał");
});

beforeEach(() => {
  const d = db();
  for (const t of ["dowod_zastosowania", "zastosowanie", "model_urzadzenia", "import_wykazu", "towar_identyfikator",
    "events", "app_user"]) d.prepare(`DELETE FROM ${t}`).run();
  biuro = Number(d.prepare("INSERT INTO app_user(login,name,role) VALUES ('ala','A. Lewandowska','biuro')").run().lastInsertRowid);
  const id = d.prepare(`INSERT INTO towar_identyfikator(tw_id,tw_symbol,rodzaj,wartosc,wartosc_norm,zrodlo,dodal)
    VALUES (?,?,?,?,?,?,?)`);
  /* Ten sam oryginał przy dwóch kartotekach — obie go deklarują. */
  id.run(GAZNIK, "W09-0211", "oem", "16100-ZH8-W61", "16100zh8w61", "opis", "import");
  id.run(GAZNIK_ZAM, "EX055", "oem", "16100-ZH8-W61", "16100zh8w61", "dostawca", "Ala");
  id.run(FILTR, "F-160", "nr_oryg", "17210-ZE1-517", "17210ze1517", "opis", "import");
  /* Numer „zamiennika" z opisu to NASZ symbol innej kartoteki — nie numer producenta. */
  id.run(FILTR, "F-160", "zamiennik", "17211-ZE1-517", "17211ze1517", "opis", "import");
});

const liczba = (t: string) => (db().prepare(`SELECT count(*) n FROM ${t}`).get() as { n: number }).n;

const WYKAZ = [
  "Model;Poz.;Numer części;Rok od;Rok do;Nr seryjny od",
  "GX160;1;16100-ZH8-W61;2012;2018;",
  "GX160;2;17210-ZE1-517, 17211-ZE1-517;;;",
  "GX160;3;16100-ZH8-W61;;;",
  "GX160;4;99999-XXX-999;;;",
  "GX160;5;1234;;;",
  "GX160;6;17210-ZE1-517;2019;2014;",
  "MS 250;7;4238 141 0300;;;175000000",
  ";8;16100-ZH8-W61;;;",
].join("\n");

const MAPA: import("./wykaz-czesci.js").MapowanieWykazu = {
  marka: { tekst: "Honda" }, model: { kolumna: 0 }, wariant: null, numery: [2],
  rokOd: 3, rokDo: 4, seryjnyOd: 5, seryjnyDo: null, rodzaj: "silnik",
};
const zadanie = (n: Partial<import("./wykaz-czesci.js").ZadanieWykazu> = {}) =>
  ({ zrodlo: "IPL Honda GX160 2023", tresc: { csv: WYKAZ }, mapowanie: MAPA, ...n });

test("nagłówki zgadują model, numery i zakresy — a kolumna pozycji na rysunku numerem nie jest", () => {
  const m = Wk.zgadnijMapowanie(["Model", "Poz.", "Numer części", "Rok od", "Rok do", "Nr seryjny od"])!;
  assert.deepEqual(m.model, { kolumna: 0 });
  assert.deepEqual(m.numery, [2], "„Poz.\" to numer na rysunku, nie numer części");
  assert.deepEqual([m.rokOd, m.rokDo, m.seryjnyOd, m.seryjnyDo], [3, 4, 5, null]);
  assert.equal(m.marka, null, "marki nie ma w pliku — człowiek wpisze ją dla całego wykazu");
  assert.equal(Wk.zgadnijMapowanie(["Symbol", "Nazwa"]), null);
});

test("podgląd liczy pary, braki i złe zakresy — i nie zapisuje niczego, nawet modelu", () => {
  const przed = ["events", "zastosowanie", "model_urzadzenia", "import_wykazu"].map(liczba);
  const r = Wk.importujWykaz(zadanie(), false, null);
  assert.deepEqual(["events", "zastosowanie", "model_urzadzenia", "import_wykazu"].map(liczba), przed);

  /* Oryginał przy dwóch kartotekach daje dwie pary; ta sama część dwa razy
     w wykazie jednej maszyny to jedna para. Numer „zamiennika" z opisu nie
     jest numerem producenta, a nasz symbol równy numerowi — jest. */
  assert.deepEqual(r.przyklady.map((p) => [p.symbol, p.maszyna, p.numery.join("|"), p.warunki]).sort(), [
    ["4238 141 0300", "silnik Honda MS 250", "4238 141 0300", "nr seryjny od 175000000"],
    ["EX055", "silnik Honda GX160", "16100-ZH8-W61", "roczniki 2012–2018"],
    ["F-160", "silnik Honda GX160", "17210-ZE1-517", null],
    ["W09-0211", "silnik Honda GX160", "16100-ZH8-W61", "roczniki 2012–2018"],
  ]);
  assert.deepEqual(r.par, { nowych: 4, znanych: 0, znanychInneWarunki: 0 });
  assert.deepEqual(r.maszyn, { nowych: 2, znanych: 0 });
  /* „99999-XXX-999" i „17211-ZE1-517" nie są przy żadnej kartotece jako OEM. */
  assert.deepEqual(r.bezKartoteki, { liczba: 2, przyklady: ["17211-ZE1-517", "99999-XXX-999"] });
  assert.equal(r.bezNumerow, 1, "„1234\" to za krótki numer — trafiałby w przypadkowe kartoteki");
  assert.equal(r.bezMaszyny, 1);
  assert.deepEqual(r.bledneWarunki, { liczba: 1, przyklady: ["wiersz 7: Rok od jest późniejszy niż rok do"] });
  assert.equal(r.zapisano, null);
});

test("zapis rodzi PROPOZYCJE z dowodem producenta i warunkami; bez nazwy wykazu i potwierdzonych kolumn — odmowa", () => {
  assert.throws(() => Wk.importujWykaz(zadanie({ zrodlo: " " }), true, biuro), /Nazwij wykaz/);
  assert.throws(() => Wk.importujWykaz(zadanie({ mapowanie: null }), true, biuro), /Potwierdź mapowanie/);
  assert.throws(() => Wk.importujWykaz(zadanie({ mapowanie: { ...MAPA, numery: [2, 3] } }), false, null),
    /roku albo numeru seryjnego/, "rok zaznaczony jako numer części trafiałby w przypadkowe kartoteki");
  const r = Wk.importujWykaz(zadanie({ link: "https://example.com/ipl.pdf" }), true, biuro);
  assert.equal(r.zapisano?.propozycji, 4);
  const w = W.kolejkaPropozycji().propozycje.find((z) => z.twId === GAZNIK)!;
  assert.equal(w.stan, "propozycja", "wykaz nie zatwierdza — ogniwo numer → kartoteka sprawdza człowiek");
  assert.equal(w.model.etykieta, "silnik Honda GX160");
  assert.equal(w.zdanieWarunkow, "roczniki 2012–2018");
  assert.deepEqual(w.dowody.map((d) => [d.rodzaj, d.tresc, d.link]),
    [["producent", "IPL Honda GX160 2023: silnik Honda GX160 — numer 16100-ZH8-W61", "https://example.com/ipl.pdf"]]);
  assert.equal((db().prepare("SELECT count(*) n FROM zastosowanie WHERE import_id=?").get(r.zapisano!.importId) as { n: number }).n, 4);
});

test("para już znana nie dubluje się — a inne warunki w wykazie raport nazywa po imieniu", () => {
  const stare = W.zaproponujZastosowanie({ twId: GAZNIK, model: { rodzaj: "silnik", marka: "Honda", nazwa: "GX160" },
    polaryzacja: "pasuje", zrodlo: "reczne", dowod: { rodzaj: "producent", tresc: "karta" } },
  { userId: biuro, name: "A. Lewandowska" })!;
  W.rozstrzygnijZastosowanie(stare.id, "zatwierdz", null, biuro);
  const r = Wk.importujWykaz(zadanie(), false, null);
  assert.deepEqual(r.par, { nowych: 3, znanych: 1, znanychInneWarunki: 1 });
  assert.deepEqual(r.inneWarunki.map((p) => [p.symbol, p.warunki]), [["W09-0211", "roczniki 2012–2018"]]);
  assert.deepEqual(r.maszyn, { nowych: 1, znanych: 1 });
});

test("wycofanie wykazu zdejmuje czekające propozycje, zatwierdzonych nie rusza", () => {
  const { zapisano } = Wk.importujWykaz(zadanie(), true, biuro);
  const zGaznika = W.kolejkaPropozycji().propozycje.find((z) => z.twId === GAZNIK)!;
  W.rozstrzygnijZastosowanie(zGaznika.id, "zatwierdz", null, biuro);
  let h = Wk.historiaWykazow()[0];
  assert.deepEqual([h.czeka, h.zatwierdzonych, h.stan], [3, 1, "aktywny"]);

  h = Wk.wycofajWykaz(zapisano!.importId, biuro);
  assert.deepEqual([h.czeka, h.zatwierdzonych, h.stan, h.wycofal], [0, 1, "wycofany", "A. Lewandowska"]);
  assert.equal(W.zastosowanie(zGaznika.id)!.stan, "zatwierdzone");
  assert.equal(W.kolejkaPropozycji().propozycje.filter((z) => z.dowody.some((d) => d.tresc.startsWith("IPL Honda"))).length, 0);
  assert.throws(() => Wk.wycofajWykaz(zapisano!.importId, biuro), /już wycofany/);
});
