import { z } from "zod";
import { db, nowIso } from "../db/db.js";
import { logEvent } from "./events.js";
import { fillOrderReservations } from "./wms-stock-work.js";
import { readSnapshot } from "./wms.js";
import {
  applyOrderAction,
  command,
  getOrder,
  getWave,
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
const version = z.number().int().positive();
const reason = z.string().trim().min(3).max(500);
const fail = (message: string, status = 409): never => {
  throw new WmsError(status, message);
};
type Cart = {
  code: string;
  name: string;
  capacity: 20 | 30;
  selection: "all" | "single" | "multi";
  max_units: number;
  active: number;
  version: number;
};
type Run = {
  id: number;
  cart_code: string;
  capacity: number;
  assigned_count: number;
  arrived_at: string | null;
  station_code: string | null;
  closed_at: string | null;
};
type Slot = { position: number; box_barcode: string | null };
type Assignment = {
  run_id: number;
  position: number;
  order_id: number;
  box_barcode: string;
  handed_at: string | null;
  station_code: string | null;
  released_at: string | null;
  ended_at: string | null;
};

function cartByCode(value: string) {
  return (
    (db().prepare("SELECT * FROM wms_cart WHERE code=?").get(value) as
      Cart | undefined) ?? fail("Nieznany kod wózka", 404)
  );
}
function activeRun(value: string) {
  return db()
    .prepare(
      "SELECT * FROM wms_cart_run WHERE cart_code=? AND closed_at IS NULL",
    )
    .get(value) as Run | undefined;
}
function ownRun(actor: Actor, runId: number) {
  const run = db()
    .prepare("SELECT * FROM wms_cart_run WHERE id=?")
    .get(id.parse(runId)) as Run | undefined;
  if (!run) fail("Nie ma takiej trasy wózka", 404);
  const wave = getWave(actor, runId);
  if (wave.picker_id !== actor.id)
    fail("Wózek obsługuje inna osoba. Biuro może przejąć trasę", 403);
  if (run!.closed_at) fail("Wózek zakończył już tę trasę");
  return { run: run!, wave };
}
function station(value: string, kind?: string) {
  const found = db()
    .prepare("SELECT * FROM wms_station WHERE code=? AND active=1")
    .get(value);
  if (!found || (kind && found.kind !== kind))
    fail("Zeskanuj aktywne stanowisko właściwego typu", 400);
  return found!;
}
function boxFree(value: string) {
  if (
    db()
      .prepare(
        "SELECT 1 FROM wms_order WHERE tote=? AND status NOT IN ('shipped','cancelled')",
      )
      .get(value)
  )
    fail("Skrzynka nadal zawiera niezakończone zamówienie");
  if (
    db()
      .prepare(
        "SELECT 1 FROM wms_cart_assignment WHERE box_barcode=? AND released_at IS NULL AND ended_at IS NULL",
      )
      .get(value)
  )
    fail("Skrzynka jest zajęta na trasie");
}

export function listCarts(actor: Actor) {
  return {
    rows: db()
      .prepare(
        `SELECT c.*,r.id AS run_id,w.picker_id,w.created_at,r.arrived_at,
      (SELECT count(*) FROM wms_cart_slot s WHERE s.cart_code=c.code AND s.box_barcode IS NOT NULL) AS bound_boxes,
      r.assigned_count FROM wms_cart c LEFT JOIN wms_cart_run r ON r.cart_code=c.code AND r.closed_at IS NULL
      LEFT JOIN wms_wave w ON w.id=r.id ORDER BY c.code`,
      )
      .all(),
    stations: db().prepare("SELECT * FROM wms_station ORDER BY code").all(),
    actorId: actor.id,
  };
}
export function getCart(actor: Actor, value: string) {
  return readSnapshot(() => readCart(actor, value));
}
function readCart(actor: Actor, value: string) {
  const cart = cartByCode(code.parse(value));
  const run = activeRun(cart.code);
  return {
    ...cart,
    slots: db()
      .prepare(
        "SELECT position,box_barcode FROM wms_cart_slot WHERE cart_code=? ORDER BY position",
      )
      .all(cart.code) as Slot[],
    run:
      run &&
      (actor.id ===
        Number(
          db().prepare("SELECT picker_id FROM wms_wave WHERE id=?").get(run.id)!
            .picker_id,
        ) ||
        actor.role !== "magazynier")
        ? getCartRun(actor, run.id)
        : null,
    occupied: !!run,
  };
}
export function configureCart(actor: Actor, key: string, raw: unknown) {
  manager(actor);
  const input = z
    .object({
      code,
      name: z.string().trim().min(1).max(120),
      capacity: z.union([z.literal(20), z.literal(30)]),
      selection: z.enum(["all", "single", "multi"]).default("all"),
      maxUnits: z.number().int().min(1).max(1000000).default(1000000),
      active: z.boolean().default(true),
      version: z.number().int().min(0),
      boxes: z
        .array(
          z
            .object({
              position: z.number().int().min(1).max(30),
              barcode: code.nullable(),
            })
            .strict(),
        )
        .min(20)
        .max(30),
    })
    .strict()
    .parse(raw);
  return command(key, actor, "cart_configure", input, () => {
    const old = db()
      .prepare("SELECT * FROM wms_cart WHERE code=?")
      .get(input.code) as Cart | undefined;
    if ((old?.version ?? 0) !== input.version)
      fail("Konfiguracja zmieniła się. Odśwież wózek");
    if (activeRun(input.code))
      fail("Nie można zmieniać konfiguracji zajętego wózka");
    if (
      input.boxes.length !== input.capacity ||
      new Set(input.boxes.map((s) => s.position)).size !== input.capacity ||
      input.boxes.some((s) => s.position > input.capacity)
    )
      fail("Podaj każdą stałą pozycję wózka dokładnie raz", 400);
    const barcodes = input.boxes.flatMap((s) => (s.barcode ? [s.barcode] : []));
    if (new Set(barcodes).size !== barcodes.length)
      fail("Każda skrzynka musi mieć inny kod", 400);
    const oldSlots = db()
      .prepare(
        "SELECT box_barcode FROM wms_cart_slot WHERE cart_code=? AND box_barcode IS NOT NULL",
      )
      .all(input.code);
    for (const s of oldSlots) boxFree(String(s.box_barcode));
    for (const value of barcodes) {
      boxFree(value);
      if (
        db()
          .prepare(
            "SELECT 1 FROM wms_cart_slot WHERE box_barcode=? AND cart_code<>?",
          )
          .get(value, input.code)
      )
        fail("Skrzynka jest przypisana do innego wózka");
    }
    db()
      .prepare(
        `INSERT INTO wms_cart(code,name,capacity,selection,max_units,active) VALUES (?,?,?,?,?,?)
      ON CONFLICT(code) DO UPDATE SET name=excluded.name,capacity=excluded.capacity,selection=excluded.selection,max_units=excluded.max_units,active=excluded.active,version=wms_cart.version+1`,
      )
      .run(
        input.code,
        input.name,
        input.capacity,
        input.selection,
        input.maxUnits,
        Number(input.active),
      );
    db().prepare("DELETE FROM wms_cart_slot WHERE cart_code=?").run(input.code);
    for (const s of input.boxes)
      db()
        .prepare(
          "INSERT INTO wms_cart_slot(cart_code,position,box_barcode) VALUES (?,?,?)",
        )
        .run(input.code, s.position, s.barcode);
    return getCart(actor, input.code);
  });
}
export function configureStation(actor: Actor, key: string, raw: unknown) {
  manager(actor);
  const input = z
    .object({
      code,
      name: z.string().trim().min(1).max(120),
      kind: z.enum(["pack", "exception"]),
      active: z.boolean(),
      version: z.number().int().min(0),
    })
    .strict()
    .parse(raw);
  return command(key, actor, "station_configure", input, () => {
    const old = db()
      .prepare("SELECT * FROM wms_station WHERE code=?")
      .get(input.code);
    if ((old?.version ?? 0) !== input.version)
      fail("Stanowisko zmieniło się. Odśwież dane");
    if (
      old &&
      (old.kind !== input.kind || !input.active) &&
      db()
        .prepare(
          `SELECT 1 FROM wms_cart_assignment a JOIN wms_order o ON o.id=a.order_id
      WHERE a.station_code=? AND a.ended_at IS NULL AND o.status NOT IN ('shipped','cancelled')`,
        )
        .get(input.code)
    )
      fail("Stanowisko obsługuje niezakończone skrzynki");
    db()
      .prepare(
        `INSERT INTO wms_station(code,name,kind,active) VALUES (?,?,?,?) ON CONFLICT(code) DO UPDATE SET name=excluded.name,kind=excluded.kind,active=excluded.active,version=wms_station.version+1`,
      )
      .run(input.code, input.name, input.kind, Number(input.active));
    return listCarts(actor);
  });
}
export function configurePickRoute(actor: Actor, key: string, raw: unknown) {
  manager(actor);
  const input = z
    .object({
      bins: z
        .array(
          z
            .object({
              bin: code,
              sequence: z.number().int().min(0).max(1000000),
              version: z.number().int().min(0),
            })
            .strict(),
        )
        .min(1)
        .max(5000),
    })
    .strict()
    .parse(raw);
  return command(key, actor, "pick_route_configure", input, () => {
    if (new Set(input.bins.map((b) => b.bin)).size !== input.bins.length)
      fail("Lokalizacja powtarza się", 400);
    for (const b of input.bins) {
      const old = db()
        .prepare("SELECT version FROM wms_pick_route WHERE bin=?")
        .get(b.bin);
      if ((old?.version ?? 0) !== b.version)
        fail(`Kolejność ${b.bin} zmieniła się`);
      db()
        .prepare(
          `INSERT INTO wms_pick_route(bin,sequence) VALUES (?,?) ON CONFLICT(bin) DO UPDATE SET sequence=excluded.sequence,version=wms_pick_route.version+1`,
        )
        .run(b.bin, b.sequence);
    }
    return { updated: input.bins.length };
  });
}

export function getCartRun(actor: Actor, runId: number) {
  return readSnapshot(() => readCartRun(actor, runId));
}
function readCartRun(actor: Actor, runId: number) {
  const run = db()
    .prepare("SELECT * FROM wms_cart_run WHERE id=?")
    .get(id.parse(runId)) as Run | undefined;
  if (!run) fail("Nie ma takiej trasy wózka", 404);
  const assigned = db()
    .prepare("SELECT picker_id FROM wms_wave WHERE id=?")
    .get(runId);
  // Kolektor może zwolnić lokalny widok dopiero po jednoznacznej odpowiedzi.
  // Błąd sesji lub Wi-Fi nie jest dowodem przejęcia wózka.
  if (
    assigned &&
    assigned.picker_id !== actor.id &&
    actor.role !== "admin" &&
    actor.role !== "biuro"
  )
    throw new WmsError(
      403,
      "Trasę obsługuje już inna osoba",
      "WMS_RUN_REASSIGNED",
    );
  const wave = getWave(actor, runId);
  const assignments = db()
    .prepare(
      "SELECT * FROM wms_cart_assignment WHERE run_id=? ORDER BY position",
    )
    .all(runId) as Assignment[];
  const exceptions = db()
    .prepare("SELECT * FROM wms_pick_exception WHERE run_id=? ORDER BY id DESC")
    .all(runId);
  // Zwrot jest pracą obecnego właściciela przed przekazaniem skrzynki. Samo wstrzymanie nie zleca zwrotu.
  const returns = db()
    .prepare(
      `
    SELECT a.id AS allocation_id,a.picked AS remaining,a.bin,l.tw_id,l.sku,l.name,l.barcode,
      o.id AS order_id,o.version,o.tote,o.hold_reason,ca.position,coalesce(b.mode,'pick') AS source_mode
    FROM wms_cart_assignment ca JOIN wms_order o ON o.id=ca.order_id
    JOIN wms_line l ON l.order_id=o.id JOIN wms_allocation a ON a.line_id=l.id
    LEFT JOIN wms_pick_route r ON r.bin=a.bin
    LEFT JOIN wms_bin b ON b.bin=a.bin
    WHERE ca.run_id=? AND ca.ended_at IS NULL AND ca.released_at IS NULL AND ca.handed_at IS NULL
      AND o.hold_reason IS NOT NULL AND o.status IN ('picking','picked') AND a.picked>0
      AND o.picker_id=? AND o.tote=ca.box_barcode
      AND NOT EXISTS(SELECT 1 FROM wms_shipment s WHERE s.order_id=o.id)
      AND NOT EXISTS(SELECT 1 FROM wms_pack_recovery p WHERE p.order_id=o.id AND p.completed_at IS NULL AND p.cancelled_at IS NULL)
    ORDER BY coalesce(r.sequence,1000001),a.bin,l.sku,ca.position,a.id
  `,
    )
    .all(runId, actor.id);
  return { ...wave, ...run!, assignments, exceptions, returns };
}

export function startCart(actor: Actor, key: string, raw: unknown) {
  const input = z.object({ barcode: code }).strict().parse(raw);
  return command(key, actor, "cart_start", input, () => {
    const cart = cartByCode(input.barcode);
    if (!cart.active) fail("Wózek jest wyłączony z pracy");
    const previous = activeRun(cart.code);
    if (previous) {
      ownRun(actor, previous.id);
      return { resumed: true, run: getCartRun(actor, previous.id) };
    }
    const slots = db()
      .prepare(
        `SELECT s.position,s.box_barcode FROM wms_cart_slot s WHERE s.cart_code=? AND s.box_barcode IS NOT NULL
      AND NOT EXISTS(SELECT 1 FROM wms_order o WHERE o.tote=s.box_barcode AND o.status NOT IN ('shipped','cancelled')) ORDER BY s.position`,
      )
      .all(cart.code) as Slot[];
    if (!slots.length)
      fail(
        "Brak pustych, przypisanych skrzynek. Zeskanuj skrzynki na pozycjach wózka",
      );
    let runId: number | null = null;
    // Dostępność liczymy ponownie po każdym przydziale: dwa zamówienia nie mogą zużyć tego samego zapasu.
    // Braki nie zatrzymują przeglądania kolejki na arbitralnej stronie pierwszych 50 zamówień.
    const candidate = db()
      .prepare(`SELECT o.id,o.version,o.status FROM wms_order o
      WHERE o.status IN ('new','allocated') AND o.hold_reason IS NULL
      AND NOT EXISTS(SELECT 1 FROM wms_wave_order w WHERE w.order_id=o.id)
      AND (?='all' OR (?='single' AND (SELECT count(*) FROM wms_line l WHERE l.order_id=o.id)=1)
        OR (?='multi' AND (SELECT count(*) FROM wms_line l WHERE l.order_id=o.id)>1))
      AND (SELECT sum(l.quantity) FROM wms_line l WHERE l.order_id=o.id)<=?
      AND (o.status='allocated' OR NOT EXISTS(SELECT 1 FROM wms_line l WHERE l.order_id=o.id AND l.quantity>
        coalesce((SELECT sum(s.on_hand-s.reserved) FROM wms_stock s LEFT JOIN wms_bin b ON b.bin=s.bin
          WHERE s.tw_id=l.tw_id AND coalesce(b.mode,'pick')='pick'
          AND NOT EXISTS(SELECT 1 FROM wms_stock_check sc WHERE sc.tw_id=s.tw_id AND sc.bin=s.bin AND sc.resolved_at IS NULL)),0)))
      AND NOT EXISTS(SELECT 1 FROM wms_allocation a JOIN wms_line l ON l.id=a.line_id
        JOIN wms_stock_check sc ON sc.tw_id=l.tw_id AND sc.bin=a.bin AND sc.resolved_at IS NULL WHERE l.order_id=o.id AND a.picked<a.quantity)
      ORDER BY o.priority DESC,o.due_at,o.id LIMIT 1`);
    for (const s of slots) {
      const next = candidate.get(
        cart.selection,
        cart.selection,
        cart.selection,
        cart.max_units,
      ) as { id: number; version: number; status: string } | undefined;
      if (!next) break;
      if (runId === null) {
        runId = Number(
          db()
            .prepare(
              "INSERT INTO wms_wave(name,picker_id,created_at) VALUES (?,?,?)",
            )
            .run(cart.name, actor.id, nowIso()).lastInsertRowid,
        );
        db()
          .prepare(
            "INSERT INTO wms_cart_run(id,cart_code,capacity) VALUES (?,?,?)",
          )
          .run(runId, cart.code, cart.capacity);
      }
      let order = getOrder(next.id);
      if (order.status === "new")
        order = applyOrderAction(actor, order.id, {
          action: "allocate",
          version: order.version,
        });
      db()
        .prepare(
          "INSERT INTO wms_cart_assignment(run_id,position,order_id,box_barcode) VALUES (?,?,?,?)",
        )
        .run(runId, s.position, order.id, s.box_barcode);
      applyOrderAction(actor, order.id, {
        action: "pick-start",
        version: order.version,
        tote: s.box_barcode!,
      });
      db()
        .prepare("INSERT INTO wms_wave_order(wave_id,order_id) VALUES (?,?)")
        .run(runId, order.id);
      db()
        .prepare(
          "UPDATE wms_cart_run SET assigned_count=assigned_count+1 WHERE id=?",
        )
        .run(runId);
      logEvent(
        "wms_cart_order_assigned",
        actor.name,
        null,
        { runId, orderId: order.id, position: s.position, box: s.box_barcode },
        actor.id,
      );
    }
    return {
      resumed: false,
      run: runId === null ? null : getCartRun(actor, runId),
    };
  });
}

export function handoffCart(
  actor: Actor,
  key: string,
  runId: number,
  raw: unknown,
) {
  const input = z.object({ cart: code, station: code }).strict().parse(raw);
  return command(key, actor, "cart_handoff", { runId, ...input }, () => {
    const { run, wave } = ownRun(actor, runId);
    if (run.cart_code !== input.cart) fail("Zeskanuj właściwy wózek", 400);
    station(input.station, "pack");
    if (
      wave.orders.some(
        (o) => !o.hold_reason && !["picked", "cancelled"].includes(o.status),
      )
    )
      fail("Najpierw dokończ zbiórkę pozostałych zamówień");
    if (run.arrived_at) fail("Wózek został już przekazany");
    const now = nowIso();
    db()
      .prepare("UPDATE wms_cart_run SET arrived_at=?,station_code=? WHERE id=?")
      .run(now, input.station, runId);
    db()
      .prepare(
        "UPDATE wms_cart_assignment SET handed_at=?,station_code=? WHERE run_id=? AND released_at IS NULL AND ended_at IS NULL",
      )
      .run(now, input.station, runId);
    return getCartRun(actor, runId);
  });
}

export function packCartBox(actor: Actor, key: string, raw: unknown) {
  const input = z.object({ box: code, station: code }).strict().parse(raw);
  return command(key, actor, "cart_pack_box", input, () => {
    station(input.station, "pack");
    const row = db()
      .prepare(
        `SELECT a.* FROM wms_cart_assignment a JOIN wms_order o ON o.id=a.order_id
      WHERE a.box_barcode=? AND a.ended_at IS NULL AND o.status NOT IN ('shipped','cancelled')`,
      )
      .get(input.box) as Assignment | undefined;
    if (!row || !row.handed_at || row.station_code !== input.station)
      fail("Skrzynka nie została przekazana na to stanowisko");
    let order = getOrder(row!.order_id);
    if (order.hold_reason) fail(`Zamówienie wstrzymane: ${order.hold_reason}`);
    if (order.status === "picked")
      order = applyOrderAction(actor, order.id, {
        action: "pack-start",
        version: order.version,
        tote: input.box,
      });
    else if (
      !["packing", "packed"].includes(order.status) ||
      order.packer_id !== actor.id
    )
      fail("Skrzynka jest na innym etapie albo obsługuje ją inna osoba");
    return order;
  });
}

export function releaseCart(
  actor: Actor,
  key: string,
  runId: number,
  raw: unknown,
) {
  const input = z.object({ cart: code }).strict().parse(raw);
  return command(key, actor, "cart_release", { runId, ...input }, () => {
    const run = db()
      .prepare("SELECT * FROM wms_cart_run WHERE id=?")
      .get(id.parse(runId)) as Run | undefined;
    if (!run || run.cart_code !== input.cart)
      fail("Zeskanuj właściwy wózek", 400);
    if (run!.closed_at) fail("Ta trasa jest już zakończona");
    const assignments = db()
      .prepare(
        `SELECT a.*,o.status,o.packer_id FROM wms_cart_assignment a JOIN wms_order o ON o.id=a.order_id WHERE a.run_id=?`,
      )
      .all(runId);
    if (
      assignments.some(
        (a) =>
          a.released_at === null &&
          !["shipped", "cancelled"].includes(String(a.status)),
      )
    )
      fail(
        "Wózek zawiera niezakończone zamówienia. Przekaż skrzynki lub dokończ pakowanie",
      );
    const now = nowIso();
    db()
      .prepare(
        "UPDATE wms_cart_assignment SET released_at=coalesce(released_at,?),ended_at=coalesce(ended_at,?) WHERE run_id=? AND order_id IN (SELECT id FROM wms_order WHERE status IN ('shipped','cancelled'))",
      )
      .run(now, now, runId);
    db()
      .prepare("UPDATE wms_cart_run SET closed_at=? WHERE id=?")
      .run(now, runId);
    return getCart(actor, input.cart);
  });
}

export function bindCartBox(actor: Actor, key: string, raw: unknown) {
  const input = z
    .object({
      cart: code,
      position: z.number().int().min(1).max(30),
      box: code,
      version,
    })
    .strict()
    .parse(raw);
  return command(key, actor, "cart_bind_box", input, () => {
    const cart = cartByCode(input.cart);
    if (cart.version !== input.version) fail("Wózek zmienił się. Odśwież dane");
    if (activeRun(cart.code))
      fail("Zakończ trasę przed przypisaniem pustych skrzynek");
    if (input.position > cart.capacity)
      fail("Nie ma takiej pozycji na wózku", 400);
    const old = db()
      .prepare(
        "SELECT box_barcode FROM wms_cart_slot WHERE cart_code=? AND position=?",
      )
      .get(cart.code, input.position);
    if (old?.box_barcode) boxFree(String(old.box_barcode));
    boxFree(input.box);
    const existing = db()
      .prepare(
        "SELECT cart_code,position FROM wms_cart_slot WHERE box_barcode=?",
      )
      .get(input.box);
    if (
      existing &&
      (existing.cart_code !== cart.code || existing.position !== input.position)
    )
      fail("Skrzynka ma już inną stałą pozycję");
    db()
      .prepare(
        "UPDATE wms_cart_slot SET box_barcode=? WHERE cart_code=? AND position=?",
      )
      .run(input.box, cart.code, input.position);
    db()
      .prepare("UPDATE wms_cart SET version=version+1 WHERE code=?")
      .run(cart.code);
    return getCart(actor, cart.code);
  });
}

export function detachCartBox(
  actor: Actor,
  key: string,
  runId: number,
  raw: unknown,
) {
  const input = z
    .object({ box: code, station: code, version })
    .strict()
    .parse(raw);
  return command(key, actor, "cart_detach_box", { runId, ...input }, () => {
    const row = db()
      .prepare(
        "SELECT * FROM wms_cart_assignment WHERE run_id=? AND box_barcode=? AND released_at IS NULL AND ended_at IS NULL",
      )
      .get(id.parse(runId), input.box) as Assignment | undefined;
    if (!row) fail("Skrzynka nie jest na wskazanym wózku");
    const order = getOrder(row!.order_id);
    if (order.version !== input.version)
      fail("Zamówienie zmieniło się. Odśwież dane");
    if (actor.id !== order.picker_id && actor.id !== order.packer_id)
      manager(actor);
    const destination = station(
      input.station,
      order.hold_reason ? "exception" : "pack",
    );
    if (
      !order.hold_reason &&
      !["picked", "packing", "packed", "shipped", "cancelled"].includes(
        order.status,
      )
    )
      fail("Dokończ zbiórkę przed przekazaniem skrzynki");
    if (
      ["packing", "packed"].includes(order.status) &&
      input.station !== row!.station_code
    )
      fail("Zakończ pakowanie na obecnym stanowisku");
    const now = nowIso();
    db()
      .prepare(
        "UPDATE wms_cart_assignment SET handed_at=coalesce(handed_at,?),station_code=?,released_at=? WHERE run_id=? AND position=?",
      )
      .run(now, String(destination.code), now, runId, row!.position);
    const run = db()
      .prepare("SELECT cart_code FROM wms_cart_run WHERE id=?")
      .get(runId)!;
    db()
      .prepare(
        "UPDATE wms_cart_slot SET box_barcode=NULL WHERE cart_code=? AND position=? AND box_barcode=?",
      )
      .run(run.cart_code, row!.position, input.box);
    db()
      .prepare("UPDATE wms_cart SET version=version+1 WHERE code=?")
      .run(run.cart_code);
    return { orderId: order.id, position: row!.position, detached: true };
  });
}

function rerouteMissingStock(
  actor: Actor,
  twId: number,
  bin: string,
  reportedOrder: number,
  exceptionId: number,
) {
  // Wspólna półka dotyczy wielu tras. Kolejność priorytetów chroni pilne zamówienia przed wyścigiem zgłoszeń.
  const affected = db()
    .prepare(
      `SELECT a.*,o.id AS order_id FROM wms_allocation a
    JOIN wms_line l ON l.id=a.line_id JOIN wms_order o ON o.id=l.order_id
    WHERE l.tw_id=? AND a.bin=? AND a.quantity>a.picked AND o.status IN ('allocated','picking')
    AND (o.hold_reason IS NULL OR o.id=?)
    AND NOT EXISTS(SELECT 1 FROM wms_pick_exception e WHERE e.order_id=o.id AND e.resolved_at IS NULL AND e.id<>?)
    AND NOT EXISTS(SELECT 1 FROM wms_cart_assignment c WHERE c.order_id=o.id AND c.ended_at IS NULL AND (c.handed_at IS NOT NULL OR c.released_at IS NOT NULL))
    ORDER BY o.priority DESC,o.due_at,o.id`,
    )
    .all(twId, bin, reportedOrder, exceptionId);
  for (const a of affected) {
    const orderId = Number(a.order_id);
    db().exec("SAVEPOINT reroute_missing");
    try {
      move(
        actor,
        twId,
        bin,
        0,
        -(Number(a.quantity) - Number(a.picked)),
        "release",
        "Przekierowanie po braku na półce",
        orderId,
      );
      if (a.picked)
        db()
          .prepare("UPDATE wms_allocation SET quantity=picked WHERE id=?")
          .run(a.id);
      else db().prepare("DELETE FROM wms_allocation WHERE id=?").run(a.id);
      fillOrderReservations(
        actor,
        orderId,
        "Przydział z innej półki po zgłoszeniu braku",
      );
      if (orderId === reportedOrder) {
        db()
          .prepare(
            "UPDATE wms_pick_exception SET resolved_at=?,resolution=? WHERE id=?",
          )
          .run(
            nowIso(),
            "Niezebrane sztuki przydzielono z innych półek. Zgłoszona półka nadal wymaga przeliczenia.",
            exceptionId,
          );
        applyOrderAction(actor, orderId, {
          action: "resume",
          version: getOrder(orderId).version,
          reason: "Zapas przydzielony z innych półek",
        });
      } else {
        // Kolektor na innej trasie musi odrzucić skan starego przydziału i pobrać świeżą półkę.
        db()
          .prepare(
            "UPDATE wms_order SET version=version+1,updated_at=? WHERE id=?",
          )
          .run(nowIso(), orderId);
      }
      logEvent(
        "wms_pick_reallocated",
        actor.name,
        twId,
        {
          orderId,
          reportedOrder,
          source: bin,
          quantity: Number(a.quantity) - Number(a.picked),
        },
        actor.id,
      );
      db().exec("RELEASE reroute_missing");
    } catch (error) {
      db().exec("ROLLBACK TO reroute_missing");
      db().exec("RELEASE reroute_missing");
      // Niepełny zastępczy przydział nie rozprasza operatora. Dotychczasowy przydział pozostaje zablokowany do wyjaśnienia.
      if (!(error instanceof WmsError) || error.statusCode !== 409) throw error;
    }
  }
}

export function reportPickException(actor: Actor, key: string, raw: unknown) {
  const input = z
    .object({
      orderId: id,
      allocationId: id,
      version,
      box: code,
      kind: z.enum(["missing", "damaged", "box_full"]),
      reason,
    })
    .strict()
    .parse(raw);
  return command(key, actor, "pick_exception", input, () => {
    const order = getOrder(input.orderId);
    if (order.picker_id !== actor.id)
      fail("Zgłoszenie wymaga właściciela zbiórki", 403);
    if (order.tote !== input.box)
      fail("Zeskanuj skrzynkę tego zamówienia", 400);
    const allocation = order.allocations.find(
      (a) => a.id === input.allocationId,
    );
    if (!allocation) fail("Pozycja nie należy do zamówienia", 400);
    if (input.kind === "missing" && allocation!.quantity === allocation!.picked)
      fail(
        "Ta pozycja jest już zebrana. Odśwież trasę przed zgłoszeniem braku",
      );
    const line = order.lines.find((l) => l.id === allocation!.line_id)!;
    if (order.status !== "picking")
      fail("Zgłoszenie dotyczy trwającej zbiórki");
    if (order.hold_reason)
      fail("Zamówienie jest już wstrzymane. Najpierw rozwiąż jego zgłoszenie");
    const assignment = db()
      .prepare(
        "SELECT run_id FROM wms_cart_assignment WHERE order_id=? AND ended_at IS NULL",
      )
      .get(order.id);
    applyOrderAction(actor, order.id, {
      action: "hold",
      version: input.version,
      reason: `${input.kind}: ${input.reason}`,
    });
    const exceptionId = Number(
      db()
        .prepare(
          "INSERT INTO wms_pick_exception(order_id,allocation_id,run_id,kind,tw_id,bin,reason,created_at,user_id) VALUES (?,?,?,?,?,?,?,?,?)",
        )
        .run(
          order.id,
          input.allocationId,
          assignment?.run_id ?? null,
          input.kind,
          line.tw_id,
          allocation!.bin,
          input.reason,
          nowIso(),
          actor.id,
        ).lastInsertRowid,
    );
    if (input.kind !== "box_full")
      db()
        .prepare(
          `INSERT INTO wms_stock_check(tw_id,bin,reason,created_at,user_id) SELECT ?,?,?,?,?
      WHERE NOT EXISTS(SELECT 1 FROM wms_stock_check WHERE tw_id=? AND bin=? AND resolved_at IS NULL)`,
        )
        .run(
          line.tw_id,
          allocation!.bin,
          input.reason,
          nowIso(),
          actor.id,
          line.tw_id,
          allocation!.bin,
        );
    if (input.kind === "missing")
      rerouteMissingStock(
        actor,
        line.tw_id,
        allocation!.bin,
        order.id,
        exceptionId,
      );
    return getOrder(order.id);
  });
}

export function takeoverCart(
  actor: Actor,
  key: string,
  runId: number,
  raw: unknown,
) {
  manager(actor);
  const input = z.object({ cart: code, reason }).strict().parse(raw);
  return command(key, actor, "cart_takeover", { runId, ...input }, () => {
    const run = getCartRun(actor, runId);
    if (run.closed_at || run.cart_code !== input.cart)
      fail("Zeskanuj wózek z otwartej trasy", 400);
    for (const a of run.assignments.filter(
      (a) => !a.released_at && !a.ended_at,
    )) {
      const o = getOrder(a.order_id);
      if (["picking", "picked"].includes(o.status))
        applyOrderAction(actor, o.id, {
          action: "takeover",
          version: o.version,
          reason: input.reason,
        });
    }
    db()
      .prepare("UPDATE wms_wave SET picker_id=? WHERE id=?")
      .run(actor.id, runId);
    return getCartRun(actor, runId);
  });
}

export function replaceCartBox(
  actor: Actor,
  key: string,
  runId: number,
  raw: unknown,
) {
  const input = z
    .object({
      oldBox: code,
      newBox: code,
      version,
      reason,
      transferConfirmed: z.literal(true),
    })
    .strict()
    .parse(raw);
  return command(key, actor, "cart_replace_box", { runId, ...input }, () => {
    const { run } = ownRun(actor, runId);
    const row = db()
      .prepare(
        "SELECT * FROM wms_cart_assignment WHERE run_id=? AND box_barcode=? AND released_at IS NULL AND ended_at IS NULL",
      )
      .get(runId, input.oldBox) as Assignment | undefined;
    if (!row || row.handed_at) fail("Wymiana dotyczy skrzynki podczas zbiórki");
    const order = getOrder(row!.order_id);
    if (order.version !== input.version)
      fail("Zamówienie zmieniło się. Odśwież dane");
    if (!["picking", "picked"].includes(order.status))
      fail("Wymiana jest niedostępna na tym etapie");
    if (input.oldBox === input.newBox)
      fail("Zeskanuj inną pustą skrzynkę", 400);
    boxFree(input.newBox);
    if (
      db()
        .prepare("SELECT 1 FROM wms_cart_slot WHERE box_barcode=?")
        .get(input.newBox)
    )
      fail("Nowa skrzynka ma już stałą pozycję");
    db()
      .prepare(
        "UPDATE wms_cart_slot SET box_barcode=? WHERE cart_code=? AND position=?",
      )
      .run(input.newBox, run.cart_code, row!.position);
    db()
      .prepare(
        "UPDATE wms_cart_assignment SET box_barcode=? WHERE run_id=? AND position=?",
      )
      .run(input.newBox, runId, row!.position);
    db()
      .prepare(
        "UPDATE wms_order SET tote=?,version=version+1,updated_at=? WHERE id=?",
      )
      .run(input.newBox, nowIso(), order.id);
    db()
      .prepare("UPDATE wms_cart SET version=version+1 WHERE code=?")
      .run(run.cart_code);
    const resolved = db()
      .prepare(
        "UPDATE wms_pick_exception SET resolved_at=?,resolution=? WHERE order_id=? AND kind='box_full' AND resolved_at IS NULL",
      )
      .run(nowIso(), input.reason, order.id);
    if (
      resolved.changes &&
      !db()
        .prepare(
          "SELECT 1 FROM wms_pick_exception WHERE order_id=? AND resolved_at IS NULL",
        )
        .get(order.id)
    ) {
      const updated = getOrder(order.id);
      if (updated.hold_reason)
        applyOrderAction(actor, updated.id, {
          action: "resume",
          version: updated.version,
          reason: input.reason,
        });
    }
    return getCartRun(actor, runId);
  });
}

export function resolvePickException(actor: Actor, key: string, raw: unknown) {
  manager(actor);
  const input = z
    .object({
      orderId: id,
      version,
      box: code,
      reason,
      action: z.enum(["continue", "remove"]),
    })
    .strict()
    .parse(raw);
  return command(key, actor, "pick_exception_resolve", input, () => {
    const order = getOrder(input.orderId);
    const hadException = !!db()
      .prepare(
        "SELECT 1 FROM wms_pick_exception WHERE order_id=? AND resolved_at IS NULL",
      )
      .get(order.id);
    if (order.version !== input.version || order.tote !== input.box)
      fail("Odśwież zamówienie i zeskanuj jego skrzynkę");
    if (!order.hold_reason) fail("Zamówienie nie jest wstrzymane");
    const a = db()
      .prepare(
        "SELECT * FROM wms_cart_assignment WHERE order_id=? AND ended_at IS NULL",
      )
      .get(order.id) as Assignment | undefined;
    if (input.action === "remove") {
      if (order.lines.some((l) => l.picked > 0))
        fail("Najpierw odłóż wszystkie pobrane sztuki za pomocą skanów zwrotu");
      // Usunięcie z trasy jest jawne i zachowuje historię pozycji; zapas wraca przez normalne anulowanie.
      applyOrderAction(actor, order.id, {
        action: "cancel",
        version: order.version,
        reason: input.reason,
      });
      if (a)
        db()
          .prepare(
            "UPDATE wms_cart_assignment SET released_at=?,ended_at=? WHERE run_id=? AND position=?",
          )
          .run(nowIso(), nowIso(), a.run_id, a.position);
    } else {
      if (a?.handed_at || a?.released_at)
        fail(
          "Skrzynka opuściła zbiórkę. Odłóż pobrania i usuń zamówienie z trasy albo obsłuż je osobno",
        );
      if (
        db()
          .prepare(
            `SELECT 1 FROM wms_pick_exception e JOIN wms_stock_check c ON c.tw_id=e.tw_id AND c.bin=e.bin AND c.resolved_at IS NULL
        WHERE e.order_id=? AND e.resolved_at IS NULL`,
          )
          .get(order.id)
      )
        fail("Najpierw przelicz zgłoszoną półkę w zadaniach zapasu");
      fillOrderReservations(actor, order.id);
    }
    const resolved = db()
      .prepare(
        "UPDATE wms_pick_exception SET resolved_at=?,resolution=? WHERE order_id=? AND resolved_at IS NULL",
      )
      .run(nowIso(), input.reason, order.id);
    if (
      !resolved.changes &&
      !hadException &&
      !order.hold_reason?.startsWith("Brak po przeliczeniu:")
    )
      fail("Nie ma otwartego zgłoszenia dla zamówienia");
    if (input.action === "continue")
      applyOrderAction(actor, order.id, {
        action: "resume",
        version: order.version,
        reason: input.reason,
      });
    return getOrder(order.id);
  });
}

export function cartAnalytics(actor: Actor, raw: unknown) {
  return readSnapshot(() => readCartAnalytics(actor, raw));
}
function readCartAnalytics(actor: Actor, raw: unknown) {
  manager(actor);
  const input = z
    .object({ days: z.coerce.number().int().min(1).max(90).default(30) })
    .parse(raw);
  const since = new Date(Date.now() - input.days * 86400000).toISOString();
  return {
    days: input.days,
    since,
    summary: db()
      .prepare(
        `SELECT count(*) AS runs,coalesce(sum(r.capacity),0) AS positions,coalesce(sum(r.assigned_count),0) AS orders,
      sum(CASE WHEN r.arrived_at IS NOT NULL THEN 1 ELSE 0 END) AS arrived_runs,
      avg(CASE WHEN r.arrived_at IS NOT NULL THEN (julianday(r.arrived_at)-julianday(w.created_at))*86400 END) AS elapsed_seconds
      FROM wms_cart_run r JOIN wms_wave w ON w.id=r.id WHERE w.created_at>=?`,
      )
      .get(since),
    carts: db()
      .prepare(
        `SELECT r.cart_code,r.capacity,count(*) AS runs,sum(r.assigned_count) AS orders,
      avg(CASE WHEN r.arrived_at IS NOT NULL THEN (julianday(r.arrived_at)-julianday(w.created_at))*86400 END) AS elapsed_seconds
      FROM wms_cart_run r JOIN wms_wave w ON w.id=r.id WHERE w.created_at>=? GROUP BY r.cart_code,r.capacity ORDER BY r.cart_code`,
      )
      .all(since),
    activity: db()
      .prepare(
        `SELECT r.cart_code,count(DISTINCT r.id||':'||m.bin||':'||m.tw_id) AS stops,
      count(*) AS confirmations,sum(-m.delta) AS picked_units
      FROM wms_cart_run r JOIN wms_wave w ON w.id=r.id JOIN wms_wave_order wo ON wo.wave_id=w.id
      JOIN wms_movement m ON m.order_id=wo.order_id AND m.kind='pick'
      WHERE w.created_at>=? GROUP BY r.cart_code ORDER BY r.cart_code`,
      )
      .all(since),
    exceptions: db()
      .prepare(
        "SELECT kind,count(*) AS count,sum(CASE WHEN resolved_at IS NULL THEN 1 ELSE 0 END) AS unresolved FROM wms_pick_exception WHERE created_at>=? GROUP BY kind",
      )
      .all(since),
    note: "Czas od przydziału do przekazania obejmuje postoje i oczekiwanie. Nie jest pomiarem roboczogodzin.",
  };
}
