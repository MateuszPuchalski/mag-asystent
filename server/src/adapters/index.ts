import { config } from "../config.js";
import type { SubiektAdapter } from "./subiekt.js";
import type { SferaAdapter } from "./sfera.js";
import { SeededSubiektAdapter } from "./subiekt.seeded.js";
import { DevSferaAdapter } from "./sfera.dev.js";
import { SqlSferaAdapter } from "./sfera.sql.js";

/**
 * Fabryki adapterów.
 *
 * ODCZYT: zawsze SeededSubiektAdapter na lokalnym read-modelu sgt_*.
 * Różni się tylko źródło zasilenia: SGT_MODE=seeded → seed z mag.xlsx,
 * SGT_MODE=mssql → import z bazy Subiekta (subiekt.mssql.ts, przy starcie
 * API + co MSSQL_SYNC_MS + POST /api/admin/resync).
 *
 * ZAPIS (worker): wg SFERA_MODE — 'dev' (mutacja sgt_*) albo 'sql' (UPDATE
 * tw_Lokalizacja w MSSQL; MM błąd — edu bez Sfery). Zapis przez Sferę (COM)
 * realizuje osobny proces na Windows — kontrakt w `sfera.ts`.
 */
export function makeSubiektAdapter(): SubiektAdapter {
  return new SeededSubiektAdapter();
}

export function makeSferaAdapter(): SferaAdapter {
  return config.sferaMode === "sql" ? new SqlSferaAdapter() : new DevSferaAdapter();
}
