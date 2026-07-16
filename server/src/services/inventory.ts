import { db } from "../db/db.js";
import { subiekt } from "../context.js";
import { getProductsByLocation, validateLocationCode } from "./locations.js";
import { logEvent } from "./events.js";

/**
 * Inwentaryzacja = kontrola poprawności lokalizacji (analiza). Stan w SGT jest
 * per-magazyn, nie per-bin, więc weryfikujemy OBECNOŚĆ towaru w miejscu, nie
 * liczbę sztuk. Skan lokalizacji → lista towarów, które wg kartoteki tu leżą →
 * magazynier oznacza obecny/brak; „nadmiar" = towar fizycznie jest, a nie ma go
 * na kartotece pod tym kodem.
 */

export function createSession(user: string): number {
  const id = Number(
    db().prepare("INSERT INTO inventory_sessions(status, created_by) VALUES ('open', ?)").run(user)
      .lastInsertRowid
  );
  logEvent("inventory_open", user, null, { sessionId: id });
  return id;
}

/** Zarejestruj skan lokalizacji: dołóż oczekiwane towary (bez duplikatów). */
export function scanLocation(sessionId: number, rawCode: string, user: string) {
  const err = validateLocationCode(rawCode);
  if (err) return { error: err };
  const code = rawCode.trim().toUpperCase();
  const products = getProductsByLocation(code);
  const existing = db()
    .prepare("SELECT tw_id FROM inventory_items WHERE session_id=? AND location=?")
    .all(sessionId, code) as Array<{ tw_id: number }>;
  const have = new Set(existing.map((r) => r.tw_id));
  const ins = db().prepare(
    "INSERT INTO inventory_items(session_id, location, tw_id, expected, counted) VALUES (?,?,?,1,NULL)"
  );
  const tx = db().transaction(() => {
    for (const p of products) if (!have.has(p.id)) ins.run(sessionId, code, p.id);
  });
  tx();
  logEvent("inventory_scan_loc", user, null, { sessionId, location: code, expected: products.length });
  return { location: code, expected: products.length };
}

export function markItem(itemId: number, present: boolean, note: string | undefined, user: string) {
  const item = db().prepare("SELECT * FROM inventory_items WHERE id=?").get(itemId) as any;
  if (!item) return { error: "Brak pozycji" };
  db().prepare("UPDATE inventory_items SET counted=?, note=? WHERE id=?").run(present ? 1 : 0, note ?? null, itemId);
  logEvent("inventory_mark", user, item.tw_id, { itemId, present, location: item.location });
  return { ok: true };
}

/** Nadmiar: towar fizycznie w lokalizacji, którego kartoteka tam nie ma. */
export function addExtra(sessionId: number, rawCode: string, twId: number, user: string) {
  const t = subiekt.getProductById(twId);
  if (!t) return { error: "Nieznany towar" };
  const code = rawCode.trim().toUpperCase();
  const id = Number(
    db()
      .prepare("INSERT INTO inventory_items(session_id, location, tw_id, expected, counted) VALUES (?,?,?,0,1)")
      .run(sessionId, code, twId).lastInsertRowid
  );
  logEvent("inventory_extra", user, twId, { sessionId, location: code });
  return { itemId: id, sym: t.symbol, name: t.nazwa };
}

export function getSession(sessionId: number) {
  const s = db().prepare("SELECT * FROM inventory_sessions WHERE id=?").get(sessionId) as any;
  if (!s) return undefined;
  const rows = db()
    .prepare(
      `SELECT i.*, t.symbol AS sym, t.nazwa AS name
       FROM inventory_items i JOIN sgt_towar t ON t.tw_id = i.tw_id
       WHERE i.session_id=? ORDER BY i.location, t.symbol`
    )
    .all(sessionId) as Array<any>;
  const items = rows.map((r) => ({
    id: r.id,
    location: r.location,
    twId: r.tw_id,
    sym: r.sym,
    name: r.name,
    expected: !!r.expected,
    counted: r.counted == null ? null : !!r.counted,
    note: r.note as string | null,
  }));
  const summary = {
    total: items.length,
    ok: items.filter((i) => i.expected && i.counted === true).length,
    missing: items.filter((i) => i.expected && i.counted === false).length,
    extra: items.filter((i) => !i.expected).length,
    unchecked: items.filter((i) => i.expected && i.counted === null).length,
  };
  return { id: s.id, status: s.status, createdBy: s.created_by, items, summary };
}

export function closeSession(sessionId: number, user: string) {
  const view = getSession(sessionId);
  if (!view) return { error: "Brak sesji" };
  db()
    .prepare("UPDATE inventory_sessions SET status='closed', closed_at=(strftime('%Y-%m-%dT%H:%M:%fZ','now')) WHERE id=?")
    .run(sessionId);
  logEvent("inventory_close", user, null, { sessionId, summary: view.summary });
  return { status: "closed", summary: view.summary };
}
