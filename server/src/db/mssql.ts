import sql from "mssql";
import { config } from "../config.js";

/**
 * Pule połączeń do bazy MSSQL Subiekta GT (SGT_MODE=mssql).
 *  • pula ODCZYTU — login read-only (GRANT SELECT na tw__Towar, tw_Stan,
 *    dok__Dokument, dok_Pozycja, kh__Kontrahent), używana przez importer,
 *  • pula ZAPISU — osobny login z GRANT UPDATE wyłącznie na kolumnę
 *    lokalizacji (config.mssql.locColumn, plan B ze spec §9), używana przez
 *    workera.
 * Gdy MSSQL_WRITE_USER nie jest ustawiony, obie pule dzielą login odczytu.
 */
function poolConfig(user: string, password: string): sql.config {
  const c = config.mssql;
  return {
    server: c.server,
    ...(c.port ? { port: c.port } : {}),
    database: c.database,
    user,
    password,
    options: {
      encrypt: c.encrypt,
      trustServerCertificate: c.trustServerCertificate,
      // instancja nazwana (wymaga usługi SQL Server Browser); jawny port ma pierwszeństwo
      ...(c.port ? {} : { instanceName: c.instance }),
    },
    pool: { max: 4, min: 0, idleTimeoutMillis: 30000 },
  };
}

let _read: sql.ConnectionPool | null = null;
let _write: sql.ConnectionPool | null = null;

export async function mssqlRead(): Promise<sql.ConnectionPool> {
  if (_read?.connected) return _read;
  _read = await new sql.ConnectionPool(
    poolConfig(config.mssql.user, config.mssql.password)
  ).connect();
  return _read;
}

export async function mssqlWrite(): Promise<sql.ConnectionPool> {
  const c = config.mssql;
  if (c.writeUser === c.user && c.writePassword === c.password) return mssqlRead();
  if (_write?.connected) return _write;
  _write = await new sql.ConnectionPool(poolConfig(c.writeUser, c.writePassword)).connect();
  return _write;
}

/**
 * Nazwa kolumny wstrzykiwana do zapytania (SELECT/UPDATE) nie da się
 * sparametryzować jak wartość — waliduj jako bezpieczny identyfikator SQL
 * (litery/cyfry/podkreślnik, nie zaczyna się cyfrą), zanim trafi do query.
 */
export function assertSafeColumn(name: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    throw new Error(`Niebezpieczna/nieprawidłowa nazwa kolumny: "${name}"`);
  }
  return name;
}
