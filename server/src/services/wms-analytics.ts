import { z } from "zod";
import { db, nowIso, type Db } from "../db/db.js";
import { config } from "../config.js";

export const analyticsInput = z.object({
  days: z.coerce.number().int().min(1).max(90).default(30),
});

export function analytics(raw: unknown) {
  const { days } = analyticsInput.parse(raw);
  const d = db();
  const now = nowIso();
  const since = new Date(Date.parse(now) - days * 86_400_000).toISOString();
  // Jeden snapshot: równoległy proces nie może zmienić stanów między kaflami.
  d.exec("BEGIN");
  try {
    const backlog = d
      .prepare(
        `SELECT status,count(*) AS orders,sum(CASE WHEN hold_reason IS NOT NULL THEN 1 ELSE 0 END) AS held,
      sum(CASE WHEN due_at<? AND status NOT IN ('shipped','cancelled') THEN 1 ELSE 0 END) AS overdue
      FROM wms_order GROUP BY status`,
      )
      .all(now);
    const throughput = d
      .prepare(
        `SELECT count(*) AS shipped,
      coalesce(sum(CASE WHEN shipped_at<=due_at THEN 1 ELSE 0 END),0) AS on_time,
      avg((julianday(shipped_at)-julianday(created_at))*24*60) AS cycle_minutes,
      avg((julianday(picked_at)-julianday(allocated_at))*24*60) AS pick_minutes,
      avg((julianday(packed_at)-julianday(picked_at))*24*60) AS pack_minutes,
      avg((julianday(t.pack_started_at)-julianday(o.picked_at))*24*60) AS pack_queue_minutes,
      avg((julianday(t.pack_completed_at)-julianday(t.pack_started_at))*24*60) AS pack_session_minutes,
      count(t.pack_completed_at) AS timed_packed_orders
      FROM wms_order o LEFT JOIN wms_order_timing t ON t.order_id=o.id WHERE shipped_at>=? AND shipped_at<=?`,
      )
      .get(since, now);
    const dispatchCoverage = d
      .prepare(
        `SELECT count(*) AS orders,
      coalesce(sum(EXISTS(SELECT 1 FROM wms_shipment s JOIN wms_parcel_state p ON p.shipment_id=s.id WHERE s.order_id=o.id AND p.status='handed')),0) AS confirmed_orders
      FROM wms_order o WHERE o.status='shipped' AND o.shipped_at>=? AND o.shipped_at<=?`,
      )
      .get(since, now);
    const dailyRows = d
      .prepare(
        `SELECT substr(shipped_at,1,10) AS day,count(*) AS shipped,
      sum(CASE WHEN shipped_at<=due_at THEN 1 ELSE 0 END) AS on_time
      FROM wms_order WHERE shipped_at>=? AND shipped_at<=? GROUP BY day ORDER BY day`,
      )
      .all(since, now);
    const byDay = new Map(dailyRows.map((r) => [String(r.day), r]));
    const daily = [];
    for (
      let day = Date.parse(since.slice(0, 10) + "T00:00:00Z");
      day <= Date.parse(now);
      day += 86_400_000
    ) {
      const key = new Date(day).toISOString().slice(0, 10);
      daily.push(byDay.get(key) ?? { day: key, shipped: 0, on_time: 0 });
    }
    const stock = d
      .prepare(
        `SELECT count(DISTINCT s.tw_id) AS skus,coalesce(sum(on_hand),0) AS on_hand,
      coalesce(sum(reserved),0) AS reserved,
      coalesce(sum(CASE WHEN coalesce(b.mode,'pick')='pick' AND sc.id IS NULL THEN on_hand-reserved ELSE 0 END),0) AS available,
      coalesce(sum(CASE WHEN b.mode='quarantine' THEN on_hand ELSE 0 END),0) AS quarantined,
      coalesce(sum(CASE WHEN b.mode='reserve' THEN on_hand ELSE 0 END),0) AS reserve_stock,
      coalesce(sum(CASE WHEN on_hand-reserved<minimum THEN 1 ELSE 0 END),0) AS low_bins
      FROM wms_stock s LEFT JOIN wms_bin b ON b.bin=s.bin
      LEFT JOIN wms_stock_check sc ON sc.tw_id=s.tw_id AND sc.bin=s.bin AND sc.resolved_at IS NULL`,
      )
      .get();
    const top = d
      .prepare(
        `SELECT l.tw_id,l.sku,l.name,count(*) AS orders,sum(l.quantity) AS units
      FROM wms_line l JOIN wms_order o ON o.id=l.order_id WHERE o.shipped_at>=? AND o.shipped_at<=?
      GROUP BY l.tw_id,l.sku,l.name ORDER BY orders DESC,units DESC LIMIT 20`,
      )
      .all(since, now);
    const exceptions = d
      .prepare(
        `SELECT count(*) AS total FROM events WHERE created_at>=? AND created_at<=?
      AND (type='wms_order_hold' OR (type='http_rejected' AND json_extract(payload,'$.sciezka') LIKE '/api/wms/%'))`,
      )
      .get(since, now);
    const movements = d
      .prepare(
        `SELECT kind,count(*) AS operations,sum(delta) AS units FROM wms_movement
      WHERE created_at>=? AND created_at<=? GROUP BY kind`,
      )
      .all(since, now);
    const productivity = d
      .prepare(
        `SELECT m.user_id,coalesce(u.name,'Usunięte konto') AS name,
      count(*) AS scans,sum(-m.delta) AS units,count(DISTINCT m.order_id) AS orders
      FROM wms_movement m LEFT JOIN app_user u ON u.user_id=m.user_id
      WHERE m.kind='pick' AND m.created_at>=? AND m.created_at<=? GROUP BY m.user_id ORDER BY units DESC`,
      )
      .all(since, now);
    const aging = d
      .prepare(
        `SELECT
      sum(CASE WHEN created_at>=? THEN 1 ELSE 0 END) AS under_24h,
      sum(CASE WHEN created_at<? AND created_at>=? THEN 1 ELSE 0 END) AS hours_24_48,
      sum(CASE WHEN created_at<? THEN 1 ELSE 0 END) AS over_48h
      FROM wms_order WHERE status NOT IN ('shipped','cancelled')`,
      )
      .get(
        new Date(Date.parse(now) - 86_400_000).toISOString(),
        new Date(Date.parse(now) - 86_400_000).toISOString(),
        new Date(Date.parse(now) - 172_800_000).toISOString(),
        new Date(Date.parse(now) - 172_800_000).toISOString(),
      );
    const channels = d
      .prepare(
        `SELECT o.channel AS channel,count(*) AS shipped,
      sum(CASE WHEN shipped_at<=due_at THEN 1 ELSE 0 END) AS on_time,
      avg((julianday(shipped_at)-julianday(created_at))*24*60) AS cycle_minutes
      FROM wms_order o
      WHERE shipped_at>=? AND shipped_at<=? GROUP BY o.channel ORDER BY shipped DESC`,
      )
      .all(since, now);
    const adjustments = d
      .prepare(
        `SELECT m.tw_id,coalesce(p.symbol,'#'||m.tw_id) AS sku,sum(m.delta) AS variance,count(*) AS counts
      FROM wms_movement m LEFT JOIN wms_product p ON p.tw_id=m.tw_id WHERE m.kind='count' AND m.created_at>=? AND m.created_at<=?
      GROUP BY m.tw_id HAVING sum(abs(m.delta))>0 ORDER BY sum(abs(m.delta)) DESC LIMIT 20`,
      )
      .all(since, now);
    d.exec("COMMIT");
    return {
      days,
      since,
      now,
      timezone: "UTC",
      backlog,
      throughput,
      daily,
      stock,
      top,
      exceptions,
      movements,
      productivity,
      aging,
      channels,
      adjustments,
      dispatchCoverage,
    };
  } catch (e) {
    d.exec("ROLLBACK");
    throw e;
  }
}

export function erpReconciliation() {
  const rows = db()
    .prepare(
      `WITH physical AS (SELECT tw_id,sum(on_hand) AS shelf FROM wms_stock GROUP BY tw_id),
    staged AS (SELECT l.tw_id,sum(l.picked) AS picked,
      max(EXISTS(SELECT 1 FROM wms_shipment s JOIN wms_parcel_state ps ON ps.shipment_id=s.id WHERE s.order_id=o.id AND ps.status='handed')) AS partial_dispatch
      FROM wms_line l JOIN wms_order o ON o.id=l.order_id
      WHERE o.status NOT IN ('shipped','cancelled') GROUP BY l.tw_id)
    SELECT p.tw_id,p.symbol,p.nazwa,coalesce(s.shelf,0) AS shelf,
      CASE WHEN g.partial_dispatch=1 THEN NULL ELSE coalesce(g.picked,0) END AS staged,
      coalesce(g.partial_dispatch,0) AS partial_dispatch,
      e.stan AS erp,CASE WHEN g.partial_dispatch=1 THEN NULL ELSE coalesce(s.shelf,0)+coalesce(g.picked,0)-e.stan END AS difference
    FROM wms_product p LEFT JOIN physical s ON s.tw_id=p.tw_id LEFT JOIN staged g ON g.tw_id=p.tw_id
    LEFT JOIN sgt_stan e ON e.tw_id=p.tw_id AND e.mag_id=?
    WHERE g.partial_dispatch=1 OR e.stan IS NULL OR coalesce(s.shelf,0)+coalesce(g.picked,0)<>e.stan
    ORDER BY abs(difference) DESC,p.symbol LIMIT 100`,
    )
    .all(config.magId.MAG);
  return {
    rows,
    warehouseId: config.magId.MAG,
    limit: 100,
    explanation:
      "WMS obejmuje półki i pobrane, niewysłane sztuki. Częściowy odbiór wielopaczkowy nie ma jeszcze podziału SKU na paczki, więc różnica pozostaje nieznana. ERP pochodzi z ostatniej synchronizacji. Raport nie zmienia ewidencji.",
  };
}

export function integrity(database: Db = db()) {
  database.exec("BEGIN");
  try {
    // Dziennik nie jest dekoracją: odtwarza każdą ilość fizyczną i rezerwację.
    const balances = database
      .prepare(
        `WITH ledger AS (SELECT tw_id,bin,sum(delta) AS on_hand,sum(reserved_delta) AS reserved
      FROM wms_movement GROUP BY tw_id,bin)
    SELECT coalesce(s.tw_id,m.tw_id) AS tw_id,coalesce(s.bin,m.bin) AS bin,s.on_hand,s.reserved,
    coalesce(m.on_hand,0) AS ledger_on_hand,coalesce(m.reserved,0) AS ledger_reserved
    FROM wms_stock s FULL OUTER JOIN ledger m ON m.tw_id=s.tw_id AND m.bin=s.bin
    WHERE s.tw_id IS NULL OR s.on_hand<>coalesce(m.on_hand,0) OR s.reserved<>coalesce(m.reserved,0)`,
      )
      .all();
    const reservations = database
      .prepare(
        `WITH assigned AS (SELECT l.tw_id,a.bin,sum(a.quantity-a.picked) AS allocated
      FROM wms_allocation a JOIN wms_line l ON l.id=a.line_id JOIN wms_order o ON o.id=l.order_id
      WHERE o.status NOT IN ('shipped','cancelled') GROUP BY l.tw_id,a.bin)
    SELECT coalesce(s.tw_id,a.tw_id) AS tw_id,coalesce(s.bin,a.bin) AS bin,s.reserved,coalesce(a.allocated,0) AS allocated
    FROM wms_stock s FULL OUTER JOIN assigned a ON a.tw_id=s.tw_id AND a.bin=s.bin
    WHERE coalesce(s.reserved,0)<>coalesce(a.allocated,0)`,
      )
      .all();
    database.exec("COMMIT");
    return {
      ok: balances.length === 0 && reservations.length === 0,
      balances,
      reservations,
    };
  } catch (e) {
    database.exec("ROLLBACK");
    throw e;
  }
}
