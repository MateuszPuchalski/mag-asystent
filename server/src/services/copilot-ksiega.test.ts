import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { migrate } from "../db/db.js";
import {
  BladKluczaCopilota, BladLacznosciCopilota, BladLimituCopilota,
  BladOdpowiedziCopilota, BladPrzeciazeniaCopilota, kodZatrzymania,
} from "../adapters/copilot.js";
import { kodBledu, sladPorazki, zapiszWKsiedze } from "./copilot-ksiega.js";

/* ── Księga Copilota: jeden pisarz i słownik kodów ───────────────────────────
   Pomiar grupuje porażki po kodzie, więc kod musi wynikać z klasy błędu,
   a nie z tekstu śladu, który pisze dostawca. Pisarz ma zostawić NULL tam,
   gdzie liczby nie zna: zero udawałoby pomiar.                              */

const schema = fs.readFileSync(new URL("../db/schema.sql", import.meta.url), "utf8");
const baza = () => {
  const d = new DatabaseSync(":memory:");
  d.exec(schema);
  migrate(d);
  return d;
};

test("kod błędu wynika z klasy, a odmowa niesie kod nadany tam, gdzie powstała", () => {
  assert.equal(kodBledu(new BladLimituCopilota("x", null)), "limit");
  assert.equal(kodBledu(new BladKluczaCopilota("x")), "klucz");
  assert.equal(kodBledu(new BladPrzeciazeniaCopilota("x", 529, "s")), "przeciazenie");
  assert.equal(kodBledu(new BladLacznosciCopilota("x", "s")), "lacznosc");
  assert.equal(kodBledu(new BladOdpowiedziCopilota("x", 400, "s")), "inny", "odmowa bez nazwy");
  assert.equal(kodBledu(new BladOdpowiedziCopilota("x", 200, "", "uciety")), "uciety");
  assert.equal(kodBledu(new BladOdpowiedziCopilota("x", 200, "za_dlugi", "za_dlugi")), "za_dlugi");
  assert.equal(kodBledu(new Error("obcy")), "inny");
  assert.equal(kodBledu("napis"), "inny");
});

test("stop_reason bez wyniku: ucięcie i odmowa mają własne kody, reszta to inny", () => {
  assert.equal(kodZatrzymania("max_tokens"), "uciety");
  assert.equal(kodZatrzymania("refusal"), "odmowa");
  assert.equal(kodZatrzymania("end_turn"), "inny");
  assert.equal(kodZatrzymania(null), "inny");
});

test("zapis oddaje id wiersza i liczy twierdzenia, a braki zostawia jako NULL", () => {
  const d = baza();
  const at = new Date("2026-10-21T08:00:00Z");
  const pierwszy = zapiszWKsiedze(d, {
    zadanie: "szkic", model: "claude-opus-5", wynik: "ok", przezUserId: null, at,
    zuzycie: { wej: 10, wyj: 2, cacheZapis: 0, cacheOdczyt: 5 }, ms: 120,
    kodBledu: null, wersjaInstrukcji: "s1", zrodlo: "takt", rund: 2, narzedzi: 1,
    twierdzenia: [
      { zrodlo: "fakty", obnizona: false },
      { zrodlo: "model", obnizona: true },
      { zrodlo: "oferta", obnizona: false },
    ],
    kategoria: "ORDER_STATUS",
  });
  const drugi = zapiszWKsiedze(d, {
    zadanie: "szkic", model: "", wynik: "blad", przezUserId: null, at,
    blad: "x".repeat(400), kodBledu: "maskowanie",
  });
  assert.ok(pierwszy > 0);
  assert.equal(drugi, pierwszy + 1, "id to klucz nowego wiersza");

  const w = d.prepare(`SELECT kod_bledu, wersja_instrukcji, zrodlo, rund, narzedzi, twierdzen,
      twierdzen_obnizonych, twierdzen_spoza_faktow, kategoria, ms, tokeny_cache_odczyt
      FROM copilot_wywolanie WHERE id=?`).get(pierwszy) as Record<string, unknown>;
  assert.deepEqual({ ...w }, {
    kod_bledu: null, wersja_instrukcji: "s1", zrodlo: "takt", rund: 2, narzedzi: 1,
    twierdzen: 3, twierdzen_obnizonych: 1, twierdzen_spoza_faktow: 2,
    kategoria: "ORDER_STATUS", ms: 120, tokeny_cache_odczyt: 5,
  });

  const b = d.prepare(`SELECT blad, kod_bledu, ms, tokeny_wej, wersja_instrukcji, zrodlo, rund,
      twierdzen, twierdzen_spoza_faktow, kategoria FROM copilot_wywolanie WHERE id=?`)
    .get(drugi) as Record<string, unknown>;
  assert.equal(String(b.blad).length, 300, "ślad ucięty do 300 znaków");
  assert.deepEqual({ ...b, blad: null }, {
    blad: null, kod_bledu: "maskowanie", ms: null, tokeny_wej: 0, wersja_instrukcji: null,
    zrodlo: null, rund: null, twierdzen: null, twierdzen_spoza_faktow: null, kategoria: null,
  });
  d.close();
});

test("ślad porażki czyta tylko to, co adapter dopiął, i nie zmyśla reszty", () => {
  const wyniki = [{ id: "N1", nazwa: "karta_towaru", argument: "GAZ-1", tresc: "Kartoteka GAZ-1" }];
  const e = Object.assign(new Error("x"), {
    zuzycie: { wej: 1, wyj: 1, cacheZapis: 0, cacheOdczyt: 0 }, rund: 3, narzedzi: 2, wersjaInstrukcji: "s1",
    wynikiNarzedzi: wyniki,
  });
  assert.deepEqual(sladPorazki(e), {
    zuzycie: { wej: 1, wyj: 1, cacheZapis: 0, cacheOdczyt: 0 }, rund: 3, narzedzi: 2, wersjaInstrukcji: "s1",
    wynikiNarzedzi: wyniki,
  });
  assert.deepEqual(sladPorazki(new Error("goły")), {
    zuzycie: undefined, rund: undefined, narzedzi: undefined, wersjaInstrukcji: undefined,
    wynikiNarzedzi: undefined,
  });
  /* Coś, co nie jest listą, nie udaje wyników narzędzi. */
  assert.equal(sladPorazki(Object.assign(new Error("y"), { wynikiNarzedzi: "N1" })).wynikiNarzedzi, undefined);
  assert.deepEqual(sladPorazki(null).rund, undefined);
});
