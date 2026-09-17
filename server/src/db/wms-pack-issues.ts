import type { DatabaseSync } from "node:sqlite";

/** Wspólna historia rozróżnia fizyczną kwarantannę od potwierdzonego braku bez pozornego przyjęcia zapasu. */
export function migratePackIssues(database: DatabaseSync) {
  const oldExists = () =>
    database
      .prepare(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name='wms_pack_damage'",
      )
      .get();
  if (!oldExists()) return;
  database.exec("BEGIN IMMEDIATE");
  try {
    // Drugi proces mógł zakończyć migrację podczas oczekiwania na blokadę.
    if (oldExists()) {
      if (database.prepare("SELECT 1 FROM wms_pack_issue LIMIT 1").get())
        throw new Error(
          "Dwie historie wymian WMS wymagają wyjaśnienia przed migracją",
        );
      database.exec(`INSERT INTO wms_pack_issue(id,recovery_id,line_id,tw_id,sku,name,quantity,replaced,kind,quarantine,parcel_no,reason,user_id,created_at)
        SELECT id,recovery_id,line_id,tw_id,sku,name,quantity,replaced,'damage',quarantine,parcel_no,reason,user_id,created_at FROM wms_pack_damage;
        DROP TABLE wms_pack_damage;`);
    }
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}
