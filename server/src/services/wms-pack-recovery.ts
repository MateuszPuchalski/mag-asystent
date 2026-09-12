import { z } from "zod";
import { db, nowIso } from "../db/db.js";
import {
  command,
  getOrder,
  manager,
  move,
  readSnapshot,
  WmsError,
  type Actor,
} from "./wms.js";
import { removePackedContent } from "./wms-packing.js";
import { fillOrderReservations } from "./wms-stock-work.js";

const id = z.number().int().positive();
const qty = z.number().int().min(1).max(1000000);
const code = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9][A-Z0-9-]{0,29}$/);
const reason = z.string().trim().min(3).max(500);
const fail = (message: string, status = 409): never => {
  throw new WmsError(status, message);
};
type Recovery = {
  id: number;
  order_id: number;
  user_id: number | null;
  version: number;
  completed_at: string | null;
  cancelled_at: string | null;
};
function recovery(taskId: number) {
  return (
    (db()
      .prepare("SELECT * FROM wms_pack_recovery WHERE id=?")
      .get(id.parse(taskId)) as Recovery | undefined) ??
    fail("Nie ma zadania wymiany", 404)
  );
}
function open(taskId: number, version: number) {
  const task = recovery(taskId);
  if (task.version !== version || task.completed_at || task.cancelled_at)
    fail("Odśwież zadanie wymiany");
  return task;
}
function owner(actor: Actor, task: Recovery) {
  if (task.user_id !== actor.id) fail("Wymianę prowadzi inny operator", 403);
}
function packing(task: Recovery) {
  const order = getOrder(task.order_id);
  if (order.status !== "packing" || order.shipments.length)
    fail("Zamówienie nie jest dostępne do wymiany");
  if (order.hold_reason) fail(`Zamówienie wstrzymane: ${order.hold_reason}`);
  return order;
}
function touchOrder(orderId: number) {
  db()
    .prepare("UPDATE wms_order SET version=version+1,updated_at=? WHERE id=?")
    .run(nowIso(), orderId);
}
export function recoveryTask(actor: Actor, taskId: number) {
  return readSnapshot(() => {
    const task = recovery(taskId);
    if (task.user_id !== null && task.user_id !== actor.id) manager(actor);
    const order = getOrder(task.order_id);
    const lines = db()
      // Starsze APK oczekuje tekstu. Pusty adres oznacza brak kwarantanny; rodzaj i NULL w bazie rozróżniają ubytek.
      .prepare(
        "SELECT id,recovery_id,line_id,tw_id,sku,name,quantity,replaced,kind,coalesce(quarantine,'') AS quarantine,parcel_no,reason,user_id,created_at FROM wms_pack_issue WHERE recovery_id=? ORDER BY id",
      )
      .all(task.id);
    const picks = db()
      .prepare(
        `SELECT a.id AS allocation_id,a.bin,a.quantity-a.picked AS quantity,s.version AS stock_version,
      l.tw_id,l.sku,l.name,l.barcode,c.reason AS blocked FROM wms_allocation a JOIN wms_line l ON l.id=a.line_id
      JOIN wms_stock s ON s.tw_id=l.tw_id AND s.bin=a.bin
      LEFT JOIN wms_stock_check c ON c.tw_id=l.tw_id AND c.bin=a.bin AND c.resolved_at IS NULL
      WHERE l.order_id=? AND a.quantity>a.picked ORDER BY a.bin,l.id`,
      )
      .all(order.id);
    return {
      ...task,
      reference: order.reference,
      box: order.tote,
      hold_reason: order.hold_reason,
      lines,
      picks,
    };
  });
}
export function recoveryWork(actor: Actor, raw: unknown) {
  const input = z
    .object({
      q: z.string().trim().max(120).default(""),
      offset: z.coerce.number().int().min(0).max(1000000).default(0),
    })
    .strict()
    .parse(raw);
  return readSnapshot(() => {
    const where = `FROM wms_pack_recovery r JOIN wms_order o ON o.id=r.order_id WHERE r.completed_at IS NULL AND r.cancelled_at IS NULL
      AND (r.user_id IS NULL OR r.user_id=? OR ?=1) AND (instr(lower(o.reference),lower(?))>0 OR o.tote=?)`;
    const args = [
      actor.id,
      Number(actor.role !== "magazynier"),
      input.q,
      input.q.toUpperCase(),
    ];
    return {
      rows: db()
        .prepare(
          `SELECT r.*,o.reference,o.tote AS box,o.hold_reason,
      (SELECT sum(quantity-replaced) FROM wms_pack_issue WHERE recovery_id=r.id) AS remaining ${where}
      ORDER BY o.priority DESC,o.due_at,r.id LIMIT 50 OFFSET ?`,
        )
        .all(...args, input.offset),
      total: Number(
        db()
          .prepare(`SELECT count(*) n ${where}`)
          .get(...args)!.n,
      ),
    };
  });
}
export function quarantinePacking(actor: Actor, key: string, raw: unknown) {
  const input = z
    .object({
      orderId: id,
      version: id,
      box: code,
      barcode: z.string().trim().min(1).max(120),
      quantity: qty,
      parcelNo: z.number().int().min(0).max(20),
      quarantine: code,
      reason,
    })
    .strict()
    .parse(raw);
  return command(key, actor, "pack_quarantine", input, () =>
    recordPackingIssue(actor, input, "damage"),
  );
}

export function confirmPackingShortage(
  actor: Actor,
  key: string,
  raw: unknown,
) {
  manager(actor);
  const input = z
    .object({
      orderId: id,
      version: id,
      box: code,
      lineId: id,
      observedQuantity: z.number().int().min(0).max(1000000),
      parcelNo: z.number().int().min(0).max(20),
      reason,
    })
    .strict()
    .parse(raw);
  return command(key, actor, "pack_shortage", input, () => {
    const order = getOrder(input.orderId);
    const line = order.lines.find((l) => l.id === input.lineId);
    if (!line) fail("Wybierz część z tego zamówienia", 400);
    // Liczymy wskazaną paczkę lub niesprawdzone sztuki. Nie trzeba skanować nieobecnej części ani udawać jej zwrotu.
    const expected = input.parcelNo
      ? Number(
          order.packingContents.find(
            (c) => c.line_id === line!.id && c.parcel_no === input.parcelNo,
          )?.quantity ?? 0,
        )
      : line!.picked - line!.packed;
    const quantity = expected - input.observedQuantity;
    if (quantity <= 0)
      fail(
        "Wpisz faktyczną ilość mniejszą od zapisanej dla wskazanej zawartości. Nadwyżkę wyjaśnij oddzielnie",
        400,
      );
    return recordPackingIssue(
      actor,
      { ...input, barcode: line!.sku, quantity, quarantine: null },
      "shortage",
    );
  });
}

type PackingIssueInput = {
  orderId: number;
  version: number;
  box: string;
  barcode: string;
  quantity: number;
  parcelNo: number;
  quarantine: string | null;
  reason: string;
  lineId?: number;
};
function recordPackingIssue(
  actor: Actor,
  input: PackingIssueInput,
  kind: "damage" | "shortage",
) {
  const order = getOrder(input.orderId);
  if (order.version !== input.version || order.tote !== input.box)
    fail("Odśwież zamówienie i zeskanuj jego skrzynkę");
  if (!["packing", "packed"].includes(order.status) || order.shipments.length)
    fail("Najpierw wycofaj etykiety i rozpocznij kontrolę pakowania");
  if (order.packer_id !== actor.id) manager(actor);
  let task = db()
    .prepare(
      "SELECT * FROM wms_pack_recovery WHERE order_id=? AND completed_at IS NULL AND cancelled_at IS NULL",
    )
    .get(order.id) as Recovery | undefined;
  if (task?.user_id != null)
    fail(
      "Najpierw rozlicz aktywną wymianę; kolejny brak lub uszkodzenie dodaj po jej zakończeniu lub zwrocie niepotwierdzonych pobrań",
    );
  const matches = order.lines.filter((l) =>
    input.lineId
      ? l.id === input.lineId
      : l.sku.toUpperCase() === input.barcode.toUpperCase() ||
        l.barcode === input.barcode,
  );
  if (matches.length !== 1)
    fail("Zeskanuj jednoznaczny kod części z zamówienia", 400);
  const line = matches[0];
  if (
    kind === "damage" &&
    db().prepare("SELECT mode FROM wms_bin WHERE bin=?").get(input.quarantine)
      ?.mode !== "quarantine"
  )
    fail("Zeskanuj lokalizację kwarantanny", 400);
  if (
    input.quantity > line.picked ||
    (!input.parcelNo && input.quantity > line.picked - line.packed)
  )
    fail("Tyle niesprawdzonych sztuk nie znajduje się przy stanowisku", 400);
  if (input.parcelNo)
    removePackedContent(line.id, input.parcelNo, input.quantity);
  // Zmniejszamy pobrania; uszkodzona sztuka trafia do kwarantanny, a nieobecna nie tworzy żadnego przyjęcia.
  let left = input.quantity;
  for (const a of order.allocations.filter(
    (a) => a.line_id === line.id && a.picked > 0,
  )) {
    const take = Math.min(left, a.picked);
    if (a.quantity === take)
      db().prepare("DELETE FROM wms_allocation WHERE id=?").run(a.id);
    else
      db()
        .prepare(
          "UPDATE wms_allocation SET quantity=quantity-?,picked=picked-? WHERE id=?",
        )
        .run(take, take, a.id);
    left -= take;
    if (!left) break;
  }
  if (left)
    fail("Niespójna historia pobrań. Wstrzymaj zamówienie i wyjaśnij zapas");
  if (input.quarantine !== null)
    move(
      actor,
      line.tw_id,
      input.quarantine,
      input.quantity,
      0,
      "return",
      input.reason,
      order.id,
    );
  db()
    .prepare("UPDATE wms_line SET picked=picked-?,packed=packed-? WHERE id=?")
    .run(input.quantity, input.parcelNo ? input.quantity : 0, line.id);
  const stamp = nowIso();
  if (!task) {
    const saved = db()
      .prepare(
        "INSERT INTO wms_pack_recovery(order_id,created_at) VALUES (?,?)",
      )
      .run(order.id, stamp);
    task = recovery(Number(saved.lastInsertRowid));
  } else
    db()
      .prepare("UPDATE wms_pack_recovery SET version=version+1 WHERE id=?")
      .run(task.id);
  db()
    .prepare(
      "INSERT INTO wms_pack_issue(recovery_id,line_id,tw_id,sku,name,quantity,kind,quarantine,parcel_no,reason,user_id,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
    )
    .run(
      task.id,
      line.id,
      line.tw_id,
      line.sku,
      line.name,
      input.quantity,
      kind,
      input.quarantine,
      input.parcelNo,
      input.reason,
      actor.id,
      stamp,
    );
  db()
    .prepare("UPDATE wms_order SET status='packing',packed_at=NULL WHERE id=?")
    .run(order.id);
  db()
    .prepare(
      "UPDATE wms_order_timing SET pack_completed_at=NULL WHERE order_id=?",
    )
    .run(order.id);
  touchOrder(order.id);
  return recoveryTask(actor, task.id);
}
export function claimRecovery(
  actor: Actor,
  key: string,
  taskId: number,
  raw: unknown,
) {
  const input = z.object({ version: id }).strict().parse(raw);
  return command(
    key,
    actor,
    "pack_recovery_claim",
    { taskId, ...input },
    () => {
      const task = open(taskId, input.version);
      if (task.user_id !== null) fail("Wymiana jest już podjęta");
      const order = packing(task);
      // Brak zamiennika odrzuca tylko podjęcie, nigdy wcześniej potwierdzoną kwarantannę.
      fillOrderReservations(
        actor,
        order.id,
        "Zamiennik rozbieżności przy pakowaniu",
      );
      db()
        .prepare(
          "UPDATE wms_pack_recovery SET user_id=?,version=version+1 WHERE id=?",
        )
        .run(actor.id, task.id);
      touchOrder(order.id);
      return recoveryTask(actor, task.id);
    },
  );
}
export function pickRecovery(
  actor: Actor,
  key: string,
  taskId: number,
  raw: unknown,
) {
  const input = z
    .object({
      version: id,
      allocationId: id,
      sourceVersion: id,
      source: code,
      barcode: z.string().trim().min(1).max(120),
      quantity: qty,
      box: code,
    })
    .strict()
    .parse(raw);
  return command(key, actor, "pack_recovery_pick", { taskId, ...input }, () => {
    const task = open(taskId, input.version);
    owner(actor, task);
    const order = packing(task);
    if (order.tote !== input.box)
      fail("Zeskanuj skrzynkę oczekującą na zamiennik", 400);
    const a = order.allocations.find((a) => a.id === input.allocationId);
    if (!a || a.bin !== input.source || input.quantity > a.quantity - a.picked)
      fail("Odśwież pobranie i zeskanuj właściwe źródło", 400);
    const line = order.lines.find((l) => l.id === a!.line_id)!;
    if (
      line.sku.toUpperCase() !== input.barcode.toUpperCase() &&
      line.barcode !== input.barcode
    )
      fail("To inna część", 400);
    const s = db()
      .prepare("SELECT version FROM wms_stock WHERE tw_id=? AND bin=?")
      .get(line.tw_id, a!.bin);
    if (s?.version !== input.sourceVersion)
      fail(
        "Stan źródła zmienił się. Zwróć niepotwierdzone sztuki na źródło i odśwież zadanie",
      );
    if (
      db()
        .prepare(
          "SELECT 1 FROM wms_stock_check WHERE tw_id=? AND bin=? AND resolved_at IS NULL",
        )
        .get(line.tw_id, a!.bin)
    )
      fail("Źródło czeka na przeliczenie; zwróć niepotwierdzone sztuki");
    const cases = db()
      .prepare(
        "SELECT id,quantity-replaced AS remaining FROM wms_pack_issue WHERE recovery_id=? AND line_id=? AND replaced<quantity ORDER BY id",
      )
      .all(task.id, line.id);
    if (cases.reduce((n, c) => n + Number(c.remaining), 0) < input.quantity)
      fail("Ilość przekracza brakujące zamienniki");
    move(
      actor,
      line.tw_id,
      a!.bin,
      -input.quantity,
      -input.quantity,
      "pick",
      "Zamiennik do skrzynki " + input.box,
      order.id,
    );
    db()
      .prepare("UPDATE wms_allocation SET picked=picked+? WHERE id=?")
      .run(input.quantity, a!.id);
    db()
      .prepare("UPDATE wms_line SET picked=picked+? WHERE id=?")
      .run(input.quantity, line.id);
    let left = input.quantity;
    for (const c of cases) {
      const take = Math.min(left, Number(c.remaining));
      db()
        .prepare("UPDATE wms_pack_issue SET replaced=replaced+? WHERE id=?")
        .run(take, c.id);
      left -= take;
      if (!left) break;
    }
    db()
      .prepare(
        "UPDATE wms_pack_recovery SET version=version+1,completed_at=CASE WHEN NOT EXISTS(SELECT 1 FROM wms_pack_issue WHERE recovery_id=? AND replaced<quantity) THEN ? END WHERE id=?",
      )
      .run(task.id, nowIso(), task.id);
    touchOrder(order.id);
    return recoveryTask(actor, task.id);
  });
}
export function releaseRecovery(
  actor: Actor,
  key: string,
  taskId: number,
  raw: unknown,
) {
  const input = z
    .object({ version: id, sources: z.array(code).max(10000), reason })
    .strict()
    .parse(raw);
  return command(
    key,
    actor,
    "pack_recovery_release",
    { taskId, ...input },
    () => {
      const task = open(taskId, input.version);
      owner(actor, task);
      const order = getOrder(task.order_id);
      const pending = order.allocations.filter((a) => a.quantity > a.picked);
      const expected = [...new Set(pending.map((a) => a.bin))].sort();
      if (
        JSON.stringify([...new Set(input.sources)].sort()) !==
        JSON.stringify(expected)
      )
        fail("Zwróć wszystkie niepotwierdzone sztuki i zeskanuj każde źródło");
      for (const a of pending) {
        const line = order.lines.find((l) => l.id === a.line_id)!;
        move(
          actor,
          line.tw_id,
          a.bin,
          0,
          -(a.quantity - a.picked),
          "release",
          input.reason,
          order.id,
        );
        if (a.picked === 0)
          db().prepare("DELETE FROM wms_allocation WHERE id=?").run(a.id);
        else
          db()
            .prepare("UPDATE wms_allocation SET quantity=picked WHERE id=?")
            .run(a.id);
      }
      db()
        .prepare(
          "UPDATE wms_pack_recovery SET user_id=NULL,version=version+1 WHERE id=?",
        )
        .run(task.id);
      touchOrder(order.id);
      return recoveryTask(actor, task.id);
    },
  );
}
export function abortRecovery(
  actor: Actor,
  key: string,
  taskId: number,
  raw: unknown,
) {
  manager(actor);
  const input = z.object({ version: id, reason }).strict().parse(raw);
  return command(
    key,
    actor,
    "pack_recovery_abort",
    { taskId, ...input },
    () => {
      const task = open(taskId, input.version);
      if (task.user_id !== null)
        fail(
          "Najpierw zwróć niepotwierdzone pobrania i zwolnij zadanie wymiany",
        );
      const order = getOrder(task.order_id);
      db()
        .prepare(
          "UPDATE wms_pack_recovery SET cancelled_at=?,reason=?,version=version+1 WHERE id=?",
        )
        .run(nowIso(), input.reason, task.id);
      db()
        .prepare(
          "DELETE FROM wms_pack_content WHERE line_id IN (SELECT id FROM wms_line WHERE order_id=?)",
        )
        .run(order.id);
      db()
        .prepare("UPDATE wms_line SET packed=0 WHERE order_id=?")
        .run(order.id);
      db()
        .prepare(
          "UPDATE wms_order SET status='picking',hold_reason=?,picked_at=NULL,packed_at=NULL WHERE id=?",
        )
        .run(
          order.hold_reason ?? "Wymiana przerwana: " + input.reason,
          order.id,
        );
      db()
        .prepare(
          "UPDATE wms_order_timing SET pack_started_at=NULL,first_pack_scan_at=NULL,last_pack_scan_at=NULL,pack_completed_at=NULL WHERE order_id=?",
        )
        .run(order.id);
      touchOrder(order.id);
      return recoveryTask(actor, task.id);
    },
  );
}
