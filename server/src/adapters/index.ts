import { config } from "../config.js";
import type { SubiektAdapter } from "./subiekt.js";
import type { SferaAdapter } from "./sfera.js";
import { SeededSubiektAdapter } from "./subiekt.seeded.js";
import { DevSferaAdapter } from "./sfera.dev.js";
import { MssqlSubiektAdapter } from "./subiekt.mssql.js";
import { ComSferaAdapter } from "./sfera.com.js";

/**
 * Fabryki adapterów. W tym środowisku (SGT_MODE=seeded) używamy implementacji
 * na SQLite. Dla SGT_MODE=mssql należy dostarczyć MssqlSubiektAdapter i
 * ComSferaAdapter (szkielety w subiekt.mssql.ts / sfera.com.ts) — te wymagają
 * maszyny z Subiektem GT + Sferą i nie są uruchamiane w chmurze.
 */
export function makeSubiektAdapter(): SubiektAdapter {
  return config.sgtMode === "mssql" ? new MssqlSubiektAdapter() : new SeededSubiektAdapter();
}

export function makeSferaAdapter(): SferaAdapter {
  return config.sgtMode === "mssql" ? new ComSferaAdapter() : new DevSferaAdapter();
}
