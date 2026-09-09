import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { migrate } from "./db.js";

/* ── Pasowanie części i kolejne drogi doboru przeżywają migrację ────────────
   `CHECK` na `dobor_rozmowy.wybrany_droga` stoi wyłącznie w `schema.sql`.
   Bazy sprzed 0.229.0 znają osiem dróg, z 0.229.0 — dziewięć, z 0.230.0 —
   dziesięć; szczebel zgodnych wymiarów dokłada jedenastą. Jedna funkcja ma
   doprowadzić KAŻDY kształt do docelowego jedną przebudową — klient, który
   przeskoczy kilka wydań, nie może przebudowywać tabeli kilka razy.         */

const schema = fs.readFileSync(new URL("./schema.sql", import.meta.url), "utf8");

function bazaZDrogami(drogi: string[]) {
  const d = new DatabaseSync(":memory:");
  d.exec(schema);
  d.exec("DROP TABLE dobor_rozmowy");
  d.exec(`CREATE TABLE dobor_rozmowy (
    conversation_id INTEGER PRIMARY KEY REFERENCES conversation(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'not_started' CHECK (status IN (
      'not_started','extracting_data','missing_information','searching',
      'candidates_found','requires_expert','confirmed','rejected','not_applicable')),
    wersja INTEGER NOT NULL DEFAULT 1,
    marka TEXT, model TEXT, wariant TEXT, rocznik TEXT, nr_seryjny TEXT, silnik TEXT,
    oem TEXT, nazwa_czesci TEXT, parametry_json TEXT, brakuje TEXT,
    wybrany_tw_id INTEGER, wybrany_symbol TEXT,
    wybrany_droga TEXT CHECK (wybrany_droga IS NULL OR wybrany_droga IN (${drogi.map((x) => `'${x}'`).join(",")})),
    wybrano_przez TEXT, wybrano_user_id INTEGER REFERENCES app_user(user_id), wybrano_at TEXT,
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_by TEXT, updated_user_id INTEGER REFERENCES app_user(user_id)
  )`);
  d.exec(`INSERT INTO channel_account(channel,external_account_id) VALUES ('allegro','a');
    INSERT INTO conversation(channel_account_id,external_conversation_id) VALUES (1,'w-1');`);
  return d;
}
const OSIEM = ["oferta", "zamiennik", "symbol", "ean", "wyszukiwarka", "zastosowanie", "oem", "pelnotekst"];
const DZIEWIEC = [...OSIEM.slice(0, 6), "silnik", ...OSIEM.slice(6)];
/* Kształt z produkcji między 0.230.0 a szczeblem zgodnych wymiarów. */
const DZIESIEC = [...DZIEWIEC.slice(0, 7), "pasowanie", ...DZIEWIEC.slice(7)];
const sqlTabeli = (d: DatabaseSync) =>
  (d.prepare("SELECT sql FROM sqlite_master WHERE name='dobor_rozmowy'").get() as { sql: string }).sql;

test("pasowanie_czesci przeżywa kasatę nakładek, a spalona nazwa nadal znika", () => {
  const d = bazaZDrogami(DZIEWIEC);
  migrate(d);
  const jest = (t: string) => Boolean(d.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(t));
  assert.equal(jest("pasowanie_czesci"), true);
  assert.equal(jest("dopasowanie"), false);
  d.close();
});

for (const [nazwa, drogi] of [["ośmioma", OSIEM], ["dziewięcioma", DZIEWIEC], ["dziesięcioma", DZIESIEC]] as const) {
  test(`baza z ${nazwa} drogami po JEDNEJ migracji przyjmuje pasowanie i wymiar, odrzuca wymyśloną i nie gubi pól`, () => {
    const d = bazaZDrogami([...drogi]);
    const wiersz = { conversation_id: 1, status: "candidates_found", wersja: 7, marka: "NAC", model: "LS 46-450",
      silnik: "B&S 450E", oem: "W09-0211", nazwa_czesci: "uszczelka", parametry_json: "{}", brakuje: "x",
      wybrany_tw_id: 501, wybrany_symbol: "SZR", wybrany_droga: "zastosowanie", wybrano_przez: "Ala",
      wybrano_at: "2026-09-01T07:00:00Z", updated_at: "2026-09-01T08:00:00Z", updated_by: "Ala" } as Record<string, string | number>;
    const kol = Object.keys(wiersz);
    d.prepare(`INSERT INTO dobor_rozmowy(${kol.join(",")}) VALUES (${kol.map(() => "?").join(",")})`).run(...Object.values(wiersz));
    assert.throws(() => d.prepare("UPDATE dobor_rozmowy SET wybrany_droga='wymiar'").run(), /CHECK/);

    migrate(d);
    const poPierwszej = sqlTabeli(d);
    d.prepare("UPDATE dobor_rozmowy SET wybrany_droga='pasowanie'").run();
    d.prepare("UPDATE dobor_rozmowy SET wybrany_droga='silnik'").run();
    d.prepare("UPDATE dobor_rozmowy SET wybrany_droga='wymiar'").run();
    assert.throws(() => d.prepare("UPDATE dobor_rozmowy SET wybrany_droga='semantyka'").run(), /CHECK/);
    const po = d.prepare("SELECT * FROM dobor_rozmowy WHERE conversation_id=1").get() as Record<string, unknown>;
    for (const k of kol) if (k !== "wybrany_droga") assert.equal(String(po[k]), String(wiersz[k]), `zgubiona kolumna ${k}`);

    migrate(d);
    assert.equal(sqlTabeli(d), poPierwszej, "druga migracja nie przebudowuje");
    d.close();
  });
}

test("przebudowa odtwarza ON DELETE CASCADE", () => {
  const d = bazaZDrogami(DZIEWIEC);
  d.prepare("INSERT INTO dobor_rozmowy(conversation_id,marka) VALUES (1,'STIGA')").run();
  migrate(d);
  d.exec("PRAGMA foreign_keys = ON");
  d.prepare("DELETE FROM conversation WHERE id=1").run();
  assert.equal((d.prepare("SELECT count(*) n FROM dobor_rozmowy").get() as { n: number }).n, 0);
  d.close();
});

test("CHECK-i pasowania są zamknięte dokumentem", () => {
  const d = bazaZDrogami(DZIEWIEC);
  migrate(d);
  const wstaw = (tw: number, doTw: number, rola: string, pol: string, powod: string | null, zrodlo: string, dowod: string) =>
    d.prepare(`INSERT INTO pasowanie_czesci(tw_id,tw_symbol,do_tw_id,do_tw_symbol,rola,polaryzacja,powod_negatywny,
      zrodlo_propozycji,rodzaj_dowodu,dowod_tresc,zaproponowal) VALUES (?,'A',?,'B',?,?,?,?,?,'x','Ala')`)
      .run(tw, doTw, rola, pol, powod, zrodlo, dowod);
  assert.throws(() => wstaw(1, 2, "podkladka", "pasuje", null, "reczne", "producent"), /CHECK/, "rola spoza listy");
  assert.throws(() => wstaw(1, 2, "uszczelka", "moze", null, "reczne", "producent"), /CHECK/);
  assert.throws(() => wstaw(1, 2, "uszczelka", "nie_pasuje", null, "reczne", "producent"), /CHECK/, "negatyw bez powodu");
  assert.throws(() => wstaw(1, 2, "uszczelka", "pasuje", "nie_pasuje", "reczne", "producent"), /CHECK/, "pozytyw z powodem");
  assert.throws(() => wstaw(1, 2, "uszczelka", "pasuje", null, "ai", "producent"), /CHECK/);
  assert.throws(() => wstaw(1, 1, "uszczelka", "pasuje", null, "reczne", "producent"), /CHECK/, "część do samej siebie");
  for (const rola of ["uszczelka", "membrana", "zestaw_naprawczy", "lacznik", "element_zestawu", "inne"]) wstaw(1, 2, rola, "pasuje", null, "reczne", "producent");
  for (const z of ["reczne", "dobor", "opis", "copilot"]) wstaw(1, 2, "uszczelka", "pasuje", null, z, "rozmowa");
  d.close();
});
