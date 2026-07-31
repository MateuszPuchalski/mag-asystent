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

test("kod spoza pary FZ/PZ wypada, zamiast trafić do SQL jako null", () => {
  // null w `IN (?)` nie dopasowałby niczego i lista dostaw milczkiem opustoszałaby.
  const orig = config.mssql.dokTypyDostaw;
  config.mssql.dokTypyDostaw = [config.mssql.dokTypFZ, 14, 15];
  try {
    assert.deepEqual(etykietyDostaw(), ["FZ"]);
  } finally {
    config.mssql.dokTypyDostaw = orig;
  }
});
