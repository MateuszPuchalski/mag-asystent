import { before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "wertis-zamiennosc-")), "t.db");
process.env.SGT_MODE = "seeded";

/* ── Zamienność przez wspólny numer oryginału, na PRAWDZIWEJ kartotece ──────
   Seed niesie oba przypadki, które zdecydowały o kształcie tej funkcji:
   gaźniki `W09-1307` i `76-080` dzielą cztery numery B&S i są zamienne,
   a noże Castelgarden `14-11013` (lewy) i `14-11022` (lewy mielący) dzielą
   pięć numerów i NIE są. Dlatego automat tylko proponuje.

   Pilnujemy: filtra śmieci i progu grupy, pominięcia par znanych z opisu,
   decyzji wyłącznie o prawdziwym kandydacie, powrotu po wycofaniu,
   i tego, że dopiero ZATWIERDZONA para niesie pasowania dalej.            */

let db: typeof import("../db/db.js").db;
let Z: typeof import("./zamiennosc-oem.js");
let P: typeof import("./pasowania.js");
let N: typeof import("./siec-wiedzy.js");
let biuro = 0;
let hala = 0;
const ID: Record<string, number> = {};

before(async () => {
  ({ db } = await import("../db/db.js"));
  const { config } = await import("../config.js");
  const { przebudujIdentyfikatory } = await import("./identyfikatory.js");
  Z = await import("./zamiennosc-oem.js");
  P = await import("./pasowania.js");
  N = await import("./siec-wiedzy.js");
  const d = db();
  const rows = JSON.parse(fs.readFileSync(config.seedProducts, "utf8")) as string[][];
  const ins = d.prepare("INSERT INTO sgt_towar(tw_id,symbol,nazwa,ean,opis) VALUES (?,?,?,?,?)");
  d.exec("BEGIN");
  rows.forEach((r, i) => ins.run(i + 1, r[0], r[1], r[2] || "", r[9] || ""));
  d.exec("COMMIT");
  przebudujIdentyfikatory(d);
  for (const s of ["W09-1307", "76-080", "14-11013", "14-11022", "14-11034", "W53-0202", "W09-0211"]) {
    const w = d.prepare("SELECT tw_id FROM sgt_towar WHERE symbol=?").get(s) as { tw_id: number } | undefined;
    assert.ok(w, `scenariusz wymaga kartoteki ${s} w seedzie`);
    ID[s] = w.tw_id;
  }
});

beforeEach(() => {
  const d = db();
  for (const t of ["zamiennosc_oem", "pasowanie_czesci", "events", "app_user"]) d.prepare(`DELETE FROM ${t}`).run();
  biuro = Number(d.prepare("INSERT INTO app_user(login,name,role) VALUES ('ala','A. Lewandowska','biuro')").run().lastInsertRowid);
  hala = Number(d.prepare("INSERT INTO app_user(login,name,role) VALUES ('bob','B. Nowak','magazynier')").run().lastInsertRowid);
});

const para = (x: string, y: string) => [ID[x], ID[y]].sort((a, b) => a - b).join("~");
const klucze = () => Z.kandydaciZamiennosci().kandydaci.map((k) => `${k.a.twId}~${k.b.twId}`);
const kandydat = (x: string, y: string) =>
  Z.kandydaciZamiennosci().kandydaci.find((k) => `${k.a.twId}~${k.b.twId}` === para(x, y));

test("kandydaci: gaźniki B&S z czterema wspólnymi numerami, noże lewy i lewy mielący też — to decyduje człowiek", () => {
  const gazniki = kandydat("W09-1307", "76-080");
  assert.ok(gazniki);
  assert.deepEqual([...gazniki.numery].sort(), ["281707", "390811", "392152", "491590"]);
  assert.ok(kandydat("14-11013", "14-11022"), "automat nie odróżni noża lewego od mielącego — i nie ma udawać, że umie");
  const lista = Z.kandydaciZamiennosci().kandydaci;
  for (let i = 1; i < lista.length; i++) {
    assert.ok(lista[i - 1].numery.length >= lista[i].numery.length, "najwięcej wspólnych numerów pierwsze");
  }
});

test("kandydaci: filtr śmieci i próg grupy — modele maszyn, krótkie kody i rodziny numerów odpadają", () => {
  const { kandydaci } = Z.kandydaciZamiennosci();
  const numery = kandydaci.flatMap((k) => k.numery);
  for (const smiec of ["0000", "1800", "245R", "272XP", "1307"]) {
    assert.ok(!numery.some((n) => n.toUpperCase() === smiec), `${smiec} nie jest numerem oryginału`);
  }
  assert.ok(numery.every((n) => (n.match(/\d/g) ?? []).length >= Z.MIN_CYFR));
  /* 14-11034 dzieli numery z trzema innymi nożami (lewy, prawy, mielące) —
     grupa czterech to rodzina, nie zamienność. */
  assert.ok(!kandydaci.some((k) => k.a.twId === ID["14-11034"] || k.b.twId === ID["14-11034"]));
});

test("kandydaci: para, którą zna już opis kartoteki, nie wraca jako nowa", () => {
  const d = db();
  for (const k of Z.kandydaciZamiennosci().kandydaci) {
    const a = P.towar(d, k.a.twId)!; const b = P.towar(d, k.b.twId)!;
    const zOpisu = (x: typeof a, y: typeof b) =>
      P.zamiennikiKartoteki(d, x).some((z) => z.zrodlo === "opis" && z.twId === y.twId);
    assert.ok(!zOpisu(a, b) && !zOpisu(b, a), `${a.symbol} ⟷ ${b.symbol} zna już opis`);
  }
});

test("zatwierdzenie: para schodzi z kolejki, widać ją z obu stron, druga decyzja dostaje 409", () => {
  const z = Z.rozstrzygnijZamiennosc(ID["76-080"], ID["W09-1307"], "zatwierdz", null, biuro);
  assert.equal(z.stan, "zatwierdzone");
  assert.ok(z.a.twId < z.b.twId, "para bez kierunku zapisuje się w jednym porządku");
  assert.match(z.zdanie, /są zamienne: wspólne numery oryginału .*281707.* — zatwierdził A\. Lewandowska/);
  assert.ok(!klucze().includes(para("W09-1307", "76-080")));
  assert.deepEqual(Z.zamiennicyOem(ID["W09-1307"]).map((x) => x.kartoteka.symbol), ["76-080"]);
  assert.deepEqual(Z.zamiennicyOem(ID["76-080"]).map((x) => x.kartoteka.symbol), ["W09-1307"]);
  assert.throws(() => Z.rozstrzygnijZamiennosc(ID["W09-1307"], ID["76-080"], "odrzuc", "inna", biuro),
    (e: Error) => e instanceof Error && /zdecydował już A\. Lewandowska/.test(e.message));
  const ev = db().prepare("SELECT type FROM events WHERE type LIKE 'zamiennosc_oem%'").all() as Array<{ type: string }>;
  assert.deepEqual(ev.map((e) => e.type), ["zamiennosc_oem_rozstrzygniecie"]);
});

test("odrzucenie: bez powodu nie wychodzi; z powodem para nie wraca, dopóki ktoś nie wycofa z powodem", () => {
  assert.throws(() => Z.rozstrzygnijZamiennosc(ID["14-11013"], ID["14-11022"], "odrzuc", "  ", biuro), /wymaga powodu/);
  const z = Z.rozstrzygnijZamiennosc(ID["14-11013"], ID["14-11022"], "odrzuc", "lewy zwykły i lewy mielący", biuro);
  assert.match(z.zdanie, /NIE są zamienne mimo wspólnych numerów .*: lewy zwykły i lewy mielący/);
  assert.ok(!klucze().includes(para("14-11013", "14-11022")), "odrzucona para nie wraca przy następnym odczycie");
  assert.deepEqual(Z.zamiennicyOem(ID["14-11013"]), [], "odrzucenie nie jest zamiennikiem");
  assert.throws(() => Z.wycofajZamiennosc(z.id, null, biuro), /wyłącznie z powodem/);
  const po = Z.wycofajZamiennosc(z.id, "pomyłka przy klikaniu", biuro);
  assert.equal(po.stan, "wycofane");
  assert.ok(klucze().includes(para("14-11013", "14-11022")), "wycofanie zwalnia parę z powrotem do kolejki");
  assert.throws(() => Z.wycofajZamiennosc(z.id, "drugi raz", biuro), /już wycofana/);
});

test("decyzja tylko o prawdziwym kandydacie i tylko z ręki biura", () => {
  assert.throws(() => Z.rozstrzygnijZamiennosc(ID["W09-1307"], ID["W53-0202"], "zatwierdz", null, biuro),
    /nie mają dziś wspólnego numeru/, "trasa nie jest furtką do dowolnego zamiennika");
  assert.throws(() => Z.rozstrzygnijZamiennosc(ID["W09-1307"], ID["W09-1307"], "zatwierdz", null, biuro), /dwie różne/);
  assert.throws(() => Z.rozstrzygnijZamiennosc(ID["W09-1307"], ID["76-080"], "zatwierdz", null, hala), /człowiek z biura/);
  assert.equal((db().prepare("SELECT count(*) n FROM zamiennosc_oem").get() as { n: number }).n, 0);
});

test("przechodniość: pasowanie do W09-1307 dochodzi do 76-080 dopiero po zatwierdzeniu, jako prawdopodobne", () => {
  const p = P.zaproponujPasowanie({ twId: ID["W53-0202"], doTwId: ID["W09-1307"], rola: "uszczelka",
    polaryzacja: "pasuje", rodzajDowodu: "katalog_dostawcy", dowodTresc: "katalog 2024", zrodlo: "reczne" },
  { userId: biuro, name: "A. Lewandowska" })!;
  P.rozstrzygnijPasowanie(p.id, "zatwierdz", null, biuro);
  const przez = () => P.pasowaniaTowaru(ID["76-080"]).pasujace.filter((t) => t.przezZamiennik !== null);
  assert.deepEqual(przez(), [], "sam kandydat niczego nie przenosi");
  Z.rozstrzygnijZamiennosc(ID["W09-1307"], ID["76-080"], "zatwierdz", null, biuro);
  const t = przez();
  assert.equal(t.length, 1);
  assert.equal(t[0].czesc.symbol, "W53-0202");
  assert.equal(t[0].pewnosc, "prawdopodobne");
  assert.match(t[0].zdanie, /pasuje do W09-1307 .*; W09-1307 i 76-080 są zamienne: wspólne numery oryginału/);
});

test("sieć: zatwierdzona para to krawędź zamiennika z numerem decyzji, bez grotu", () => {
  const p = P.zaproponujPasowanie({ twId: ID["W53-0202"], doTwId: ID["W09-1307"], rola: "uszczelka",
    polaryzacja: "pasuje", rodzajDowodu: "katalog_dostawcy", dowodTresc: "katalog 2024", zrodlo: "reczne" },
  { userId: biuro, name: "A. Lewandowska" })!;
  P.rozstrzygnijPasowanie(p.id, "zatwierdz", null, biuro);
  const z = Z.rozstrzygnijZamiennosc(ID["W09-1307"], ID["76-080"], "zatwierdz", null, biuro);
  const k = N.siecWiedzy().krawedzie.find((e) => e.warstwa === "zamienniki" && e.wierszId === z.id);
  assert.ok(k, "76-080 wchodzi do sieci przez zatwierdzoną parę");
  assert.equal(k.obustronnie, true);
  assert.match(k.zdanie, /są zamienne: wspólne numery oryginału/);
});

test("odczyt kolejki niczego nie zapisuje", () => {
  const licz = () => ["events", "zamiennosc_oem"].map((t) => (db().prepare(`SELECT count(*) n FROM ${t}`).get() as { n: number }).n);
  const przed = licz();
  Z.kandydaciZamiennosci(); Z.zamiennosciTowaru(ID["W09-1307"]); Z.zamiennicyOem(ID["W09-1307"]);
  assert.deepEqual(licz(), przed);
});
