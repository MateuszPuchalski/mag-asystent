import { z } from "zod";
import { db, nowIso } from "../db/db.js";
import {
  command,
  getOrder,
  manager,
  readSnapshot,
  WmsError,
  type Actor,
} from "./wms.js";
import { wierszCsv, zbudujCsv } from "./csv.js";

const filters = z.object({
  day: z.iso.date().refine((v) => v >= "2000-01-01" && v <= "2099-12-31"),
  q: z.string().trim().max(120).default(""),
});
const pageInput = filters.extend({
  offset: z.coerce.number().int().min(0).max(1_000_000).default(0),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
type Parcel = {
  id: number;
  order_id: number;
  reference: string;
  channel: string;
  package_no: number;
  carrier: string;
  tracking: string;
  weight_g: number;
  created_at: string;
  dispatch_status: string;
  handed_at: string | null;
};
const columns =
  "s.*,o.reference,o.channel,coalesce(p.status,'legacy') AS dispatch_status,p.handed_at";

function selection(input: z.infer<typeof filters>) {
  const start = `${input.day}T00:00:00.000Z`;
  const end = new Date(Date.parse(start) + 86_400_000).toISOString();
  // instr traktuje %, _ i apostrofy jak dane, bez poszerzania wyszukiwania.
  return {
    sql: `FROM wms_shipment s JOIN wms_order o ON o.id=s.order_id LEFT JOIN wms_parcel_state p ON p.shipment_id=s.id
      WHERE s.created_at>=? AND s.created_at<?
      AND (?='' OR instr(lower(o.reference),lower(?))>0
        OR instr(lower(s.tracking),lower(?))>0 OR instr(lower(s.carrier),lower(?))>0
        OR instr(lower(o.channel),lower(?))>0)`,
    args: [start, end, input.q, input.q, input.q, input.q, input.q],
  };
}

export function dispatchRegister(actor: Actor, raw: unknown) {
  manager(actor);
  const input = pageInput.parse(raw);
  const { sql, args } = selection(input),
    d = db();
  // Liczniki i strona muszą opisywać tę samą chwilę przy równoległej wysyłce.
  d.exec("BEGIN");
  try {
    const totals = d
      .prepare(
        `SELECT count(*) AS parcels,count(DISTINCT s.order_id) AS orders,
      coalesce(sum(s.weight_g),0) AS weightG ${sql}`,
      )
      .get(...args);
    const rows = d
      .prepare(
        `SELECT ${columns} ${sql} ORDER BY s.created_at DESC,s.id DESC LIMIT ? OFFSET ?`,
      )
      .all(...args, input.limit, input.offset) as Parcel[];
    d.exec("COMMIT");
    return { ...input, totals, rows };
  } catch (error) {
    d.exec("ROLLBACK");
    throw error;
  }
}

export function dispatchCsv(actor: Actor, raw: unknown) {
  manager(actor);
  const input = filters.parse(raw);
  const { sql, args } = selection(input);
  // Eksport obejmuje cały filtr, nigdy tylko widoczną stronę. Nie wolno go ucinać po cichu.
  const rows = db()
    .prepare(`SELECT ${columns} ${sql} ORDER BY s.created_at,s.id LIMIT 30001`)
    .all(...args) as Parcel[];
  if (rows.length > 30000)
    throw new WmsError(
      422,
      "Ponad 30000 paczek. Zawęź wyszukiwanie przed eksportem",
    );
  // Numery i kanały pochodzą od użytkownika; Excel nie może wykonać ich jako formuł.
  const cell = (value: string) =>
    /^[\s]*[=+@-]/.test(value) ? `'${value}` : value;
  return zbudujCsv([
    wierszCsv(
      [
        "ID paczki",
        "Zamówienie",
        "Kanał",
        "Paczka",
        "Przewoźnik",
        "Numer przesyłki",
        "Masa g",
        "Zarejestrowano UTC",
        "Stan paczki",
        "Odbiór UTC",
      ],
      ";",
    ),
    ...rows.map((r) =>
      wierszCsv(
        [
          r.id,
          cell(r.reference),
          cell(r.channel),
          r.package_no,
          cell(r.carrier),
          cell(r.tracking),
          r.weight_g,
          r.created_at,
          r.dispatch_status,
          r.handed_at ?? "",
        ],
        ";",
      ),
    ),
  ]);
}

export const dispatchToday = () => nowIso().slice(0, 10);

const label = z.string().trim().min(1).max(120);
const identity = label.transform((v) => v.toUpperCase());
const version = z.number().int().positive();
const reason = z.string().trim().min(3).max(500);
const fail = (message: string, status = 409): never => {
  throw new WmsError(status, message);
};
type Batch = {
  id: number;
  carrier: string;
  closed_at: string | null;
  version: number;
};
function batch(id: number) {
  return (
    (db().prepare("SELECT * FROM wms_dispatch_batch WHERE id=?").get(id) as
      | Batch
      | undefined) ?? fail("Nie ma takiego przekazania", 404)
  );
}
export function handoffQueue(raw: unknown) {
  const input = z
    .object({
      q: z.string().trim().max(120).default(""),
      offset: z.coerce.number().int().min(0).max(1_000_000).default(0),
      batchOffset: z.coerce.number().int().min(0).max(1_000_000).default(0),
    })
    .parse(raw);
  return readSnapshot(() => ({
    carriers: db()
      .prepare(
        "SELECT s.carrier,count(*) AS parcels FROM wms_shipment s JOIN wms_parcel_state p ON p.shipment_id=s.id WHERE p.status='ready' GROUP BY s.carrier ORDER BY s.carrier",
      )
      .all(),
    summary: db()
      .prepare(
        `SELECT count(*) AS waiting,count(DISTINCT s.order_id) AS orders,min(s.created_at) AS oldest,
    sum(CASE WHEN o.hold_reason IS NOT NULL THEN 1 ELSE 0 END) AS held
    FROM wms_parcel_state p JOIN wms_shipment s ON s.id=p.shipment_id JOIN wms_order o ON o.id=s.order_id WHERE p.status='ready'`,
      )
      .get(),
    rows: db()
      .prepare(
        `SELECT s.*,p.version,o.reference,o.hold_reason,e.batch_id FROM wms_parcel_state p JOIN wms_shipment s ON s.id=p.shipment_id
    JOIN wms_order o ON o.id=s.order_id LEFT JOIN wms_dispatch_entry e ON e.shipment_id=s.id AND e.removed_at IS NULL
    WHERE p.status='ready' AND instr(lower(s.carrier||' '||s.tracking||' '||o.reference),lower(?))>0 ORDER BY s.created_at,s.id LIMIT 51 OFFSET ?`,
      )
      .all(input.q, input.offset),
    batches: db()
      .prepare(
        `SELECT b.*,count(e.id) AS parcels FROM wms_dispatch_batch b LEFT JOIN wms_dispatch_entry e ON e.batch_id=b.id AND e.removed_at IS NULL
    GROUP BY b.id ORDER BY (b.closed_at IS NULL) DESC,b.id DESC LIMIT 51 OFFSET ?`,
      )
      .all(input.batchOffset),
  }));
}
export function getHandoff(id: number) {
  return readSnapshot(() => ({
    ...batch(id),
    totals: {
      ...db()
        .prepare(
          "SELECT count(*) AS parcels,coalesce(sum(weight_g),0) AS weightG FROM wms_dispatch_entry WHERE batch_id=? AND removed_at IS NULL",
        )
        .get(id),
    },
    entries: db()
      .prepare(
        `SELECT e.*,s.order_id,o.reference FROM wms_dispatch_entry e JOIN wms_shipment s ON s.id=e.shipment_id
    JOIN wms_order o ON o.id=s.order_id WHERE e.batch_id=? AND e.removed_at IS NULL ORDER BY e.id DESC LIMIT 50`,
      )
      .all(id)
      .map((r) => ({ ...r })),
  }));
}
export function createHandoff(actor: Actor, key: string, raw: unknown) {
  const input = z.object({ carrier: identity }).strict().parse(raw);
  return command(key, actor, "handoff_create", input, () => {
    const id = Number(
      db()
        .prepare(
          "INSERT INTO wms_dispatch_batch(carrier,created_at,user_id) VALUES (?,?,?)",
        )
        .run(input.carrier, nowIso(), actor.id).lastInsertRowid,
    );
    return getHandoff(id);
  });
}
export function scanHandoff(
  actor: Actor,
  key: string,
  id: number,
  raw: unknown,
) {
  const input = z.object({ tracking: identity }).strict().parse(raw);
  return command(key, actor, `handoff_scan:${id}`, input, () => {
    const current = batch(id);
    if (current.closed_at) fail("Przekazanie zostało już zamknięte");
    const matches = db()
      .prepare(
        `SELECT s.id,s.order_id,p.status,o.status AS order_status,o.hold_reason FROM wms_shipment s
    LEFT JOIN wms_parcel_state p ON p.shipment_id=s.id JOIN wms_order o ON o.id=s.order_id WHERE upper(s.carrier)=? AND upper(s.tracking)=? LIMIT 2`,
      )
      .all(current.carrier, input.tracking);
    if (matches.length !== 1)
      fail(
        "Brak jednoznacznej paczki dla tego przewoźnika. Sprawdź etykietę i wybrane przekazanie",
        400,
      );
    const p = matches[0];
    if (p.status !== "ready" || p.order_status !== "packed" || p.hold_reason)
      fail(
        "Paczka nie jest gotowa do przekazania. Sprawdź status i wstrzymanie zamówienia",
      );
    const existing = db()
      .prepare(
        "SELECT batch_id FROM wms_dispatch_entry WHERE shipment_id=? AND removed_at IS NULL",
      )
      .get(p.id);
    if (existing) {
      if (existing.batch_id !== id)
        fail(`Paczka jest już na przekazaniu #${existing.batch_id}`);
      return { ...getHandoff(id), alreadyScanned: true };
    }
    if (
      Number(
        db()
          .prepare(
            "SELECT count(*) AS n FROM wms_dispatch_entry WHERE batch_id=? AND removed_at IS NULL",
          )
          .get(id)!.n,
      ) >= 5000
    )
      fail("Przekazanie ma 5000 paczek. Otwórz kolejne");
    db()
      .prepare(
        `INSERT INTO wms_dispatch_entry(batch_id,shipment_id,tracking,weight_g,scanned_at,scanned_by)
    SELECT ?,id,tracking,weight_g,?,? FROM wms_shipment WHERE id=?`,
      )
      .run(id, nowIso(), actor.id, p.id);
    db()
      .prepare("UPDATE wms_dispatch_batch SET version=version+1 WHERE id=?")
      .run(id);
    return { ...getHandoff(id), alreadyScanned: false };
  });
}
export function removeHandoff(
  actor: Actor,
  key: string,
  id: number,
  raw: unknown,
) {
  const input = z
    .object({ tracking: identity, version, reason })
    .strict()
    .parse(raw);
  return command(key, actor, `handoff_remove:${id}`, input, () => {
    const current = batch(id);
    if (current.closed_at || current.version !== input.version)
      fail("Przekazanie zmieniło się. Odśwież listę");
    const removed = db()
      .prepare(
        "UPDATE wms_dispatch_entry SET removed_at=?,removed_reason=? WHERE batch_id=? AND upper(tracking)=? AND removed_at IS NULL",
      )
      .run(nowIso(), input.reason, id, input.tracking);
    if (!removed.changes) fail("Tej paczki nie ma na przekazaniu", 404);
    db()
      .prepare("UPDATE wms_dispatch_batch SET version=version+1 WHERE id=?")
      .run(id);
    return getHandoff(id);
  });
}
export function closeHandoff(
  actor: Actor,
  key: string,
  id: number,
  raw: unknown,
) {
  const input = z
    .object({ version, parcels: z.number().int().min(0).max(5000) })
    .strict()
    .parse(raw);
  return command(key, actor, `handoff_close:${id}`, input, () => {
    const current = batch(id);
    if (current.closed_at || current.version !== input.version)
      fail("Przekazanie zmieniło się. Sprawdź aktualną liczbę paczek");
    const entries = db()
      .prepare(
        `SELECT e.shipment_id,e.tracking,p.status,o.status AS order_status,o.hold_reason FROM wms_dispatch_entry e
    JOIN wms_shipment s ON s.id=e.shipment_id JOIN wms_parcel_state p ON p.shipment_id=s.id JOIN wms_order o ON o.id=s.order_id WHERE e.batch_id=? AND e.removed_at IS NULL`,
      )
      .all(id);
    if (entries.length !== input.parcels)
      fail("Liczba paczek nie odpowiada przekazaniu. Odśwież i przelicz");
    const blocked = entries.find(
      (p) =>
        p.status !== "ready" || p.order_status !== "packed" || p.hold_reason,
    );
    if (blocked)
      fail(
        `Przekazanie zawiera wstrzymaną lub niegotową paczkę ${blocked.tracking}. Wyjaśnij ją albo usuń z listy`,
      );
    const now = nowIso();
    db()
      .prepare(
        "UPDATE wms_parcel_state SET status='handed',handed_at=?,version=version+1 WHERE shipment_id IN (SELECT shipment_id FROM wms_dispatch_entry WHERE batch_id=? AND removed_at IS NULL)",
      )
      .run(now, id);
    db()
      .prepare(
        `UPDATE wms_order SET status='shipped',shipped_at=?,updated_at=?,version=version+1
    WHERE id IN (SELECT s.order_id FROM wms_dispatch_entry e JOIN wms_shipment s ON s.id=e.shipment_id WHERE e.batch_id=? AND e.removed_at IS NULL)
    AND NOT EXISTS(SELECT 1 FROM wms_shipment s JOIN wms_parcel_state p ON p.shipment_id=s.id WHERE s.order_id=wms_order.id AND p.status='ready')`,
      )
      .run(now, now, id);
    db()
      .prepare(
        "UPDATE wms_dispatch_batch SET closed_at=?,closed_by=?,version=version+1 WHERE id=?",
      )
      .run(now, actor.id, id);
    return getHandoff(id);
  });
}
function readyParcel(id: number) {
  const p = db()
    .prepare(
      `SELECT s.*,p.status,p.version FROM wms_shipment s JOIN wms_parcel_state p ON p.shipment_id=s.id WHERE s.id=?`,
    )
    .get(id);
  if (!p || p.status !== "ready")
    fail("Etykietę można zmienić tylko przed przekazaniem", 409);
  if (
    db()
      .prepare(
        "SELECT 1 FROM wms_dispatch_entry WHERE shipment_id=? AND removed_at IS NULL",
      )
      .get(id)
  )
    fail("Najpierw usuń paczkę z przekazania");
  return p!;
}
export function correctParcel(
  actor: Actor,
  key: string,
  id: number,
  raw: unknown,
) {
  manager(actor);
  const input = z
    .object({
      version,
      carrier: identity,
      tracking: identity,
      weightG: z.number().int().positive().max(1_000_000),
      reason,
    })
    .strict()
    .parse(raw);
  return command(key, actor, `parcel_correct:${id}`, input, () => {
    const p = readyParcel(id);
    if (p.version !== input.version)
      fail("Etykieta zmieniła się. Odśwież paczkę");
    if (
      db()
        .prepare(
          "SELECT 1 FROM wms_shipment WHERE upper(carrier)=? AND upper(tracking)=? AND id<>?",
        )
        .get(input.carrier, input.tracking, id)
    )
      fail("Ten numer przesyłki jest już użyty");
    // Stan sprzed korekty pozostaje dostępny nawet po zmianie etykiety.
    db()
      .prepare(
        "INSERT INTO wms_parcel_revision(shipment_id,previous,next,reason,user_id,created_at) VALUES (?,?,?,?,?,?)",
      )
      .run(
        id,
        JSON.stringify(p),
        JSON.stringify(input),
        input.reason,
        actor.id,
        nowIso(),
      );
    db()
      .prepare(
        "UPDATE wms_shipment SET carrier=?,tracking=?,weight_g=? WHERE id=?",
      )
      .run(input.carrier, input.tracking, input.weightG, id);
    db()
      .prepare(
        "UPDATE wms_parcel_state SET version=version+1 WHERE shipment_id=?",
      )
      .run(id);
    return { id, corrected: true };
  });
}
export function reopenPacking(
  actor: Actor,
  key: string,
  id: number,
  raw: unknown,
) {
  manager(actor);
  const input = z
    .object({
      version,
      reason,
      tote: identity.pipe(z.string().regex(/^[A-Z0-9][A-Z0-9-]{0,29}$/)),
    })
    .strict()
    .parse(raw);
  return command(key, actor, `parcels_reopen:${id}`, input, () => {
    const o = getOrder(id);
    if (
      o.status !== "packed" ||
      o.version !== input.version ||
      !o.shipments.length
    )
      fail("Odśwież spakowane zamówienie z przygotowanymi paczkami");
    for (const p of o.shipments) readyParcel(Number(p.id));
    if (
      db()
        .prepare("SELECT 1 FROM wms_cart_slot WHERE box_barcode=?")
        .get(input.tote)
    )
      fail("Do ponownej kontroli użyj pojemnika poza wózkiem");
    if (
      db()
        .prepare(
          "SELECT 1 FROM wms_order WHERE tote=? AND status NOT IN ('shipped','cancelled')",
        )
        .get(input.tote)
    )
      fail("Ten pojemnik jest zajęty");
    const now = nowIso();
    for (const p of o.shipments) {
      db()
        .prepare(
          "INSERT INTO wms_parcel_revision(shipment_id,previous,next,reason,user_id,created_at) VALUES (?,?,?,?,?,?)",
        )
        .run(
          p.id,
          JSON.stringify(p),
          JSON.stringify({ status: "void" }),
          input.reason,
          actor.id,
          now,
        );
      db()
        .prepare(
          "UPDATE wms_parcel_state SET status='void',version=version+1 WHERE shipment_id=?",
        )
        .run(p.id);
    }
    db().prepare("UPDATE wms_line SET packed=0 WHERE order_id=?").run(id);
    db()
      .prepare(
        "UPDATE wms_order SET status='picked',packer_id=NULL,packed_at=NULL,tote=?,version=version+1,updated_at=? WHERE id=?",
      )
      .run(input.tote, now, id);
    return getOrder(id);
  });
}
export function handoffCsv(id: number) {
  // Nagłówek odbioru i jego skany muszą pochodzić z tego samego odczytu.
  return readSnapshot(() => {
    const b = batch(id);
    const rows = db()
      .prepare(
        "SELECT tracking,weight_g,scanned_at FROM wms_dispatch_entry WHERE batch_id=? AND removed_at IS NULL ORDER BY id",
      )
      .all(id);
    const safe = (v: unknown) => {
      const s = String(v ?? "");
      return /^[\s]*[=+@-]/.test(s) ? `'${s}` : s;
    };
    return zbudujCsv([
      wierszCsv(
        [
          "Przekazanie",
          "Przewoźnik",
          "Numer przesyłki",
          "Masa g",
          "Skan UTC",
          "Odbiór UTC",
        ],
        ";",
      ),
      ...rows.map((r) =>
        wierszCsv(
          [
            id,
            safe(b.carrier),
            safe(r.tracking),
            r.weight_g,
            r.scanned_at,
            b.closed_at ?? "NIE POTWIERDZONO",
          ],
          ";",
        ),
      ),
    ]);
  });
}
