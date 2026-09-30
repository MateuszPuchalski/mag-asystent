import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { migrate } from "./db.js";

/* ── Pasowanie części przeżywa migrację ──────────────────────────────────────
   Nowa tabela ma przeżyć kasatę nakładek, a spalone nazwy dalej znikać.   */

const schema = fs.readFileSync(new URL("./schema.sql", import.meta.url), "utf8");

function bazaPoSchemacie() {
  const d = new DatabaseSync(":memory:");
  d.exec(schema);
  d.exec(`INSERT INTO channel_account(channel,external_account_id) VALUES ('allegro','a');
    INSERT INTO conversation(channel_account_id,external_conversation_id) VALUES (1,'w-1');`);
  return d;
}

test("pasowanie_czesci przeżywa kasatę nakładek, a spalona nazwa nadal znika", () => {
  const d = bazaPoSchemacie();
  migrate(d);
  const jest = (t: string) => Boolean(d.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(t));
  assert.equal(jest("pasowanie_czesci"), true);
  assert.equal(jest("dopasowanie"), false);
  d.close();
});

test("CHECK-i pasowania są zamknięte dokumentem", () => {
  const d = bazaPoSchemacie();
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
