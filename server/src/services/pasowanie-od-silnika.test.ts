import { before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "wertis-silnik-")), "t.db");
process.env.SGT_MODE = "seeded";
process.env.LOG_LEVEL = "silent";

/* ── Pasowanie od silnika (0.527.0) ─────────────────────────────────────────
   Właściciel: „szukanie od najpopularniejszych silników powinno znacznie
   przyspieszyć dopasowania”. Jeden wykaz części silnika dopasowuje wiele
   naszych kartotek naraz. Pilnujemy: numer dopasowuje SERWER, dokładnie, po
   tokenach; liczy się tylko strona nazwana wykazem tego silnika, spoza
   Allegro; zatwierdzone „nie pasuje” wygrywa; noc zaczyna od silników. */

let db: typeof import("../db/db.js").db;
let M: typeof import("./pasowanie-od-silnika.js");
const TERAZ = new Date("2026-09-26T02:00:00Z");
const WYKAZ = "https://producent.example.com/gcv160-ipl.pdf";
const TEKST = "Honda GCV160 parts list. 17211-ZL8-023 ELEMENT, AIR CLEANER 1 pc. 16100-Z0L-853 CARBURETOR 1 pc.";

before(async () => {
  ({ db } = await import("../db/db.js"));
  M = await import("./pasowanie-od-silnika.js");
  const d = db();
  const tw = d.prepare("INSERT INTO sgt_towar(tw_id,symbol,nazwa) VALUES (?,?,?)");
  tw.run(901, "W12-001", "Filtr powietrza");
  tw.run(902, "W12-002", "Gaźnik");
  const id = d.prepare(`INSERT INTO towar_identyfikator(tw_id,tw_symbol,rodzaj,wartosc,wartosc_norm,zrodlo,dodal,at)
    VALUES (?,?,'oem',?,?,'opis','import','2026-09-01T00:00:00Z')`);
  id.run(901, "W12-001", "17211-ZL8-023", "17211zl8023");
  id.run(902, "W12-002", "16100-Z0L-853", "16100z0l853");
});

beforeEach(() => {
  const d = db();
  for (const t of ["dowod_zastosowania", "zastosowanie", "model_urzadzenia", "pasowanie_siec_silnik", "pasowanie_siec",
    "copilot_wywolanie", "events"]) d.prepare(`DELETE FROM ${t}`).run();
});

test("numer dopasowuje się dokładnie po tokenach, także rozbity spacjami, a nie jako podciąg", () => {
  const numery = new Map([["532165630", [{ twId: 1, symbol: "A", numer: "532 16 56-30" }]],
    ["11231200650", [{ twId: 2, symbol: "B", numer: "1123 120 0650" }]]]);
  const t = M.trafieniaWTekscie("Nóż 532 16 56-30, szt. 1; X11231200650Y nie jest numerem.", numery);
  assert.deepEqual(t.map((x) => x.symbol), ["A"], "podciąg w dłuższym tokenie to nie ten numer");
  assert.ok(t[0]!.cytat.includes("532 16 56-30"), "cytat to wycinek strony wokół numeru");
});

test("strona musi mówić o tym silniku: oznaczenie i marka w tekście", () => {
  assert.equal(M.stronaOSilniku(TEKST, { marka: "Honda", nazwa: "GCV160" }), true);
  assert.equal(M.stronaOSilniku(TEKST, { marka: "Honda", nazwa: "GCV135" }), false);
  assert.equal(M.stronaOSilniku("Briggs 450E parts", { marka: "Briggs & Stratton", nazwa: "450E" }), true);
});

const nadajSilnik = (wykazy: Array<{ url: string; zrodloStrony: "producent" | "katalog_dostawcy" | "sklep" }> = [{ url: WYKAZ, zrodloStrony: "producent" }],
  strony = [{ url: WYKAZ, tekst: TEKST }]) => {
  const pytania: string[] = [];
  const nadaj: import("./pasowanie-od-silnika.js").NadawcaWykazuSilnika = async (s) => {
    pytania.push(`${s.marka} ${s.nazwa}`);
    /* Każdy silnik z listy dostaje ten sam wykaz; tylko GCV160 przejdzie
       sprawdzenie „strona o tym silniku”. */
    return { wykazy, strony, pdfy: [], wyszukiwan: 1, model: "claude-opus-5",
      zuzycie: { wej: 100, wyj: 10, cacheZapis: 0, cacheOdczyt: 0, wyszukiwania: 1 }, ms: 1 };
  };
  return { nadaj, pytania };
};

test("wykaz silnika daje propozycje dla WSZYSTKICH naszych kartotek, które w nim stoją", async () => {
  const n = nadajSilnik();
  const w = await M.szukajOdSilnikow({ nadaj: n.nadaj, ile: M.SILNIKI_POPULARNE.length, teraz: () => TERAZ });
  assert.equal(n.pytania[0], "Briggs & Stratton Classic", "idzie od góry listy właściciela");
  assert.equal(w.zaproponowano, 2, "jeden wykaz, dwie kartoteki");
  const z = db().prepare(`SELECT z.tw_id, z.stan, z.zaproponowal, m.marka, m.nazwa, m.rodzaj, d.link
      FROM zastosowanie z JOIN model_urzadzenia m ON m.id=z.model_id JOIN dowod_zastosowania d ON d.zastosowanie_id=z.id
      ORDER BY z.tw_id`).all() as Array<Record<string, unknown>>;
  assert.deepEqual(z.map((x) => ({ ...x })), [
    { tw_id: 901, stan: "propozycja", zaproponowal: "automat (siec-silnik)", marka: "Honda", nazwa: "GCV160", rodzaj: "silnik", link: WYKAZ },
    { tw_id: 902, stan: "propozycja", zaproponowal: "automat (siec-silnik)", marka: "Honda", nazwa: "GCV160", rodzaj: "silnik", link: WYKAZ },
  ]);
  assert.equal(M.silnikiDoSieci(99, TERAZ).length, 0, "sprawdzony silnik wraca dopiero po 90 dniach");
});

test("strona nienazwana wykazem albo z Allegro nie daje nic", async () => {
  const allegro = "https://allegro.pl/oferta/1";
  const n = nadajSilnik([{ url: allegro, zrodloStrony: "sklep" }], [{ url: WYKAZ, tekst: TEKST }, { url: allegro, tekst: TEKST }]);
  const w = await M.szukajOdSilnikow({ nadaj: n.nadaj, ile: 3, teraz: () => TERAZ });
  assert.equal(w.zaproponowano, 0);
});

test("przegląd listą: jedna karta na silnik; zatwierdzenie bierze tylko zaznaczone", async () => {
  const d = db();
  const biuro = Number(d.prepare("INSERT INTO app_user(login,name,role) VALUES (?,'A. L.','biuro')")
    .run(`ala-${Math.random()}`).lastInsertRowid);
  await M.szukajOdSilnikow({ nadaj: nadajSilnik().nadaj, ile: M.SILNIKI_POPULARNE.length, teraz: () => TERAZ });
  const W = await import("./wiedza.js");
  const [g] = M.przegladOdSilnika(W.kolejkaPropozycji().propozycje);
  assert.equal(g!.zrodlo, "silnik Honda GCV160 — wykazy części z sieci");
  assert.deepEqual(g!.pozycje.map((p) => p.symbol).sort(), ["W12-001", "W12-002"]);
  const r = M.zatwierdzOdSilnika(g!.id, [g!.pozycje[0]!.id], biuro);
  assert.deepEqual(r, { zatwierdzono: 1, pominieto: 0 });
  assert.throws(() => M.zatwierdzOdSilnika(g!.id + 999, [g!.pozycje[1]!.id], biuro), /spoza tego silnika/);
});

test("noc zaczyna od silników; kartoteki dostają resztę limitu", async () => {
  const czesci: string[] = [];
  const w = await M.przebiegSieci({
    nadaj: async (z) => { czesci.push(z.symbol); throw new Error("nie powinno dojść"); },
    nadajSilnik: nadajSilnik().nadaj, naNoc: 2, teraz: () => TERAZ,
  });
  assert.equal(w.silniki.sprawdzono, 2, "cały limit poszedł na silniki z listy");
  assert.deepEqual(czesci, [], "na kartoteki nie zostało nic");
});

test("zatwierdzone „nie pasuje” do silnika wygrywa z wykazem z sieci", async () => {
  const d = db();
  const model = Number(d.prepare(`INSERT INTO model_urzadzenia(rodzaj,marka,nazwa,klucz,utworzono_przez)
    VALUES ('silnik','Honda','GCV160','silnik|hondagcv160','test')`).run().lastInsertRowid);
  d.prepare(`INSERT INTO zastosowanie(tw_id,tw_symbol,model_id,polaryzacja,powod_negatywny,stan,zrodlo_propozycji,zaproponowal)
    VALUES (901,'W12-001',?,'nie_pasuje','nie_pasuje','zatwierdzone','reczne','test')`).run(model);
  const w = await M.szukajOdSilnikow({ nadaj: nadajSilnik().nadaj, ile: M.SILNIKI_POPULARNE.length, teraz: () => TERAZ });
  assert.equal(w.zaproponowano, 1, "tylko gaźnik; filtr zmierzony jako niepasujący zostaje niepasujący");
});
