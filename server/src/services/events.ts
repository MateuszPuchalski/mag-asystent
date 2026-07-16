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
