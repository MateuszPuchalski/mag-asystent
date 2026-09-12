import { z } from "zod";
import { db, nowIso } from "../db/db.js";
import { readSnapshot } from "./wms.js";
import {
  applyStock,
  checkBarcode,
  command,
  getOrder,
  manager,
  move,
  WmsError,
  type Actor,
} from "./wms.js";

const code = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9][A-Z0-9-]{0,29}$/);
const id = z.number().int().positive();
const quantity = z.number().int().positive().max(1000000);
const reason = z.string().trim().min(3).max(500);
const fail = (message: string, status = 409): never => {
  throw new WmsError(status, message);
};
type Stock = {
  on_hand: number;
  reserved: number;
  version: number;
  bin: string;
};
type Task = {
  id: number;
  tw_id: number;
  source: string;
  target: string;
  quantity: number;
  source_version: number;
  target_version: number;
  user_id: number;
  completed_at: string | null;
  cancelled_at: string | null;
};
function product(twId: number) {
  const p = db()
    .prepare(
      `SELECT symbol AS sku,ean AS barcode FROM sgt_towar WHERE tw_id=? UNION ALL
    SELECT symbol AS sku,ean AS barcode FROM wms_product WHERE tw_id=? AND NOT EXISTS(SELECT 1 FROM sgt_towar WHERE tw_id=?) LIMIT 1`,
    )
    .get(twId, twId, twId) as
    | { sku: string; barcode: string | null }
    | undefined;
  return p ?? fail("Nie ma kartoteki towaru", 404);
}
function stock(twId: number, bin: string) {
  return db()
    .prepare("SELECT * FROM wms_stock WHERE tw_id=? AND bin=?")
    .get(twId, bin) as Stock | undefined;
}
function checkOpen(twId: number, bin: string) {
  return !!db()
    .prepare(
      "SELECT 1 FROM wms_stock_check WHERE tw_id=? AND bin=? AND resolved_at IS NULL",
    )
    .get(twId, bin);
}

// Naprawa przydziału odbywa się w transakcji nadrzędnej; brak wycofuje wszystkie jej rezerwacje.
export function fillOrderReservations(
  actor: Actor,
  orderId: number,
  reason = "Ponowny przydział po przeliczeniu",
) {
  if (!db().isTransaction)
    throw new Error("Naprawa rezerwacji wymaga transakcji command");
  const order = getOrder(orderId);
  for (const line of order.lines) {
    let missing =
      line.quantity -
      order.allocations
        .filter((a) => a.line_id === line.id)
        .reduce((sum, a) => sum + a.quantity, 0);
    if (missing <= 0) continue;
    const bins = db()
      .prepare(
        `SELECT s.* FROM wms_stock s LEFT JOIN wms_bin b ON b.bin=s.bin
      WHERE s.tw_id=? AND s.on_hand>s.reserved AND coalesce(b.mode,'pick')='pick'
      AND NOT EXISTS(SELECT 1 FROM wms_stock_check c WHERE c.tw_id=s.tw_id AND c.bin=s.bin AND c.resolved_at IS NULL) ORDER BY s.bin`,
      )
      .all(line.tw_id) as Stock[];
    for (const bin of bins) {
      const take = Math.min(missing, bin.on_hand - bin.reserved);
      move(actor, line.tw_id, bin.bin, 0, take, "reserve", reason, orderId);
      db()
        .prepare(
          `INSERT INTO wms_allocation(line_id,bin,quantity) VALUES (?,?,?) ON CONFLICT(line_id,bin) DO UPDATE SET quantity=wms_allocation.quantity+excluded.quantity`,
        )
        .run(line.id, bin.bin, take);
      missing -= take;
      if (!missing) break;
    }
    if (missing)
      fail(
        `Brak ${missing} szt. ${line.sku}. Uzupełnij zapas przed wznowieniem`,
      );
  }
}

export function stockWork(actor: Actor, raw: unknown) {
  return readSnapshot(() => readStockWork(actor, raw));
}
function readStockWork(actor: Actor, raw: unknown) {
  const input = z
    .object({ q: z.string().trim().max(120).default("") })
    .parse(raw);
  const plans = db()
    .prepare(
      `WITH demand AS (
    SELECT l.tw_id,sum(max(0,l.quantity-coalesce((SELECT sum(a.quantity) FROM wms_allocation a WHERE a.line_id=l.id),0))) AS needed
    FROM wms_line l JOIN wms_order o ON o.id=l.order_id WHERE o.status IN ('new','allocated','picking') AND (o.hold_reason IS NULL OR o.status<>'new') GROUP BY l.tw_id
  ), pick AS (
    SELECT s.*,p.symbol AS sku,p.nazwa AS name,coalesce(d.needed,0) AS needed,
      sum(s.on_hand-s.reserved) OVER(PARTITION BY s.tw_id) AS available,
      row_number() OVER(PARTITION BY s.tw_id ORDER BY s.bin) AS rank
    FROM wms_stock s JOIN wms_product p ON p.tw_id=s.tw_id LEFT JOIN wms_bin b ON b.bin=s.bin LEFT JOIN demand d ON d.tw_id=s.tw_id
    WHERE coalesce(b.mode,'pick')='pick' AND NOT EXISTS(SELECT 1 FROM wms_stock_check c WHERE c.tw_id=s.tw_id AND c.bin=s.bin AND c.resolved_at IS NULL)
  ), needs AS (
    SELECT *,max(0,minimum-(on_hand-reserved),CASE WHEN rank=1 THEN needed-available ELSE 0 END) AS quantity FROM pick
  ) SELECT n.tw_id,n.sku,n.name,n.bin AS target,n.version AS target_version,n.quantity,s.bin AS source,s.version AS source_version,
      s.on_hand-s.reserved-coalesce((SELECT sum(r.quantity) FROM wms_replenishment r WHERE r.tw_id=s.tw_id AND r.source=s.bin AND r.completed_at IS NULL AND r.cancelled_at IS NULL),0)
      -coalesce((SELECT sum(w.remaining) FROM wms_putaway_work w WHERE w.tw_id=s.tw_id AND w.source=s.bin AND w.remaining>0),0) AS source_available
    FROM needs n JOIN wms_stock s ON s.tw_id=n.tw_id JOIN wms_bin b ON b.bin=s.bin AND b.mode='reserve'
    WHERE n.quantity>0 AND NOT EXISTS(SELECT 1 FROM wms_replenishment r WHERE r.tw_id=n.tw_id AND r.target=n.bin AND r.completed_at IS NULL AND r.cancelled_at IS NULL)
    AND NOT EXISTS(SELECT 1 FROM wms_stock_check c WHERE c.tw_id=s.tw_id AND c.bin=s.bin AND c.resolved_at IS NULL)
    AND source_available>0 AND (instr(lower(n.sku||' '||n.name),lower(?))>0 OR n.bin=? OR s.bin=?)
    ORDER BY n.quantity DESC,n.sku,n.bin,s.bin LIMIT 100`,
    )
    .all(input.q, input.q.toUpperCase(), input.q.toUpperCase());
  return {
    plans,
    repairs:
      actor.role === "magazynier"
        ? []
        : db()
            .prepare(
              `SELECT o.id,o.reference,o.tote,o.version FROM wms_order o
      WHERE o.hold_reason LIKE 'Brak po przeliczeniu:%' AND o.status IN ('allocated','picking') ORDER BY o.priority DESC,o.due_at LIMIT 100`,
            )
            .all(),
    tasks: db()
      .prepare(
        `SELECT r.*,p.symbol AS sku,p.nazwa AS name FROM wms_replenishment r JOIN wms_product p ON p.tw_id=r.tw_id
      WHERE r.completed_at IS NULL AND r.cancelled_at IS NULL AND (?=1 OR r.user_id=?) ORDER BY r.id LIMIT 100`,
      )
      .all(Number(actor.role !== "magazynier"), actor.id),
    checks: db()
      .prepare(
        `SELECT c.*,p.symbol AS sku,p.nazwa AS name,s.version AS stock_version,s.on_hand,s.reserved,
      v.id AS observation_id,v.quantity AS observed_quantity,v.stock_version AS observed_version,
      v.created_at AS observed_at,u.name AS counter_name FROM wms_stock_check c
      LEFT JOIN wms_stock_observation v ON v.check_id=c.id AND v.reviewed_at IS NULL
      LEFT JOIN app_user u ON u.user_id=v.user_id
      JOIN wms_stock s ON s.tw_id=c.tw_id AND s.bin=c.bin JOIN wms_product p ON p.tw_id=c.tw_id WHERE c.resolved_at IS NULL ORDER BY c.created_at LIMIT 100`,
      )
      .all(),
  };
}

export function repairReservations(actor: Actor, key: string, raw: unknown) {
  manager(actor);
  const input = z
    .object({ orderId: id, version: id, reason })
    .strict()
    .parse(raw);
  return command(key, actor, "reservation_repair", input, () => {
    const order = getOrder(input.orderId);
    if (
      order.version !== input.version ||
      !order.hold_reason?.startsWith("Brak po przeliczeniu:") ||
      !["allocated", "picking"].includes(order.status)
    )
      fail("Odśwież listę zamówień oczekujących na zapas");
    if (
      db()
        .prepare(
          "SELECT 1 FROM wms_pick_exception WHERE order_id=? AND resolved_at IS NULL",
        )
        .get(order.id)
    )
      fail("Rozwiąż zgłoszenie zbiórki przed wznowieniem");
    fillOrderReservations(actor, order.id);
    db()
      .prepare(
        "UPDATE wms_order SET hold_reason=NULL,version=version+1,updated_at=? WHERE id=?",
      )
      .run(nowIso(), order.id);
    return getOrder(order.id);
  });
}

export function claimReplenishment(actor: Actor, key: string, raw: unknown) {
  const input = z
    .object({
      twId: id,
      source: code,
      target: code,
      quantity,
      sourceVersion: id,
      targetVersion: id,
    })
    .strict()
    .parse(raw);
  return command(key, actor, "replenishment_claim", input, () => {
    const from = stock(input.twId, input.source),
      to = stock(input.twId, input.target);
    if (
      !from ||
      !to ||
      from.version !== input.sourceVersion ||
      to.version !== input.targetVersion
    )
      fail("Stan zmienił się. Odśwież plan uzupełnień");
    if (
      !db()
        .prepare("SELECT 1 FROM wms_bin WHERE bin=? AND mode='reserve'")
        .get(input.source)
    )
      fail("Źródło musi być zapasem zaplecza", 400);
    const mode =
      db().prepare("SELECT mode FROM wms_bin WHERE bin=?").get(input.target)
        ?.mode ?? "pick";
    if (mode !== "pick" || input.source === input.target)
      fail("Cel musi być lokalizacją kompletacji", 400);
    if (
      checkOpen(input.twId, input.source) ||
      checkOpen(input.twId, input.target)
    )
      fail("Najpierw przelicz zablokowaną lokalizację");
    if (
      db()
        .prepare(
          "SELECT 1 FROM wms_replenishment WHERE tw_id=? AND target=? AND completed_at IS NULL AND cancelled_at IS NULL",
        )
        .get(input.twId, input.target)
    )
      fail("Ta półka ma już otwarte uzupełnienie");
    const assigned = Number(
      db()
        .prepare(
          `SELECT coalesce((SELECT sum(quantity) FROM wms_replenishment WHERE tw_id=? AND source=? AND completed_at IS NULL AND cancelled_at IS NULL),0)
          + coalesce((SELECT sum(remaining) FROM wms_putaway_work WHERE tw_id=? AND source=? AND remaining>0),0) AS n`,
        )
        .get(input.twId, input.source, input.twId, input.source)!.n,
    );
    if (input.quantity > from!.on_hand - from!.reserved - assigned)
      fail("Zapas zaplecza jest już potrzebny w innych zadaniach");
    const taskId = Number(
      db()
        .prepare(
          "INSERT INTO wms_replenishment(tw_id,source,target,quantity,source_version,target_version,user_id,created_at) VALUES (?,?,?,?,?,?,?,?)",
        )
        .run(
          input.twId,
          input.source,
          input.target,
          input.quantity,
          from!.version,
          to!.version,
          actor.id,
          nowIso(),
        ).lastInsertRowid,
    );
    return { id: taskId };
  });
}

export function completeReplenishment(
  actor: Actor,
  key: string,
  taskId: number,
  raw: unknown,
) {
  const input = z
    .object({
      source: code,
      target: code,
      barcode: z.string().trim().min(1).max(120),
      quantity,
    })
    .strict()
    .parse(raw);
  return command(
    key,
    actor,
    "replenishment_complete",
    { taskId, ...input },
    () => {
      const task = db()
        .prepare("SELECT * FROM wms_replenishment WHERE id=?")
        .get(id.parse(taskId)) as Task | undefined;
      if (!task || task.completed_at || task.cancelled_at)
        fail("Zadanie jest już zamknięte albo nie istnieje");
      if (task!.user_id !== actor.id) fail("Zadanie obsługuje inna osoba", 403);
      if (
        task!.source !== input.source ||
        task!.target !== input.target ||
        task!.quantity !== input.quantity
      )
        fail("Zeskanuj źródło, cel i potwierdź przydzieloną ilość", 400);
      checkBarcode(product(task!.tw_id), input.barcode);
      // Dopisanie do celu nie nadpisuje jego stanu, więc zwykła zbiórka na celu nie powinna zatrzymywać uzupełnienia.
      if (
        stock(task!.tw_id, input.source)?.version !== task!.source_version ||
        !stock(task!.tw_id, input.target)
      )
        fail(
          "Zapas zmienił się od przydziału. Anuluj zadanie i przygotuj nowy plan",
        );
      if (
        checkOpen(task!.tw_id, input.source) ||
        checkOpen(task!.tw_id, input.target)
      )
        fail("Najpierw przelicz zablokowaną lokalizację");
      if (
        db().prepare("SELECT mode FROM wms_bin WHERE bin=?").get(input.source)
          ?.mode !== "reserve" ||
        (db().prepare("SELECT mode FROM wms_bin WHERE bin=?").get(input.target)
          ?.mode ?? "pick") !== "pick"
      )
        fail("Przeznaczenie lokalizacji zmieniło się. Przygotuj nowy plan");
      // W tej samej transakcji zwalniamy własny przydział; cudze sztuki nadal chroni move.
      db()
        .prepare("UPDATE wms_replenishment SET completed_at=? WHERE id=?")
        .run(nowIso(), taskId);
      applyStock(actor, {
        action: "transfer",
        twId: task!.tw_id,
        bin: input.source,
        target: input.target,
        quantity: input.quantity,
        reason: `Uzupełnienie #${taskId}`,
      });
      return { completed: true, id: taskId };
    },
  );
}

export function cancelReplenishment(
  actor: Actor,
  key: string,
  taskId: number,
  raw: unknown,
) {
  const input = z.object({ reason }).strict().parse(raw);
  return command(
    key,
    actor,
    "replenishment_cancel",
    { taskId, ...input },
    () => {
      const task = db()
        .prepare("SELECT * FROM wms_replenishment WHERE id=?")
        .get(id.parse(taskId)) as Task | undefined;
      if (!task || task.completed_at || task.cancelled_at)
        fail("Zadanie jest zamknięte albo nie istnieje");
      if (task!.user_id !== actor.id) manager(actor);
      db()
        .prepare(
          "UPDATE wms_replenishment SET cancelled_at=?,reason=? WHERE id=?",
        )
        .run(nowIso(), input.reason, taskId);
      return { cancelled: true, id: taskId };
    },
  );
}

export function countStockCheck(
  actor: Actor,
  key: string,
  checkId: number,
  raw: unknown,
) {
  manager(actor);
  const input = z
    .object({
      bin: code,
      barcode: z.string().trim().min(1).max(120),
      quantity: z.number().int().min(0).max(1000000),
      version: id,
      reason,
    })
    .strict()
    .parse(raw);
  return command(key, actor, "stock_check_count", { checkId, ...input }, () => {
    if (
      db()
        .prepare(
          "SELECT 1 FROM wms_stock_observation WHERE check_id=? AND reviewed_at IS NULL",
        )
        .get(checkId)
    )
      fail("Najpierw zatwierdź wynik z kolektora albo zleć ponowne liczenie");
    return applyStockCheckCount(actor, checkId, input);
  });
}

// Tylko wewnątrz command: akceptacja obserwacji i korekta zapasu muszą mieć wspólny wynik.
export function applyStockCheckCount(
  actor: Actor,
  checkId: number,
  input: {
    bin: string;
    barcode: string;
    quantity: number;
    version: number;
    reason: string;
  },
) {
  manager(actor);
  if (!db().isTransaction)
    throw new Error("Przeliczenie wymaga transakcji command");
  const check = db()
    .prepare("SELECT * FROM wms_stock_check WHERE id=? AND resolved_at IS NULL")
    .get(id.parse(checkId));
  if (!check || check.bin !== input.bin)
    fail("Zeskanuj lokalizację otwartego przeliczenia", 400);
  const twId = Number(check!.tw_id),
    current = stock(twId, input.bin);
  if (
    db()
      .prepare(
        "SELECT 1 FROM wms_replenishment WHERE tw_id=? AND (source=? OR target=?) AND completed_at IS NULL AND cancelled_at IS NULL",
      )
      .get(twId, input.bin, input.bin)
  )
    fail(
      "Najpierw rozlicz uzupełnienie tej półki. Przy anulowaniu odłóż towar na źródło przed przeliczeniem",
    );
  if (!current || current.version !== input.version)
    fail("Stan zmienił się. Odśwież dane i przelicz ponownie");
  checkBarcode(product(twId), input.barcode);
  const affected = db()
    .prepare(
      `SELECT a.*,l.order_id FROM wms_allocation a JOIN wms_line l ON l.id=a.line_id
      JOIN wms_order o ON o.id=l.order_id WHERE l.tw_id=? AND a.bin=? AND a.quantity>a.picked ORDER BY o.priority DESC,o.due_at,o.id`,
    )
    .all(twId, input.bin);
  const orderIds = [...new Set(affected.map((a) => Number(a.order_id)))];
  // Liczymy stan fizyczny na półce. Rezerwacje niezebranych sztuk wracają dopiero po zweryfikowaniu rzeczywistego zapasu.
  for (const a of affected) {
    move(
      actor,
      twId,
      input.bin,
      0,
      -(Number(a.quantity) - Number(a.picked)),
      "release",
      input.reason,
      Number(a.order_id),
    );
    if (a.picked)
      db()
        .prepare("UPDATE wms_allocation SET quantity=picked WHERE id=?")
        .run(a.id);
    else db().prepare("DELETE FROM wms_allocation WHERE id=?").run(a.id);
  }
  applyStock(actor, {
    action: "count",
    twId,
    bin: input.bin,
    quantity: input.quantity,
    version: stock(twId, input.bin)!.version,
    reason: input.reason,
  });
  db()
    .prepare(
      "UPDATE wms_stock_check SET resolved_at=?,counted=?,resolution=? WHERE id=?",
    )
    .run(nowIso(), input.quantity, input.reason, checkId);
  const results: { orderId: number; reserved: boolean; error?: string }[] = [];
  for (const orderId of orderIds) {
    db().exec("SAVEPOINT repair_order");
    try {
      fillOrderReservations(actor, orderId);
      db().exec("RELEASE repair_order");
      results.push({ orderId, reserved: true });
    } catch (error) {
      db().exec("ROLLBACK TO repair_order");
      db().exec("RELEASE repair_order");
      if (!(error instanceof WmsError)) throw error;
      db()
        .prepare(
          "UPDATE wms_order SET hold_reason=coalesce(hold_reason,?) WHERE id=?",
        )
        .run(`Brak po przeliczeniu: ${error.message}`, orderId);
      results.push({ orderId, reserved: false, error: error.message });
    }
    db()
      .prepare("UPDATE wms_order SET version=version+1,updated_at=? WHERE id=?")
      .run(nowIso(), orderId);
  }
  // Zgłoszenie pozostaje do decyzji biura. Przeliczenie półki nie potwierdza zawartości skrzynki.
  return { checkId, counted: input.quantity, results };
}
