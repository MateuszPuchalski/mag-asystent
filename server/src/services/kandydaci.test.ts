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
let S: typeof import("./silniki.js");
let P: typeof import("./pasowania.js");
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
  S = await import("./silniki.js");
  P = await import("./pasowania.js");
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
  /* E3: szczeble OEM i pełnego tekstu czytają pochodne po imporcie, nie kartotekę. */
  const { przebudujIdentyfikatory } = await import("./identyfikatory.js");
  const { przebudujFts } = await import("./pelnotekst.js");
  przebudujIdentyfikatory(d);
  assert.ok(przebudujFts(d), "FTS5 ma być dostępne w node:sqlite testów");
});

beforeEach(() => {
  const d = db();
  for (const t of ["pasowanie_czesci", "dowod_zastosowania", "zastosowanie", "alias_silnika", "zabudowa_silnika", "model_urzadzenia",
    "dobor_rozmowy", "offer_snapshot",
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
  assert.equal(drogi.length, 10, "raport ma KAŻDY szczebel §11.2");
  for (const d of drogi) {
    assert.equal(d.sprawdzona, false, `${d.droga} udaje sprawdzony`);
    assert.ok(d.powod, `${d.droga} pominięty bez powodu`);
  }
  assert.match(szczebel(drogi, "oferta").powod!, /nie jest powiązana z ofertą/);
  assert.match(szczebel(drogi, "zastosowanie").powod!, /marki i modelu/);
  assert.match(szczebel(drogi, "silnik").powod!, /marki i modelu/);
  assert.match(szczebel(drogi, "pasowanie").powod!, /nie wpisał symbolu ani numeru, a rozmowa nie ma kartoteki oferty/);
  assert.match(szczebel(drogi, "oem").powod!, /numeru OEM/);
  assert.match(szczebel(drogi, "pelnotekst").powod!, /nazwy części ani maszyny/);
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
  assert.deepEqual(kandydaci.filter((k) => k.twId !== null), []);
  assert.equal(szczebel(drogi, "symbol").sprawdzona, true);
  assert.equal(szczebel(drogi, "symbol").wynikow, 0);
  /* Zostaje wyłącznie karta „bez kartoteki" z pola OEM (E3) — bez wiersza, bez stanu. */
  assert.deepEqual(kandydaci.map((k) => [k.twId, k.droga, k.pewnosc]), [[null, "oem", "wymaga_danych"]]);
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

/* ── Szczeble OEM i pełnego tekstu (E3) ──────────────────────────────────── */

test("numer OEM z opisu trafia w kartotekę drogą `oem`, a ta sama kartoteka z zamiennika to JEDEN kandydat", () => {
  pytaniePodOferta("14892374512", "FTC272");
  zapiszDane(rozmowa, { oem: "41307131600" }, 1, biuro);
  const { kandydaci, drogi } = kandydaciDoboru(rozmowa, subiekt);
  assert.equal(szczebel(drogi, "oem").sprawdzona, true);
  assert.ok(szczebel(drogi, "oem").wynikow >= 2, "numer stoi w opisie FTC272 i jego zamiennika");
  const ftc = kandydaci.find((k) => k.twId === FTC272)!;
  assert.equal(ftc.droga, "oem", "OEM bije kontekst oferty");
  assert.equal(ftc.pewnosc, "prawdopodobne");
  assert.match(ftc.zrodlo, /^numer OEM 41307131600 z opisu kartoteki „FTC272”$/);
  /* Zamiennik z opisu FTC272 ma ten sam numer w SWOIM opisie: jedna karta, mocniejsza droga. */
  assert.equal(kandydaci.filter((k) => k.twId === ZAMIENNIK_FTC272).length, 1);
  assert.equal(kandydaci.find((k) => k.twId === ZAMIENNIK_FTC272)!.droga, "oem");
  assert.equal(kandydaci.some((k) => k.twId === null), false, "numer z kartoteką nie dostaje karty „bez kartoteki”");
});

test("numer OEM bez kartoteki to kandydat BEZ wiersza na końcu listy — decyzja właściciela, makieta Dobor.dc.html", () => {
  pytaniePodOferta("14892374512", "FTC272");
  zapiszDane(rozmowa, { oem: "999999999" }, 1, biuro);
  const { kandydaci, drogi } = kandydaciDoboru(rozmowa, subiekt);
  assert.equal(szczebel(drogi, "oem").sprawdzona, true);
  assert.equal(szczebel(drogi, "oem").wynikow, 0, "karta bez kartoteki nie liczy się jako trafienie");
  const ostatni = kandydaci[kandydaci.length - 1];
  assert.equal(ostatni.twId, null);
  assert.equal(ostatni.stan, null);
  assert.equal(ostatni.symbol, "OEM 999999999");
  assert.equal(ostatni.nazwa, "identyfikator bez wiersza w kartotece");
  assert.equal(ostatni.pewnosc, "wymaga_danych");
  assert.equal(ostatni.nr, kandydaci.length, "numeracja ciągła: karta bez kartoteki idzie PO kartotekach");
  assert.ok(kandydaci.slice(0, -1).every((k) => k.twId !== null));
});

test("numer wpisany jako NAZWA części nie dostaje karty „bez kartoteki”", () => {
  zapiszDane(rozmowa, { nazwaCzesci: "123456789" }, 1, biuro);
  const { kandydaci, drogi } = kandydaciDoboru(rozmowa, subiekt);
  assert.equal(szczebel(drogi, "oem").sprawdzona, true);
  assert.deepEqual(kandydaci, []);
});

test("pełny tekst pyta o dane agenta i daje trafienia `wymaga_danych` z rankingiem, nie dowód", () => {
  zapiszDane(rozmowa, { nazwaCzesci: "podkładka przekładni", marka: "STIHL", model: "FS 250" }, 1, biuro);
  const { kandydaci, drogi } = kandydaciDoboru(rozmowa, subiekt);
  assert.equal(szczebel(drogi, "pelnotekst").sprawdzona, true);
  assert.ok(szczebel(drogi, "pelnotekst").wynikow >= 1);
  assert.ok(szczebel(drogi, "pelnotekst").wynikow <= 5, "górna zapora: pięć trafień bm25");
  const pt = kandydaci.filter((k) => k.droga === "pelnotekst");
  assert.equal(pt.length, szczebel(drogi, "pelnotekst").wynikow);
  assert.ok(pt.every((k) => k.pewnosc === "wymaga_danych"));
  assert.match(pt[0].zrodlo, /^trafienie po treści kartoteki dla „podkładka przekładni STIHL FS 250” — nie dowód/);
  assert.ok(pt.some((k) => k.twId === FTC272), "podkładka przekładni FS jest w opisie FTC272");
});

test("bez FTS5 szczebel pełnego tekstu jest pominięty z powodem, a reszta drabiny działa", async () => {
  const { udawajBrakFts } = await import("../db/db.js");
  pytaniePodOferta("14892374512", "FTC272");
  zapiszDane(rozmowa, { nazwaCzesci: "podkładka przekładni" }, 1, biuro);
  udawajBrakFts(true);
  try {
    const { kandydaci, drogi } = kandydaciDoboru(rozmowa, subiekt);
    assert.equal(szczebel(drogi, "pelnotekst").sprawdzona, false);
    assert.match(szczebel(drogi, "pelnotekst").powod!, /SQLite bez FTS5/);
    assert.equal(kandydaci[0].twId, FTC272);
  } finally {
    udawajBrakFts(false);
  }
});

/* ── Szczebel „przez silnik": zabudowa jako drugie ogniwo łańcucha ────────── */

const BS450 = { rodzaj: "silnik" as const, marka: "Briggs & Stratton", nazwa: "450E" };
const HONDA = { rodzaj: "silnik" as const, marka: "Honda", nazwa: "GCV160" };

/** Zatwierdzona para maszyna→silnik. `dowod` steruje pewnością drugiego ogniwa. */
function zabuduj(silnik: typeof BS450, rodzajDowodu: Parameters<typeof S.zaproponujZabudowe>[0]["rodzajDowodu"] = "producent") {
  const z = S.zaproponujZabudowe({ maszyna: STIHL, silnik, rodzajDowodu,
    dowodTresc: "karta katalogowa", zrodlo: "reczne" }, { userId: biuro, name: "A. Lewandowska" })!;
  return S.rozstrzygnijZabudowe(z.id, "zatwierdz", null, biuro);
}

/** Zatwierdzone zastosowanie części DO SILNIKA — bez tego szczebel nie ma paliwa. */
function zastosowanieDoSilnika(twId: number, silnik: typeof BS450, rodzaj: "katalog_dostawcy" | "rozmowa" = "katalog_dostawcy") {
  const z = W.zaproponujZastosowanie({ twId, model: silnik, polaryzacja: "pasuje", zrodlo: "reczne",
    dowod: { rodzaj, tresc: "katalog 2024" } }, { userId: biuro, name: "A. Lewandowska" })!;
  return W.rozstrzygnijZastosowanie(z.id, "zatwierdz", null, biuro);
}

test("bez zabudowy szczebel silnika jest POMINIĘTY i mówi, czego brakuje", () => {
  zapiszDane(rozmowa, { marka: "STIHL", model: "FS 250" }, 1, biuro);
  const { drogi } = kandydaciDoboru(rozmowa, subiekt);
  assert.equal(szczebel(drogi, "silnik").sprawdzona, false);
  /* Powód NAZYWA maszynę i mówi, gdzie iść — to jedyna droga, którą agent
     dowie się, że baza silników ma lukę. */
  assert.match(szczebel(drogi, "silnik").powod!, /nie wiadomo, jaki silnik stoi w STIHL FS 250/);
  assert.match(szczebel(drogi, "silnik").powod!, /Wiedza → Silniki/);
});

test("powód pominięcia prowadzi do słownika albo do przycisku zabudowy — a alias sam nie daje kandydatów", () => {
  /* Tekst bez aliasu: agent ma wiedzieć, że brakuje wpisu w słowniku. */
  zapiszDane(rozmowa, { marka: "STIHL", model: "FS 250", silnik: "B&S 450E" }, 1, biuro);
  let sz = szczebel(kandydaciDoboru(rozmowa, subiekt).drogi, "silnik");
  assert.equal(sz.sprawdzona, false);
  assert.match(sz.powod!, /„B&S 450E” nie ma w słowniku silników/);
  /* Alias jest, zabudowy nie ma: krok dalej to przycisk pod polem, nie zgadywanie. */
  S.dodajAliasSilnika({ tekst: "B&S 450E", silnik: BS450 }, { userId: biuro, name: "A. Lewandowska" });
  zastosowanieDoSilnika(FTC272, BS450);
  const w = kandydaciDoboru(rozmowa, subiekt);
  sz = szczebel(w.drogi, "silnik");
  assert.equal(sz.sprawdzona, false, "alias to nie zabudowa — szczebel dalej pominięty");
  assert.match(sz.powod!, /to silnik Briggs & Stratton 450E wg słownika/);
  assert.match(sz.powod!, /zaproponuj zabudowę pod polem Silnik/);
  assert.equal(w.kandydaci.some((k) => k.droga === "silnik"), false, "kandydatów z samego aliasu nie ma");
});

test("silnik znany, ale bez zastosowań to SPRAWDZONY z zerem, nie pominięcie", () => {
  zapiszDane(rozmowa, { marka: "STIHL", model: "FS 250" }, 1, biuro);
  zabuduj(BS450);
  const { drogi } = kandydaciDoboru(rozmowa, subiekt);
  /* Dwie różne prawdy: „nie wiem, jaki silnik” kontra „wiem i nic nie mam”. */
  assert.equal(szczebel(drogi, "silnik").sprawdzona, true);
  assert.equal(szczebel(drogi, "silnik").wynikow, 0);
  assert.equal(szczebel(drogi, "silnik").powod, undefined);
});

test("część silnika trafia do kandydatów, a źródło nazywa OBA ogniwa łańcucha", () => {
  zapiszDane(rozmowa, { marka: "STIHL", model: "FS 250" }, 1, biuro);
  zabuduj(BS450);
  zastosowanieDoSilnika(FTC272, BS450);
  const { kandydaci, drogi } = kandydaciDoboru(rozmowa, subiekt);
  assert.equal(szczebel(drogi, "silnik").wynikow, 1);
  const k = kandydaci.find((x) => x.twId === FTC272)!;
  assert.equal(k.droga, "silnik");
  assert.equal(k.pewnosc, "potwierdzone", "dowód techniczny po obu stronach łańcucha");
  assert.match(k.zrodlo, /zastosowanie do silnik Briggs & Stratton 450E/);
  assert.match(k.zrodlo, /silnik Briggs & Stratton 450E stoi w STIHL FS 250/);
  assert.deepEqual(k.ostrzezenia, [], "jeden silnik — nie ma czego potwierdzać z tabliczki");
});

test("dwie wersje silnikowe: nigdy „potwierdzone” i zawsze ostrzeżenie o tabliczce", () => {
  zapiszDane(rozmowa, { marka: "STIHL", model: "FS 250" }, 1, biuro);
  zabuduj(BS450);
  zabuduj(HONDA);
  zastosowanieDoSilnika(FTC272, BS450);
  const { kandydaci } = kandydaciDoboru(rozmowa, subiekt);
  const k = kandydaci.find((x) => x.twId === FTC272)!;
  /* Klient zna model kosiarki, nie wersję silnika. Milcząca pewność w tym
     miejscu kończy się zwrotem „nie pasuje". */
  assert.equal(k.pewnosc, "prawdopodobne");
  assert.equal(k.ostrzezenia.length, 1);
  assert.match(k.ostrzezenia[0], /bywa z kilkoma silnikami — potwierdź z tabliczki/);
});

test("ślad rozmowy po którejkolwiek stronie łańcucha zbija pewność do „prawdopodobne”", () => {
  zapiszDane(rozmowa, { marka: "STIHL", model: "FS 250" }, 1, biuro);
  zabuduj(BS450, "rozmowa");
  zastosowanieDoSilnika(FTC272, BS450);
  const k = kandydaciDoboru(rozmowa, subiekt).kandydaci.find((x) => x.twId === FTC272)!;
  assert.equal(k.pewnosc, "prawdopodobne", "łańcuch jest wart tyle, co słabsze ogniwo");
});

test("negatyw przez silnik jest widoczny i cytuje oba dowody", () => {
  zapiszDane(rozmowa, { marka: "STIHL", model: "FS 250" }, 1, biuro);
  zabuduj(BS450);
  const neg = W.zaproponujZastosowanie({ twId: FTC272, model: BS450, polaryzacja: "nie_pasuje",
    powodNegatywny: "tylko_inny_wariant", zrodlo: "reczne",
    dowod: { rodzaj: "pomiar_wlasny", tresc: "inny gwint" } }, { userId: biuro, name: "A. Lewandowska" })!;
  W.rozstrzygnijZastosowanie(neg.id, "zatwierdz", null, biuro);
  const { negatywne } = kandydaciDoboru(rozmowa, subiekt);
  assert.deepEqual(negatywne.map((n) => n.twId), [FTC272]);
  assert.match(negatywne[0].zrodlo, /nie pasuje do silnik Briggs & Stratton 450E/);
  assert.match(negatywne[0].zrodlo, /stoi w STIHL FS 250/);
});

test("zastosowanie do MASZYNY bije to samo przez silnik — jeden kandydat, mocniejsza droga", () => {
  zapiszDane(rozmowa, { marka: "STIHL", model: "FS 250" }, 1, biuro);
  zabuduj(BS450);
  zastosowanieDoSilnika(FTC272, BS450);
  W.rozstrzygnijZastosowanie(zaproponuj(FTC272).id, "zatwierdz", null, biuro);
  const { kandydaci } = kandydaciDoboru(rozmowa, subiekt);
  assert.equal(kandydaci.filter((k) => k.twId === FTC272).length, 1);
  assert.equal(kandydaci.find((k) => k.twId === FTC272)!.droga, "zastosowanie");
});

test("propozycja zabudowy i zabudowa wycofana NIE karmią szczebla", () => {
  zapiszDane(rozmowa, { marka: "STIHL", model: "FS 250" }, 1, biuro);
  S.zaproponujZabudowe({ maszyna: STIHL, silnik: HONDA, rodzajDowodu: "producent",
    dowodTresc: "karta", zrodlo: "reczne" }, { userId: biuro, name: "A. Lewandowska" });
  zastosowanieDoSilnika(FTC272, HONDA);
  assert.equal(szczebel(kandydaciDoboru(rozmowa, subiekt).drogi, "silnik").sprawdzona, false,
    "propozycja nie jest wiedzą");

  const zab = zabuduj(BS450);
  zastosowanieDoSilnika(ZAMIENNIK_FTC272, BS450);
  assert.equal(szczebel(kandydaciDoboru(rozmowa, subiekt).drogi, "silnik").wynikow, 1);
  S.wycofajZabudowe(zab.id, "pomyłka: to inna wersja kosiarki", biuro);
  /* Wycofanie zabudowy gasi CAŁĄ gałąź naraz — dlatego wymaga powodu. */
  assert.equal(szczebel(kandydaciDoboru(rozmowa, subiekt).drogi, "silnik").sprawdzona, false);
});

/* ── Szczebel „pasowanie": części do KOTWICY (uszczelka do gaźnika) ──────────
   Kotwica to kartoteka, którą agent WSKAZAŁ symbolem/numerem albo kartoteka
   oferty — nigdy treść wiadomości. Scenariusz GX160 z seedu: gaźniki
   `W09-0211` ≡ `EX055`, uszczelki `LC170430140-0001` ≡ `06-12038`.          */

const tw = (symbol: string) =>
  (db().prepare("SELECT tw_id FROM sgt_towar WHERE symbol=?").get(symbol) as { tw_id: number }).tw_id;
const pasuje = (czesc: string, doCzego: string, n: Record<string, unknown> = {}) =>
  P.rozstrzygnijPasowanie(P.zaproponujPasowanie({ twId: tw(czesc), doTwId: tw(doCzego), rola: "uszczelka",
    polaryzacja: "pasuje", rodzajDowodu: "katalog_dostawcy", dowodTresc: "katalog", zrodlo: "reczne", ...n } as never,
    { userId: biuro, name: "A. Lewandowska" })!.id, "zatwierdz", null, biuro);

test("klient nazwał gaźnik: symbol daje gaźnik jako kotwicę, pasowanie — jego uszczelki", () => {
  pasuje("LC170430140-0001", "W09-0211", { pozycja: "od strony filtra" });
  zapiszDane(rozmowa, { oem: "W09-0211", nazwaCzesci: "uszczelka" }, 1, biuro);
  const { kandydaci, drogi, kotwice } = kandydaciDoboru(rozmowa, subiekt);
  assert.deepEqual(kotwice.map((k) => k.symbol), ["W09-0211"]);
  assert.equal(szczebel(drogi, "pasowanie").sprawdzona, true);
  /* Wprost + przez zamiennik uszczelki (06-12038). */
  assert.equal(szczebel(drogi, "pasowanie").wynikow, 2);
  const wprost = kandydaci.find((k) => k.symbol === "LC170430140-0001")!;
  assert.equal(wprost.droga, "pasowanie");
  assert.equal(wprost.pewnosc, "potwierdzone");
  assert.match(wprost.zrodlo, /^uszczelka \(od strony filtra\) LC170430140-0001 pasuje do W09-0211 — katalog dostawcy/);
  const przez = kandydaci.find((k) => k.symbol === "06-12038")!;
  assert.equal(przez.pewnosc, "prawdopodobne");
  assert.match(przez.zrodlo, /podaje 06-12038 jako zamiennik/);
  /* Sam gaźnik jest kandydatem z drogi `symbol` — kotwica nie znika z listy. */
  assert.equal(kandydaci.find((k) => k.symbol === "W09-0211")!.droga, "symbol");
});

test("kotwica z zamiennika gaźnika: EX055 dziedziczy uszczelki W09-0211 jako prawdopodobne", () => {
  pasuje("LC170430140-0001", "W09-0211");
  zapiszDane(rozmowa, { oem: "EX055" }, 1, biuro);
  const k = kandydaciDoboru(rozmowa, subiekt).kandydaci.find((x) => x.symbol === "LC170430140-0001")!;
  assert.equal(k.droga, "pasowanie");
  assert.equal(k.pewnosc, "prawdopodobne");
  assert.match(k.zrodlo, /EX055 podaje W09-0211 jako zamiennik/);
});

test("scenariusz odwrotny: oferta to uszczelka, klient pyta o swój gaźnik — droga `pasowanie` bije `oferta`", () => {
  pasuje("06-12038", "W09-0211");
  pytaniePodOferta("14892374513", "06-12038");
  zapiszDane(rozmowa, { oem: "W09-0211" }, 1, biuro);
  const { kandydaci } = kandydaciDoboru(rozmowa, subiekt);
  const u = kandydaci.find((k) => k.symbol === "06-12038")!;
  /* Gdyby `oferta` była wyżej, zdanie brzmiałoby „Kartoteka oferty…" i dowód
     pasowania zniknąłby ze szkicu. */
  assert.equal(u.droga, "pasowanie");
  assert.match(u.zrodlo, /pasuje do W09-0211/);
});

test("kotwica bez pasowań to sprawdzony szczebel z zerem; negatyw pasowania ląduje w ostrzeżeniach", () => {
  zapiszDane(rozmowa, { oem: "W09-0211" }, 1, biuro);
  assert.deepEqual(szczebel(kandydaciDoboru(rozmowa, subiekt).drogi, "pasowanie"),
    { droga: "pasowanie", sprawdzona: true, wynikow: 0 });
  pasuje("170430138-0001", "W09-0211", { polaryzacja: "nie_pasuje", powodNegatywny: "tylko_inny_wariant",
    rodzajDowodu: "pomiar_wlasny", dowodTresc: "inny rozstaw" });
  const { negatywne } = kandydaciDoboru(rozmowa, subiekt);
  assert.deepEqual(negatywne.map((n) => n.symbol), ["170430138-0001"]);
  assert.match(negatywne[0].zrodlo, /nie pasuje do W09-0211/);
});
