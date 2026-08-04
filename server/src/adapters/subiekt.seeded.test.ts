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
  /* Do 0.22.1 ta asercja brzmiała odwrotnie: kod spoza pary FZ/PZ WYPADAŁ
     z listy etykiet. Zachowanie było spójne samo ze sobą, ale nie z importerem,
     który ten sam kod zapisywał do read-modelu jako „PZ" — bo miał gałąź
     `else`, nie filtr. Dopisanie trzeciego typu do `DOK_TYPY_DOSTAW` dawało
     więc dokumenty pod CUDZĄ nazwą, bez jednego słowa błędu po drodze.

     `TYP-14` jest brzydkie i o to chodzi: widać, że czegoś nie nazwano. */
  const orig = config.mssql.dokTypyDostaw;
  config.mssql.dokTypyDostaw = [config.mssql.dokTypFZ, 14, 20];
  try {
    assert.deepEqual(etykietyDostaw(), ["FZ", "TYP-14", "TYP-20"]);
  } finally {
    config.mssql.dokTypyDostaw = orig;
  }
});
