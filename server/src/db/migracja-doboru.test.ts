import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { migrate } from "./db.js";

/* ── Tabela `dobor` i jednorazowa kopia starego doboru ───────────────────────
   Dwie umowy. Kształt tabeli pilnuje reguł, których żaden zapis nie ma prawa
   ominąć: jedna rozmowa = jeden dobór, wynik z listy, „ta część" z kartoteką.
   Migracja przenosi stary dobór raz, tłumacząc status i drogę na wynik
   i podstawę, a starej tabeli nie rusza — powrót do poprzedniej wersji musi
   zastać jej dane. `dopasowanie` dalej znika, bo to nazwa spalona.        */

const schema = fs.readFileSync(new URL("./schema.sql", import.meta.url), "utf8");

/* Stara tabela w ostatnim kształcie z produkcji. W schemacie jej już nie ma,
   więc test stawia ją sam — tak, jak zastanie ją migracja u klienta. */
const STARA = `CREATE TABLE dobor_rozmowy (
  conversation_id INTEGER PRIMARY KEY REFERENCES conversation(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'not_started', wersja INTEGER NOT NULL DEFAULT 1,
  marka TEXT, model TEXT, wariant TEXT, rocznik TEXT, nr_seryjny TEXT, silnik TEXT, oem TEXT, nazwa_czesci TEXT,
  parametry_json TEXT, brakuje TEXT, wybrany_tw_id INTEGER, wybrany_symbol TEXT, wybrany_droga TEXT,
  wybrano_przez TEXT, wybrano_user_id INTEGER, wybrano_at TEXT,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), updated_by TEXT, updated_user_id INTEGER
)`;

function baza(zeStara = false) {
  const d = new DatabaseSync(":memory:");
  d.exec(schema);
  if (zeStara) d.exec(STARA);
  d.exec("INSERT INTO channel_account(channel,external_account_id) VALUES ('allegro','a')");
  for (let i = 1; i <= 9; i++) {
    d.prepare("INSERT INTO conversation(channel_account_id,external_conversation_id) VALUES (1,?)").run(`w-${i}`);
  }
  return d;
}

const istnieje = (d: DatabaseSync, tabela: string) =>
  Boolean(d.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(tabela));

test("nowa baza ma `dobor`, nie ma starej tabeli, a spalona nazwa nadal znika", () => {
  const d = baza();
  migrate(d);
  assert.equal(istnieje(d, "dobor"), true, "dobor musi przeżyć migrate()");
  assert.equal(istnieje(d, "dobor_rozmowy"), false, "nowa baza nie zakłada tabeli, której nic nie czyta");
  assert.equal(istnieje(d, "dopasowanie"), false, "dopasowanie to nazwa spalona");
  d.close();
});

test("CHECK: wynik i podstawa z listy, „ta część” bez kartoteki odbija się", () => {
  const d = baza();
  migrate(d);
  const wstaw = (kol: string, ...v: unknown[]) =>
    d.prepare(`INSERT INTO dobor(conversation_id,${kol}) VALUES (1,${v.map(() => "?").join(",")})`).run(...v as never[]);
  assert.throws(() => wstaw("wynik", "pasuje"), /CHECK/);
  assert.throws(() => wstaw("wynik,tw_id,podstawa", "czesc", 5, "wymiar"), /CHECK/);
  assert.throws(() => wstaw("wynik", "czesc"), /CHECK/, "wynik bez kartoteki nie ma czego wstawić do odpowiedzi");
  for (const wynik of ["brak", "dopytac", "nie_dotyczy", null]) {
    d.prepare("DELETE FROM dobor").run();
    wstaw("wynik", wynik);
  }
  d.prepare("DELETE FROM dobor").run();
  wstaw("wynik,tw_id,podstawa", "czesc", 999999, "reczny");
  /* Jedna rozmowa = jeden dobór; bez klucza do `sgt_towar`, bo read-model
     odtwarza się przy każdym imporcie. */
  assert.throws(() => wstaw("wynik", "brak"), /UNIQUE|PRIMARY/);
  d.exec("PRAGMA foreign_keys = ON");
  d.prepare("DELETE FROM conversation WHERE id=1").run();
  assert.equal((d.prepare("SELECT count(*) n FROM dobor").get() as { n: number }).n, 0, "kaskada z rozmowy");
  d.close();
});

test("kopia tłumaczy status i drogę na wynik i podstawę — raz, a starej tabeli nie rusza", () => {
  const d = baza(true);
  const stary = d.prepare(`INSERT INTO dobor_rozmowy(conversation_id,status,wersja,marka,model,brakuje,
    wybrany_tw_id,wybrany_symbol,wybrany_droga,updated_by,updated_user_id,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`);
  const T = "2026-09-01T08:00:00Z";
  stary.run(1, "confirmed", 7, "NAC", "LS 46-450", null, 501, "SZR", "zastosowanie", "Ala", null, T);
  stary.run(2, "candidates_found", 3, "NAC", null, null, 502, "SZR2", "wyszukiwarka", "Ala", null, T);
  stary.run(3, "rejected", 2, null, null, null, 503, "X", "symbol", "Ala", null, T);
  stary.run(4, "missing_information", 2, null, null, "numer z tabliczki", null, null, null, "Ala", null, T);
  stary.run(5, "missing_information", 2, null, null, "  ", null, null, null, "Ala", null, T);
  stary.run(6, "not_applicable", 2, null, null, null, null, null, null, "Ala", null, T);
  stary.run(7, "searching", 2, "STIGA", null, null, null, null, null, "automat (szkic)", null, T);
  stary.run(8, "confirmed", 4, null, null, null, 504, "Y", "pelnotekst", "Ala", null, T);
  stary.run(9, "missing_information", 5, null, null, "tabliczka", 505, "Z", "oferta", "Ala", null, T);

  migrate(d);
  const w = (id: number) => d.prepare(`SELECT wynik, tw_id, symbol, podstawa, dopytac, wersja, marka, zmienil,
    zmieniono_at FROM dobor WHERE conversation_id=?`).get(id) as Record<string, unknown>;
  assert.deepEqual({ ...w(1) }, { wynik: "czesc", tw_id: 501, symbol: "SZR", podstawa: "wiedza", dopytac: null,
    wersja: 7, marka: "NAC", zmienil: "Ala", zmieniono_at: T });
  assert.deepEqual([w(2).wynik, w(2).podstawa], ["czesc", "reczny"], "wybór bez zatwierdzenia to też wybrana część");
  assert.deepEqual([w(3).wynik, w(3).tw_id], ["brak", null], "odrzucony dobór nie niesie kartoteki");
  assert.deepEqual([w(4).wynik, w(4).dopytac], ["dopytac", "numer z tabliczki"]);
  assert.equal(w(5).dopytac, "czego brakuje — nie zapisano", "pusty powód nie może złamać reguły „dopytać ze zdaniem”");
  assert.equal(w(6).wynik, "nie_dotyczy");
  assert.deepEqual([w(7).wynik, w(7).marka], [null, "STIGA"]);
  assert.equal(w(8).podstawa, "podobne");
  assert.deepEqual([w(9).wynik, w(9).podstawa, w(9).dopytac], ["czesc", "numer", null]);

  /* Druga migracja nic nie kopiuje: nowy zapis nie może zostać nadpisany. */
  d.prepare("UPDATE dobor SET marka='Husqvarna' WHERE conversation_id=1").run();
  migrate(d);
  assert.equal(w(1).marka, "Husqvarna");
  assert.equal((d.prepare("SELECT count(*) n FROM dobor").get() as { n: number }).n, 9);
  assert.equal((d.prepare("SELECT count(*) n FROM dobor_rozmowy").get() as { n: number }).n, 9, "stara tabela nietknięta");
  d.close();
});

test("kopia znosi starszy kształt starej tabeli — brakująca kolumna daje NULL, nie błąd startu", () => {
  const d = baza();
  d.exec(`CREATE TABLE dobor_rozmowy (conversation_id INTEGER PRIMARY KEY, status TEXT NOT NULL,
    wersja INTEGER NOT NULL DEFAULT 1, marka TEXT, model TEXT, wybrany_tw_id INTEGER, wybrany_symbol TEXT)`);
  d.prepare("INSERT INTO dobor_rozmowy(conversation_id,status,marka,wybrany_tw_id,wybrany_symbol) VALUES (1,'confirmed','NAC',501,'SZR')").run();
  migrate(d);
  const w = d.prepare("SELECT wynik, podstawa, marka, zmienil FROM dobor").get() as Record<string, unknown>;
  assert.deepEqual({ ...w }, { wynik: "czesc", podstawa: "reczny", marka: "NAC", zmienil: null });
  d.close();
});
