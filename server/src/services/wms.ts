import { createHash } from "node:crypto";
import { z } from "zod";
import { db, nowIso } from "../db/db.js";
import { logEvent } from "./events.js";
import type { Rola } from "./users.js";

export type Actor = { id: number; name: string; role: Rola };
export class WmsError extends Error {
  constructor(
    public statusCode: number,
    message: string,
  ) {
    super(message);
  }
}
const fail = (message: string, status = 409): never => {
  throw new WmsError(status, message);
};
const id = z.number().int().positive().max(2_147_483_647);
const qty = z.number().int().positive().max(1_000_000);
const label = z.string().trim().min(1).max(120);
const bin = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9][A-Z0-9-]{0,29}$/, "Niepoprawny kod lokalizacji");
const reason = z.string().trim().min(3).max(500);
const version = z.number().int().positive();
export const orderInput = z
  .object({
    reference: label,
    channel: label.default("sklep"),
    priority: z.number().int().min(0).max(2).default(0),
    dueAt: z.iso
      .datetime({ offset: true })
      .transform((v) => new Date(v).toISOString()),
    lines: z
      .array(z.object({ sku: label, quantity: qty }).strict())
      .min(1)
      .max(200),
  })
  .strict();
export const stockInput = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("receive"),
      twId: id,
      bin,
      quantity: qty,
      reason,
    })
    .strict(),
  z
    .object({
      action: z.literal("count"),
      twId: id,
      bin,
      quantity: z.number().int().min(0).max(1_000_000),
      version,
      reason,
    })
    .strict(),
  z
    .object({
      action: z.literal("transfer"),
      twId: id,
      bin,
      target: bin,
      quantity: qty,
      reason,
    })
    .strict(),
  z
    .object({
      action: z.literal("minimum"),
      twId: id,
      bin,
      quantity: z.number().int().min(0).max(1_000_000),
      version,
      reason,
    })
    .strict(),
]);
export const actionInput = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("amend"),
      version,
      reason,
      lines: orderInput.shape.lines,
      dueAt: orderInput.shape.dueAt,
      priority: orderInput.shape.priority,
    })
    .strict(),
  z.object({ action: z.literal("allocate"), version }).strict(),
  z.object({ action: z.literal("pick-start"), version, tote: bin }).strict(),
  z
    .object({
      action: z.literal("pick"),
      tote: bin.optional(),
      version,
      allocationId: id,
      barcode: label,
      bin,
      quantity: qty,
    })
    .strict(),
  z.object({ action: z.literal("pack-start"), version, tote: bin }).strict(),
  z
    .object({
      action: z.literal("pack"),
      version,
      barcode: label,
      quantity: qty,
    })
    .strict(),
  z
    .object({
      action: z.literal("ship"),
      version,
      carrier: label,
      tracking: label,
      weightG: qty,
      extraParcels: z
        .array(
          z.object({ carrier: label, tracking: label, weightG: qty }).strict(),
        )
        .max(19)
        .default([]),
    })
    .strict(),
  z.object({ action: z.literal("hold"), version, reason }).strict(),
  z.object({ action: z.literal("resume"), version, reason }).strict(),
  z.object({ action: z.literal("takeover"), version, reason }).strict(),
  z
    .object({
      action: z.literal("return"),
      version,
      allocationId: id,
      barcode: label,
      bin,
      quantity: qty,
      reason,
    })
    .strict(),
  z.object({ action: z.literal("cancel"), version, reason }).strict(),
]);
type Stock = {
  tw_id: number;
  bin: string;
  on_hand: number;
  reserved: number;
  minimum: number;
  version: number;
};
export type Order = {
  id: number;
  reference: string;
  channel: string;
  status: string;
  priority: number;
  due_at: string;
  created_at: string;
  updated_at: string;
  allocated_at: string | null;
  picked_at: string | null;
  packed_at: string | null;
  shipped_at: string | null;
  picker_id: number | null;
  packer_id: number | null;
  tote: string | null;
  hold_reason: string | null;
  version: number;
};
type Line = {
  id: number;
  order_id: number;
  tw_id: number;
  sku: string;
  name: string;
  barcode: string | null;
  quantity: number;
  picked: number;
  packed: number;
};
type Allocation = {
  id: number;
  line_id: number;
  bin: string;
  quantity: number;
  picked: number;
};

export function manager(actor: Actor): void {
  if (actor.role !== "admin" && actor.role !== "biuro")
    fail("Ta operacja wymaga uprawnień biura", 403);
}

// Transakcja obejmuje walidację stanu, ruchy, audyt i odpowiedź na ponowienie.
// Nie wolno przekazywać async: oczekiwanie oddałoby połączenie innemu żądaniu.
export function command<T>(
  key: string,
  actor: Actor,
  scope: string,
  input: unknown,
  run: () => T,
): T {
  if (!/^[a-zA-Z0-9_-]{16,100}$/.test(key))
    fail("Wymagany poprawny Idempotency-Key (16–100 znaków)", 400);
  const fingerprint = createHash("sha256")
    .update(JSON.stringify([actor.id, scope, input]))
    .digest("hex");
  const d = db();
  d.exec("BEGIN IMMEDIATE");
  try {
    const previous = d
      .prepare("SELECT fingerprint, response FROM wms_command WHERE key=?")
      .get(key) as { fingerprint: string; response: string } | undefined;
    if (previous) {
      if (previous.fingerprint !== fingerprint)
        fail("Klucz ponowienia należy do innej operacji");
      d.exec("COMMIT");
      return JSON.parse(previous.response) as T;
    }
    const result = run();
    if (result instanceof Promise)
      throw new Error("WMS transaction must be synchronous");
    logEvent(`wms_${scope}`, actor.name, null, input, actor.id);
    d.prepare(
      "INSERT INTO wms_command(key,fingerprint,response,created_at) VALUES (?,?,?,?)",
    ).run(key, fingerprint, JSON.stringify(result), nowIso());
    d.exec("COMMIT");
    return result;
  } catch (e) {
    try {
      d.exec("ROLLBACK");
    } catch {
      /* SQLite mógł już wycofać transakcję po awarii dysku. */
    }
    throw e;
  }
}

function stock(twId: number, address: string): Stock | undefined {
  return db()
    .prepare("SELECT * FROM wms_stock WHERE tw_id=? AND bin=?")
    .get(twId, address) as Stock | undefined;
}

export function configureBin(actor: Actor, key: string, raw: unknown) {
  manager(actor);
  const input = z
    .object({
      bin,
      mode: z.enum(["pick", "reserve", "quarantine"]),
      version,
      reason,
    })
    .strict()
    .parse(raw);
  return command(key, actor, "bin", input, () => {
    const d = db();
    const current = d
      .prepare("SELECT * FROM wms_bin WHERE bin=?")
      .get(input.bin);
    if ((current?.version ?? 1) !== input.version)
      fail("Lokalizacja zmieniła się. Odśwież listę");
    if (
      input.mode !== "pick" &&
      d
        .prepare("SELECT 1 FROM wms_stock WHERE bin=? AND reserved>0 LIMIT 1")
        .get(input.bin)
    )
      fail("Lokalizacja ma aktywne rezerwacje. Najpierw rozwiąż zamówienia");
    d.prepare(
      `INSERT INTO wms_bin(bin,mode,version) VALUES (?,?,2)
      ON CONFLICT(bin) DO UPDATE SET mode=excluded.mode,version=wms_bin.version+1`,
    ).run(input.bin, input.mode);
    return { ...d.prepare("SELECT * FROM wms_bin WHERE bin=?").get(input.bin) };
  });
}

export function listBins(raw: unknown) {
  const f = z
    .object({
      q: z.string().trim().max(30).default(""),
      limit: z.coerce.number().int().min(1).max(100).default(50),
      offset: z.coerce.number().int().min(0).max(100000).default(0),
    })
    .parse(raw);
  const base = `WITH addresses AS (SELECT bin FROM wms_stock UNION SELECT bin FROM wms_bin)
    SELECT a.bin,coalesce(b.mode,'pick') AS mode,coalesce(b.version,1) AS version,
    coalesce(sum(s.on_hand),0) AS on_hand,coalesce(sum(s.reserved),0) AS reserved
    FROM addresses a LEFT JOIN wms_bin b ON b.bin=a.bin LEFT JOIN wms_stock s ON s.bin=a.bin
    WHERE instr(a.bin,upper(?))>0 GROUP BY a.bin`;
  const rows = db()
    .prepare(`${base} ORDER BY a.bin LIMIT ? OFFSET ?`)
    .all(f.q, f.limit, f.offset);
  const total = db().prepare(`SELECT count(*) AS n FROM (${base})`).get(f.q)!.n;
  return { rows, total, ...f };
}

function move(
  actor: Actor,
  twId: number,
  address: string,
  delta: number,
  reserved: number,
  kind: string,
  why: string,
  orderId: number | null = null,
): void {
  const d = db();
  d.prepare("INSERT OR IGNORE INTO wms_stock(tw_id,bin) VALUES (?,?)").run(
    twId,
    address,
  );
  const changed = d
    .prepare(
      `UPDATE wms_stock SET on_hand=on_hand+?, reserved=reserved+?, version=version+1
    WHERE tw_id=? AND bin=? AND on_hand+? >= 0 AND reserved+? >= 0 AND reserved+? <= on_hand+?`,
    )
    .run(delta, reserved, twId, address, delta, reserved, reserved, delta);
  if (!changed.changes) fail(`Za mało dostępnego towaru na ${address}`);
  d.prepare(
    `INSERT INTO wms_movement(tw_id,bin,delta,reserved_delta,kind,order_id,reason,user_id,created_at)
    VALUES (?,?,?,?,?,?,?,?,?)`,
  ).run(twId, address, delta, reserved, kind, orderId, why, actor.id, nowIso());
}

export function changeStock(actor: Actor, key: string, raw: unknown) {
  const input = stockInput.parse(raw);
  if (input.action === "count" || input.action === "minimum") manager(actor);
  return command(key, actor, "stock", input, () => {
    const d = db();
    const catalog = d
      .prepare("SELECT tw_id,symbol,nazwa,ean FROM sgt_towar WHERE tw_id=?")
      .get(input.twId);
    if (catalog)
      d.prepare(
        `INSERT INTO wms_product(tw_id,symbol,nazwa,ean) VALUES (?,?,?,?)
      ON CONFLICT(tw_id) DO UPDATE SET symbol=excluded.symbol,nazwa=excluded.nazwa,ean=excluded.ean`,
      ).run(catalog.tw_id, catalog.symbol, catalog.nazwa, catalog.ean);
    else if (
      !d.prepare("SELECT 1 FROM wms_product WHERE tw_id=?").get(input.twId)
    )
      fail("Nie ma takiego towaru", 404);
    const current = stock(input.twId, input.bin);
    if ("version" in input && (current?.version ?? 1) !== input.version)
      fail("Stan zmienił się. Odśwież i przelicz ponownie");
    if (input.action === "receive")
      move(
        actor,
        input.twId,
        input.bin,
        input.quantity,
        0,
        "receive",
        input.reason,
      );
    if (input.action === "count")
      move(
        actor,
        input.twId,
        input.bin,
        input.quantity - (current?.on_hand ?? 0),
        0,
        "count",
        input.reason,
      );
    if (input.action === "transfer") {
      if (
        d
          .prepare("SELECT 1 FROM wms_bin WHERE bin=? AND mode='quarantine'")
          .get(input.bin)
      )
        manager(actor);
      if (input.bin === input.target)
        fail("Wybierz inną lokalizację docelową", 400);
      move(
        actor,
        input.twId,
        input.bin,
        -input.quantity,
        0,
        "transfer",
        input.reason,
      );
      move(
        actor,
        input.twId,
        input.target,
        input.quantity,
        0,
        "transfer",
        input.reason,
      );
    }
    if (input.action === "minimum") {
      d.prepare("INSERT OR IGNORE INTO wms_stock(tw_id,bin) VALUES (?,?)").run(
        input.twId,
        input.bin,
      );
      d.prepare(
        "UPDATE wms_stock SET minimum=?,version=version+1 WHERE tw_id=? AND bin=?",
      ).run(input.quantity, input.twId, input.bin);
    }
    return stock(input.twId, input.bin)!;
  });
}

export function createOrder(actor: Actor, key: string, raw: unknown) {
  manager(actor);
  const input = orderInput.parse(raw);
  return command(key, actor, "create", input, () => insertOrder(input));
}

function insertOrder(input: z.infer<typeof orderInput>) {
  const d = db();
  if (
    db()
      .prepare("SELECT 1 FROM wms_order WHERE reference=? AND channel=?")
      .get(input.reference, input.channel)
  )
    fail("Zamówienie o tym numerze już istnieje w tym kanale");
  const now = nowIso();
  const result = d
    .prepare(
      `INSERT INTO wms_order(reference,channel,priority,due_at,created_at,updated_at)
      VALUES (?,?,?,?,?,?)`,
    )
    .run(input.reference, input.channel, input.priority, input.dueAt, now, now);
  const orderId = Number(result.lastInsertRowid);
  writeOrderLines(orderId, input.lines);
  return getOrder(orderId);
}

function writeOrderLines(
  orderId: number,
  lines: z.infer<typeof orderInput>["lines"],
) {
  const d = db();
  const merged = new Map<
    number,
    { sku: string; name: string; barcode: string | null; quantity: number }
  >();
  for (const line of lines) {
    const found = d
      .prepare(
        "SELECT tw_id,symbol,nazwa,ean FROM sgt_towar WHERE symbol=? COLLATE NOCASE LIMIT 2",
      )
      .all(line.sku) as {
      tw_id: number;
      symbol: string;
      nazwa: string;
      ean: string | null;
    }[];
    if (found.length !== 1)
      fail(
        `Symbol ${line.sku}: ${found.length ? "niejednoznaczna kartoteka" : "brak kartoteki"}`,
        400,
      );
    const p = found[0];
    const quantity = (merged.get(p.tw_id)?.quantity ?? 0) + line.quantity;
    if (quantity > 1_000_000) fail("Przekroczony limit ilości pozycji", 400);
    merged.set(p.tw_id, {
      sku: p.symbol,
      name: p.nazwa,
      barcode: p.ean,
      quantity,
    });
  }
  for (const [twId, p] of merged)
    d.prepare(
      "INSERT INTO wms_line(order_id,tw_id,sku,name,barcode,quantity) VALUES (?,?,?,?,?,?)",
    ).run(orderId, twId, p.sku, p.name, p.barcode, p.quantity);
}

export const batchInput = z
  .object({ orders: z.array(orderInput).min(1).max(200) })
  .strict();
export function importOrders(actor: Actor, key: string, raw: unknown) {
  manager(actor);
  const input = batchInput.parse(raw);
  return command(key, actor, "import", input, () => {
    const result: { id: number; reference: string; created: boolean }[] = [];
    for (const item of input.orders) {
      const existing = db()
        .prepare("SELECT id FROM wms_order WHERE reference=? AND channel=?")
        .get(item.reference, item.channel);
      if (existing) {
        const old = getOrder(Number(existing.id));
        const sums = (lines: { sku: string; quantity: number }[]) => {
          const merged = new Map<string, number>();
          for (const l of lines)
            merged.set(
              l.sku.toUpperCase(),
              (merged.get(l.sku.toUpperCase()) ?? 0) + l.quantity,
            );
          return JSON.stringify(
            [...merged].sort(([a], [b]) => a.localeCompare(b)),
          );
        };
        if (
          old.due_at !== item.dueAt ||
          old.priority !== item.priority ||
          sums(old.lines) !== sums(item.lines)
        )
          fail(
            `Zamówienie ${item.reference} już istnieje z inną treścią. Import wycofano`,
          );
        result.push({ id: old.id, reference: old.reference, created: false });
      } else {
        const created = insertOrder(item);
        result.push({
          id: created.id,
          reference: created.reference,
          created: true,
        });
      }
    }
    return {
      orders: result,
      created: result.filter((o) => o.created).length,
      existing: result.filter((o) => !o.created).length,
    };
  });
}

function allocate(actor: Actor, order: ReturnType<typeof getOrder>) {
  if (order.status !== "new" || order.hold_reason)
    fail("Zamówienie nie jest gotowe do rezerwacji");
  const d = db();
  for (const line of order.lines) {
    let remaining = line.quantity;
    const bins = d
      .prepare(
        `SELECT s.* FROM wms_stock s LEFT JOIN wms_bin b ON b.bin=s.bin
        WHERE s.tw_id=? AND s.on_hand>s.reserved AND coalesce(b.mode,'pick')='pick' ORDER BY s.bin`,
      )
      .all(line.tw_id) as Stock[];
    for (const b of bins) {
      const amount = Math.min(remaining, b.on_hand - b.reserved);
      move(
        actor,
        line.tw_id,
        b.bin,
        0,
        amount,
        "reserve",
        order.reference,
        order.id,
      );
      d.prepare(
        "INSERT INTO wms_allocation(line_id,bin,quantity) VALUES (?,?,?)",
      ).run(line.id, b.bin, amount);
      remaining -= amount;
      if (!remaining) break;
    }
    if (remaining)
      fail(
        `Brak ${remaining} szt. ${line.sku}. Uzupełnij zapas i ponów rezerwację`,
      );
  }
  d.prepare(
    "UPDATE wms_order SET status='allocated',allocated_at=? WHERE id=?",
  ).run(nowIso(), order.id);
}

export function releaseBatch(actor: Actor, key: string, raw: unknown) {
  manager(actor);
  const input = z
    .object({
      orders: z.array(z.object({ id, version }).strict()).min(1).max(100),
    })
    .strict()
    .parse(raw);
  return command(key, actor, "release", input, () => {
    const results: { id: number; ok: boolean; error?: string }[] = [];
    for (const item of input.orders) {
      db().exec("SAVEPOINT release_order");
      try {
        const order = getOrder(item.id);
        if (order.version !== item.version)
          fail("Zamówienie zmieniło się; odśwież listę");
        allocate(actor, order);
        db()
          .prepare(
            "UPDATE wms_order SET version=version+1,updated_at=? WHERE id=?",
          )
          .run(nowIso(), item.id);
        logEvent(
          "wms_order_allocate",
          actor.name,
          null,
          { orderId: item.id, batch: true },
          actor.id,
        );
        db().exec("RELEASE release_order");
        results.push({ id: item.id, ok: true });
      } catch (e) {
        db().exec("ROLLBACK TO release_order");
        db().exec("RELEASE release_order");
        if (!(e instanceof WmsError)) throw e;
        results.push({ id: item.id, ok: false, error: e.message });
      }
    }
    return { results };
  });
}

export function getOrder(orderId: number) {
  const d = db();
  const order = d.prepare("SELECT * FROM wms_order WHERE id=?").get(orderId) as
    | Order
    | undefined;
  if (!order) return fail("Zamówienie nie istnieje", 404);
  const lines = d
    .prepare("SELECT * FROM wms_line WHERE order_id=? ORDER BY id")
    .all(orderId) as Line[];
  const allocations = d
    .prepare(
      `SELECT a.* FROM wms_allocation a JOIN wms_line l ON l.id=a.line_id
    WHERE l.order_id=? ORDER BY a.bin,a.id`,
    )
    .all(orderId) as Allocation[];
  const shipments = d
    .prepare("SELECT * FROM wms_shipment WHERE order_id=? ORDER BY package_no")
    .all(orderId);
  return {
    ...order,
    wave_id:
      d
        .prepare("SELECT wave_id FROM wms_wave_order WHERE order_id=?")
        .get(orderId)?.wave_id ?? null,
    lines,
    allocations,
    shipment: shipments[0] ?? null,
    shipments,
  };
}

function checkBarcode(line: Line, scan: string): void {
  if (line.sku.toUpperCase() === scan.toUpperCase()) return;
  if (line.barcode !== scan)
    fail("Inny towar. Zeskanuj kod oczekiwanej pozycji", 400);
  const duplicates = db()
    .prepare("SELECT tw_id FROM sgt_towar WHERE ean=? LIMIT 2")
    .all(scan);
  if (duplicates.length > 1)
    fail("Kod niejednoznaczny. Zeskanuj symbol SKU", 400);
}
function owner(current: number | null, actor: Actor): void {
  if (current !== actor.id)
    fail("Zamówienie obsługuje inna osoba. Poproś biuro o przejęcie", 403);
}

export function actOnOrder(
  actor: Actor,
  key: string,
  orderId: number,
  raw: unknown,
) {
  id.parse(orderId);
  const input = actionInput.parse(raw);
  if (
    ["allocate", "cancel", "resume", "takeover", "amend"].includes(input.action)
  )
    manager(actor);
  return command(
    key,
    actor,
    `order_${input.action}`,
    { orderId, ...input },
    () => {
      if (
        input.action === "ship" &&
        db()
          .prepare("SELECT 1 FROM wms_sellasist_link WHERE order_id=?")
          .get(orderId)
      ) {
        if (
          !db()
            .prepare(
              "SELECT 1 FROM wms_sellasist_check WHERE key=? AND order_id=? AND fingerprint=? AND checked_at>=?",
            )
            .get(
              key,
              orderId,
              shipmentFingerprint(actor, orderId, input),
              Date.now() - 60000,
            )
        )
          fail("Najpierw potwierdź zgodność przesyłki z Sellasist");
      }
      const result = applyOrderAction(actor, orderId, input);
      if (input.action === "ship")
        db().prepare("DELETE FROM wms_sellasist_check WHERE key=?").run(key);
      return result;
    },
  );
}

export function shipmentFingerprint(
  actor: Actor,
  orderId: number,
  input: unknown,
) {
  return createHash("sha256")
    .update(JSON.stringify([actor.id, orderId, input]))
    .digest("hex");
}

// Wywoływane wyłącznie wewnątrz command: skan pojedynczy i wózek mają te same reguły.
function applyOrderAction(
  actor: Actor,
  orderId: number,
  input: z.infer<typeof actionInput>,
) {
  const d = db();
  const order = getOrder(orderId);
  if (order.version !== input.version)
    fail("Zamówienie zmieniło się. Odśwież przed kolejną operacją");
  if (["shipped", "cancelled"].includes(order.status))
    fail("To zamówienie jest już zamknięte");
  if (
    order.hold_reason &&
    !["resume", "cancel", "return", "takeover", "amend"].includes(input.action)
  )
    fail(`Zamówienie wstrzymane: ${order.hold_reason}`);
  const requireState = (...states: string[]) => {
    if (!states.includes(order.status))
      fail("Operacja niedostępna na tym etapie zamówienia");
  };
  if (input.action === "allocate") {
    allocate(actor, order);
  }
  if (input.action === "amend") {
    requireState("new", "allocated", "picking");
    if (
      order.lines.some((l) => l.picked > 0) ||
      (order.status === "picking" && !order.hold_reason)
    )
      fail("Najpierw wstrzymaj zamówienie i odłóż wszystkie pobrane sztuki");
    logEvent(
      "wms_order_amend_before",
      actor.name,
      null,
      {
        orderId,
        lines: order.lines.map((l) => ({ sku: l.sku, quantity: l.quantity })),
        dueAt: order.due_at,
        priority: order.priority,
        waveId: order.wave_id,
      },
      actor.id,
    );
    for (const a of order.allocations) {
      const line = order.lines.find((l) => l.id === a.line_id)!;
      move(
        actor,
        line.tw_id,
        a.bin,
        0,
        -a.quantity,
        "release",
        input.reason,
        orderId,
      );
    }
    d.prepare(
      "DELETE FROM wms_allocation WHERE line_id IN (SELECT id FROM wms_line WHERE order_id=?)",
    ).run(orderId);
    d.prepare("DELETE FROM wms_line WHERE order_id=?").run(orderId);
    d.prepare("DELETE FROM wms_wave_order WHERE order_id=?").run(orderId);
    writeOrderLines(orderId, input.lines);
    d.prepare(
      `UPDATE wms_order SET status='new',due_at=?,priority=?,allocated_at=NULL,picked_at=NULL,packed_at=NULL,picker_id=NULL,packer_id=NULL,tote=NULL WHERE id=?`,
    ).run(input.dueAt, input.priority, orderId);
  }
  if (input.action === "pick-start") {
    requireState("allocated");
    if (
      d
        .prepare(
          "SELECT 1 FROM wms_order WHERE tote=? AND status NOT IN ('shipped','cancelled') AND id<>?",
        )
        .get(input.tote, orderId)
    )
      fail("Pojemnik jest przypisany do innego zamówienia");
    d.prepare(
      "UPDATE wms_order SET status='picking',picker_id=?,tote=? WHERE id=?",
    ).run(actor.id, input.tote, orderId);
  }
  if (input.action === "pick" || input.action === "return") {
    if (input.action === "pick") {
      if (order.wave_id && input.tote !== order.tote)
        fail("Zeskanuj pojemnik zamówienia z wózka", 400);
      requireState("picking");
      owner(order.picker_id, actor);
    } else {
      requireState("picking", "picked", "packing", "packed");
      if (!order.hold_reason)
        fail("Najpierw wstrzymaj zamówienie przed odkładaniem towaru");
      if (
        actor.role === "magazynier" &&
        actor.id !== order.picker_id &&
        actor.id !== order.packer_id
      )
        fail("Towar może odłożyć osoba przypisana do zamówienia", 403);
    }
    const a = order.allocations.find((a) => a.id === input.allocationId);
    if (!a) fail("Pozycja nie należy do tego zamówienia", 404);
    const allocation = a!;
    const line = order.lines.find((l) => l.id === allocation.line_id)!;
    checkBarcode(line, input.barcode);
    if (allocation.bin !== input.bin)
      fail(`Zeskanuj lokalizację ${allocation.bin}`, 400);
    const returning = input.action === "return";
    if (
      input.quantity >
      (returning ? allocation.picked : allocation.quantity - allocation.picked)
    )
      fail("Ilość przekracza pozostałą liczbę sztuk", 400);
    const amount = returning ? -input.quantity : input.quantity;
    move(
      actor,
      line.tw_id,
      allocation.bin,
      -amount,
      -amount,
      returning ? "return" : "pick",
      returning ? input.reason : order.reference,
      orderId,
    );
    d.prepare("UPDATE wms_allocation SET picked=picked+? WHERE id=?").run(
      amount,
      allocation.id,
    );
    if (returning) {
      // Po fizycznym wyjęciu z paczki kontrola całego zamówienia zaczyna się od nowa.
      d.prepare("UPDATE wms_line SET packed=0 WHERE order_id=?").run(orderId);
      d.prepare(
        "UPDATE wms_order SET status='picking',picked_at=NULL,packed_at=NULL WHERE id=?",
      ).run(orderId);
    }
    d.prepare("UPDATE wms_line SET picked=picked+? WHERE id=?").run(
      amount,
      line.id,
    );
    if (
      !returning &&
      !d
        .prepare("SELECT 1 FROM wms_line WHERE order_id=? AND picked<quantity")
        .get(orderId)
    ) {
      d.prepare(
        "UPDATE wms_order SET status='picked',picked_at=? WHERE id=?",
      ).run(nowIso(), orderId);
    }
  }
  if (input.action === "pack-start") {
    requireState("picked");
    if (input.tote !== order.tote) fail("To pojemnik innego zamówienia", 400);
    d.prepare(
      "UPDATE wms_order SET status='packing',packer_id=? WHERE id=?",
    ).run(actor.id, orderId);
  }
  if (input.action === "pack") {
    requireState("packing");
    owner(order.packer_id, actor);
    const matches = order.lines.filter(
      (l) =>
        l.sku.toUpperCase() === input.barcode.toUpperCase() ||
        l.barcode === input.barcode,
    );
    if (matches.length !== 1)
      fail(
        matches.length
          ? "Kod niejednoznaczny. Zeskanuj symbol SKU"
          : "Towar nie należy do zamówienia",
        400,
      );
    const line = matches[0];
    checkBarcode(line, input.barcode);
    if (input.quantity > line.quantity - line.packed)
      fail("Nadmiar w paczce. Odłóż dodatkowe sztuki", 400);
    d.prepare("UPDATE wms_line SET packed=packed+? WHERE id=?").run(
      input.quantity,
      line.id,
    );
    if (
      !d
        .prepare("SELECT 1 FROM wms_line WHERE order_id=? AND packed<quantity")
        .get(orderId)
    ) {
      d.prepare(
        "UPDATE wms_order SET status='packed',packed_at=? WHERE id=?",
      ).run(nowIso(), orderId);
    }
  }
  if (input.action === "ship") {
    requireState("packed");
    owner(order.packer_id, actor);
    if (order.lines.some((l) => l.packed !== l.quantity))
      fail("Paczka wymaga kontroli wszystkich pozycji");
    const now = nowIso();
    const parcels = [
      {
        carrier: input.carrier,
        tracking: input.tracking,
        weightG: input.weightG,
      },
      ...input.extraParcels,
    ];
    for (const [index, parcel] of parcels.entries()) {
      if (
        d
          .prepare("SELECT 1 FROM wms_shipment WHERE carrier=? AND tracking=?")
          .get(parcel.carrier, parcel.tracking)
      )
        fail("Ten numer przesyłki jest już użyty");
      d.prepare(
        "INSERT INTO wms_shipment(order_id,package_no,carrier,tracking,weight_g,created_at) VALUES (?,?,?,?,?,?)",
      ).run(
        orderId,
        index + 1,
        parcel.carrier,
        parcel.tracking,
        parcel.weightG,
        now,
      );
    }
    d.prepare(
      "UPDATE wms_order SET status='shipped',shipped_at=? WHERE id=?",
    ).run(now, orderId);
  }
  if (input.action === "hold")
    d.prepare("UPDATE wms_order SET hold_reason=? WHERE id=?").run(
      input.reason,
      orderId,
    );
  if (input.action === "resume") {
    if (!order.hold_reason) fail("Zamówienie nie jest wstrzymane");
    d.prepare("UPDATE wms_order SET hold_reason=NULL WHERE id=?").run(orderId);
  }
  if (input.action === "takeover") {
    requireState("picking", "picked", "packing", "packed");
    const field = ["picking", "picked"].includes(order.status)
      ? "picker_id"
      : "packer_id";
    d.prepare(`UPDATE wms_order SET ${field}=? WHERE id=?`).run(
      actor.id,
      orderId,
    );
  }
  if (input.action === "cancel") {
    if (order.lines.some((l) => l.picked > 0))
      fail("Najpierw wstrzymaj i odłóż pobrane sztuki na wskazane lokalizacje");
    for (const a of order.allocations) {
      const line = order.lines.find((l) => l.id === a.line_id)!;
      move(
        actor,
        line.tw_id,
        a.bin,
        0,
        -a.quantity,
        "release",
        input.reason,
        orderId,
      );
    }
    d.prepare(
      "DELETE FROM wms_allocation WHERE line_id IN (SELECT id FROM wms_line WHERE order_id=?)",
    ).run(orderId);
    d.prepare(
      "UPDATE wms_order SET status='cancelled',hold_reason=NULL WHERE id=?",
    ).run(orderId);
  }
  d.prepare(
    "UPDATE wms_order SET version=version+1,updated_at=? WHERE id=?",
  ).run(nowIso(), orderId);
  return getOrder(orderId);
}

export function createWave(actor: Actor, key: string, raw: unknown) {
  const input = z
    .object({
      name: label,
      orders: z
        .array(z.object({ id, version, tote: bin }).strict())
        .min(1)
        .max(12),
    })
    .strict()
    .parse(raw);
  return command(key, actor, "wave_create", input, () => {
    if (new Set(input.orders.map((o) => o.id)).size !== input.orders.length)
      fail("Zamówienie powtarza się na wózku", 400);
    const waveId = Number(
      db()
        .prepare(
          "INSERT INTO wms_wave(name,picker_id,created_at) VALUES (?,?,?)",
        )
        .run(input.name, actor.id, nowIso()).lastInsertRowid,
    );
    for (const o of input.orders) {
      if (
        db().prepare("SELECT 1 FROM wms_wave_order WHERE order_id=?").get(o.id)
      )
        fail("Zamówienie należy już do wózka");
      applyOrderAction(actor, o.id, {
        action: "pick-start",
        version: o.version,
        tote: o.tote,
      });
      db()
        .prepare("INSERT INTO wms_wave_order(wave_id,order_id) VALUES (?,?)")
        .run(waveId, o.id);
    }
    return getWave(actor, waveId);
  });
}

export function getWave(actor: Actor, waveId: number) {
  id.parse(waveId);
  const wave = db().prepare("SELECT * FROM wms_wave WHERE id=?").get(waveId) as
    | { id: number; name: string; picker_id: number; created_at: string }
    | undefined;
  if (!wave) throw new WmsError(404, "Nie ma takiego wózka");
  if (wave.picker_id !== actor.id) manager(actor);
  const orders = db()
    .prepare(
      `SELECT o.* FROM wms_wave_order w JOIN wms_order o ON o.id=w.order_id WHERE w.wave_id=? ORDER BY o.id`,
    )
    .all(waveId) as Order[];
  const tasks = db()
    .prepare(
      `SELECT a.id AS allocation_id,a.bin,a.quantity-a.picked AS remaining,
    l.sku,l.name,o.id AS order_id,o.reference,o.tote,o.version,o.picker_id,o.hold_reason
    FROM wms_wave_order w JOIN wms_order o ON o.id=w.order_id JOIN wms_line l ON l.order_id=o.id
    JOIN wms_allocation a ON a.line_id=l.id WHERE w.wave_id=? AND o.status='picking' AND a.picked<a.quantity
    ORDER BY a.bin,l.sku,o.id`,
    )
    .all(waveId);
  return { ...wave, orders, tasks };
}

export function listWaves(actor: Actor, raw: unknown) {
  const f = z
    .object({ offset: z.coerce.number().int().min(0).max(100000).default(0) })
    .parse(raw);
  // Zbiórki zakończone pozostają w audycie, a lista robocza pokazuje wyłącznie otwarte.
  return {
    rows: db()
      .prepare(
        `SELECT w.*,count(*) AS orders FROM wms_wave w
    JOIN wms_wave_order wo ON wo.wave_id=w.id JOIN wms_order o ON o.id=wo.order_id
    WHERE w.picker_id=? GROUP BY w.id HAVING sum(CASE WHEN o.status IN ('allocated','picking') THEN 1 ELSE 0 END)>0
    ORDER BY w.id DESC LIMIT 50 OFFSET ?`,
      )
      .all(actor.id, f.offset),
  };
}

export function pickWave(
  actor: Actor,
  key: string,
  waveId: number,
  raw: unknown,
) {
  id.parse(waveId);
  const input = z
    .object({
      orderId: id,
      version,
      allocationId: id,
      bin,
      barcode: label,
      tote: bin,
      quantity: qty,
    })
    .strict()
    .parse(raw);
  return command(key, actor, "wave_pick", { waveId, ...input }, () => {
    const wave = getWave(actor, waveId);
    const order = wave.orders.find((o) => o.id === input.orderId);
    if (!order) fail("Zamówienie nie należy do wózka", 400);
    if (order!.tote !== input.tote)
      fail("Zeskanuj pojemnik wskazanego zamówienia", 400);
    const { orderId, tote, ...scan } = input;
    applyOrderAction(actor, orderId, { action: "pick", tote, ...scan });
    return getWave(actor, waveId);
  });
}

export const listInput = z.object({
  q: z.string().trim().max(120).default(""),
  status: z
    .enum([
      "all",
      "open",
      "new",
      "allocated",
      "picking",
      "picked",
      "packing",
      "packed",
      "shipped",
      "cancelled",
      "held",
    ])
    .default("all"),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).max(1_000_000).default(0),
});
export function listOrders(raw: unknown) {
  const f = listInput.parse(raw);
  // Stałe predykaty pozwalają SQLite użyć indeksu etapu i otwartej kolejki.
  const conditions: string[] = [];
  const args: string[] = [];
  if (f.status === "open")
    conditions.push("o.status NOT IN ('shipped','cancelled')");
  else if (f.status === "held") conditions.push("o.hold_reason IS NOT NULL");
  else if (f.status !== "all") {
    conditions.push("o.status=?");
    args.push(f.status);
  }
  if (f.q) {
    conditions.push("(instr(lower(o.reference),lower(?))>0 OR o.tote=?)");
    args.push(f.q, f.q.toUpperCase());
  }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const rows = db()
    .prepare(
      `SELECT o.*, (SELECT sum(quantity) FROM wms_line WHERE order_id=o.id) AS units,
    (SELECT sum(picked) FROM wms_line WHERE order_id=o.id) AS picked_units,
    (SELECT sum(packed) FROM wms_line WHERE order_id=o.id) AS packed_units
    FROM wms_order o ${where} ORDER BY o.priority DESC,o.due_at,o.id LIMIT ? OFFSET ?`,
    )
    .all(...args, f.limit, f.offset);
  const total = (
    db()
      .prepare(`SELECT count(*) AS n FROM wms_order o ${where}`)
      .get(...args) as { n: number }
  ).n;
  return { rows, total, ...f };
}

export const inventoryInput = z.object({
  q: z.string().trim().max(120).default(""),
  low: z.enum(["0", "1"]).default("0"),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).max(1_000_000).default(0),
});
export function inventory(raw: unknown) {
  const f = inventoryInput.parse(raw);
  // Usunięcie kartoteki w ERP nie może ukryć pozostałych sztuk na półce.
  const catalog = `WITH catalog AS (SELECT tw_id,symbol,nazwa,ean,1 AS active FROM sgt_towar
    UNION ALL SELECT p.tw_id,p.symbol,p.nazwa,p.ean,0 AS active FROM wms_product p
    WHERE NOT EXISTS(SELECT 1 FROM sgt_towar t WHERE t.tw_id=p.tw_id))`;
  const where = `FROM catalog t LEFT JOIN wms_stock s ON s.tw_id=t.tw_id LEFT JOIN wms_bin b ON b.bin=s.bin
    WHERE (instr(lower(t.symbol || ' ' || t.nazwa),lower(?))>0 OR t.ean=? OR s.bin=?)
    AND (?='0' OR s.on_hand-s.reserved<s.minimum)`;
  const args = [f.q, f.q, f.q.toUpperCase(), f.low];
  const rows = db()
    .prepare(
      `${catalog} SELECT t.tw_id,t.symbol,t.nazwa,t.ean,t.active,s.bin,coalesce(s.on_hand,0) AS on_hand,
    coalesce(s.reserved,0) AS reserved,coalesce(s.minimum,0) AS minimum,coalesce(s.version,1) AS version,
    coalesce(b.mode,'pick') AS mode,CASE WHEN coalesce(b.mode,'pick')='pick' THEN coalesce(s.on_hand-s.reserved,0) ELSE 0 END AS available
    ${where} ORDER BY t.symbol,s.bin LIMIT ? OFFSET ?`,
    )
    .all(...args, f.limit, f.offset);
  const total = (
    db()
      .prepare(`${catalog} SELECT count(*) AS n ${where}`)
      .get(...args) as { n: number }
  ).n;
  return { rows, total, ...f };
}
