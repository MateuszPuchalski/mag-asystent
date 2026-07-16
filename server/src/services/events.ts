import { db } from "../db/db.js";

/** Log zdarzeń — audyt każdego skanu i decyzji (spec §7, §12). */
export function logEvent(
  type: string,
  userId: string,
  twId: number | null = null,
  payload: unknown = null
): void {
  db()
    .prepare(
      "INSERT INTO events(type, tw_id, payload, user_id) VALUES (?,?,?,?)"
    )
    .run(type, twId, payload == null ? null : JSON.stringify(payload), userId);
}

export interface MovementEntry {
  type: string;
  user: string;
  at: string;
  detail: string;
}

/** Historia ruchów lokalizacji/MM danego towaru (dla karty na kolektorze). */
export function productHistory(twId: number, limit = 20): MovementEntry[] {
  const rows = db()
    .prepare(
      `SELECT type, user_id, payload, created_at FROM events
       WHERE tw_id = ? AND type IN ('location_set','location_removed','mm_queued')
       ORDER BY id DESC LIMIT ?`
    )
    .all(twId, limit) as Array<{ type: string; user_id: string; payload: string | null; created_at: string }>;
  return rows.map((r) => {
    let p: any = {};
    try {
      p = r.payload ? JSON.parse(r.payload) : {};
    } catch {
      /* uszkodzony payload */
    }
    let detail = "";
    if (r.type === "location_set") detail = p.result ? `→ ${p.result}` : `${p.action ?? ""} ${p.value ?? ""}`.trim();
    else if (r.type === "location_removed") detail = `usunięto ${p.value ?? ""}`.trim();
    else if (r.type === "mm_queued") detail = p.combo ? `zasilenie ${p.qty ?? ""} szt · ${p.location ?? ""}` : "MM MGP→MAG";
    return { type: r.type, user: r.user_id, at: r.created_at, detail };
  });
}
