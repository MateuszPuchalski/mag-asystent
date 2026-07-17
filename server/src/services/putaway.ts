import { db } from "../db/db.js";
import { config } from "../config.js";
import { subiekt } from "../context.js";
import { enqueueMM, enqueueSetLocation } from "./queue.js";
import { pendingMmByTw } from "./stock.js";
import { logEvent } from "./events.js";
import { validateLocationCode } from "./locations.js";
import type { MmItem } from "../adapters/sfera.js";
import type { PutawayDocument, PutawayItemView } from "../types.js";

const LOCK_TTL_MS = 30 * 60 * 1000;

/** Lista dokumentów FZ/PZ na MGP (14 dni) z postępem sesji (spec §5.4). */
export function listDocuments(days = 14): PutawayDocument[] {
  const docs = subiekt.listPutawayDocuments(days);
  return docs.map((d) => {
    const positions = subiekt.getDocumentPositions(d.dok_id).length;
    const sess = db()
      .prepare(
        `SELECT id, status FROM putaway_sessions
         WHERE source_doc_id = ? ORDER BY id DESC LIMIT 1`
      )
      .get(d.dok_id) as { id: number; status: string } | undefined;
    let session: PutawayDocument["session"];
    if (sess) {
      const agg = db()
        .prepare(
          `SELECT COUNT(*) AS total, SUM(CASE WHEN status IN ('done','skipped') THEN 1 ELSE 0 END) AS done
           FROM putaway_items WHERE session_id = ?`
        )
        .get(sess.id) as { total: number; done: number };
      session = {
        id: sess.id,
        status: sess.status,
        progressPct: agg.total ? Math.round((100 * (agg.done ?? 0)) / agg.total) : 0,
      };
    }
    return {
      docId: d.dok_id,
      typ: d.typ,
      nrPelny: d.nr_pelny,
      dataWyst: d.data_wyst,
      dostawca: d.dostawca ?? "",
      positions,
      session,
    };
  });
}

/** Utwórz (lub wznów) sesję rozkładania dla dokumentu lub trybu „całe MGP". */
export function createSession(
  opts: { docId?: number; mode?: "all_mgp" },
  user: string
): number {
  let sourceDocId: number | null = null;
  let sourceDocNumber: string | null = null;
  let positions: Array<{ tw_id: number; ilosc: number }>;

  if (opts.docId) {
    const doc = subiekt.getDocument(opts.docId);
    if (!doc) throw new Error("Nie znaleziono dokumentu");
    // wznowienie istniejącej otwartej sesji
    const open = db()
      .prepare("SELECT id FROM putaway_sessions WHERE source_doc_id=? AND status='open' ORDER BY id DESC LIMIT 1")
      .get(opts.docId) as { id: number } | undefined;
    if (open) return open.id;
    sourceDocId = doc.dok_id;
    sourceDocNumber = doc.nr_pelny;
    positions = subiekt.getDocumentPositions(opts.docId);
  } else {
    // wznowienie istniejącej otwartej sesji „całe MGP" — bez duplikatów pozycji
    const open = db()
      .prepare("SELECT id FROM putaway_sessions WHERE source_doc_id IS NULL AND status='open' ORDER BY id DESC LIMIT 1")
      .get() as { id: number } | undefined;
    if (open) return open.id;
    positions = subiekt.listMgpStockProducts();
  }

  // agregacja tego samego towaru (różne partie/ceny → jedna pozycja sesji)
  const agg = new Map<number, number>();
  for (const p of positions) agg.set(p.tw_id, (agg.get(p.tw_id) ?? 0) + p.ilosc);

  const sessionId = Number(
    db()
      .prepare(
        `INSERT INTO putaway_sessions(source_doc_id, source_doc_number, status, created_by)
         VALUES (?,?, 'open', ?)`
      )
      .run(sourceDocId, sourceDocNumber, user).lastInsertRowid
  );

  const insItem = db().prepare(
    `INSERT INTO putaway_items(session_id, tw_id, target_loc, qty_expected, status, off_document)
     VALUES (?,?,?,?, 'pending', 0)`
  );
  const tx = db().transaction(() => {
    for (const [twId, qty] of agg) {
      const t = subiekt.getProductById(twId);
      const targetLoc = t?.lokalizacja ? t.lokalizacja.split(" ").filter(Boolean)[0] ?? null : null;
      insItem.run(sessionId, twId, targetLoc, qty);
    }
  });
  tx();

  logEvent("putaway_session_open", user, null, { sessionId, docId: sourceDocId });
  return sessionId;
}

/** Pozycje sesji sortowane po lokalizacji docelowej; BRAK LOK na końcu. */
export function getSession(sessionId: number) {
  const session = db()
    .prepare("SELECT * FROM putaway_sessions WHERE id = ?")
    .get(sessionId) as
    | { id: number; source_doc_id: number | null; source_doc_number: string | null; status: string }
    | undefined;
  if (!session) return undefined;

  const rows = db()
    .prepare(
      `SELECT i.*, t.symbol AS sym, t.nazwa AS name, COALESCE(s.stan,0) AS mgp_stan
       FROM putaway_items i JOIN sgt_towar t ON t.tw_id = i.tw_id
       LEFT JOIN sgt_stan s ON s.tw_id = i.tw_id AND s.mag_id = ${config.magId.MGP}
       WHERE i.session_id = ?`
    )
    .all(sessionId) as Array<any>;

  const items: PutawayItemView[] = rows
    .map((r) => ({
      id: r.id,
      twId: r.tw_id,
      sym: r.sym,
      name: r.name,
      targetLoc: r.target_loc,
      qtyExpected: r.qty_expected,
      qtyDone: r.qty_done,
      delta: r.qty_expected - r.qty_done,
      mgpStan: r.mgp_stan,
      status: r.status,
      skipReason: r.skip_reason,
      lockedBy: freshLock(r.locked_by, r.locked_at),
      offDocument: !!r.off_document,
      stageQty: r.stage_qty,
      stageLoc: r.stage_loc,
    }))
    // sort po lokalizacji docelowej, BRAK LOK na końcu (spec §5.4)
    .sort((a, b) => {
      if (!a.targetLoc && !b.targetLoc) return a.sym.localeCompare(b.sym);
      if (!a.targetLoc) return 1;
      if (!b.targetLoc) return -1;
      return a.targetLoc.localeCompare(b.targetLoc) || a.sym.localeCompare(b.sym);
    });

  const total = items.length;
  const doneCount = items.filter((i) => i.status === "done" || i.status === "skipped").length;
  const onCart = items.filter((i) => i.status === "on_cart").length;

  // zadania kolejki tej sesji: błędy jako alerty (MM/lokalizacja nie weszły do
  // Subiekta mimo odhaczonych pozycji) + licznik „w drodze"
  const queueAlerts = db()
    .prepare(
      `SELECT id, type, label, detail, error_msg AS errorMsg FROM sfera_queue
       WHERE session_id = ? AND status = 'error' ORDER BY id`
    )
    .all(sessionId) as Array<{ id: number; type: string; label: string; detail: string; errorMsg: string | null }>;
  const inFlight = (
    db()
      .prepare(
        `SELECT COUNT(*) AS n FROM sfera_queue
         WHERE session_id = ? AND status IN ('pending','processing','waiting_for_doc')`
      )
      .get(sessionId) as { n: number }
  ).n;

  return {
    id: session.id,
    sourceDocId: session.source_doc_id,
    sourceDocNumber: session.source_doc_number,
    status: session.status,
    progress: { total, done: doneCount, remaining: total - doneCount, onCart },
    queueAlerts,
    inFlight,
    items,
  };
}

function freshLock(lockedBy: string | null, lockedAt: string | null): string | null {
  if (!lockedBy || !lockedAt) return null;
  return Date.now() - Date.parse(lockedAt) < LOCK_TTL_MS ? lockedBy : null;
}

/** Dostępny stan MGP = stan magazynowy minus MM „w drodze" (kolejka Sfery). */
function availableMgp(twId: number): number {
  const stan = subiekt.getStock(twId, config.magId.MGP).stan;
  return stan - (pendingMmByTw().get(twId) ?? 0);
}

/** Skan towaru na wózek (spec §5.4 pkt 1). Zwraca pozycję lub info „spoza dok.". */
export function scanToCart(sessionId: number, twId: number, user: string) {
  const item = db()
    .prepare("SELECT * FROM putaway_items WHERE session_id=? AND tw_id=?")
    .get(sessionId, twId) as any;
  const t = subiekt.getProductById(twId);
  if (!t) return { error: "Nieznany towar" };

  if (!item) {
    // spoza dokumentu (spec §5.4 pkt 5) — sygnał dla UI
    return { offDocument: true, twId, sym: t.symbol, name: t.nazwa };
  }
  const lock = freshLock(item.locked_by, item.locked_at);
  if (lock && lock !== user) return { locked: true, lockedBy: lock };

  // bez fizycznego stanu na MGP (po odjęciu MM „w drodze") nie ma czego rozkładać
  const avail = availableMgp(twId);
  if (avail <= 0) return { error: "Brak stanu na MGP (lub całość już w drodze na MAG)" };

  const remaining = item.qty_expected - item.qty_done;
  const defaultQty = Math.min(Math.max(remaining, 1), avail);
  const targetLoc = t.lokalizacja ? t.lokalizacja.split(" ").filter(Boolean)[0] ?? null : null;

  db()
    .prepare(
      `UPDATE putaway_items
       SET status='on_cart', stage_qty=?, stage_loc=?, locked_by=?, locked_at=?
       WHERE id=?`
    )
    .run(defaultQty, targetLoc, user, new Date().toISOString(), item.id);
  logEvent("putaway_confirm", user, twId, { sessionId, stage: "on_cart", qty: defaultQty });
  return { itemId: item.id, twId, sym: t.symbol, name: t.nazwa, qty: defaultQty, targetLoc };
}

/** Dodanie towaru spoza dokumentu (spec §5.4 pkt 5). */
export function addOffDocument(sessionId: number, twId: number, user: string) {
  const t = subiekt.getProductById(twId);
  if (!t) return { error: "Nieznany towar" };
  const avail = availableMgp(twId);
  if (avail <= 0) return { error: "Brak stanu na MGP (lub całość już w drodze na MAG)" };
  const targetLoc = t.lokalizacja ? t.lokalizacja.split(" ").filter(Boolean)[0] ?? null : null;
  const id = Number(
    db()
      .prepare(
        `INSERT INTO putaway_items(session_id, tw_id, target_loc, qty_expected, qty_done, status, off_document, stage_qty, stage_loc, locked_by, locked_at)
         VALUES (?,?,?,?,0,'on_cart',1,?,?,?,?)`
      )
      .run(sessionId, twId, targetLoc, avail, avail, targetLoc, user, new Date().toISOString())
      .lastInsertRowid
  );
  logEvent("putaway_confirm", user, twId, { sessionId, offDocument: true });
  return { itemId: id, twId, sym: t.symbol, name: t.nazwa };
}

/** Potwierdzenie pozycji przy regale: qty + lokalizacja (spec §5.4 pkt 2/3/6). */
export function confirmItem(
  itemId: number,
  qty: number,
  location: string,
  updateLoc: boolean,
  user: string
) {
  const item = db().prepare("SELECT * FROM putaway_items WHERE id=?").get(itemId) as any;
  if (!item) return { error: "Brak pozycji" };
  const locErr = validateLocationCode(location);
  if (locErr) return { error: locErr };
  if (!Number.isFinite(qty) || qty <= 0) return { error: "Ilość musi być większa od zera" };
  const avail = availableMgp(item.tw_id);
  if (qty > avail) return { error: `Na MGP dostępne tylko ${avail} szt`, status: 409 };
  db()
    .prepare("UPDATE putaway_items SET status='on_cart', stage_qty=?, stage_loc=?, stage_update_loc=? WHERE id=?")
    .run(qty, location.toUpperCase(), updateLoc ? 1 : 0, itemId);
  logEvent("putaway_confirm", user, item.tw_id, { itemId, qty, location, updateLoc });
  return { ok: true };
}

/** Zdejmij z wózka (cofnij). */
export function removeFromCart(itemId: number, user: string) {
  const item = db().prepare("SELECT * FROM putaway_items WHERE id=?").get(itemId) as any;
  if (!item) return { error: "Brak pozycji" };
  if (item.off_document) {
    db().prepare("DELETE FROM putaway_items WHERE id=?").run(itemId);
  } else {
    db()
      .prepare("UPDATE putaway_items SET status='pending', stage_qty=NULL, stage_loc=NULL, locked_by=NULL, locked_at=NULL WHERE id=?")
      .run(itemId);
  }
  logEvent("putaway_cart_remove", user, item.tw_id, { itemId });
  return { ok: true };
}

/** Pomiń pozycję + powód (spec §5.4 pkt 7). */
export function skipItem(itemId: number, reason: string | undefined, user: string) {
  const item = db().prepare("SELECT * FROM putaway_items WHERE id=?").get(itemId) as any;
  if (!item) return { error: "Brak pozycji" };
  db()
    .prepare("UPDATE putaway_items SET status='skipped', skip_reason=?, locked_by=NULL, locked_at=NULL WHERE id=?")
    .run(reason ?? null, itemId);
  logEvent("putaway_skip", user, item.tw_id, { itemId, reason });
  return { ok: true };
}

/**
 * Zatwierdzenie wózka (spec §5.4 pkt 8): jeden dokument MM + zadania
 * set_location z tej rundy. Pozycje częściowe zostają na liście.
 */
export function commitCart(sessionId: number, user: string) {
  const session = db().prepare("SELECT * FROM putaway_sessions WHERE id=?").get(sessionId) as any;
  if (!session) return { error: "Brak sesji" };
  const cart = db()
    .prepare("SELECT * FROM putaway_items WHERE session_id=? AND status='on_cart' AND stage_loc IS NOT NULL")
    .all(sessionId) as any[];
  if (!cart.length) return { error: "Wózek pusty — najpierw potwierdź pozycje ze skanem lokalizacji" };

  const mmItems: MmItem[] = cart
    .filter((i) => i.stage_qty > 0)
    .map((i) => ({ twId: i.tw_id, qty: i.stage_qty }));

  // walidacja przed kolejką: suma z wózka per towar vs stan MGP minus MM „w drodze"
  // (inaczej MM padłby dopiero w workerze, a pozycje byłyby już odhaczone)
  const staged = new Map<number, number>();
  for (const i of mmItems) staged.set(i.twId, (staged.get(i.twId) ?? 0) + i.qty);
  for (const [twId, qty] of staged) {
    const avail = availableMgp(twId);
    if (qty > avail) {
      const t = subiekt.getProductById(twId);
      return {
        error: `${t?.symbol ?? twId}: na MGP dostępne tylko ${avail} szt (na wózku ${qty})`,
        status: 409,
      };
    }
  }

  const queueIds: number[] = [];
  if (mmItems.length) {
    const qid = enqueueMM(config.magId.MGP, config.magId.MAG, mmItems, {
      createdBy: user,
      twId: null,
      sourceDocId: session.source_doc_id,
      sessionId,
      label: `MM wózek · ${mmItems.length} poz.`,
      detail: `${mmItems.reduce((s, i) => s + i.qty, 0)} szt MGP→MAG (rozkładanie)`,
    });
    queueIds.push(qid);
  }

  const tx = db().transaction(() => {
    for (const i of cart) {
      // set_location, gdy zeskanowana lokalizacja różni się i user zatwierdził aktualizację
      const t = subiekt.getProductById(i.tw_id);
      const current = t?.lokalizacja ? t.lokalizacja.split(" ").filter(Boolean) : [];
      if (i.stage_update_loc && i.stage_loc && current[0] !== i.stage_loc) {
        const newLocs = current.length <= 1 ? [i.stage_loc] : Array.from(new Set([i.stage_loc, ...current]));
        const joined = newLocs.join(" ").slice(0, config.locFieldLimit);
        const qid = enqueueSetLocation(i.tw_id, joined, {
          createdBy: user,
          twId: i.tw_id,
          sessionId,
          label: "Lokalizacja · " + (t?.symbol ?? i.tw_id),
          detail: `${i.stage_loc} (rozkładanie)`,
        });
        queueIds.push(qid);
      }
      const doneQty = i.qty_done + (i.stage_qty ?? 0);
      const status = doneQty >= i.qty_expected ? "done" : "partial";
      db()
        .prepare(
          "UPDATE putaway_items SET qty_done=?, status=?, stage_qty=NULL, stage_loc=NULL, locked_by=NULL, locked_at=NULL WHERE id=?"
        )
        .run(doneQty, status, i.id);
    }
  });
  tx();

  logEvent("putaway_commit_cart", user, null, { sessionId, items: cart.length, queueIds });
  return { queueIds, committed: cart.length };
}

/** Zamknięcie sesji + rozliczenie (spec §5.4 „zamknięcie sesji"). */
export function closeSession(sessionId: number, user: string) {
  const rows = db()
    .prepare("SELECT status FROM putaway_items WHERE session_id=?")
    .all(sessionId) as Array<{ status: string }>;
  const summary = {
    done: rows.filter((r) => r.status === "done").length,
    partial: rows.filter((r) => r.status === "partial").length,
    skipped: rows.filter((r) => r.status === "skipped").length,
    untouched: rows.filter((r) => r.status === "pending" || r.status === "on_cart").length,
    total: rows.length,
  };
  const status = summary.partial + summary.skipped + summary.untouched > 0 ? "closed_with_deviations" : "closed";
  db()
    .prepare("UPDATE putaway_sessions SET status=?, closed_at=? WHERE id=?")
    .run(status, new Date().toISOString(), sessionId);
  logEvent("putaway_session_close", user, null, { sessionId, status, summary });
  return { status, summary };
}
