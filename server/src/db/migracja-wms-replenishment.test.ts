import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { migrate } from "./db.js";

test("dawne pełne uzupełnienia przeżywają dwukrotną migrację bez zmiany ilości", () => {
  const d = new DatabaseSync(":memory:");
  try {
    d.exec(fs.readFileSync(new URL("./schema.sql", import.meta.url), "utf8"));
    d.exec("ALTER TABLE wms_replenishment DROP COLUMN completed_quantity");
    d.exec("ALTER TABLE wms_replenishment DROP COLUMN returned_quantity");
    d.exec("ALTER TABLE wms_replenishment DROP COLUMN target_full");
    d.exec("ALTER TABLE wms_stock DROP COLUMN capacity");
    d.exec(
      "INSERT INTO wms_stock(tw_id,bin,on_hand,minimum) VALUES(30,'A-01',5,3)",
    );
    d.exec(
      "INSERT INTO wms_replenishment(tw_id,source,target,quantity,source_version,target_version,user_id,created_at,completed_at) VALUES (30,'RES-01','A-01',4,1,1,2,'2026-09-12','2026-09-12')",
    );
    migrate(d);
    migrate(d);
    const task = d.prepare("SELECT * FROM wms_replenishment").get()!;
    assert.equal(task.quantity, 4);
    assert.equal(task.completed_quantity, null);
    assert.equal(task.returned_quantity, 0);
    assert.equal(task.target_full, 0);
    const stock = d.prepare("SELECT * FROM wms_stock").get()!;
    assert.equal(stock.capacity, null);
    assert.equal(stock.minimum, 3);
    assert.equal(stock.on_hand, 5);
    assert.equal(task.completed_at, "2026-09-12");
    assert.throws(
      () => d.exec("UPDATE wms_replenishment SET completed_quantity=5"),
      /CHECK/,
    );
    assert.throws(
      () => d.exec("UPDATE wms_replenishment SET completed_quantity=-1"),
      /CHECK/,
    );
    d.exec("UPDATE wms_replenishment SET completed_quantity=0");
    assert.equal(
      d.prepare("SELECT completed_quantity FROM wms_replenishment").get()!
        .completed_quantity,
      0,
    );
  } finally {
    d.close();
  }
});
