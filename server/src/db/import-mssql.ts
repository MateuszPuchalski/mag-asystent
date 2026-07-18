import { importFromMssql } from "../adapters/subiekt.mssql.js";
import { config } from "../config.js";

/**
 * Jednorazowy import read-modelu sgt_* z bazy MSSQL Subiekta GT.
 * Użycie (na maszynie z Subiektem, po ustawieniu env MSSQL_*):
 *   npm run import:mssql
 */
async function main() {
  console.log(
    `[import:mssql] ${config.mssql.server}${config.mssql.port ? ":" + config.mssql.port : "\\" + config.mssql.instance} · baza=${config.mssql.database} · user=${config.mssql.user}`
  );
  const stats = await importFromMssql();
  console.log(`[import:mssql] gotowe (${stats.at}).`);
  process.exit(0);
}

main().catch((e) => {
  console.error("[import:mssql] błąd:", e instanceof Error ? e.message : e);
  process.exit(1);
});
