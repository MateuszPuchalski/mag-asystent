import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { migratePackIssues } from "./wms-pack-issues.js";
import { integrity } from "../services/wms-analytics.js";

const schema = readFileSync(new URL("./schema.sql", import.meta.url), "utf8");
function oldDatabase() {
  const d = new DatabaseSync(":memory:");
  d.exec(schema);
  d.exec(`CREATE TABLE wms_pack_damage (
    id INTEGER PRIMARY KEY,recovery_id INTEGER NOT NULL REFERENCES wms_pack_recovery(id),
    line_id INTEGER REFERENCES wms_line(id) ON DELETE SET NULL,tw_id INTEGER NOT NULL,sku TEXT NOT NULL,name TEXT NOT NULL,
    quantity INTEGER NOT NULL CHECK(quantity>0),replaced INTEGER NOT NULL DEFAULT 0 CHECK(replaced>=0 AND replaced<=quantity),
    quarantine TEXT NOT NULL,parcel_no INTEGER NOT NULL CHECK(parcel_no BETWEEN 0 AND 20),reason TEXT NOT NULL,user_id INTEGER NOT NULL,created_at TEXT NOT NULL
  );
  INSERT INTO wms_order(id,reference,channel,status,due_at,created_at,updated_at,tote) VALUES (1,'OLD','seeded','packing','2026-09-12','2026-09-12','2026-09-12','BOX');
  INSERT INTO wms_line(id,order_id,tw_id,sku,name,quantity,picked,packed) VALUES (1,1,30,'SKU','Część',3,2,2);
  INSERT INTO wms_pack_recovery(id,order_id,user_id,version,created_at) VALUES (7,1,2,4,'2026-09-12');
  INSERT INTO wms_pack_damage VALUES (9,7,1,30,'SKU','Część',2,1,'QUAR',1,'Pęknięcie',2,'2026-09-12');`);
  return d;
}

test("migracja zachowuje identyfikatory, postęp i kwarantannę starej wymiany oraz usuwa starą tabelę", () => {
  const d = oldDatabase();
  try {
    const before = d.prepare("SELECT * FROM wms_pack_damage").get()!;
    migratePackIssues(d);
    assert.deepEqual(
      { ...d.prepare("SELECT * FROM wms_pack_issue").get() },
      { ...before, kind: "damage" },
    );
    assert.equal(
      d
        .prepare("SELECT 1 FROM sqlite_master WHERE name='wms_pack_damage'")
        .get(),
      undefined,
    );
    assert.equal(
      d.prepare("SELECT version FROM wms_pack_recovery WHERE id=7").get()!
        .version,
      4,
    );
    assert.equal(integrity(d).ok, true);
    const changes = d.prepare("SELECT total_changes() n").get()!.n;
    migratePackIssues(d);
    assert.equal(d.prepare("SELECT total_changes() n").get()!.n, changes);
    assert.deepEqual(d.prepare("PRAGMA foreign_key_check").all(), []);
  } finally {
    d.close();
  }
});

test("nieudana migracja pozostawia całą starą historię, a odczyt starszej kopii niczego nie zapisuje", () => {
  const d = oldDatabase();
  try {
    d.exec(
      "CREATE TEMP TRIGGER fail_issue BEFORE INSERT ON wms_pack_issue BEGIN SELECT RAISE(ABORT,'migration rollback'); END",
    );
    assert.throws(() => migratePackIssues(d), /migration rollback/);
    assert.equal(
      d.prepare("SELECT count(*) n FROM wms_pack_damage").get()!.n,
      1,
    );
    assert.equal(
      d.prepare("SELECT count(*) n FROM wms_pack_issue").get()!.n,
      0,
    );
    d.exec("DROP TRIGGER fail_issue; DROP TABLE wms_pack_issue");
    const changes = d.prepare("SELECT total_changes() n").get()!.n;
    assert.equal(integrity(d).ok, true);
    assert.equal(d.prepare("SELECT total_changes() n").get()!.n, changes);
    d.exec(schema);
    migratePackIssues(d);
    assert.equal(integrity(d).ok, true);
  } finally {
    d.close();
  }
});

test("dwie niepuste historie nie są nadpisywane ani uznawane za poprawną kopię", () => {
  const d = oldDatabase();
  try {
    d.exec(
      "INSERT INTO wms_pack_issue(id,recovery_id,line_id,tw_id,sku,name,quantity,replaced,kind,quarantine,parcel_no,reason,user_id,created_at) SELECT id,recovery_id,line_id,tw_id,sku,name,quantity,replaced,'damage',quarantine,parcel_no,reason,user_id,created_at FROM wms_pack_damage",
    );
    assert.throws(() => migratePackIssues(d), /Dwie historie/);
    assert.throws(() => integrity(d), /Niepełny schemat/);
    assert.equal(
      d.prepare("SELECT count(*) n FROM wms_pack_damage").get()!.n,
      1,
    );
    assert.equal(
      d.prepare("SELECT count(*) n FROM wms_pack_issue").get()!.n,
      1,
    );
    d.exec("BEGIN; ROLLBACK");
  } finally {
    d.close();
  }
});
