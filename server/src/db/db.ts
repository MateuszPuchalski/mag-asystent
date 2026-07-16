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
  _db = database;
  return database;
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
