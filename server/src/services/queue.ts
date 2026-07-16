import { db } from "../db/db.js";
import type { MmItem } from "../adapters/sfera.js";

export interface EnqueueBase {
  createdBy: string;
  twId?: number | null;
  sourceDocId?: number | null;
  sessionId?: number | null;
  label: string;
  detail: string;
}

function insert(
  type: string,
  payload: unknown,
  base: EnqueueBase
): number {
  const res = db()
    .prepare(
      `INSERT INTO sfera_queue(type, payload, status, label, detail, tw_id, source_doc_id, session_id, created_by)
       VALUES (?,?, 'pending', ?,?,?,?,?,?)`
    )
    .run(
      type,
      JSON.stringify(payload),
      base.label,
      base.detail,
      base.twId ?? null,
      base.sourceDocId ?? null,
      base.sessionId ?? null,
      base.createdBy
    );
  return Number(res.lastInsertRowid);
}

/** Zadanie zmiany lokalizacji (spec §5.2). */
export function enqueueSetLocation(
  twId: number,
  newValue: string,
  base: EnqueueBase
): number {
  return insert("set_location", { twId, newValue }, base);
}

/** Zadanie MM (spec §5.3). items: przesunięcie MGP→MAG. */
export function enqueueMM(
  magFrom: number,
  magTo: number,
  items: MmItem[],
  base: EnqueueBase
): number {
  return insert("mm", { magFrom, magTo, items }, base);
}

/**
 * Zadanie „zasilenie" (kombo): MM całości + ustawienie lokalizacji jednym
 * zadaniem (spec §5.3). Worker wykonuje MM, potem set_location.
 */
export function enqueueCombo(
  magFrom: number,
  magTo: number,
  items: MmItem[],
  location: string,
  base: EnqueueBase
): number {
  return insert("combo", { magFrom, magTo, items, location }, base);
}
