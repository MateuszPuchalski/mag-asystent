import type { DatabaseSync } from "node:sqlite";
import { db } from "../db/db.js";
import { GRANICA_OKNA, OKNO } from "./raporty.js";
import {
  PODSTAWY_WYBORU, stanDoboruSql, WYNIKI_DOBORU, type PodstawaWyboru, type WynikDoboru,
} from "./dobor.js";

/**
 * Miary doboru — WYŁĄCZNIE ODCZYT (`docs/dobor-od-zera.md` §5.1).
 *
 * Wyniki i podstawy liczymy z DZIENNIKA (`events`), nie z tabeli `dobor`.
 * Retencja kasuje rozmowy sprzed progu, a tabela wisi na `ON DELETE
 * CASCADE`, więc liczby z niej zmieniałyby się między dwoma odświeżeniami.
 * Dziennik nie ma klucza do rozmowy i przeżywa sprzątanie.
 *
 * Każda rozmowa liczy się RAZ, ostatnim wynikiem w oknie: agent, który
 * zmienił zdanie, zostawia jedną odpowiedź klientowi, nie dwie.
 *
 * Stare zdarzenia wyboru mówią o drogach, nie o podstawach, więc miary
 * liczą wyłącznie `dobor_wynik`. Wynik `null` (dobór otwarty ponownie) nie
 * jest odpowiedzią i do wyników nie wchodzi.
 */

export interface MiaryDoboru {
  dni: number;
  /** Ostatni wynik każdej rozmowy z oknem, z dziennika zdarzeń. */
  wyniki: Record<WynikDoboru, number>;
  /** Podstawy przy wyniku `czesc`. */
  podstawy: Record<PodstawaWyboru, number>;
  /** Stan dziś: rozmowy w stanie `otwarty`. */
  otwarte: number;
}

export function miaryDoboru(dni: number, database: DatabaseSync = db()): MiaryDoboru {
  const wyniki = Object.fromEntries(WYNIKI_DOBORU.map((w) => [w, 0])) as Record<WynikDoboru, number>;
  const podstawy = Object.fromEntries(PODSTAWY_WYBORU.map((p) => [p, 0])) as Record<PodstawaWyboru, number>;
  /* Ostatni PO `id`, nie po czasie: jeden zapis zostawia kilka wierszy
     w tej samej milisekundzie, a `id` rośnie ściśle. */
  const ostatnie = database.prepare(`
    SELECT json_extract(e.payload, '$.po') AS po, json_extract(e.payload, '$.podstawa') AS podstawa
      FROM events e
     WHERE e.id IN (SELECT MAX(id) FROM events
                     WHERE type='dobor_wynik' AND created_at >= ${GRANICA_OKNA}
                     GROUP BY json_extract(payload, '$.conversationId'))`)
    .all(OKNO(dni)) as Array<{ po: string | null; podstawa: string | null }>;
  for (const { po, podstawa } of ostatnie) {
    if (po && po in wyniki) wyniki[po as WynikDoboru] += 1;
    if (po === "czesc" && podstawa && podstawa in podstawy) podstawy[podstawa as PodstawaWyboru] += 1;
  }
  const otwarte = Number((database.prepare(
    `SELECT count(*) n FROM dobor d WHERE ${stanDoboruSql("d")} = 'otwarty'`).get() as { n: number }).n);
  return { dni, wyniki, podstawy, otwarte };
}
