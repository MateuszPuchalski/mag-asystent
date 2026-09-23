import { before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "wertis-siec-")), "t.db");
process.env.SGT_MODE = "seeded";

/* ── Sieć wiedzy na PRAWDZIWEJ kartotece ─────────────────────────────────────
   Scenariusz GX160 z seeda: gaźniki `W09-0211` ≡ `EX055` (wymieniają się
   w opisach), `10-02001` wymienia oba; uszczelki `LC170430140-0001` ≡
   `06-12038`, `170430138-0001`, `W53-0202`. Do tego kosiarka i silnik
   z `model_urzadzenia`.

   Pilnujemy, że sieć rysuje PRZESŁANKI ze wszystkich czterech warstw, nie
   wnioski; że nie schodzi głębiej niż krok po opisach; że nie pokazuje tego,
   co człowiek odrzucił, i że odczyt niczego nie zapisuje.                 */

let db: typeof import("../db/db.js").db;
let P: typeof import("./pasowania.js");
let W: typeof import("./wiedza.js");
let S: typeof import("./silniki.js");
let N: typeof import("./siec-wiedzy.js");
let config: typeof import("../config.js").config;
let biuro = 0;
const ID: Record<string, number> = {};

before(async () => {
  ({ db } = await import("../db/db.js"));
  ({ config } = await import("../config.js"));
  P = await import("./pasowania.js");
  W = await import("./wiedza.js");
  S = await import("./silniki.js");
  N = await import("./siec-wiedzy.js");
  const d = db();
  const rows = JSON.parse(fs.readFileSync(config.seedProducts, "utf8")) as string[][];
  const ins = d.prepare("INSERT INTO sgt_towar(tw_id,symbol,nazwa,ean,opis) VALUES (?,?,?,?,?)");
  d.exec("BEGIN");
  rows.forEach((r, i) => ins.run(i + 1, r[0], r[1], r[2] || "", r[9] || ""));
  d.exec("COMMIT");
  for (const s of ["W09-0211", "EX055", "10-02001", "LC170430140-0001", "06-12038", "170430138-0001", "W53-0202"]) {
    const w = d.prepare("SELECT tw_id FROM sgt_towar WHERE symbol=?").get(s) as { tw_id: number } | undefined;
    assert.ok(w, `scenariusz GX160 wymaga kartoteki ${s} w seedzie`);
    ID[s] = w.tw_id;
  }
});

beforeEach(() => {
  const d = db();
  for (const t of ["pasowanie_czesci", "dowod_zastosowania", "zastosowanie", "zabudowa_silnika", "model_urzadzenia",
    "conversation_event", "events", "app_user"]) {
    d.prepare(`DELETE FROM ${t}`).run();
  }
  biuro = Number(d.prepare("INSERT INTO app_user(login,name,role) VALUES ('ala','A. Lewandowska','biuro')").run().lastInsertRowid);
});

const ala = () => ({ userId: biuro, name: "A. Lewandowska" });
const NAC = { rodzaj: "maszyna" as const, marka: "NAC", nazwa: "LS 46-450" };
const GX160 = { rodzaj: "silnik" as const, marka: "Honda", nazwa: "GX160" };

const pasowanie = (czesc: string, doCzego: string, n: Partial<Parameters<typeof P.zaproponujPasowanie>[0]> = {}, zatw = true) => {
  const p = P.zaproponujPasowanie({ twId: ID[czesc], doTwId: ID[doCzego], rola: "uszczelka", polaryzacja: "pasuje",
    rodzajDowodu: "katalog_dostawcy", dowodTresc: "katalog 2024", zrodlo: "reczne", ...n }, ala())!;
  return zatw ? P.rozstrzygnijPasowanie(p.id, "zatwierdz", null, biuro) : p;
};
const zastosowanie = (czesc: string, model: typeof NAC | typeof GX160, zatw = true) => {
  const z = W.zaproponujZastosowanie({ twId: ID[czesc], model, polaryzacja: "pasuje", zrodlo: "reczne",
    dowod: { rodzaj: "katalog_dostawcy", tresc: "katalog 2024" } }, ala())!;
  return zatw ? W.rozstrzygnijZastosowanie(z.id, "zatwierdz", null, biuro) : z;
};
const zabudowa = (zatw = true) => {
  const b = S.zaproponujZabudowe({ maszyna: NAC, silnik: GX160, rodzajDowodu: "producent",
    dowodTresc: "karta katalogowa", zrodlo: "reczne" }, ala())!;
  return zatw ? S.rozstrzygnijZabudowe(b.id, "zatwierdz", null, biuro) : b;
};

const tw = (s: string) => `tw:${ID[s]}`;
const etykieta = (siec: { wezly: Array<{ klucz: string; etykieta: string }> }, klucz: string) =>
  siec.wezly.find((w) => w.klucz === klucz)?.etykieta ?? klucz;
const opis = (siec: ReturnType<typeof N.siecWiedzy>, warstwa: string) => siec.krawedzie
  .filter((k) => k.warstwa === warstwa).map((k) => `${etykieta(siec, k.z)}>${etykieta(siec, k.do)}:${k.rodzaj}`);

test("pusta baza daje pustą sieć, nie zamienniki całej kartoteki", () => {
  assert.deepEqual(N.siecWiedzy(), { wezly: [], krawedzie: [] });
});

test("pasowania: trzy rodzaje wierszy, odrzucone znika, kierunek część → do czego", () => {
  pasowanie("LC170430140-0001", "W09-0211", { pozycja: "od strony filtra" });
  pasowanie("170430138-0001", "W09-0211", { pozycja: "od strony kolektora" }, false);
  pasowanie("W53-0202", "W09-0211", { polaryzacja: "nie_pasuje", powodNegatywny: "tylko_inny_wariant" });
  const odrzucone = pasowanie("06-12038", "EX055", {}, false);
  P.rozstrzygnijPasowanie(odrzucone.id, "odrzuc", "nie ten gaźnik", biuro);

  const s = N.siecWiedzy();
  assert.deepEqual(opis(s, "pasowania"), [
    "LC170430140-0001>W09-0211:pasuje", "170430138-0001>W09-0211:propozycja", "W53-0202>W09-0211:nie_pasuje",
  ]);
  assert.match(s.krawedzie.find((k) => k.rodzaj === "nie_pasuje")!.zdanie, /nie pasuje do W09-0211/,
    "zdanie z serwera, panel go nie układa");
  assert.ok(!s.krawedzie.some((k) => k.wierszId === odrzucone.id && k.warstwa === "pasowania"));
  const klucze = new Set(s.wezly.map((w) => w.klucz));
  assert.ok(s.krawedzie.every((k) => klucze.has(k.z) && klucze.has(k.do)), "krawędź bez węzła rysowałaby się w próżnię");
});

test("zamienniki: jedna linia na parę, obustronność w zdaniu, nigdy potwierdzenie", () => {
  pasowanie("LC170430140-0001", "W09-0211");
  const s = N.siecWiedzy();
  const zam = s.krawedzie.filter((k) => k.warstwa === "zamienniki");
  assert.equal(new Set(zam.map((k) => [k.z, k.do].sort().join("~"))).size, zam.length,
    "„A podaje B” i „B podaje A” to jedna linia");
  const gazniki = zam.find((k) => [k.z, k.do].includes(tw("W09-0211")) && [k.z, k.do].includes(tw("EX055")))!;
  assert.ok(gazniki, "EX055 dochodzi z opisu W09-0211");
  assert.equal(gazniki.obustronnie, true);
  assert.match(gazniki.zdanie, /podają się nawzajem/);
  /* 10-02001 wchodzi z opisu W09-0211, a jego własny opis wymienia EX055, który
     już stoi w sieci — ta krawędź jest wolna, bo nie wnosi nowego węzła. */
  assert.ok(zam.some((k) => [k.z, k.do].includes(tw("10-02001")) && [k.z, k.do].includes(tw("EX055"))));
  assert.ok(zam.every((k) => k.wierszId === null && k.pewnosc === "prawdopodobne" && k.rodzaj === "zamiennik"));
});

test("zamienniki: opis dołożonego zamiennika nie wnosi nowych węzłów — głębokość jeden", () => {
  const d = db();
  const przed = (d.prepare("SELECT opis FROM sgt_towar WHERE tw_id=?").get(ID["EX055"]) as { opis: string }).opis;
  d.prepare("UPDATE sgt_towar SET opis=? WHERE tw_id=?").run(`${przed} // W53-0202`, ID["EX055"]);
  try {
    pasowanie("LC170430140-0001", "W09-0211");
    const s = N.siecWiedzy();
    assert.ok(s.wezly.some((w) => w.klucz === tw("EX055")));
    assert.ok(!s.wezly.some((w) => w.klucz === tw("W53-0202")), "drugi krok po opisach to już nie jest nasza wiedza");
  } finally {
    d.prepare("UPDATE sgt_towar SET opis=? WHERE tw_id=?").run(przed, ID["EX055"]);
  }
});

test("maszyny i silniki: łańcuch uszczelka → gaźnik → silnik → kosiarka w jednej sieci", () => {
  pasowanie("LC170430140-0001", "W09-0211");
  zastosowanie("W09-0211", GX160);
  zastosowanie("W53-0202", NAC, false);
  zabudowa();

  const s = N.siecWiedzy();
  assert.deepEqual(opis(s, "zastosowania"), ["W09-0211>Honda GX160:pasuje", "W53-0202>NAC LS 46-450:propozycja"]);
  assert.deepEqual(opis(s, "zabudowy"), ["Honda GX160>NAC LS 46-450:zabudowa"], "silnik → maszyna, w czym stoi");
  const silnik = s.wezly.find((w) => w.etykieta === "Honda GX160")!;
  assert.equal(silnik.rodzaj, "silnik");
  assert.equal(silnik.twId, null);
  assert.match(silnik.nazwa, /GX160/, "pełna etykieta modelu idzie do dymka");
  assert.equal(s.wezly.find((w) => w.klucz === tw("W53-0202"))!.nazwa, "Uszczelka do gaźników GX160 (między dystansem)",
    "kartoteka z samego zastosowania dostaje nazwę z Subiektu, nie drugi raz symbol");
  assert.match(s.krawedzie.find((k) => k.warstwa === "zabudowy")!.zdanie, /stoi w NAC LS 46-450/);
});

test("maszyny i silniki: propozycja zabudowy czeka na bursztynowo, odrzucone zastosowanie znika", () => {
  zabudowa(false);
  const z = zastosowanie("W09-0211", NAC, false);
  W.rozstrzygnijZastosowanie(z.id, "odrzuc", "inny gaźnik", biuro);
  const s = N.siecWiedzy();
  assert.deepEqual(opis(s, "zabudowy"), ["Honda GX160>NAC LS 46-450:propozycja"]);
  assert.deepEqual(opis(s, "zastosowania"), []);
  assert.ok(!s.wezly.some((w) => w.klucz === tw("W09-0211")), "odrzucone nie wnosi też zamienników swojej kartoteki");
});

test("odczyt niczego nie zapisuje", () => {
  pasowanie("LC170430140-0001", "W09-0211");
  zastosowanie("W09-0211", GX160);
  zabudowa();
  const licz = () => ["events", "pasowanie_czesci", "zastosowanie", "zabudowa_silnika", "model_urzadzenia"]
    .map((t) => (db().prepare(`SELECT count(*) n FROM ${t}`).get() as { n: number }).n);
  const przed = licz();
  N.siecWiedzy();
  assert.deepEqual(licz(), przed);
});
