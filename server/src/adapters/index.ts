import { config } from "../config.js";
import type { SubiektAdapter } from "./subiekt.js";
import type { SferaAdapter } from "./sfera.js";
import { SeededSubiektAdapter } from "./subiekt.seeded.js";
import { DevSferaAdapter } from "./sfera.dev.js";
import { SqlSferaAdapter } from "./sfera.sql.js";
import { ComSferaAdapter } from "./sfera.com.js";

/**
 * Fabryki adapterów.
 *
 * ODCZYT: zawsze SeededSubiektAdapter na lokalnym read-modelu sgt_*.
 * Różni się tylko źródło zasilenia: SGT_MODE=seeded → seed z mag.xlsx,
 * SGT_MODE=mssql → import z bazy Subiekta (subiekt.mssql.ts, przy starcie
 * API + co MSSQL_SYNC_MS + POST /api/admin/resync).
 *
 * ZAPIS (worker): wg SFERA_MODE — 'dev' (mutacja sgt_*), 'sql' (UPDATE
 * tw_Lokalizacja w MSSQL; MM błąd — edu bez Sfery), 'com' (Sfera, szkielet).
 */
export function makeSubiektAdapter(): SubiektAdapter {
  return new SeededSubiektAdapter();
}

export function makeSferaAdapter(): SferaAdapter {
  switch (config.sferaMode) {
    case "sql":
      return new SqlSferaAdapter();
    case "com":
      return new ComSferaAdapter();
    default:
      return new DevSferaAdapter();
  }
}
