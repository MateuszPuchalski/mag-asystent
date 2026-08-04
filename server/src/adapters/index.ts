import { config } from "../config.js";
import type { SferaAdapter } from "./sfera.js";
import { DevSferaAdapter } from "./sfera.dev.js";
import { SqlSferaAdapter } from "./sfera.sql.js";

/**
 * Fabryka adaptera ZAPISU (worker): wynika z SGT_MODE — 'seeded'→dev (mutacja
 * sgt_*), 'mssql'→sql (UPDATE tw_Lokalizacja w MSSQL; MM błąd — edu bez
 * Sfery). Zapis przez Sferę (COM) realizuje osobny proces na Windows —
 * kontrakt w `sfera.ts`.
 *
 * ODCZYT nie ma fabryki: zawsze `SeededSubiektAdapter` na lokalnym
 * read-modelu sgt_* (instancja w `context.ts`).
 */
export function makeSferaAdapter(): SferaAdapter {
  return config.sferaMode === "sql" ? new SqlSferaAdapter() : new DevSferaAdapter();
}
