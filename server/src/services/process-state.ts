import { db, nowIso } from "../db/db.js";
import { config } from "../config.js";

/* ── Meldunek procesu i wykrywanie rozjazdu konfiguracji ─────────────────────
   API i worker to osobne procesy. Gdy worker nie dostanie `SGT_MODE=mssql`,
   dostaje adapter demo: pisze do lokalnego SQLite, oznacza zadanie jako `done`
   i NIE ZGŁASZA BŁĘDU. Na kolektorze zielono, w Subiekcie zero zmian — awaria
   bez jednego objawu, ciągnąca się tygodniami.

   Zalecana w dokumentacji weryfikacja `curl /api/health` nie mogła tego
   wykryć, bo raportowała wyłącznie proces API. Stąd ten meldunek: każdy proces
   zapisuje swój tryb, a `/api/health` je porównuje.                           */

export type NazwaProcesu = "api" | "worker";

/** Po ilu sekundach bez meldunku uznajemy proces za martwy. */
const MARTWY_PO_S = 30;

export function zamelduj(name: NazwaProcesu): void {
  db()
    .prepare(
      `INSERT INTO process_state (name, pid, sgt_mode, sfera_mode, at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(name) DO UPDATE SET
         pid = excluded.pid, sgt_mode = excluded.sgt_mode,
         sfera_mode = excluded.sfera_mode, at = excluded.at`,
    )
    .run(name, process.pid, config.sgtMode, config.sferaMode, nowIso());
}

export interface StanWorkera {
  /** null = worker nigdy nie wystartował na tej bazie. */
  widziany: string | null;
  zyje: boolean;
  sgtMode: string | null;
  /** Czy worker pracuje w tym samym trybie co API. */
  zgodny: boolean;
  /** Zdanie dla człowieka; null = wszystko w porządku. */
  problem: string | null;
}

export function stanWorkera(): StanWorkera {
  const row = db()
    .prepare("SELECT pid, sgt_mode, at FROM process_state WHERE name = 'worker'")
    .get() as { pid: number; sgt_mode: string; at: string } | undefined;

  if (!row) {
    return {
      widziany: null,
      zyje: false,
      sgtMode: null,
      zgodny: false,
      problem:
        "Worker nigdy nie wystartował na tej bazie — zadania zapisu do Subiekta nie będą wykonywane.",
    };
  }

  const wiek = (Date.now() - Date.parse(row.at)) / 1000;
  const zyje = Number.isFinite(wiek) && wiek < MARTWY_PO_S;
  const zgodny = row.sgt_mode === config.sgtMode;

  /* Kolejność jest ważna: martwy worker zgłaszamy przed rozjazdem trybu, bo
     przy zatrzymanym procesie tryb i tak nic nie znaczy. */
  let problem: string | null = null;
  if (!zyje) {
    problem = `Worker nie melduje się od ${Math.round(wiek)} s — sprawdź, czy usługa wertis-worker działa.`;
  } else if (!zgodny) {
    problem =
      `ROZJAZD KONFIGURACJI: API pracuje w trybie ${config.sgtMode}, worker w ${row.sgt_mode}. ` +
      "Zapisy trafiają do innego miejsca, niż pokazuje aplikacja — oba procesy muszą czytać ten sam wertis.env.";
  }

  return { widziany: row.at, zyje, sgtMode: row.sgt_mode, zgodny, problem };
}
