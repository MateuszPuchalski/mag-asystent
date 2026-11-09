import { test } from "node:test";
import assert from "node:assert/strict";
import { config } from "../config.js";
import { etykietyDostaw } from "./subiekt.seeded.js";

/* Tłumaczenie DOK_TYPY_DOSTAW na etykiety read-modelu
   ─────────────────────────────────────────────────────────────────────────
   Read-model trzyma typ dokumentu jako napis ('FZ'/'PZ'), konfiguracja — jako
   kod dok_Typ (1/10). Para ('FZ','PZ') była w zapytaniach seeded ZASZYTA, więc
   zawężenie konfiguracji nie robiło w trybie demo żadnej różnicy: pokaz i
   produkcja pokazywały co innego z tych samych ustawień.                     */

test("domyślna konfiguracja daje samo FZ", () => {
  assert.deepEqual(etykietyDostaw(), ["FZ"]);
});

test("kod PZ tłumaczy się na etykietę PZ", () => {
  const orig = config.mssql.dokTypyDostaw;
  config.mssql.dokTypyDostaw = [config.mssql.dokTypFZ, config.mssql.dokTypPZ];
  try {
    assert.deepEqual(etykietyDostaw(), ["FZ", "PZ"]);
  } finally {
    config.mssql.dokTypyDostaw = orig;
  }
});

test("kod bez nazwy dostaje własny symbol, a nie cudzy", () => {
  /* Kod spoza pary FZ/PZ ZOSTAJE na liście etykiet, spójnie z importerem.
     Inaczej trzeci typ w `DOK_TYPY_DOSTAW` dawałby dokumenty pod CUDZĄ nazwą.

     `TYP-20` jest brzydkie i o to chodzi: widać, że czegoś nie nazwano. Test
     pilnuje ZACHOWANIA przy kodzie bez nazwy, więc przykład się zmienia,
     a asercja nie. */
  const orig = config.mssql.dokTypyDostaw;
  config.mssql.dokTypyDostaw = [config.mssql.dokTypFZ, 20, 22];
  try {
    assert.deepEqual(etykietyDostaw(), ["FZ", "TYP-20", "TYP-22"]);
  } finally {
    config.mssql.dokTypyDostaw = orig;
  }
});
