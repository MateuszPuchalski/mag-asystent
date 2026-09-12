import { z } from "zod";
import { db, nowIso } from "../db/db.js";
import { destinationHints } from "./wms-destination-hints.js";
import {
  checkBarcode,
  command,
  manager,
  move,
  readSnapshot,
  WmsError,
  type Actor,
} from "./wms.js";

const id = z.number().int().positive();
const code = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9][A-Z0-9-]{0,29}$/);
const reason = z.string().trim().min(3).max(500);
const fail = (message: string, status = 409): never => {
  throw new WmsError(status, message);
};
type Work = {
  id: number;
  receipt_id: number;
  tw_id: number;
  source: string;
  quantity: number;
  remaining: number;
  user_id: number | null;
  version: number;
  created_at: string;
  completed_at: string | null;
  sku: string;
  name: string;
  barcode: string | null;
  line_id: number;
  inbound_id: number;
  reference: string;
  closed_at: string | null;
};
const select = `SELECT w.*,l.sku,l.name,l.barcode,l.id AS line_id,l.inbound_id,d.reference,d.closed_at
 FROM wms_putaway_work w JOIN wms_inbound_putaway p ON p.id=w.receipt_id
 JOIN wms_inbound_line l ON l.id=p.line_id JOIN wms_inbound d ON d.id=l.inbound_id`;
function work(taskId: number): Work {
  return (
    (db()
      .prepare(select + " WHERE w.id=?")
      .get(id.parse(taskId)) as Work | undefined) ??
    fail("Nie ma takiego zadania odkładania", 404)
  );
}
export function listPutaway(actor: Actor, raw: unknown) {
  const f = z
    .object({
      q: z.string().trim().max(120).default(""),
      offset: z.coerce.number().int().min(0).max(1000000).default(0),
      mine: z.enum(["0", "1"]).default("0"),
    })
    .parse(raw);
  return readSnapshot(() => {
    const where =
      " WHERE w.remaining>0 AND (?='0' OR w.user_id=?) AND instr(lower(l.sku||' '||coalesce(l.barcode,'')||' '||l.name||' '||d.reference||' '||w.source),lower(?))>0";
    const args = [f.mine, actor.id, f.q];
    const rows = db()
      .prepare(select + where + " ORDER BY w.created_at,w.id LIMIT 50 OFFSET ?")
      .all(...args, f.offset);
    const totals = db()
      .prepare(
        "SELECT count(*) AS tasks,coalesce(sum(remaining),0) AS units,min(created_at) AS oldest FROM (" +
          select +
          where +
          ")",
      )
      .get(...args)!;
    return { rows, totals };
  });
}
export function getPutaway(taskId: number) {
  return readSnapshot(() => {
    const task = work(taskId);
    const bins = destinationHints([task.tw_id], task.source);
    const steps = db()
      .prepare(
        "SELECT * FROM wms_putaway_step WHERE task_id=? ORDER BY id DESC LIMIT 100",
      )
      .all(task.id);
    return { ...task, bins, steps };
  });
}
export function claimPutaway(
  actor: Actor,
  key: string,
  taskId: number,
  raw: unknown,
) {
  const input = z
    .object({ version: id, reason: z.string().trim().max(500).default("") })
    .strict()
    .parse(raw);
  return command(key, actor, "putaway_claim", { taskId, ...input }, () => {
    const task = work(taskId);
    if (!task.remaining || task.version !== input.version)
      fail("Zadanie zmieniło się. Odśwież kolejkę");
    if (task.user_id !== null && task.user_id !== actor.id) {
      manager(actor);
      reason.parse(input.reason);
    }
    db()
      .prepare(
        "UPDATE wms_putaway_work SET user_id=?,version=version+1 WHERE id=?",
      )
      .run(actor.id, task.id);
    return getPutaway(task.id);
  });
}
export function finishPutaway(
  actor: Actor,
  key: string,
  taskId: number,
  raw: unknown,
) {
  const input = z
    .object({
      version: id,
      source: code,
      target: code,
      barcode: z.string().trim().min(1).max(120),
      quantity: id.max(1000000),
      disposition: z.enum(["good", "damaged"]).default("good"),
      reason: z.string().trim().max(500).default(""),
    })
    .strict()
    .parse(raw);
  return command(key, actor, "putaway_finish", { taskId, ...input }, () => {
    const task = work(taskId);
    verify(task, input);
    if (task.user_id !== actor.id)
      fail("Najpierw podejmij zadanie na swoje konto", 403);
    if (task.source === input.target)
      fail("Zeskanuj półkę docelową, inną niż bufor", 400);
    const bin = db()
      .prepare(
        `SELECT mode FROM wms_bin WHERE bin=? UNION ALL SELECT 'pick' AS mode
      WHERE EXISTS(SELECT 1 FROM wms_stock WHERE bin=?) AND NOT EXISTS(SELECT 1 FROM wms_bin WHERE bin=?) LIMIT 1`,
      )
      .get(input.target, input.target, input.target);
    if (
      !bin ||
      (bin.mode === "quarantine") !== (input.disposition === "damaged")
    )
      fail(
        "Zeskanuj właściwą półkę: dobry towar na kompletację lub zaplecze, uszkodzony do kwarantanny",
        400,
      );
    if (input.disposition === "damaged") reason.parse(input.reason);
    // Rezerwacja zadania maleje w tej samej transakcji co oba ruchy.
    // Odmowa na celu wycofuje także źródło, historię i pozostałą ilość.
    reduce(task, input.quantity);
    move(
      actor,
      task.tw_id,
      task.source,
      -input.quantity,
      0,
      "transfer",
      `Odłożenie dostawy ${task.reference}`,
    );
    move(
      actor,
      task.tw_id,
      input.target,
      input.quantity,
      0,
      "transfer",
      `Odłożenie dostawy ${task.reference}`,
    );
    if (input.disposition === "damaged") {
      db()
        .prepare(
          "UPDATE wms_inbound_line SET damaged=damaged+?,version=version+1 WHERE id=?",
        )
        .run(input.quantity, task.line_id);
      db()
        .prepare("UPDATE wms_inbound SET version=version+1 WHERE id=?")
        .run(task.inbound_id);
    }
    step(
      task,
      actor,
      input.disposition === "damaged" ? "quarantine" : "putaway",
      input.target,
      input.quantity,
      input.reason,
    );
    return getPutaway(task.id);
  });
}
export function correctPutaway(
  actor: Actor,
  key: string,
  taskId: number,
  raw: unknown,
) {
  manager(actor);
  const input = z
    .object({
      version: id,
      source: code,
      barcode: z.string().trim().min(1).max(120),
      quantity: id.max(1000000),
      reason,
    })
    .strict()
    .parse(raw);
  return command(key, actor, "putaway_correct", { taskId, ...input }, () => {
    const task = work(taskId);
    verify(task, input);
    if (task.closed_at)
      fail("Otwórz dokument przyjęcia przed korektą policzonej ilości");
    reduce(task, input.quantity);
    // Korekta rozlicza tylko brakujące, jeszcze nieodłożone sztuki. Nie może
    // odebrać zapasu z półek, na których rozpoczęła się już zbiórka.
    move(
      actor,
      task.tw_id,
      task.source,
      -input.quantity,
      0,
      "inbound_correction",
      input.reason,
    );
    const corrected = db()
      .prepare(
        "UPDATE wms_inbound_line SET received=received-?,version=version+1 WHERE id=? AND received-damaged>=?",
      )
      .run(input.quantity, task.line_id, input.quantity);
    if (corrected.changes !== 1)
      fail("Ilość przyjęcia nie pozwala na taką korektę");
    db()
      .prepare("UPDATE wms_inbound SET version=version+1 WHERE id=?")
      .run(task.inbound_id);
    step(task, actor, "correction", null, input.quantity, input.reason);
    return getPutaway(task.id);
  });
}
function verify(
  task: Work,
  input: { version: number; source: string; barcode: string; quantity: number },
) {
  if (!task.remaining || task.version !== input.version)
    fail("Pozostała ilość zmieniła się. Odśwież zadanie");
  if (input.source !== task.source) fail("Zeskanuj bufor tego przyjęcia", 400);
  checkBarcode(task, input.barcode);
  if (input.quantity > task.remaining)
    fail("Ilość przekracza pozostałe sztuki", 400);
}
function reduce(task: Work, quantity: number) {
  db()
    .prepare(
      "UPDATE wms_putaway_work SET remaining=remaining-?,version=version+1,completed_at=CASE WHEN remaining=? THEN ? ELSE NULL END WHERE id=?",
    )
    .run(quantity, quantity, nowIso(), task.id);
}
function step(
  task: Work,
  actor: Actor,
  kind: string,
  target: string | null,
  quantity: number,
  why: string,
) {
  db()
    .prepare(
      "INSERT INTO wms_putaway_step(task_id,kind,target,quantity,reason,user_id,created_at) VALUES (?,?,?,?,?,?,?)",
    )
    .run(task.id, kind, target, quantity, why, actor.id, nowIso());
}
