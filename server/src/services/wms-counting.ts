import { z } from "zod";
import { db, nowIso } from "../db/db.js";
import {
  command,
  manager,
  checkBarcode,
  readSnapshot,
  WmsError,
  type Actor,
} from "./wms.js";
import { applyStockCheckCount } from "./wms-stock-work.js";

const id = z.number().int().positive();
const reason = z.string().trim().min(3).max(500);
const fail = (message: string, status = 409): never => {
  throw new WmsError(status, message);
};
const selection = `SELECT c.id,c.tw_id,c.bin,c.reason,c.resolved_at,p.symbol AS sku,p.nazwa AS name,p.ean AS barcode,
  s.version,EXISTS(SELECT 1 FROM wms_stock_observation v WHERE v.check_id=c.id AND v.reviewed_at IS NULL) AS pending,
  (SELECT v.reason FROM wms_stock_observation v WHERE v.check_id=c.id AND v.decision='recount' ORDER BY v.id DESC LIMIT 1) AS recount_reason
  FROM wms_stock_check c JOIN wms_product p ON p.tw_id=c.tw_id JOIN wms_stock s ON s.tw_id=c.tw_id AND s.bin=c.bin`;

export function countTask(_actor: Actor, checkId: number) {
  return (
    db().prepare(`${selection} WHERE c.id=?`).get(id.parse(checkId)) ??
    fail("Nie ma zadania przeliczenia", 404)
  );
}

export function countQueue(_actor: Actor, raw: unknown) {
  const input = z
    .object({
      q: z.string().trim().max(120).default(""),
      offset: z.coerce.number().int().min(0).max(1000000).default(0),
    })
    .strict()
    .parse(raw);
  // Lista i licznik widzą ten sam stan; żaden odczyt nie zakłada ani nie podejmuje pracy.
  return readSnapshot(() => {
    const where = ` WHERE c.resolved_at IS NULL AND (?='' OR instr(lower(c.bin),lower(?))>0 OR instr(lower(p.symbol),lower(?))>0 OR p.ean=?)`;
    const args = [input.q, input.q, input.q, input.q];
    const rows = db()
      .prepare(
        `${selection}${where} ORDER BY pending,c.created_at,c.id LIMIT 50 OFFSET ?`,
      )
      .all(...args, input.offset);
    const totals = db()
      .prepare(
        `SELECT count(*) AS tasks FROM wms_stock_check c JOIN wms_product p ON p.tw_id=c.tw_id${where}`,
      )
      .get(...args);
    return { rows, totals };
  });
}

export function observeCount(
  actor: Actor,
  key: string,
  checkId: number,
  raw: unknown,
) {
  const input = z
    .object({
      bin: z.string().trim().toUpperCase().min(1).max(30),
      barcode: z.string().trim().min(1).max(120),
      quantity: z.number().int().min(0).max(1000000),
      version: id,
    })
    .strict()
    .parse(raw);
  return command(
    key,
    actor,
    "stock_count_observe",
    { checkId, ...input },
    () => {
      const task = countTask(actor, checkId);
      if (task.resolved_at || task.pending)
        fail("Liczenie jest już zapisane. Odśwież kolejkę");
      if (task.bin !== input.bin) fail("Zeskanuj półkę tego przeliczenia", 400);
      checkBarcode(
        { sku: String(task.sku), barcode: task.barcode as string | null },
        input.barcode,
      );
      if (task.version !== input.version)
        fail("Stan zmienił się. Odśwież zadanie i policz ponownie");
      if (
        db()
          .prepare(
            `SELECT 1 FROM wms_replenishment WHERE tw_id=? AND (source=? OR target=?) AND completed_at IS NULL AND cancelled_at IS NULL`,
          )
          .get(task.tw_id, task.bin, task.bin)
      )
        fail("Najpierw rozlicz uzupełnienie tej półki, potem policz ponownie");
      const observationId = Number(
        db()
          .prepare(
            `INSERT INTO wms_stock_observation(check_id,quantity,stock_version,barcode,user_id,created_at) VALUES (?,?,?,?,?,?)`,
          )
          .run(
            checkId,
            input.quantity,
            input.version,
            input.barcode,
            actor.id,
            nowIso(),
          ).lastInsertRowid,
      );
      return { checkId, observationId, pending: true };
    },
  );
}

export function reviewCount(
  actor: Actor,
  key: string,
  checkId: number,
  raw: unknown,
) {
  manager(actor);
  const input = z
    .object({
      observationId: id,
      decision: z.enum(["accept", "recount"]),
      reason,
    })
    .strict()
    .parse(raw);
  return command(
    key,
    actor,
    "stock_count_review",
    { checkId, ...input },
    () => {
      const task = countTask(actor, checkId);
      const observed = db()
        .prepare(
          "SELECT * FROM wms_stock_observation WHERE id=? AND check_id=? AND reviewed_at IS NULL",
        )
        .get(input.observationId, checkId);
      if (!observed || task.resolved_at)
        fail("Wynik już rozstrzygnięty. Odśwież kolejkę");
      let result;
      if (input.decision === "accept") {
        // Ilość pochodzi wyłącznie z niezmiennej obserwacji, nigdy z edytowalnego formularza biura.
        result = applyStockCheckCount(actor, checkId, {
          bin: String(task.bin),
          barcode: String(observed!.barcode),
          quantity: Number(observed!.quantity),
          version: Number(observed!.stock_version),
          reason: input.reason,
        });
      }
      db()
        .prepare(
          "UPDATE wms_stock_observation SET reviewed_at=?,reviewer_id=?,decision=?,reason=? WHERE id=?",
        )
        .run(
          nowIso(),
          actor.id,
          input.decision,
          input.reason,
          input.observationId,
        );
      return result ?? { checkId, recount: true };
    },
  );
}
