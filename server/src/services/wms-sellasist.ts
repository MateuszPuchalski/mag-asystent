import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { db, nowIso } from "../db/db.js";
import {
  SellasistClient,
  SellasistError,
  mapSellasistOrder,
  sourceTracking,
  type SellasistSettings,
  type SourceOrder,
} from "../adapters/sellasist-wms.js";
import { userById } from "./users.js";
import {
  actOnOrder,
  command,
  getOrder,
  importOrders,
  manager,
  type Actor,
  actionInput,
  shipmentFingerprint,
  WmsError,
} from "./wms.js";
import { logEvent } from "./events.js";

function integrationActor(settings: SellasistSettings): Actor {
  const user = userById(settings.userId);
  if (!user?.active)
    throw new Error("Konto integracji WMS jest nieaktywne lub nie istnieje");
  const actor = { id: user.userId, name: user.name, role: user.role };
  manager(actor);
  return actor;
}
const fingerprint = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
function orderFingerprint(order: ReturnType<typeof mapSellasistOrder>) {
  const quantities = new Map<string, number>();
  for (const line of order.lines) {
    const sku = line.sku.toUpperCase();
    quantities.set(sku, (quantities.get(sku) || 0) + line.quantity);
  }
  return fingerprint({
    reference: order.reference,
    channel: order.channel,
    priority: order.priority,
    dueAt: order.dueAt,
    lines: [...quantities].sort(([a], [b]) => a.localeCompare(b)),
  });
}
type Link = {
  account: string;
  external_id: number;
  order_id: number;
  fingerprint: string;
  exported_at: string | null;
};

function issue(
  account: string,
  externalId: number,
  stage: "import" | "source" | "export",
  message: string,
  proposal: unknown = null,
) {
  db()
    .prepare(
      `INSERT INTO wms_sellasist_issue(account,external_id,stage,message,proposal,updated_at) VALUES (?,?,?,?,?,?)
    ON CONFLICT(account,external_id,stage) DO UPDATE SET message=excluded.message,proposal=excluded.proposal,updated_at=excluded.updated_at`,
    )
    .run(
      account,
      externalId,
      stage,
      message.slice(0, 500),
      proposal ? JSON.stringify(proposal) : null,
      nowIso(),
    );
}
function clearIssue(account: string, externalId: number, stage: string) {
  db()
    .prepare(
      "DELETE FROM wms_sellasist_issue WHERE account=? AND external_id=? AND stage=?",
    )
    .run(account, externalId, stage);
}

function holdSource(
  settings: SellasistSettings,
  link: Link,
  message: string,
  proposal: unknown = null,
) {
  const order = getOrder(link.order_id);
  if (!["shipped", "cancelled"].includes(order.status) && !order.hold_reason)
    actOnOrder(integrationActor(settings), randomUUID(), order.id, {
      action: "hold",
      version: order.version,
      reason: message,
    });
  issue(settings.account, link.external_id, "source", message, proposal);
}

function observe(settings: SellasistSettings, source: SourceOrder, link: Link) {
  if (
    source.placeholder ||
    !settings.readyStatuses.includes(source.status.id)
  ) {
    holdSource(
      settings,
      link,
      `Sellasist SA-${source.id}: status ${source.status.id} nie dopuszcza realizacji. Sprawdź zamówienie w sklepie.`,
    );
    return;
  }
  const mapped = mapSellasistOrder(source, settings),
    current = getOrder(link.order_id),
    hash = orderFingerprint(mapped);
  if (localFingerprint(current) !== hash) {
    holdSource(
      settings,
      link,
      `Sellasist SA-${source.id}: zmieniono treść zamówienia. Uzgodnij pozycje i termin przed wznowieniem.`,
      { orderId: current.id, order: mapped },
    );
    return;
  }
  if (hash !== link.fingerprint) {
    command(
      `sa-reconcile-${fingerprint([settings.account, source.id, link.fingerprint, hash, current.version])}`,
      integrationActor(settings),
      "sellasist_reconcile",
      { account: settings.account, externalId: source.id, fingerprint: hash },
      () => {
        db()
          .prepare(
            "UPDATE wms_sellasist_link SET fingerprint=? WHERE account=? AND external_id=?",
          )
          .run(hash, settings.account, source.id);
        return { orderId: current.id };
      },
    );
  }
  clearIssue(settings.account, source.id, "source");
}

function localFingerprint(order: ReturnType<typeof getOrder>) {
  return orderFingerprint({
    reference: order.reference,
    channel: order.channel,
    dueAt: order.due_at,
    priority: order.priority,
    lines: order.lines,
  });
}

function confirmShipment(
  source: SourceOrder,
  order: ReturnType<typeof getOrder>,
  settings: SellasistSettings,
) {
  const tracking = sourceTracking(source);
  if (
    !order.shipments.length ||
    order.shipments.some((p) => !tracking.has(String(p.tracking)))
  )
    throw new Error(
      "Numery paczek WMS nie zgadzają się z listami przewozowymi Sellasist",
    );
  if (
    orderFingerprint(mapSellasistOrder(source, settings)) !==
    localFingerprint(order)
  )
    throw new Error(
      "Treść zamówienia WMS nie zgadza się z Sellasist przed przekazaniem wysyłki",
    );
}

export async function verifySellasistShipment(
  actor: Actor,
  key: string,
  orderId: number,
  raw: unknown,
  settings: SellasistSettings | null,
  client = settings ? new SellasistClient(settings) : null,
) {
  const input = actionInput.parse(raw);
  if (input.action === "ship" && !/^[a-zA-Z0-9_-]{16,100}$/.test(key))
    throw new WmsError(400, "Wymagany poprawny Idempotency-Key");
  if (
    input.action !== "ship" ||
    db().prepare("SELECT 1 FROM wms_command WHERE key=?").get(key)
  )
    return;
  const link = db()
    .prepare("SELECT * FROM wms_sellasist_link WHERE order_id=?")
    .get(orderId) as Link | undefined;
  if (!link) return;
  const order = getOrder(orderId);
  if (order.packer_id !== actor.id)
    throw new WmsError(403, "Pakowanie prowadzi inna osoba");
  if (order.status !== "packed" || order.version !== input.version)
    throw new WmsError(409, "Zamówienie zmieniło się. Odśwież przed wysyłką");
  if (!settings || settings.account !== link.account || !client)
    throw new WmsError(
      409,
      "Integracja Sellasist tego zamówienia jest wyłączona",
    );
  let source: SourceOrder;
  try {
    source = await client.order(link.external_id);
  } catch {
    throw new WmsError(
      503,
      "Nie potwierdzono zamówienia w Sellasist. Zachowaj paczkę i ponów operację",
    );
  }
  if (
    source.id !== link.external_id ||
    !settings.readyStatuses.includes(source.status.id)
  )
    throw new WmsError(
      409,
      "Status zamówienia w Sellasist nie dopuszcza wysyłki",
    );
  const parcels = [input, ...input.extraParcels].map((p) => ({
    tracking: p.tracking,
  }));
  try {
    confirmShipment(source, { ...order, shipments: parcels }, settings);
  } catch (e) {
    throw new WmsError(
      409,
      e instanceof Error ? e.message : "Nie potwierdzono przesyłki",
    );
  }
  // Dowód wiąże odpowiedź sklepu z kontem, wersją i całą treścią konkretnego zapisu.
  db()
    .prepare(
      `INSERT INTO wms_sellasist_check(key,order_id,fingerprint,checked_at) VALUES (?,?,?,?)
    ON CONFLICT(key) DO UPDATE SET order_id=excluded.order_id,fingerprint=excluded.fingerprint,checked_at=excluded.checked_at`,
    )
    .run(key, orderId, shipmentFingerprint(actor, orderId, input), Date.now());
  db()
    .prepare("DELETE FROM wms_sellasist_check WHERE checked_at<?")
    .run(Date.now() - 3600000);
}

export function sellasistStatus(settings: SellasistSettings | null) {
  if (!settings) return { enabled: false };
  const user = userById(settings.userId);
  const configurationError =
    !user?.active || !["biuro", "admin"].includes(user.role)
      ? "Konto integracji musi być aktywne i mieć uprawnienia biura"
      : null;
  const state = db()
    .prepare(
      "SELECT last_started,last_finished,last_result,last_error,retry_at,lease_until FROM wms_sellasist_state WHERE account=?",
    )
    .get(settings.account) as
    | {
        last_started: string | null;
        last_finished: string | null;
        last_result: string | null;
        last_error: string | null;
        retry_at: number;
        lease_until: number;
      }
    | undefined;
  const issueRows = db()
    .prepare(
      "SELECT external_id,stage,message,proposal,updated_at FROM wms_sellasist_issue WHERE account=? ORDER BY updated_at DESC LIMIT 100",
    )
    .all(settings.account) as {
    external_id: number;
    stage: string;
    message: string;
    proposal: string | null;
    updated_at: string;
  }[];
  const issues = issueRows.map((i) => ({
    ...i,
    proposal: i.proposal
      ? (JSON.parse(String(i.proposal)) as {
          orderId: number;
          order: ReturnType<typeof mapSellasistOrder>;
        })
      : null,
  }));
  return {
    enabled: true,
    configurationError,
    account: settings.account,
    readyStatuses: settings.readyStatuses,
    shippedStatus: settings.shippedStatus ?? null,
    intervalMs: settings.intervalMs,
    state: state
      ? {
          ...state,
          last_result: state.last_result
            ? JSON.parse(String(state.last_result))
            : null,
        }
      : null,
    issues,
  };
}

// Jedna dzierżawa w SQLite chroni także przed uruchomieniem dwóch procesów API.
// Każdy cykl ma limit czasu; sieć nigdy nie pracuje wewnątrz transakcji stanów.
export async function syncSellasist(
  settings: SellasistSettings,
  client = new SellasistClient(settings),
) {
  const actor = integrationActor(settings),
    account = settings.account,
    token = randomUUID(),
    started = Date.now(),
    deadline = started + 90000;
  const d = db();
  d.prepare(
    "INSERT OR IGNORE INTO wms_sellasist_state(account) VALUES (?)",
  ).run(account);
  const locked = d
    .prepare(
      `UPDATE wms_sellasist_state SET lease_token=?,lease_until=?,last_started=?
    WHERE account=? AND lease_until<? AND retry_at<=?`,
    )
    .run(token, started + 180000, nowIso(), account, started, started);
  if (!locked.changes) return { skipped: true };
  const state = d
    .prepare(
      "SELECT cursors,status_cursor,watch_cursor,export_cursor FROM wms_sellasist_state WHERE account=?",
    )
    .get(account)!;
  const cursors = JSON.parse(String(state.cursors)) as Record<string, number>;
  let statusCursor =
      Number(state.status_cursor) % settings.readyStatuses.length,
    watchCursor = Number(state.watch_cursor),
    exportCursor = Number(state.export_cursor),
    retryAt = 0,
    error: string | null = null;
  const result = { created: 0, existing: 0, held: 0, exported: 0, errors: 0 };
  const available = (until = deadline) => Date.now() < until;
  const observed = new Map<number, SourceOrder>();
  const transportFailure = (e: unknown) =>
    e instanceof SellasistError &&
    (e.status === 0 ||
      e.status === 401 ||
      e.status === 403 ||
      e.status === 429 ||
      e.status >= 500);
  try {
    const orderedStatuses = [
      ...settings.readyStatuses.slice(statusCursor),
      ...settings.readyStatuses.slice(0, statusCursor),
    ];
    for (const status of orderedStatuses) {
      if (!available(started + 45000)) break;
      const after = cursors[status] || 0;
      const rows = await client.orders(status, after);
      let processed = 0;
      for (const row of rows) {
        if (!available(started + 45000)) break;
        try {
          const source = await client.order(row.id);
          observed.set(row.id, source);
          if (source.id !== row.id)
            throw new Error("Sellasist zwrócił inny numer zamówienia");
          const link = d
            .prepare(
              "SELECT * FROM wms_sellasist_link WHERE account=? AND external_id=?",
            )
            .get(account, row.id) as Link | undefined;
          if (link) {
            observe(settings, source, link);
            result.existing++;
          } else if (
            settings.readyStatuses.includes(source.status.id) &&
            !source.placeholder
          ) {
            const mapped = mapSellasistOrder(source, settings),
              hash = orderFingerprint(mapped),
              currentActor = integrationActor(settings);
            const imported = importOrders(
              currentActor,
              `sa-import-${fingerprint([account, row.id, hash])}`,
              { orders: [mapped] },
            );
            const orderId = imported.orders[0].id;
            command(
              `sa-link-${fingerprint([account, row.id])}`,
              currentActor,
              "sellasist_link",
              { account, externalId: row.id, orderId, fingerprint: hash },
              () => {
                d.prepare(
                  "INSERT INTO wms_sellasist_link(account,external_id,order_id,fingerprint,sales_channel) VALUES (?,?,?,?,?)",
                ).run(
                  account,
                  row.id,
                  orderId,
                  hash,
                  `Sellasist/${account}/${source.source || "sklep"}`,
                );
                return { orderId };
              },
            );
            result.created++;
          }
          clearIssue(account, row.id, "import");
        } catch (e) {
          if (transportFailure(e)) throw e;
          result.errors++;
          issue(
            account,
            row.id,
            "import",
            e instanceof z.ZodError
              ? "Niepoprawne pozycje lub pola odpowiedzi Sellasist"
              : e instanceof Error
                ? e.message
                : "Nie udało się zaimportować zamówienia",
          );
        }
        cursors[status] = row.id;
        processed++;
      }
      // Wracamy do początku: stare zamówienie może dopiero dziś przejść do gotowych.
      if (processed === rows.length && rows.length < 100) cursors[status] = 0;
      statusCursor =
        (settings.readyStatuses.indexOf(status) + 1) %
        settings.readyStatuses.length;
    }

    const watched = d
      .prepare(
        `SELECT l.* FROM wms_sellasist_link l JOIN wms_order o ON o.id=l.order_id
      WHERE l.account=? AND l.order_id>? AND o.status NOT IN ('shipped','cancelled') ORDER BY l.order_id LIMIT 25`,
      )
      .all(account, watchCursor) as Link[];
    let watchedCount = 0;
    for (const link of watched) {
      if (!available(started + 65000)) break;
      try {
        const source =
          observed.get(link.external_id) ??
          (await client.order(link.external_id));
        if (source.id !== link.external_id)
          throw new Error("Sellasist zwrócił inny numer zamówienia");
        observe(settings, source, link);
      } catch (e) {
        if (transportFailure(e)) throw e;
        holdSource(
          settings,
          link,
          `Sellasist SA-${link.external_id}: nie można potwierdzić aktualnego zamówienia. Sprawdź je przed realizacją.`,
        );
        result.errors++;
      }
      watchCursor = link.order_id;
      watchedCount++;
    }
    if (watchedCount === watched.length && watched.length < 25) watchCursor = 0;

    if (settings.shippedStatus) {
      const exports = d
        .prepare(
          `SELECT l.* FROM wms_sellasist_link l JOIN wms_order o ON o.id=l.order_id
        WHERE l.account=? AND l.order_id>? AND l.exported_at IS NULL AND o.status='shipped' ORDER BY l.order_id LIMIT 25`,
        )
        .all(account, exportCursor) as Link[];
      let exportedCount = 0;
      for (const link of exports) {
        if (!available()) break;
        try {
          let source = await client.order(link.external_id);
          if (source.id !== link.external_id)
            throw new Error("Sellasist zwrócił inny numer zamówienia");
          const order = getOrder(link.order_id);
          confirmShipment(source, order, settings);
          if (source.status.id !== settings.shippedStatus) {
            if (!settings.readyStatuses.includes(source.status.id))
              throw new Error(
                "Status Sellasist nie dopuszcza potwierdzenia wysyłki",
              );
            integrationActor(settings);
            await client.markShipped(link.external_id, settings.shippedStatus);
            source = await client.order(link.external_id);
            if (
              source.id !== link.external_id ||
              source.status.id !== settings.shippedStatus
            )
              throw new Error("Sellasist nie potwierdził statusu wysłania");
          }
          confirmShipment(source, order, settings);
          command(
            `sa-export-${fingerprint([account, link.external_id])}`,
            integrationActor(settings),
            "sellasist_export",
            { account, externalId: link.external_id, orderId: order.id },
            () => {
              d.prepare(
                "UPDATE wms_sellasist_link SET exported_at=? WHERE account=? AND external_id=?",
              ).run(nowIso(), account, link.external_id);
              return { orderId: order.id };
            },
          );
          clearIssue(account, link.external_id, "export");
          result.exported++;
        } catch (e) {
          if (transportFailure(e)) throw e;
          result.errors++;
          issue(
            account,
            link.external_id,
            "export",
            e instanceof z.ZodError
              ? "Niepoprawna odpowiedź Sellasist"
              : e instanceof Error
                ? e.message
                : "Nie potwierdzono wysyłki",
          );
        }
        exportCursor = link.order_id;
        exportedCount++;
      }
      if (exportedCount === exports.length && exports.length < 25)
        exportCursor = 0;
    }
  } catch (e) {
    error =
      e instanceof SellasistError
        ? e.message
        : e instanceof z.ZodError
          ? "Niepoprawna odpowiedź Sellasist"
          : "Nie ukończono synchronizacji Sellasist";
    retryAt =
      Date.now() +
      (e instanceof SellasistError && e.retryMs ? e.retryMs : 60000);
  } finally {
    result.held = Number(
      d
        .prepare(
          "SELECT count(*) AS n FROM wms_sellasist_issue WHERE account=? AND stage='source'",
        )
        .get(account)!.n,
    );
    d.prepare(
      `UPDATE wms_sellasist_state SET cursors=?,status_cursor=?,watch_cursor=?,export_cursor=?,lease_until=0,lease_token=NULL,retry_at=?,last_finished=?,last_result=?,last_error=?
      WHERE account=? AND lease_token=?`,
    ).run(
      JSON.stringify(cursors),
      statusCursor,
      watchCursor,
      exportCursor,
      retryAt,
      nowIso(),
      JSON.stringify(result),
      error,
      account,
      token,
    );
    logEvent(
      "wms_sellasist_sync",
      actor.name,
      null,
      { account, ...result, error },
      actor.id,
    );
  }
  return { ...result, error };
}
