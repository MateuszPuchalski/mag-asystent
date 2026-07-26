import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "../config.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let _db: Database.Database | null = null;

export function db(): Database.Database {
  if (_db) return _db;
  fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });
  const database = new Database(config.dbPath);
  database.pragma("journal_mode = WAL");
  database.pragma("foreign_keys = ON");
  const schema = fs.readFileSync(path.join(__dirname, "schema.sql"), "utf8");
  database.exec(schema);
  migrate(database);
  _db = database;
  return database;
}

/** Dostawki do istniejących baz (CREATE TABLE IF NOT EXISTS nie dodaje kolumn). */
function migrate(database: Database.Database) {
  const addColumn = (table: string, column: string, decl: string) => {
    const cols = database.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
    if (!cols.some((c) => c.name === column)) {
      database.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${decl}`);
    }
  };
  addColumn("sfera_queue", "session_id", "INTEGER");
  addColumn("putaway_sessions", "source_mag_id", "INTEGER");
  // locki per linia (tryb A: dostawy i zwroty) — kilka osób przy jednym dokumencie
  addColumn("delivery_line", "locked_by", "TEXT");
  addColumn("delivery_line", "locked_at", "TEXT");
  // ostatnia flaga wysłana do Subiekta — rozjazd z sgt_dokument.flaga znaczy,
  // że biuro nadpisało ją poza aplikacją
  addColumn("delivery", "flaga_wyslana", "TEXT");
  addColumn("delivery", "active_at", "TEXT");
  addColumn("sgt_dokument", "flaga", "TEXT");
  // zwroty w trybie A: koszyk jako jednostka pracy + rozliczenie MM per linia
  addColumn("delivery", "source_mag_id", "INTEGER");
  addColumn("delivery_line", "koszyk", "TEXT");
  addColumn("delivery_line", "mm_ilosc", "REAL NOT NULL DEFAULT 0");
  addColumn("delivery_line", "mm_queue_id", "INTEGER");
  // telemetria: który egzemplarz kolektora wygenerował zdarzenie
  addColumn("events", "device_id", "TEXT");
  /* Konta pracowników (§7). `events.user_id` ZOSTAJE jako tekst — to snapshot
     tego, co aplikacja wtedy wiedziała, i jedyny ślad po zdarzeniach sprzed
     kont. Obok dochodzi `user_ref` wskazujące na app_user. Historii się nie
     kasuje ani nie nadpisuje: zdarzenie, którego nie da się przypisać, zostaje
     z `user_ref = NULL`, bo to jest uczciwe, w odróżnieniu od zgadywania. */
  addColumn("events", "user_ref", "INTEGER");
}

/** ISO timestamp UTC (spójny z DEFAULT w schemacie). */
export const nowIso = () => new Date().toISOString();

/** Kolejny numer dokumentu MM (dev; w prod nadaje Subiekt). */
export function nextMmNumber(): string {
  const d = db();
  const row = d
    .prepare("UPDATE counters SET value = value + 1 WHERE name='mm' RETURNING value")
    .get() as { value: number };
  return `${row.value}/07/2026`;
}
