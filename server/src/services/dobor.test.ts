import { before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "wertis-dobor-")), "t.db");
process.env.SGT_MODE = "seeded";

/* ── Dobór przy rozmowie (§11, etap E1) ──────────────────────────────────────
   Kręgosłup doboru: dane wejściowe, status z §7, wybór kartoteki. Testy
   pilnują granic, które kosztują najwięcej, gdy pękną: odczyt nic nie zapisuje
   (zero zapisu przy patrzeniu), cudze dane nie giną po cichu (wersja),
   a zatwierdzenie nie bierze się z niczego (wymaga wyboru). Statusu bez
   nadawcy — `extracting_data` — człowiek ustawić nie może.                  */

let db: typeof import("../db/db.js").db;
let doborRozmowy: typeof import("./dobor.js").doborRozmowy;
let zapiszDane: typeof import("./dobor.js").zapiszDane;
let ustawStatusDoboru: typeof import("./dobor.js").ustawStatusDoboru;
let wybierzKandydata: typeof import("./dobor.js").wybierzKandydata;
let ConversationConflict: typeof import("./conversations.js").ConversationConflict;

let biuro = 0;
let rozmowa = 0;
const SZARPAK = 501;
const SZARPAK_ALT = 502;

before(async () => {
  ({ db } = await import("../db/db.js"));
  ({ doborRozmowy, zapiszDane, ustawStatusDoboru, wybierzKandydata } = await import("./dobor.js"));
  ({ ConversationConflict } = await import("./conversations.js"));
  const d = db();
  d.prepare("INSERT INTO sgt_towar(tw_id,symbol,nazwa) VALUES (?,?,?)").run(SZARPAK, "SZR-148/82", "Szarpak 148 mm");
  d.prepare("INSERT INTO sgt_towar(tw_id,symbol,nazwa) VALUES (?,?,?)").run(SZARPAK_ALT, "SZR-150/82", "Szarpak 150 mm");
});

beforeEach(() => {
  const d = db();
  for (const t of ["dobor_rozmowy", "conversation_event", "message", "conversation",
    "channel_account", "events", "app_user"]) d.prepare(`DELETE FROM ${t}`).run();
  biuro = Number(d.prepare("INSERT INTO app_user(login,name,role) VALUES ('ala','A. Lewandowska','biuro')")
    .run().lastInsertRowid);
  const konto = Number(d.prepare(
    "INSERT INTO channel_account(channel,external_account_id) VALUES ('allegro','seller-a')")
    .run().lastInsertRowid);
  rozmowa = Number(d.prepare(`INSERT INTO conversation(channel_account_id,
    external_conversation_id,subject) VALUES (?,'w-1','zielony_ogrod')`).run(konto).lastInsertRowid);
});

const liczba = (tabela: string) =>
  (db().prepare(`SELECT count(*) n FROM ${tabela}`).get() as { n: number }).n;
const osDoboru = () => (db().prepare(`SELECT event_type FROM conversation_event
  WHERE conversation_id=? AND event_type LIKE 'dobor_%' ORDER BY id`).all(rozmowa) as
  Array<{ event_type: string }>).map((z) => z.event_type);

test("bez wiersza dobór jest `not_started` i odczyt niczego nie zapisuje", () => {
  const d = doborRozmowy(rozmowa);
  assert.equal(d.status, "not_started");
  assert.equal(d.wersja, 1);
  assert.equal(d.wybrany, null);
  assert.equal(liczba("dobor_rozmowy"), 0, "odczyt założył wiersz");
  assert.equal(liczba("events"), 0, "odczyt dopisał zdarzenie");
  assert.throws(() => doborRozmowy(rozmowa + 999), /Nie znaleziono rozmowy/);
});

test("zapis danych podnosi wersję, startuje dobór i zostawia ślad z różnicą pól", () => {
  const d = zapiszDane(rozmowa, { marka: " NAC ", model: "LS 46-450", parametry: { "rozstaw": "82 mm" } }, 1, biuro);
  assert.equal(d.wersja, 2);
  assert.equal(d.dane.marka, "NAC", "wartości są przycinane");
  assert.deepEqual(d.dane.parametry, { rozstaw: "82 mm" });
  /* Wpisana maszyna znaczy, że dobór SIĘ ZACZĄŁ — wiersz z danymi w `not_started`
     nie dostałby plakietki w kolejce. */
  assert.equal(d.status, "searching");
  assert.equal(d.updatedBy, "A. Lewandowska");
  assert.deepEqual(osDoboru(), ["dobor_status_changed"]);
  const audyt = db().prepare("SELECT type, payload FROM events ORDER BY id").all() as
    Array<{ type: string; payload: string }>;
  assert.deepEqual(audyt.map((a) => a.type), ["dobor_dane", "dobor_status"]);
  assert.match(audyt[0].payload, /"marka":\{"z":null,"na":"NAC"\}/);
});

test("zapis bez zmian nie podnosi wersji ani nie zostawia śladu", () => {
  zapiszDane(rozmowa, { marka: "NAC" }, 1, biuro);
  const przed = liczba("events");
  const d = zapiszDane(rozmowa, { marka: "NAC " }, 2, biuro);
  assert.equal(d.wersja, 2);
  assert.equal(liczba("events"), przed);
});

test("nieaktualna wersja to konflikt z bieżącym stanem, nie cichy zapis", () => {
  zapiszDane(rozmowa, { marka: "NAC" }, 1, biuro);
  /* Drugi agent czytał wersję 1 i wpisuje model. Bez tego strażnika jego zapis
     wywróciłby markę koleżanki — jak przy szkicu. */
  assert.throws(() => zapiszDane(rozmowa, { model: "LS 46-450" }, 1, biuro), (e: unknown) => {
    assert.ok(e instanceof ConversationConflict);
    assert.equal(e.details.wersja, 2);
    assert.equal(e.details.updatedBy, "A. Lewandowska");
    return true;
  });
  assert.equal(doborRozmowy(rozmowa).dane.marka, "NAC");
  assert.equal(doborRozmowy(rozmowa).dane.model, null);
});

test("`extracting_data` nie ma nadawcy — człowiek nie może go ustawić", () => {
  assert.throws(() => ustawStatusDoboru(rozmowa, "extracting_data", null, biuro), /Copilot/);
  assert.throws(() => ustawStatusDoboru(rozmowa, "in_progress", null, biuro), /Nieznany status/);
  assert.equal(liczba("dobor_rozmowy"), 0);
});

test("`missing_information` niesie, czego dopytać; wyjście z niego kasuje notatkę", () => {
  let d = ustawStatusDoboru(rozmowa, "missing_information", "pełny numer seryjny", biuro);
  assert.equal(d.status, "missing_information");
  assert.equal(d.brakuje, "pełny numer seryjny");
  assert.equal(d.wersja, 1, "status nie podnosi wersji danych");
  d = ustawStatusDoboru(rozmowa, "searching", null, biuro);
  assert.equal(d.brakuje, null);
  assert.deepEqual(osDoboru(), ["dobor_status_changed", "dobor_status_changed"]);
  const p = JSON.parse(String((db().prepare(
    "SELECT payload FROM conversation_event WHERE event_type='dobor_status_changed' ORDER BY id LIMIT 1")
    .get() as { payload: string }).payload)) as Record<string, unknown>;
  assert.equal(p.przed, "not_started");
  assert.equal(p.po, "missing_information");
  assert.equal(p.autor, "A. Lewandowska");
});

test("zatwierdzenie bez wyboru odbija się — nie ma czego wstawić do szkicu", () => {
  assert.throws(() => ustawStatusDoboru(rozmowa, "confirmed", null, biuro), /wymaga wybranej kartoteki/);
});

test("wybór bierze symbol z bazy, podnosi status i pisze zdanie do szkicu ze źródłem", () => {
  zapiszDane(rozmowa, { marka: "NAC", model: "LS 46-450" }, 1, biuro);
  const d = wybierzKandydata(rozmowa, SZARPAK, "oferta", 2, biuro);
  assert.equal(d.wersja, 3);
  assert.equal(d.status, "candidates_found");
  assert.equal(d.wybrany?.symbol, "SZR-148/82");
  assert.equal(d.wybrany?.przez, "A. Lewandowska");
  /* Zdanie pisze SERWER (§14.3): maszyna, kartoteka i ŹRÓDŁO. Przed
     zatwierdzeniem to przypuszczenie i zdanie ma to mówić. */
  assert.match(d.wybrany!.zdanieDoSzkicu, /^Do NAC LS 46-450 prawdopodobnie pasuje SZR-148\/82 — źródło: kartoteka oferty/);
  const z = ustawStatusDoboru(rozmowa, "confirmed", null, biuro);
  assert.equal(z.wybrany!.zdanieDoSzkicu, "Do NAC LS 46-450 pasuje SZR-148/82 — źródło: kartoteka oferty, o którą pyta klient.");
  assert.deepEqual(osDoboru(), ["dobor_status_changed", "dobor_wybrano", "dobor_status_changed", "dobor_status_changed"]);
});

test("wybór bez wskazanej maszyny mówi, że to przypuszczenie", () => {
  const d = wybierzKandydata(rozmowa, SZARPAK, "wyszukiwarka", 1, biuro);
  assert.match(d.wybrany!.zdanieDoSzkicu, /bez wskazanej maszyny — to przypuszczenie/);
  assert.match(d.wybrany!.zdanieDoSzkicu, /wskazane ręcznie przez agenta/);
});

test("zdjęcie wyboru cofa zatwierdzenie, a nieistniejąca kartoteka i obca droga odbijają się", () => {
  wybierzKandydata(rozmowa, SZARPAK, "oferta", 1, biuro);
  ustawStatusDoboru(rozmowa, "confirmed", null, biuro);
  const d = wybierzKandydata(rozmowa, null, "oferta", 2, biuro);
  assert.equal(d.wybrany, null);
  assert.equal(d.status, "candidates_found", "zatwierdzenie dotyczyło TEJ kartoteki");
  assert.ok(osDoboru().includes("dobor_wybor_zdjety"));

  assert.throws(() => wybierzKandydata(rozmowa, 999999, "oferta", 3, biuro), /Nie ma takiej kartoteki/);
  /* `zastosowanie`, `oem`, `pelnotekst` czekają na E2/E3 — wybór z drogą bez
     nadawcy udawałby dowód, którego panel jeszcze nie ma. */
  assert.throws(() => wybierzKandydata(rozmowa, SZARPAK_ALT, "zastosowanie", 3, biuro), /nie ma w tym wydaniu nadawcy/);
  assert.equal(doborRozmowy(rozmowa).wersja, 3);
});

test("zmiana wyboru na inną kartotekę przy zatwierdzonym doborze cofa do kandydatów", () => {
  wybierzKandydata(rozmowa, SZARPAK, "oferta", 1, biuro);
  ustawStatusDoboru(rozmowa, "confirmed", null, biuro);
  const d = wybierzKandydata(rozmowa, SZARPAK_ALT, "zamiennik", 2, biuro);
  assert.equal(d.status, "candidates_found");
  assert.equal(d.wybrany?.symbol, "SZR-150/82");
});
