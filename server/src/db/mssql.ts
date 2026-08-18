import sql from "mssql";
import { config } from "../config.js";

/**
 * JEDNA pula połączeń do bazy MSSQL Subiekta GT (SGT_MODE=mssql), jeden login.
 *
 * Login `wertis` dostaje minimalny zakres uprawnień — pełny skrypt
 * w docs/subiekt-gt-edu-setup.md:
 *  • GRANT SELECT: tw__Towar, tw_Stan, dok__Dokument, dok_Pozycja,
 *    kh__Kontrahent, sl_Magazyn,
 *  • GRANT UPDATE na JEDNĄ kolumnę: lokalizacja na tw__Towar
 *    (config.mssql.locColumn) — i to jest CAŁY zakres zapisu.
 * Nawet przy przejęciu credentiala reszta bazy pozostaje nietykalna, a jeden
 * login to jedna rzecz do założenia i jedna do pilnowania.
 */
function poolConfig(): sql.config {
  const c = config.mssql;
  return {
    server: c.server,
    ...(c.port ? { port: c.port } : {}),
    database: c.database,
    user: c.user,
    password: c.password,
    /* Limit pojedynczego zapytania. Domyślne 15 s drivera nigdy nie było tu
       świadomą decyzją, a import to odczyt wsadowy: samo tw_Stan potrafi mieć
       sto tysięcy wierszy i na obciążonej maszynie 15 s bywa za mało —
       wdrożenie 0.53.0 ścinało tak odczyt sprzedaży (0.53.1). */
    requestTimeout: c.requestTimeoutMs,
    options: {
      encrypt: c.encrypt,
      trustServerCertificate: c.trustServerCertificate,
      // instancja nazwana (wymaga usługi SQL Server Browser); jawny port ma pierwszeństwo
      ...(c.port ? {} : { instanceName: c.instance }),
    },
    pool: { max: 4, min: 0, idleTimeoutMillis: 30000 },
  };
}

let _pool: sql.ConnectionPool | null = null;

export async function mssqlPool(): Promise<sql.ConnectionPool> {
  if (_pool?.connected) return _pool;
  _pool = await new sql.ConnectionPool(poolConfig()).connect();
  return _pool;
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
