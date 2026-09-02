import { before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "wertis-kandydaci-")), "t.db");
process.env.SGT_MODE = "seeded";

/* ── Kandydaci doboru (§11.2, etap E1) na PRAWDZIWEJ kartotece ───────────────
   Kartoteka to ten sam plik, z którego powstaje seed — jak w strażniku
   `zamienniki.test.ts`. Testy pilnują trzech rzeczy: kandydat niesie DROGĘ
   i ŹRÓDŁO zdaniem, szczebel bez danych mówi „pominięty" zamiast milczeć
   (blizna 0.153.1), a ta sama kartoteka z dwóch dróg to JEDEN kandydat
   z mocniejszą drogą.                                                       */

let db: typeof import("../db/db.js").db;
let kandydaciDoboru: typeof import("./kandydaci.js").kandydaciDoboru;
let zapiszDane: typeof import("./dobor.js").zapiszDane;
let W: typeof import("./wiedza.js");
let config: typeof import("../config.js").config;
let subiekt: typeof import("../context.js").subiekt;

let biuro = 0;
let konto = 0;
let rozmowa = 0;
/* `FTC272`: „OEM: 41307131600 Modele: FS200 FS250 Zamiennik: 24-04003" —
   jeden zamiennik, który JEST w kartotece. */
const FTC272 = 14;
const ZAMIENNIK_FTC272 = 1654;

before(async () => {
  ({ db } = await import("../db/db.js"));
  ({ config } = await import("../config.js"));
  ({ subiekt } = await import("../context.js"));
  ({ kandydaciDoboru } = await import("./kandydaci.js"));
  ({ zapiszDane } = await import("./dobor.js"));
  W = await import("./wiedza.js");
  const d = db();
  const rows = JSON.parse(fs.readFileSync(config.seedProducts, "utf8")) as string[][];
  assert.ok(rows.length > 3000, `kartoteka wygląda na niekompletną: ${rows.length} pozycji`);
  const ins = d.prepare("INSERT INTO sgt_towar(tw_id,symbol,nazwa,ean,opis) VALUES (?,?,?,?,?)");
  const stan = d.prepare("INSERT INTO sgt_stan(tw_id,mag_id,stan,stan_rez) VALUES (?,?,?,?)");
  d.exec("BEGIN");
  rows.forEach((r, i) => {
    ins.run(i + 1, r[0], r[1], r[2] || "", r[9] || "");
    stan.run(i + 1, config.magId.MAG, Number(r[3]) || 0, Number(r[4]) || 0);
  });
  d.exec("COMMIT");
  assert.equal((d.prepare("SELECT symbol FROM sgt_towar WHERE tw_id=?").get(FTC272) as { symbol: string }).symbol, "FTC272");
});

beforeEach(() => {
  const d = db();
  for (const t of ["dowod_zastosowania", "zastosowanie", "model_urzadzenia", "dobor_rozmowy", "offer_snapshot",
    "oferta_kartoteka", "conversation_event", "message", "conversation", "channel_account", "events", "app_user"]) {
    d.prepare(`DELETE FROM ${t}`).run();
  }
  biuro = Number(d.prepare("INSERT INTO app_user(login,name,role) VALUES ('ala','A. Lewandowska','biuro')")
    .run().lastInsertRowid);
  konto = Number(d.prepare(
    "INSERT INTO channel_account(channel,external_account_id) VALUES ('allegro','seller-a')")
    .run().lastInsertRowid);
  rozmowa = Number(d.prepare(`INSERT INTO conversation(channel_account_id,
    external_conversation_id,subject) VALUES (?,'w-1','zielony_ogrod')`).run(konto).lastInsertRowid);
});

function pytaniePodOferta(ofertaId: string, sku: string | null) {
  db().prepare(`INSERT INTO message(conversation_id,channel_account_id,external_message_id,direction,body,
    related_object_type,related_object_id,sent_at) VALUES (?,?,'m-1','incoming','Pasuje do FS250?','OFFER',?,'2026-09-01T07:00:00Z')`)
    .run(rozmowa, konto, ofertaId);
  db().prepare(`INSERT INTO offer_snapshot(channel_account_id,external_id,nazwa,sku,synced_at)
    VALUES (?,?,'Podkładka STIHL',?,'2026-09-01T07:05:00Z')`).run(konto, ofertaId, sku);
}

const szczebel = (drogi: Array<{ droga: string; sprawdzona: boolean; wynikow: number; powod?: string }>, droga: string) =>
  drogi.find((d) => d.droga === droga)!;

test("bez oferty i bez danych każdy szczebel jest POMINIĘTY z powodem, nie „zero”", () => {
  const przed = (db().prepare("SELECT count(*) n FROM events").get() as { n: number }).n;
  const { kandydaci, drogi } = kandydaciDoboru(rozmowa, subiekt);
  assert.deepEqual(kandydaci, []);
  assert.equal(drogi.length, 8, "raport ma KAŻDY szczebel §11.2");
  for (const d of drogi) {
    assert.equal(d.sprawdzona, false, `${d.droga} udaje sprawdzony`);
    assert.ok(d.powod, `${d.droga} pominięty bez powodu`);
  }
  assert.match(szczebel(drogi, "oferta").powod!, /nie jest powiązana z ofertą/);
  assert.match(szczebel(drogi, "zastosowanie").powod!, /marki i modelu/);
  assert.match(szczebel(drogi, "oem").powod!, /E3/);
  /* Patrzenie na kandydatów niczego nie zapisuje — ani wiersza doboru, ani zdarzenia. */
  assert.equal((db().prepare("SELECT count(*) n FROM events").get() as { n: number }).n, przed);
  assert.equal((db().prepare("SELECT count(*) n FROM dobor_rozmowy").get() as { n: number }).n, 0);
});

test("kartoteka oferty i jej zamiennik z opisu dają kandydatów z drogą i źródłem", () => {
  pytaniePodOferta("14892374512", "FTC272");
  const { kandydaci, drogi } = kandydaciDoboru(rozmowa, subiekt);
  assert.deepEqual(kandydaci.map((k) => [k.nr, k.twId, k.droga, k.pewnosc]),
    [[1, FTC272, "oferta", "prawdopodobne"], [2, ZAMIENNIK_FTC272, "zamiennik", "wymaga_danych"]]);
  assert.match(kandydaci[0].zrodlo, /Kartoteka oferty 14892374512 — SKU oferty „FTC272/);
  assert.match(kandydaci[1].zrodlo, /Zamiennik z opisu kartoteki „FTC272”/);
  assert.equal(kandydaci[1].symbol, "24-04003");
  assert.equal(szczebel(drogi, "oferta").wynikow, 1);
  assert.equal(szczebel(drogi, "zamiennik").wynikow, 1);
  assert.equal(szczebel(drogi, "symbol").sprawdzona, false, "bez wpisanego symbolu szczebel jest pominięty");
});

test("oferta bez SKU pomija szczebel z ZDANIEM z mostka, a zamienniki nie mają skąd się wziąć", () => {
  pytaniePodOferta("14892374512", "");
  const { kandydaci, drogi } = kandydaciDoboru(rozmowa, subiekt);
  assert.deepEqual(kandydaci, []);
  assert.match(szczebel(drogi, "oferta").powod!, /bez SKU/);
  assert.match(szczebel(drogi, "zamiennik").powod!, /bez kartoteki oferty/);
});

test("symbol wpisany w danych trafia dokładnie, a ta sama kartoteka z dwóch dróg to JEDEN kandydat", () => {
  pytaniePodOferta("14892374512", "FTC272");
  zapiszDane(rozmowa, { nazwaCzesci: "ftc272" }, 1, biuro);
  const { kandydaci, drogi } = kandydaciDoboru(rozmowa, subiekt);
  /* Dedup zostawia MOCNIEJSZĄ drogę: dokładny symbol bije kontekst oferty. */
  assert.equal(kandydaci.filter((k) => k.twId === FTC272).length, 1);
  assert.equal(kandydaci[0].droga, "symbol");
  assert.equal(kandydaci[0].symbol, "FTC272");
  assert.equal(szczebel(drogi, "symbol").sprawdzona, true);
  assert.equal(szczebel(drogi, "symbol").wynikow, 1);
});

test("literówka w symbolu NIE prowadzi do cudzej kartoteki — furtka jest wyłączona", () => {
  /* Blizna „szarpaka": wyszukiwarka z furtką na literówki znajdowała podobny
     symbol i agent brał go za trafienie. Dobór nie ma prawa zgadywać. */
  zapiszDane(rozmowa, { oem: "FTC27Z" }, 1, biuro);
  const { kandydaci, drogi } = kandydaciDoboru(rozmowa, subiekt);
  assert.deepEqual(kandydaci, []);
  assert.equal(szczebel(drogi, "symbol").sprawdzona, true);
  assert.equal(szczebel(drogi, "symbol").wynikow, 0);
});

test("kod EAN w danych wejściowych trafia w kartotekę drogą `ean`", () => {
  zapiszDane(rozmowa, { oem: "5907580110455" }, 1, biuro);
  const { kandydaci, drogi } = kandydaciDoboru(rozmowa, subiekt);
  assert.equal(kandydaci.length, 1);
  assert.equal(kandydaci[0].twId, FTC272);
  assert.equal(kandydaci[0].droga, "ean");
  assert.equal(szczebel(drogi, "ean").wynikow, 1);
});

test("nazwa części słowami nie uruchamia szczebla symbolu", () => {
  zapiszDane(rozmowa, { nazwaCzesci: "podkładka przekładni" }, 1, biuro);
  const { drogi } = kandydaciDoboru(rozmowa, subiekt);
  assert.equal(szczebel(drogi, "symbol").sprawdzona, false);
});

/* ── Szczebel „zastosowanie" i negatywy z bazy wiedzy (E2) ───────────────── */

const STIHL = { rodzaj: "maszyna" as const, marka: "STIHL", nazwa: "FS 250" };
const zaproponuj = (twId: number, n: Partial<Parameters<typeof W.zaproponujZastosowanie>[0]> = {}) =>
  W.zaproponujZastosowanie({ twId, model: STIHL, polaryzacja: "pasuje", zrodlo: "reczne",
    dowod: { rodzaj: "katalog_dostawcy", tresc: "katalog 2024" }, ...n }, { userId: biuro, name: "A. Lewandowska" })!;

test("zatwierdzone zastosowanie daje kandydata przed ofertą, z pewnością i źródłem z dowodu", () => {
  pytaniePodOferta("14892374512", "FTC272");
  zapiszDane(rozmowa, { marka: "stihl", model: "fs250" }, 1, biuro);
  const zatwierdzone = zaproponuj(ZAMIENNIK_FTC272);
  W.rozstrzygnijZastosowanie(zatwierdzone.id, "zatwierdz", null, biuro);
  /* Propozycja, której nikt nie rozstrzygnął, NIE jest wiedzą. */
  zaproponuj(FTC272, { dowod: { rodzaj: "rozmowa", tresc: "dobór" } });

  const { kandydaci, drogi } = kandydaciDoboru(rozmowa, subiekt);
  assert.equal(szczebel(drogi, "zastosowanie").sprawdzona, true);
  assert.equal(szczebel(drogi, "zastosowanie").wynikow, 1);
  assert.equal(kandydaci[0].twId, ZAMIENNIK_FTC272, "zastosowanie ma rangę przed ofertą");
  assert.equal(kandydaci[0].droga, "zastosowanie");
  assert.equal(kandydaci[0].pewnosc, "potwierdzone");
  assert.match(kandydaci[0].zrodlo, /^potwierdzone zastosowanie do STIHL FS 250 — katalog dostawcy, /);
  assert.equal(kandydaci.find((k) => k.twId === FTC272)?.droga, "oferta", "propozycja nie podniosła oferty do zastosowania");
});

test("negatyw jest widoczny osobno i jako ostrzeżenie przy kandydacie z innej drogi", () => {
  pytaniePodOferta("14892374512", "FTC272");
  zapiszDane(rozmowa, { marka: "STIHL", model: "FS 250" }, 1, biuro);
  const neg = zaproponuj(FTC272, { polaryzacja: "nie_pasuje", powodNegatywny: "tylko_inny_wariant",
    dowod: { rodzaj: "decyzja_biura", tresc: "pasuje do FS 250 tylko z przekładnią nową" } });
  W.rozstrzygnijZastosowanie(neg.id, "zatwierdz", null, biuro);
  /* Negatyw dla kartoteki, której NIE MA wśród kandydatów, też ma być widoczny. */
  const obcy = zaproponuj(1, { polaryzacja: "nie_pasuje", powodNegatywny: "niewlasciwy_rozstaw",
    dowod: { rodzaj: "pomiar_wlasny", tresc: "rozstaw 140 mm" } });
  W.rozstrzygnijZastosowanie(obcy.id, "zatwierdz", null, biuro);

  const { kandydaci, negatywne } = kandydaciDoboru(rozmowa, subiekt);
  assert.deepEqual(negatywne.map((n) => n.twId).sort(), [1, FTC272]);
  assert.match(negatywne.find((n) => n.twId === FTC272)!.powod, /tylko do innego wariantu/);
  const oferta = kandydaci.find((k) => k.twId === FTC272)!;
  assert.equal(oferta.droga, "oferta", "negatyw nie wyrzuca kandydata — ostrzega przy nim");
  assert.equal(oferta.ostrzezenia.length, 1);
  assert.match(oferta.ostrzezenia[0], /innego wariantu — nie pasuje do STIHL FS 250/);
  assert.equal(kandydaci.some((k) => k.twId === 1), false);
});
