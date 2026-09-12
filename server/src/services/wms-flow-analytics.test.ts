import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { flowAnalytics, confirmedDispatch } from "./wms-flow-analytics.js";
import { reportDay, reportDays, registerReportDay } from "./wms-report-time.js";

let d: DatabaseSync;
const since = "2026-09-01T00:00:00.000Z",
  now = "2026-09-02T12:00:00.000Z";
beforeEach(() => {
  d = new DatabaseSync(":memory:");
  d.exec(readFileSync(new URL("../db/schema.sql", import.meta.url), "utf8"));
});
afterEach(() => d.close());
function order(id: number, status = "shipped", created = since) {
  d.prepare(
    `INSERT INTO wms_order(id,reference,channel,status,due_at,created_at,updated_at)
    VALUES (?,?, 'seeded',?,?,?,?)`,
  ).run(id, `TEST-${id}`, status, now, created, now);
}
function report() {
  return flowAnalytics(d, since, now);
}
function stage(id: string) {
  return report().durations.find((r) => r.id === id)!;
}
function queue(id: string) {
  return report().queues.find((r) => r.id === id)!;
}
function close(actual: unknown, expected: number) {
  assert.ok(
    Math.abs(Number(actual) - expected) < 0.001,
    `${actual} ≠ ${expected}`,
  );
}

test("pusty raport nie zapisuje; brak obserwacji pozostaje NULL zamiast zera czasu", () => {
  const before = d.prepare("SELECT total_changes() AS n").get()!.n;
  const r = report();
  assert.equal(r.queues.length, 10);
  for (const q of r.queues) {
    assert.equal(q.count, 0);
    assert.equal(q.oldest_minutes, null);
    assert.equal(q.over_24h, 0);
  }
  for (const s of r.durations) {
    assert.equal(s.total, 0);
    assert.equal(s.measured, 0);
    assert.equal(s.mean_minutes, null);
    assert.equal(s.median_minutes, null);
    assert.equal(s.p95_minutes, null);
  }
  assert.equal(d.prepare("SELECT total_changes() AS n").get()!.n, before);
});

test("mediana i P95 uwzględniają prawdziwe zero; brak, błędna i odwrócona data nie zaniżają wyników", () => {
  for (let i = 0; i < 23; i++) {
    order(i + 1, "picked");
    d.prepare("UPDATE wms_order SET picked_at=? WHERE id=?").run(now, i + 1);
    const end =
      i === 20
        ? null
        : i === 21
          ? "invalid"
          : i === 22
            ? "2026-08-31T23:59:00.000Z"
            : new Date(Date.parse(since) + i * 60_000).toISOString();
    d.prepare(
      "INSERT INTO wms_order_timing(order_id,first_pick_scan_at,last_pick_scan_at) VALUES (?,?,?)",
    ).run(i + 1, since, end);
  }
  const s = stage("pick_session");
  assert.equal(s.total, 23);
  assert.equal(s.measured, 20);
  assert.equal(s.missing, 1);
  assert.equal(s.invalid, 2);
  close(s.mean_minutes, 9.5);
  close(s.median_minutes, 9.5);
  close(s.p95_minutes, 18);
});

test("okres wybiera ukończony etap także przed wysyłką, obejmuje granice i odrzuca przyszłość", () => {
  for (let id = 1; id <= 4; id++) {
    order(id, "packed", "2026-08-01T00:00:00.000Z");
    d.prepare("UPDATE wms_order SET packed_at=?,picked_at=? WHERE id=?").run(
      [since, now, "2026-08-31T23:59:59.999Z", "2026-09-02T12:00:00.001Z"][
        id - 1
      ],
      since,
      id,
    );
    d.prepare(
      "INSERT INTO wms_order_timing(order_id,pack_started_at,pack_completed_at) VALUES (?,?,?)",
    ).run(id, since, "2026-09-01T00:10:00.000Z");
  }
  assert.equal(stage("pack_session").total, 2);
  close(stage("pack_session").median_minutes, 10);
  assert.equal(stage("order_cycle").total, 0);
});

test("odbiór wymaga wszystkich czynnych paczek; etykieta, część odbioru i brak daty nie udają wysyłki", () => {
  for (let id = 1; id <= 6; id++) {
    order(id);
    d.prepare("UPDATE wms_order SET shipped_at=?,packed_at=? WHERE id=?").run(
      now,
      since,
      id,
    );
  }
  const parcel = (
    id: number,
    orderId: number,
    status?: string,
    handedAt: string | null = now,
  ) => {
    d.prepare(
      "INSERT INTO wms_shipment(id,order_id,package_no,carrier,tracking,weight_g,created_at) VALUES (?,?,?,'seeded',?,100,?)",
    ).run(id, orderId, id, `T${id}`, since);
    if (status)
      d.prepare(
        "INSERT INTO wms_parcel_state(shipment_id,status,handed_at) VALUES (?,?,?)",
      ).run(id, status, handedAt);
  };
  parcel(1, 1, "handed");
  parcel(2, 1, "handed");
  parcel(3, 1, "void");
  parcel(4, 2, "handed");
  parcel(5, 2, "ready");
  parcel(6, 3);
  parcel(7, 4, "void");
  parcel(8, 5, "handed", null);
  parcel(9, 6, "handed", "invalid");
  const s = stage("order_cycle");
  assert.equal(s.total, 6);
  assert.equal(s.measured, 1);
  assert.equal(s.missing, 5);
  close(s.median_minutes, 2160);
  assert.deepEqual(
    d
      .prepare(`SELECT o.id FROM wms_order o WHERE ${confirmedDispatch}`)
      .all()
      .map((r) => r.id),
    [1],
  );
  assert.equal(queue("dispatch").count, 1);
});

test("bieżące kolejki nie zależą od okresu i nie liczą ujemnego lub nieznanego wieku jako zera", () => {
  order(1, "new", "2026-08-01T00:00:00.000Z");
  order(2, "new", "invalid");
  order(3, "new", "2026-09-03T00:00:00.000Z");
  order(4, "cancelled");
  order(5, "allocated");
  order(6, "picking");
  order(7, "packing");
  d.prepare("UPDATE wms_order SET hold_reason='Sprawdzenie' WHERE id=1").run();
  d.prepare("UPDATE wms_order SET allocated_at=? WHERE id IN (5,6)").run(since);
  d.prepare(
    "INSERT INTO wms_order_timing(order_id,first_pick_scan_at) VALUES (6,?)",
  ).run(since);
  assert.equal(queue("allocation").count, 3);
  assert.equal(queue("allocation").held, 1);
  assert.equal(queue("allocation").over_24h, 1);
  assert.equal(queue("allocation").unknown_age, 2);
  assert.equal(queue("pick_queue").count, 1);
  assert.equal(queue("picking").count, 1);
  assert.equal(queue("packing").unknown_age, 1);
  assert.deepEqual(report().queues, flowAnalytics(d, now, now).queues);
});

test("bufor liczy częściowe odłożenia oddzielnie od korekt, kwarantanny i oczekiwanych dostaw", () => {
  d.prepare(
    "INSERT INTO wms_inbound(id,reference,supplier,fingerprint,created_at) VALUES (1,'PZ-TEST','seeded','test',?)",
  ).run("2026-08-01T00:00:00.000Z");
  d.exec(
    "INSERT INTO wms_inbound_line(id,inbound_id,tw_id,sku,name,expected,received,damaged) VALUES (1,1,1,'SKU','Część',20,12,2)",
  );
  const receive = d.prepare(
    "INSERT INTO wms_inbound_putaway(id,line_id,bin,quantity,disposition,reason,user_id,created_at) VALUES (?,1,'BUF',?,?,'Test',1,?)",
  );
  receive.run(1, 10, "good", since);
  receive.run(2, 2, "damaged", since);
  receive.run(3, 3, "good", "2026-08-01T00:00:00.000Z");
  d.prepare(
    "INSERT INTO wms_inbound_reversal(putaway_id,reason,user_id,created_at) VALUES (3,'Test',1,?)",
  ).run(now);
  d.prepare(
    "INSERT INTO wms_putaway_work(id,receipt_id,tw_id,source,quantity,remaining,created_at) VALUES (1,1,1,'BUF',10,3,?)",
  ).run(since);
  const step = d.prepare(
    "INSERT INTO wms_putaway_step(task_id,kind,target,quantity,reason,user_id,created_at) VALUES (1,?,'DEST',?,'Test',1,?)",
  );
  step.run("putaway", 3, "2026-09-01T00:10:00.000Z");
  step.run("putaway", 2, "2026-09-01T00:30:00.000Z");
  step.run("correction", 1, "2026-09-01T00:50:00.000Z");
  step.run("quarantine", 1, "2026-09-01T00:50:00.000Z");
  assert.deepEqual(
    { ...report().inbound },
    {
      expected_units: 8,
      buffer_units: 3,
      unassigned_putaway: 1,
      received_units: 12,
      damaged_units: 2,
      reversed_units: 3,
      putaway_units: 5,
      corrected_buffer_units: 1,
      quarantined_buffer_units: 1,
    },
  );
  assert.equal(stage("putaway").total, 2);
  close(stage("putaway").median_minutes, 20);
  close(stage("putaway").p95_minutes, 30);
  close(queue("putaway").oldest_minutes, 2160);
  assert.equal(queue("expected").count, 1);
  d.prepare("UPDATE wms_inbound SET closed_at=?").run(now);
  assert.equal(queue("expected").count, 0);
  assert.equal(report().inbound!.expected_units, 0);
  assert.equal(queue("putaway").count, 1);
});

test("Warszawa rozdziela północ, zmianę czasu i doby 23/25 h bez luk ani podwojonych dni", () => {
  assert.equal(reportDay("2026-09-01T21:59:59.999Z"), "2026-09-01");
  assert.equal(reportDay("2026-09-01T22:00:00.000Z"), "2026-09-02");
  assert.equal(reportDay("2026-01-01T22:59:59.999Z"), "2026-01-01");
  assert.equal(reportDay("2026-01-01T23:00:00.000Z"), "2026-01-02");
  assert.equal(reportDay("2026-03-29T01:00:00.000Z"), "2026-03-29");
  assert.equal(reportDay("2026-10-25T00:30:00.000Z"), "2026-10-25");
  assert.equal(reportDay("2026-10-25T01:30:00.000Z"), "2026-10-25");
  assert.deepEqual(
    reportDays("2026-03-28T23:00:00.000Z", "2026-03-29T22:00:00.000Z"),
    ["2026-03-29", "2026-03-30"],
  );
  assert.deepEqual(
    reportDays("2026-10-24T22:00:00.000Z", "2026-10-25T23:00:00.000Z"),
    ["2026-10-25", "2026-10-26"],
  );
  assert.equal(reportDay("invalid"), null);
  registerReportDay(d);
  registerReportDay(d);
  assert.equal(
    d
      .prepare("SELECT wms_report_day(?) AS day")
      .get("2026-09-01T22:00:00.000Z")!.day,
    "2026-09-02",
  );
  assert.equal(
    d.prepare("SELECT wms_report_day(NULL) AS day").get()!.day,
    null,
  );
});
