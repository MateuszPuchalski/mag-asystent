import { before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "wertis-pasowania-")), "t.db");
process.env.SGT_MODE = "seeded";

/* ── Pasowanie części (§11.2) na PRAWDZIWEJ kartotece ────────────────────────
   Scenariusz GX160 jest w seedzie kompletny: gaźniki `W09-0211` i `EX055`
   wymieniają się nawzajem jako zamienniki; uszczelki `LC170430140-0001`
   ≡ `06-12038` (od strony filtra), `170430138-0001` (od strony kolektora),
   `W53-0202` (między dystansem). Testy pilnują KIERUNKU relacji, granic
   przechodniości przez zamiennik i tego, że automat nie rozstrzyga.        */

let db: typeof import("../db/db.js").db;
let P: typeof import("./pasowania.js");
let config: typeof import("../config.js").config;
let biuro = 0;
let hala = 0;
let konto = 0;
let rozmowa = 0;
const ID: Record<string, number> = {};

before(async () => {
  ({ db } = await import("../db/db.js"));
  ({ config } = await import("../config.js"));
  P = await import("./pasowania.js");
  const d = db();
  const rows = JSON.parse(fs.readFileSync(config.seedProducts, "utf8")) as string[][];
  assert.ok(rows.length > 3000, `kartoteka wygląda na niekompletną: ${rows.length}`);
  const ins = d.prepare("INSERT INTO sgt_towar(tw_id,symbol,nazwa,ean,opis) VALUES (?,?,?,?,?)");
  d.exec("BEGIN");
  rows.forEach((r, i) => ins.run(i + 1, r[0], r[1], r[2] || "", r[9] || ""));
  d.exec("COMMIT");
  for (const s of ["W09-0211", "EX055", "LC170430140-0001", "06-12038", "170430138-0001", "W53-0202"]) {
    const w = d.prepare("SELECT tw_id FROM sgt_towar WHERE symbol=?").get(s) as { tw_id: number } | undefined;
    assert.ok(w, `scenariusz GX160 wymaga kartoteki ${s} w seedzie`);
    ID[s] = w.tw_id;
  }
});

beforeEach(() => {
  const d = db();
  for (const t of ["pasowanie_czesci", "conversation_event", "message", "conversation", "channel_account", "events", "app_user"]) {
    d.prepare(`DELETE FROM ${t}`).run();
  }
  biuro = Number(d.prepare("INSERT INTO app_user(login,name,role) VALUES ('ala','A. Lewandowska','biuro')").run().lastInsertRowid);
  hala = Number(d.prepare("INSERT INTO app_user(login,name,role) VALUES ('bob','B. Nowak','magazynier')").run().lastInsertRowid);
  konto = Number(d.prepare("INSERT INTO channel_account(channel,external_account_id) VALUES ('allegro','s')").run().lastInsertRowid);
  rozmowa = Number(d.prepare("INSERT INTO conversation(channel_account_id,external_conversation_id,subject) VALUES (?,'w-1','k')")
    .run(konto).lastInsertRowid);
});

const ala = () => ({ userId: biuro, name: "A. Lewandowska" });
const zaproponuj = (czesc: string, doCzego: string, n: Partial<Parameters<typeof P.zaproponujPasowanie>[0]> = {}) =>
  P.zaproponujPasowanie({ twId: ID[czesc], doTwId: ID[doCzego], rola: "uszczelka", polaryzacja: "pasuje",
    rodzajDowodu: "katalog_dostawcy", dowodTresc: "katalog 2024", zrodlo: "reczne", ...n }, ala());
const zatwierdz = (czesc: string, doCzego: string, n: Partial<Parameters<typeof P.zaproponujPasowanie>[0]> = {}) =>
  P.rozstrzygnijPasowanie(zaproponuj(czesc, doCzego, n)!.id, "zatwierdz", null, biuro);

const symbole = (t: Array<{ czesc: { symbol: string } }>) => t.map((x) => x.czesc.symbol).sort();

test("kierunek: X pasuje DO Y widać w pasujace(Y) i pasujeDo(X), nigdy odwrotnie", () => {
  zatwierdz("LC170430140-0001", "W09-0211", { pozycja: "od strony filtra" });
  const g = P.pasowaniaTowaru(ID["W09-0211"]);
  const u = P.pasowaniaTowaru(ID["LC170430140-0001"]);
  /* Wprost jest jedno; `06-12038` dochodzi PRZEZ zamiennik i ma własny test niżej. */
  assert.deepEqual(symbole(g.pasujace.filter((t) => t.przezZamiennik === null)), ["LC170430140-0001"]);
  assert.deepEqual(g.pasujeDo, [], "gaźnik nie pasuje do uszczelki");
  assert.deepEqual(u.pasujeDo.filter((t) => t.przezZamiennik === null).map((t) => t.doCzego.symbol), ["W09-0211"]);
  /* Przez zamienniki gaźnika uszczelka pasuje też do EX055 i 10-02001 — jako prawdopodobne. */
  assert.ok(u.pasujeDo.filter((t) => t.przezZamiennik !== null).every((t) => t.pewnosc === "prawdopodobne"));
  assert.deepEqual(u.pasujace, []);
  /* Rola i pozycja stoją w zdaniu źródła — panel go nie układa. */
  assert.match(g.pasujace[0].zdanie, /^uszczelka \(od strony filtra\) LC170430140-0001 pasuje do W09-0211 — katalog dostawcy, /);
  assert.equal(g.pasujace[0].pewnosc, "potwierdzone");
});

test("przechodniość przez zamiennik GAŹNIKA: EX055 wymienia W09-0211 w opisie", () => {
  zatwierdz("LC170430140-0001", "W09-0211");
  const ex = P.pasowaniaTowaru(ID["EX055"]);
  assert.deepEqual(symbole(ex.pasujace), ["LC170430140-0001"]);
  assert.equal(ex.pasujace[0].pewnosc, "prawdopodobne", "przez zamiennik nigdy „potwierdzone”");
  assert.match(ex.pasujace[0].przezZamiennik!, /^EX055 podaje W09-0211 jako zamiennik w opisie$/);
  assert.equal(ex.pasujace[0].pasowanie.doCzego.symbol, "W09-0211", "wiersz-dowód zostaje ten sam");
});

test("przechodniość przez zamiennik USZCZELKI: 06-12038 wynika z LC170430140-0001", () => {
  zatwierdz("LC170430140-0001", "W09-0211");
  const g = P.pasowaniaTowaru(ID["W09-0211"]);
  assert.deepEqual(symbole(g.pasujace), ["06-12038", "LC170430140-0001"]);
  const pochodne = g.pasujace.find((t) => t.czesc.symbol === "06-12038")!;
  assert.equal(pochodne.pewnosc, "prawdopodobne");
  assert.match(pochodne.przezZamiennik!, /LC170430140-0001 podaje 06-12038/);
  /* I w drugą stronę: 06-12038 widzi, do czego pasuje, choć wpisu o niej nie ma. */
  assert.deepEqual(P.pasowaniaTowaru(ID["06-12038"]).pasujeDo.map((t) => t.doCzego.symbol), ["W09-0211"]);
});

test("zamiennik jest jednokierunkowy: kartoteka, którą wymienia W09-0211, ale która go nie wymienia, nie dziedziczy", () => {
  /* Sztuczna kartoteka Z bez opisu; W09-0211 dostaje ją w opisie jako zamiennik. */
  const d = db();
  d.prepare("INSERT INTO sgt_towar(tw_id,symbol,nazwa,opis) VALUES (900900,'GAZ-Z','Gaźnik Z','')").run();
  const opis = (d.prepare("SELECT opis FROM sgt_towar WHERE tw_id=?").get(ID["W09-0211"]) as { opis: string }).opis;
  d.prepare("UPDATE sgt_towar SET opis=? WHERE tw_id=?").run(`${opis} // GAZ-Z`, ID["W09-0211"]);
  try {
    zatwierdz("LC170430140-0001", "W09-0211");
    assert.deepEqual(P.pasowaniaTowaru(900900).pasujace, [], "czytamy TEN opis — Z nic o W09-0211 nie mówi");
    /* Ale patrząc od strony W09-0211, Z jest jego zamiennikiem, więc uszczelka pasuje też do Z. */
    assert.ok(P.pasowaniaTowaru(ID["LC170430140-0001"]).pasujeDo.some((t) => t.doCzego.symbol === "GAZ-Z"));
  } finally {
    d.prepare("UPDATE sgt_towar SET opis=? WHERE tw_id=?").run(opis, ID["W09-0211"]);
    d.prepare("DELETE FROM sgt_towar WHERE tw_id=900900").run();
  }
});

test("wprost bije przechodnie, gdy obie drogi wskazują tę samą parę", () => {
  zatwierdz("LC170430140-0001", "W09-0211");
  zatwierdz("06-12038", "W09-0211", { rodzajDowodu: "producent", dowodTresc: "IPL" });
  const t = P.pasowaniaTowaru(ID["W09-0211"]).pasujace.find((x) => x.czesc.symbol === "06-12038")!;
  assert.equal(t.przezZamiennik, null);
  assert.equal(t.pewnosc, "potwierdzone");
});

test("negatyw z powodem, dubel jako null, automat nie rozstrzyga", () => {
  assert.throws(() => zaproponuj("170430138-0001", "W09-0211", { polaryzacja: "nie_pasuje" }), /wymaga powodu/);
  assert.throws(() => zaproponuj("W09-0211", "W09-0211"), /sama do siebie/);
  assert.throws(() => zaproponuj("W09-0211", "EX055", { dowodTresc: "  " }), /bez dowodu/);
  const neg = zatwierdz("170430138-0001", "W09-0211", { polaryzacja: "nie_pasuje", powodNegatywny: "tylko_inny_wariant",
    pozycja: "od strony kolektora", rodzajDowodu: "pomiar_wlasny", dowodTresc: "inny rozstaw" });
  assert.match(neg.zdanieZrodla, /nie pasuje do W09-0211: pasuje tylko do innego wariantu/);
  assert.deepEqual(P.pasowaniaTowaru(ID["W09-0211"]).negatywne.map((p) => p.czesc.symbol), ["170430138-0001"]);
  assert.equal(zaproponuj("170430138-0001", "W09-0211", { polaryzacja: "nie_pasuje", powodNegatywny: "nie_pasuje" }), null);
  const p = zaproponuj("W53-0202", "W09-0211")!;
  assert.throws(() => P.rozstrzygnijPasowanie(p.id, "zatwierdz", null, hala), /człowiek z biura/);
  P.rozstrzygnijPasowanie(p.id, "zatwierdz", null, biuro);
  assert.throws(() => P.rozstrzygnijPasowanie(p.id, "odrzuc", "jednak nie", biuro), /rozstrzygnął już/);
  assert.throws(() => P.wycofajPasowanie(neg.id, null, biuro), /wyłącznie z powodem/);
  P.wycofajPasowanie(p.id, null, biuro);
  assert.equal(P.pasowanie(p.id)!.stan, "wycofane");
});

test("ślad rozmowy i dziennik przy każdej mutacji; odczyt niczego nie zapisuje", () => {
  const p = zaproponuj("W53-0202", "W09-0211", { zrodlo: "dobor", conversationId: rozmowa, rodzajDowodu: "rozmowa",
    dowodTresc: "klient ma W09-0211" })!;
  assert.equal(p.pewnosc, "prawdopodobne", "ślad rozmowy nie jest dowodem technicznym");
  P.rozstrzygnijPasowanie(p.id, "zatwierdz", null, biuro);
  const typy = (db().prepare("SELECT event_type t FROM conversation_event WHERE conversation_id=? ORDER BY id").all(rozmowa) as Array<{ t: string }>).map((e) => e.t);
  assert.deepEqual(typy, ["pasowanie_propozycja", "pasowanie_rozstrzygniecie"]);
  const licz = () => (db().prepare("SELECT count(*) n FROM events").get() as { n: number }).n;
  const przed = licz();
  P.pasowaniaTowaru(ID["W09-0211"]); P.pasowaniaTowaru(ID["EX055"]); P.kolejkaPasowan();
  assert.equal(licz(), przed);
});
