import type { Db } from "../db/db.js";

type DurationStats = {
  total: number;
  missing: number;
  invalid: number;
  measured: number;
  mean_minutes: number | null;
  median_minutes: number | null;
  p95_minutes: number | null;
};
type QueueStats = {
  count: number;
  held: number;
  oldest_minutes: number | null;
  over_24h: number;
  unknown_age: number;
};

// Dawna etykieta nie dowodzi odbioru. Każda niewycofana paczka wymaga daty przekazania.
export const confirmedDispatch = `EXISTS(SELECT 1 FROM wms_shipment s JOIN wms_parcel_state p ON p.shipment_id=s.id
  WHERE s.order_id=o.id AND p.status='handed') AND NOT EXISTS(
  SELECT 1 FROM wms_shipment s LEFT JOIN wms_parcel_state p ON p.shipment_id=s.id
  WHERE s.order_id=o.id AND coalesce(p.status,'ready')<>'void'
  AND (coalesce(p.status,'ready')<>'handed' OR julianday(p.handed_at) IS NULL))`;

const orderTiming =
  "FROM wms_order o LEFT JOIN wms_order_timing t ON t.order_id=o.id";
const stages = [
  {
    id: "allocation",
    label: "Zamówienie → rezerwacja",
    unit: "zamówienia",
    start: "o.created_at",
    end: "o.allocated_at",
    cohort: "o.allocated_at",
    from: orderTiming,
  },
  {
    id: "pick_queue",
    label: "Rezerwacja → pierwsze pobranie",
    unit: "zamówienia",
    start: "o.allocated_at",
    end: "t.first_pick_scan_at",
    cohort: "o.picked_at",
    from: orderTiming,
  },
  {
    id: "pick_session",
    label: "Pierwsze → ostatnie pobranie",
    unit: "zamówienia",
    start: "t.first_pick_scan_at",
    end: "t.last_pick_scan_at",
    cohort: "o.picked_at",
    from: orderTiming,
  },
  {
    id: "pack_queue",
    label: "Koniec zbiórki → otwarcie pakowania",
    unit: "zamówienia",
    start: "o.picked_at",
    end: "t.pack_started_at",
    cohort: "o.packed_at",
    from: orderTiming,
  },
  {
    id: "pack_session",
    label: "Otwarcie → koniec pakowania",
    unit: "zamówienia",
    start: "t.pack_started_at",
    end: "t.pack_completed_at",
    cohort: "o.packed_at",
    from: orderTiming,
  },
  {
    id: "dispatch_queue",
    label: "Spakowanie → odbiór wszystkich paczek",
    unit: "zamówienia",
    start: "o.packed_at",
    end: `CASE WHEN ${confirmedDispatch} THEN o.shipped_at END`,
    cohort: "o.shipped_at",
    from: orderTiming,
  },
  {
    id: "order_cycle",
    label: "Zamówienie → odbiór wszystkich paczek",
    unit: "zamówienia",
    start: "o.created_at",
    end: `CASE WHEN ${confirmedDispatch} THEN o.shipped_at END`,
    cohort: "o.shipped_at",
    from: orderTiming,
  },
  {
    id: "putaway",
    label: "Przyjęcie do bufora → odłożenie",
    unit: "odłożenia częściowe",
    start: "w.created_at",
    end: "s.created_at",
    cohort: "s.created_at",
    from: "FROM wms_putaway_step s JOIN wms_putaway_work w ON w.id=s.task_id WHERE s.kind='putaway'",
  },
] as const;

// Źródła SQL są stałe. Okres dotyczy ukończonego etapu, a kolejki opisują stan teraz.
export function flowAnalytics(d: Db, since: string, now: string) {
  const durations = stages.map((stage) => {
    const filter = stage.from.includes(" WHERE ") ? "AND" : "WHERE";
    const row = d
      .prepare(
        `WITH raw AS (
      SELECT ${stage.start} AS started,${stage.end} AS ended ${stage.from}
      ${filter} ${stage.cohort}>=? AND ${stage.cohort}<=?
    ), samples AS (
      SELECT *, (julianday(ended)-julianday(started))*1440 AS minutes FROM raw
    ), valid AS (
      SELECT minutes,row_number() OVER(ORDER BY minutes) AS rn,count(*) OVER() AS n
      FROM samples WHERE minutes>=0
    ) SELECT (SELECT count(*) FROM samples) AS total,
      (SELECT count(*) FROM samples WHERE started IS NULL OR ended IS NULL) AS missing,
      (SELECT count(*) FROM samples WHERE started IS NOT NULL AND ended IS NOT NULL AND (minutes IS NULL OR minutes<0)) AS invalid,
      count(*) AS measured,avg(minutes) AS mean_minutes,
      avg(CASE WHEN rn IN ((n+1)/2,(n+2)/2) THEN minutes END) AS median_minutes,
      max(CASE WHEN rn=(95*n+99)/100 THEN minutes END) AS p95_minutes
      FROM valid`,
      )
      .get(since, now) as DurationStats;
    return { id: stage.id, label: stage.label, unit: stage.unit, ...row };
  });
  const queues = [
    {
      id: "expected",
      label: "Otwarte dokumenty dostaw",
      unit: "dokumenty",
      view: "inbound",
      source: `SELECT i.created_at AS started,0 AS held FROM wms_inbound i WHERE i.closed_at IS NULL`,
    },
    {
      id: "putaway",
      label: "Bufor do odłożenia",
      unit: "zadania",
      view: "inbound",
      source: `SELECT created_at AS started,0 AS held FROM wms_putaway_work WHERE remaining>0`,
    },
    {
      id: "replenishment",
      label: "Uzupełnienia półek",
      unit: "zadania",
      view: "stockwork",
      source: `SELECT created_at AS started,0 AS held FROM wms_replenishment WHERE completed_at IS NULL AND cancelled_at IS NULL`,
    },
    {
      id: "counts",
      label: "Blokady do sprawdzenia",
      unit: "lokalizacje części",
      view: "stockwork",
      source: `SELECT created_at AS started,0 AS held FROM wms_stock_check WHERE resolved_at IS NULL`,
    },
    {
      id: "capacity",
      label: "Pełne cele odłożenia",
      unit: "lokalizacje części",
      view: "stockwork",
      source: `SELECT created_at AS started,1 AS held FROM wms_capacity_issue WHERE resolved_at IS NULL`,
    },
    {
      id: "allocation",
      label: "Zamówienia do rezerwacji",
      unit: "zamówienia",
      view: "orders",
      source: `SELECT created_at AS started,hold_reason IS NOT NULL AS held FROM wms_order WHERE status='new'`,
    },
    {
      id: "pick_queue",
      label: "Czekają na pierwsze pobranie",
      unit: "zamówienia",
      view: "carts",
      source: `SELECT o.allocated_at AS started,o.hold_reason IS NOT NULL AS held ${orderTiming} WHERE o.status IN ('allocated','picking') AND t.first_pick_scan_at IS NULL`,
    },
    {
      id: "picking",
      label: "Rozpoczęta zbiórka",
      unit: "zamówienia",
      view: "carts",
      source: `SELECT t.first_pick_scan_at AS started,o.hold_reason IS NOT NULL AS held ${orderTiming} WHERE o.status IN ('allocated','picking') AND t.first_pick_scan_at IS NOT NULL`,
    },
    {
      id: "pack_queue",
      label: "Czekają na pakowanie",
      unit: "zamówienia",
      view: "packing",
      source: `SELECT picked_at AS started,hold_reason IS NOT NULL AS held FROM wms_order WHERE status='picked'`,
    },
    {
      id: "packing",
      label: "Rozpoczęte pakowanie",
      unit: "zamówienia",
      view: "packing",
      source: `SELECT t.pack_started_at AS started,o.hold_reason IS NOT NULL AS held ${orderTiming} WHERE o.status='packing'`,
    },
    {
      id: "dispatch",
      label: "Paczki czekające na kuriera",
      unit: "paczki",
      view: "handoff",
      source: `SELECT s.created_at AS started,o.hold_reason IS NOT NULL AS held FROM wms_shipment s JOIN wms_parcel_state p ON p.shipment_id=s.id JOIN wms_order o ON o.id=s.order_id WHERE p.status='ready'`,
    },
  ].map(({ source, ...queue }) => ({
    ...queue,
    ...(d
      .prepare(
        `WITH samples AS (SELECT *, (julianday(?)-julianday(started))*1440 AS age FROM (${source}))
      SELECT count(*) AS count,coalesce(sum(held),0) AS held,
      max(CASE WHEN age>=0 THEN age END) AS oldest_minutes,
      coalesce(sum(CASE WHEN age>=1440 THEN 1 ELSE 0 END),0) AS over_24h,
      coalesce(sum(CASE WHEN age IS NULL OR age<0 THEN 1 ELSE 0 END),0) AS unknown_age FROM samples`,
      )
      .get(now) as QueueStats),
  }));
  const inbound = d
    .prepare(
      `SELECT
    (SELECT coalesce(sum(max(0,l.expected-l.received)),0) FROM wms_inbound_line l JOIN wms_inbound i ON i.id=l.inbound_id WHERE i.closed_at IS NULL) AS expected_units,
    (SELECT coalesce(sum(remaining),0) FROM wms_putaway_work WHERE remaining>0) AS buffer_units,
    (SELECT count(*) FROM wms_putaway_work WHERE remaining>0 AND user_id IS NULL) AS unassigned_putaway,
    (SELECT coalesce(sum(quantity),0) FROM wms_inbound_putaway WHERE created_at>=?1 AND created_at<=?2) AS received_units,
    (SELECT coalesce(sum(quantity),0) FROM wms_inbound_putaway WHERE disposition='damaged' AND created_at>=?1 AND created_at<=?2) AS damaged_units,
    (SELECT coalesce(sum(p.quantity),0) FROM wms_inbound_reversal r JOIN wms_inbound_putaway p ON p.id=r.putaway_id WHERE r.created_at>=?1 AND r.created_at<=?2) AS reversed_units,
    (SELECT coalesce(sum(quantity),0) FROM wms_putaway_step WHERE kind='putaway' AND created_at>=?1 AND created_at<=?2) AS putaway_units,
    (SELECT coalesce(sum(quantity),0) FROM wms_putaway_step WHERE kind='correction' AND created_at>=?1 AND created_at<=?2) AS corrected_buffer_units,
    (SELECT coalesce(sum(quantity),0) FROM wms_putaway_step WHERE kind='quarantine' AND created_at>=?1 AND created_at<=?2) AS quarantined_buffer_units
  `,
    )
    .get({ "1": since, "2": now });
  return { queues, durations, inbound };
}
