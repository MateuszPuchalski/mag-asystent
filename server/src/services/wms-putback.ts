import { removePickedAllocation } from "./wms-picked-disposition.js";
import { z } from "zod";
import { db, nowIso } from "../db/db.js";
import {
  activePutback,
  applyOrderAction,
  command,
  getOrder,
  manager,
  readSnapshot,
  WmsError,
  type Actor,
} from "./wms.js";
import { clearPackingContents } from "./wms-packing.js";
import { logEvent } from "./events.js";

const id = z.number().int().positive().max(2147483647);
const code = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9][A-Z0-9-]{0,29}$/);
const reason = z.string().trim().min(3).max(500);
function fail(message: string): never {
  throw new WmsError(409, message);
}
type Work = {
  id: number;
  order_id: number;
  box: string;
  station: string;
  reason: string;
  user_id: number | null;
  version: number;
  created_at: string;
  claimed_at: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
};
function work(taskId: number) {
  const row = db()
    .prepare("SELECT * FROM wms_putback WHERE id=?")
    .get(id.parse(taskId)) as Work | undefined;
  if (!row) throw new WmsError(404, "Nie znaleziono zwrotu");
  return row;
}
function open(taskId: number, version: number) {
  const t = work(taskId);
  if (t.version !== version || t.completed_at || t.cancelled_at)
    fail("Zwrot zmienił się. Odśwież zadanie");
  return t;
}
function validOrder(t: Work) {
  const o = getOrder(t.order_id);
  if (
    !o.hold_reason ||
    o.tote !== t.box ||
    !["picking", "picked", "packing", "packed"].includes(o.status) ||
    o.shipments.length ||
    o.packingRecovery
  )
    fail("Zamówienie nie jest gotowe do zwrotu. Poproś biuro o wyjaśnienie");
  return o;
}
export function putbackTask(_actor: Actor, taskId: number) {
  return readSnapshot(() => {
    const t = work(taskId),
      o = getOrder(t.order_id);
    const picks = o.allocations
      .filter((a) => a.picked > 0)
      .map((a) => {
        const l = o.lines.find((l) => l.id === a.line_id)!;
        return {
          allocation_id: a.id,
          line_id: l.id,
          order_id: o.id,
          version: o.version,
          tw_id: l.tw_id,
          sku: l.sku,
          name: l.name,
          barcode: l.barcode,
          bin: a.bin,
          tote: t.box,
          position: 0,
          remaining: a.picked,
          hold_reason: o.hold_reason ?? t.reason,
          source_mode: a.bin_mode,
        };
      });
    return {
      ...t,
      reference: o.reference,
      order_version: o.version,
      picks,
      issues: db()
        .prepare("SELECT * FROM wms_putback_issue WHERE task_id=? ORDER BY id")
        .all(t.id),
    };
  });
}
export function putbackQueue(_actor: Actor, raw: unknown) {
  const f = z
    .object({
      q: z.string().trim().max(120).default(""),
      offset: z.coerce.number().int().min(0).max(1000000).default(0),
    })
    .parse(raw ?? {});
  return readSnapshot(() => {
    const where =
      "p.completed_at IS NULL AND p.cancelled_at IS NULL AND (instr(o.reference,?)>0 OR instr(p.box,?)>0)";
    const rows = db()
      .prepare(
        `SELECT p.*,o.reference,(SELECT coalesce(sum(l.picked),0) FROM wms_line l WHERE l.order_id=o.id) AS remaining FROM wms_putback p JOIN wms_order o ON o.id=p.order_id WHERE ${where} ORDER BY p.created_at,p.id LIMIT 50 OFFSET ?`,
      )
      .all(f.q, f.q, f.offset);
    const total = Number(
      db()
        .prepare(
          `SELECT count(*) AS n FROM wms_putback p JOIN wms_order o ON o.id=p.order_id WHERE ${where}`,
        )
        .get(f.q, f.q)!.n,
    );
    return { rows, total };
  });
}
export function requestPutback(actor: Actor, key: string, raw: unknown) {
  manager(actor);
  const input = z
    .object({ orderId: id, version: id, reason })
    .strict()
    .parse(raw);
  return command(key, actor, "putback_request", input, () => {
    const o = getOrder(input.orderId);
    if (o.version !== input.version || activePutback(o.id))
      fail("Odśwież zamówienie i jego zlecenia");
    const a = db()
      .prepare(
        "SELECT * FROM wms_cart_assignment WHERE order_id=? AND ended_at IS NULL AND handed_at IS NOT NULL",
      )
      .get(o.id);
    if (
      !a?.station_code ||
      !o.hold_reason ||
      !o.tote ||
      o.shipments.length ||
      o.packingRecovery ||
      !o.lines.some((l) => l.picked > 0) ||
      !["picking", "picked", "packing", "packed"].includes(o.status)
    )
      fail(
        "Zwrot wymaga wstrzymanej skrzynki przekazanej do stanowiska, bez etykiet i aktywnej wymiany",
      );
    const result = db()
      .prepare(
        "INSERT INTO wms_putback(order_id,box,station,reason,created_at,created_by) VALUES (?,?,?,?,?,?)",
      )
      .run(
        o.id,
        o.tote,
        String(a.station_code),
        input.reason,
        nowIso(),
        actor.id,
      );
    // Zlecenie zmienia dopuszczalne operacje; stare formularze nie mogą go ominąć.
    db()
      .prepare("UPDATE wms_order SET version=version+1,updated_at=? WHERE id=?")
      .run(nowIso(), o.id);
    return putbackTask(actor, Number(result.lastInsertRowid));
  });
}
export function claimPutback(
  actor: Actor,
  key: string,
  taskId: number,
  raw: unknown,
) {
  const input = z
    .object({
      version: id,
      box: code,
      station: code,
      contentsConfirmed: z.literal(true),
    })
    .strict()
    .parse(raw);
  return command(key, actor, "putback_claim", { taskId, ...input }, () => {
    const t = open(taskId, input.version),
      o = validOrder(t);
    if (t.user_id !== null) fail("Zwrot jest już podjęty");
    if (input.box !== t.box || input.station !== t.station)
      fail("Zeskanuj wskazane stanowisko i skrzynkę");
    const a = db()
      .prepare(
        "SELECT * FROM wms_cart_assignment WHERE order_id=? AND ended_at IS NULL",
      )
      .get(o.id);
    if (
      !a ||
      a.box_barcode !== t.box ||
      a.station_code !== t.station ||
      !a.handed_at
    )
      fail("Skrzynka zmieniła miejsce. Odśwież zlecenie w biurze");
    const now = nowIso();
    // Operator potwierdza przełożenie całej niewysłanej zawartości do skrzynki.
    // Cofamy kontrolę paczek, ale żadna sztuka nie wraca na półkę bez skanu odłożenia.
    logEvent(
      "wms_putback_handover",
      actor.name,
      null,
      {
        taskId: t.id,
        orderId: o.id,
        box: t.box,
        station: t.station,
        packingContents: o.packingContents,
        lines: o.lines.map((l) => ({
          id: l.id,
          sku: l.sku,
          picked: l.picked,
          packed: l.packed,
        })),
      },
      actor.id,
    );
    clearPackingContents(o.id);
    db().prepare("UPDATE wms_line SET packed=0 WHERE order_id=?").run(o.id);
    db()
      .prepare(
        "UPDATE wms_order SET status=?,packed_at=NULL,packer_id=NULL,version=version+1,updated_at=? WHERE id=?",
      )
      .run(
        o.lines.every((l) => l.picked === l.quantity) ? "picked" : "picking",
        now,
        o.id,
      );
    db()
      .prepare(
        "UPDATE wms_order_timing SET pack_started_at=NULL,first_pack_scan_at=NULL,last_pack_scan_at=NULL,pack_completed_at=NULL WHERE order_id=?",
      )
      .run(o.id);
    if (!a.released_at) {
      const run = db()
        .prepare("SELECT cart_code FROM wms_cart_run WHERE id=?")
        .get(a.run_id)!;
      db()
        .prepare(
          "UPDATE wms_cart_assignment SET released_at=? WHERE run_id=? AND position=?",
        )
        .run(now, a.run_id, a.position);
      db()
        .prepare(
          "UPDATE wms_cart_slot SET box_barcode=NULL WHERE cart_code=? AND position=? AND box_barcode=?",
        )
        .run(run.cart_code, a.position, t.box);
      db()
        .prepare("UPDATE wms_cart SET version=version+1 WHERE code=?")
        .run(run.cart_code);
    }
    db()
      .prepare(
        "UPDATE wms_putback SET user_id=?,claimed_at=?,version=version+1 WHERE id=?",
      )
      .run(actor.id, now, t.id);
    return putbackTask(actor, t.id);
  });
}
export function finishPutback(
  actor: Actor,
  key: string,
  taskId: number,
  raw: unknown,
) {
  const input = z
    .object({
      version: id,
      orderVersion: id,
      box: code,
      allocationId: id,
      bin: code,
      target: code.optional(),
      barcode: z.string().trim().min(1).max(120),
      quantity: z.number().int().min(1).max(1000000),
    })
    .strict()
    .parse(raw);
  return command(key, actor, "putback_return", { taskId, ...input }, () => {
    const t = open(taskId, input.version);
    if (t.user_id !== actor.id) fail("Zwrot należy do innego operatora");
    const o = validOrder(t);
    if (input.box !== t.box) fail("Zeskanuj skrzynkę tego zwrotu");
    applyOrderAction(
      actor,
      o.id,
      {
        action: "return",
        version: input.orderVersion,
        tote: input.box,
        allocationId: input.allocationId,
        bin: input.bin,
        target: input.target,
        barcode: input.barcode,
        quantity: input.quantity,
        reason: t.reason,
      },
      t.id,
    );
    settlePutback(t);
    return putbackTask(actor, t.id);
  });
}
export function releasePutback(
  actor: Actor,
  key: string,
  taskId: number,
  raw: unknown,
) {
  const input = z
    .object({ version: id, box: code, station: code, reason })
    .strict()
    .parse(raw);
  return command(key, actor, "putback_release", { taskId, ...input }, () => {
    const t = open(taskId, input.version);
    validOrder(t);
    if (
      t.user_id !== actor.id ||
      input.box !== t.box ||
      input.station !== t.station
    )
      fail("Zwróć skrzynkę na jej stanowisko i zeskanuj oba kody");
    db()
      .prepare(
        "UPDATE wms_putback SET user_id=NULL,version=version+1 WHERE id=?",
      )
      .run(t.id);
    return putbackTask(actor, t.id);
  });
}
export function abortPutback(
  actor: Actor,
  key: string,
  taskId: number,
  raw: unknown,
) {
  manager(actor);
  const input = z.object({ version: id, reason }).strict().parse(raw);
  return command(key, actor, "putback_abort", { taskId, ...input }, () => {
    const t = open(taskId, input.version);
    if (t.user_id !== null)
      fail(
        "Operator musi najpierw zwrócić skrzynkę na stanowisko i zwolnić zadanie",
      );
    db()
      .prepare(
        "UPDATE wms_putback SET cancelled_at=?,version=version+1 WHERE id=?",
      )
      .run(nowIso(), t.id);
    db()
      .prepare("UPDATE wms_order SET version=version+1,updated_at=? WHERE id=?")
      .run(nowIso(), t.order_id);
    return putbackTask(actor, t.id);
  });
}

function settlePutback(t: Work) {
  const o = getOrder(t.order_id);
  const completedAt = o.lines.every((l) => l.picked === 0) ? nowIso() : null;
  if (completedAt) {
    // Historia skrzynki zostaje; pusta trasa nie może blokować decyzji biura.
    db()
      .prepare(
        "UPDATE wms_cart_assignment SET ended_at=? WHERE order_id=? AND ended_at IS NULL",
      )
      .run(completedAt, o.id);
    db().prepare("DELETE FROM wms_wave_order WHERE order_id=?").run(o.id);
    db()
      .prepare(
        "UPDATE wms_order SET status='allocated',tote=NULL,picker_id=NULL,packer_id=NULL WHERE id=?",
      )
      .run(o.id);
  }
  db()
    .prepare(
      "UPDATE wms_putback SET version=version+1,completed_at=? WHERE id=?",
    )
    .run(completedAt, t.id);
}
function savePutbackIssue(
  actor: Actor,
  t: Work,
  lineId: number,
  quantity: number,
  quarantine: string | null,
  why: string,
  allocationId?: number,
) {
  const o = validOrder(t),
    line = o.lines.find((l) => l.id === lineId);
  if (!line) fail("Wybierz część tego zwrotu");
  removePickedAllocation(
    actor,
    o,
    lineId,
    quantity,
    quarantine,
    why,
    allocationId,
  );
  db()
    .prepare("UPDATE wms_line SET picked=picked-? WHERE id=?")
    .run(quantity, lineId);
  db()
    .prepare(
      "INSERT INTO wms_putback_issue(task_id,line_id,tw_id,sku,name,quantity,kind,quarantine,reason,user_id,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
    )
    .run(
      t.id,
      lineId,
      line!.tw_id,
      line!.sku,
      line!.name,
      quantity,
      quarantine === null ? "shortage" : "damage",
      quarantine,
      why,
      actor.id,
      nowIso(),
    );
  db()
    .prepare("UPDATE wms_order SET version=version+1,updated_at=? WHERE id=?")
    .run(nowIso(), o.id);
  settlePutback(t);
  return putbackTask(actor, t.id);
}
export function damagePutback(
  actor: Actor,
  key: string,
  taskId: number,
  raw: unknown,
) {
  const input = z
    .object({
      version: id,
      orderVersion: id,
      box: code,
      allocationId: id,
      barcode: z.string().trim().min(1).max(120),
      quantity: z.number().int().min(1).max(1000000),
      quarantine: code,
      reason,
    })
    .strict()
    .parse(raw);
  return command(key, actor, "putback_damage", { taskId, ...input }, () => {
    const t = open(taskId, input.version),
      o = validOrder(t);
    if (
      t.user_id !== actor.id ||
      o.version !== input.orderVersion ||
      t.box !== input.box
    )
      fail("Odśwież własny zwrot i zeskanuj jego skrzynkę");
    const a = o.allocations.find((a) => a.id === input.allocationId),
      line = o.lines.find((l) => l.id === a?.line_id);
    if (
      !line ||
      !(
        line.sku.toUpperCase() === input.barcode.toUpperCase() ||
        line.barcode === input.barcode
      )
    )
      fail("Zeskanuj właściwą część zwrotu");
    return savePutbackIssue(
      actor,
      t,
      line.id,
      input.quantity,
      input.quarantine,
      input.reason,
      input.allocationId,
    );
  });
}
export function shortagePutback(
  actor: Actor,
  key: string,
  taskId: number,
  raw: unknown,
) {
  manager(actor);
  const input = z
    .object({
      version: id,
      orderVersion: id,
      box: code,
      station: code,
      lineId: id,
      observedQuantity: z.number().int().min(0).max(1000000),
      reason,
    })
    .strict()
    .parse(raw);
  return command(key, actor, "putback_shortage", { taskId, ...input }, () => {
    const t = open(taskId, input.version),
      o = validOrder(t);
    // Biuro liczy dopiero po oddaniu skrzynki; operator nie może równolegle odkładać sztuk.
    if (t.user_id !== null || !t.claimed_at)
      fail(
        "Operator musi najpierw oddać skrzynkę na stanowisko i zwolnić zwrot",
      );
    if (
      o.version !== input.orderVersion ||
      t.box !== input.box ||
      t.station !== input.station
    )
      fail("Odśwież zwrot i zeskanuj stanowisko oraz skrzynkę");
    const line = o.lines.find((l) => l.id === input.lineId);
    if (!line || input.observedQuantity >= line.picked)
      fail("Wpisz rzeczywistą liczbę mniejszą od nierozliczonych pobrań");
    return savePutbackIssue(
      actor,
      t,
      line.id,
      line.picked - input.observedQuantity,
      null,
      input.reason,
    );
  });
}
