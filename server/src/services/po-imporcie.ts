import type { DatabaseSync } from "node:sqlite";
import { db } from "../db/db.js";
import { logEvent } from "./events.js";
import { przebudujIdentyfikatory, przebudujModeleZOpisu } from "./identyfikatory.js";
import { przebudujFts } from "./pelnotekst.js";
import { przebudujTokenySilnikow } from "./tokeny-silnikow.js";
import { przebudujWymiary } from "./wymiary.js";

/**
 * Konsekwencje importu read-modelu (etap E3) — NIE ticker.
 *
 * Import z Subiekta kasuje i odtwarza `sgt_towar` co `MSSQL_SYNC_MS`. Wszystko,
 * co jest POCHODNĄ opisów kartotek, musi powstać od nowa po każdym imporcie:
 * identyfikatory, sekcje „Modele:" do przerobienia i indeks pełnotekstowy.
 * Wołane z `importFromMssql` po commicie, z `seed()` po wstawieniu kartotek
 * i raz przy starcie w `main()`, gdy pochodne są puste. Nigdy z `buildApp()`
 * (testy tras) i nigdy z `migrate()` (jeden właściciel schematu, 0.177.1).
 *
 * Każda przebudowa w osobnym try/catch: pęknięty parser identyfikatorów nie
 * ma prawa zostawić panelu bez indeksu pełnotekstowego. Czas trafia do
 * dziennika, bo budżet to rytm importu — 60 s.
 */
export function poImporcie(database: DatabaseSync = db()): void {
  const start = Date.now();
  const wynik: Record<string, unknown> = {};
  const krok = (nazwa: string, fn: () => unknown) => {
    try { wynik[nazwa] = fn(); }
    catch (e) {
      wynik[nazwa] = { blad: (e as Error).message };
      console.error(`[po-imporcie] ${nazwa}: ${(e as Error).message}`);
    }
  };
  krok("identyfikatory", () => przebudujIdentyfikatory(database));
  krok("modeleZOpisu", () => przebudujModeleZOpisu(database));
  /* Tokeny silników w nazwach (0.239.0): nowa kartoteka z „GX160" w nazwie
     ma wrócić do biura jako `nowa` po najbliższym imporcie. */
  krok("tokenySilnikow", () => przebudujTokenySilnikow(database));
  /* Wymiary z nazw i opisów — paliwo szczebla „zgodne wymiary". */
  krok("wymiary", () => przebudujWymiary(database));
  krok("fts", () => przebudujFts(database) ?? "niedostepne");
  wynik.ms = Date.now() - start;
  logEvent("read_model_po_imporcie", "system", null, wynik, null, database);
}

/**
 * Czy pochodne są puste przy niepustym read-modelu — wtedy start je zakłada.
 *
 * Drugi warunek: ostatnia przebudowa nie znała kroku `wymiary`. Po wdrożeniu
 * szczebla zgodnych wymiarów tabela `wymiar_kartoteki` stałaby pusta do
 * następnego importu, a pusta tabela to szczebel pominięty u klienta. Licznik
 * wierszy nie nadaje się na wartownika — katalog bez wymiarów w nazwach dawałby
 * przebudowę przy każdym starcie. Ostatni wpis audytu mówi prawdę.
 */
export function pochodnePuste(database: DatabaseSync = db()): boolean {
  const n = (sql: string) => Number((database.prepare(sql).get() as { n: number }).n);
  if (n("SELECT count(*) n FROM sgt_towar") === 0) return false;
  if (n("SELECT count(*) n FROM towar_identyfikator") === 0) return true;
  const ostatni = database.prepare(`SELECT payload FROM events WHERE type='read_model_po_imporcie'
      ORDER BY id DESC LIMIT 1`).get() as { payload: string } | undefined;
  return !ostatni || !ostatni.payload.includes('"wymiary"');
}
