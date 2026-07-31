import { db } from "../db/db.js";

/* ── Rejestr kolizji kodów kreskowych (§4.5) ──────────────────────────────────
   Ten sam EAN na kilku kartotekach zatrzymuje pracę w alejce (D7). Zamiast
   znosić to w nieskończoność, zapisujemy każde trafienie: aplikacja staje się
   instrumentem pomiaru jakości danych, a biuro dostaje listę kodów do naprawy.

   Osobny moduł, żeby `delivery` (który zapisuje kolizje) i `problems` (który
   domyka dostawę po zgłoszeniu wyjątku) nie zapętliły się na imporcie.        */

const nowIso = () => new Date().toISOString();

export function recordEanConflict(
  ean: string,
  twIds: number[],
  auto: boolean
): void {
  db()
    .prepare("INSERT INTO ean_conflict(ean, tw_ids, auto, seen_at) VALUES (?,?,?,?)")
    .run(ean, JSON.stringify(twIds), auto ? 1 : 0, nowIso());
}

/** Zagregowany raport — ile razy który kod zatrzymał pracę. */
export function eanConflictReport(): Array<{
  ean: string;
  hits: number;
  autoResolved: number;
  twIds: number[];
  lastSeen: string;
}> {
  const rows = db()
    .prepare(
      `SELECT ean, COUNT(*) AS hits, SUM(auto) AS autoResolved,
              MAX(seen_at) AS lastSeen, MAX(tw_ids) AS twIds
       FROM ean_conflict GROUP BY ean ORDER BY hits DESC, ean`
    )
    .all() as Array<{ ean: string; hits: number; autoResolved: number; lastSeen: string; twIds: string }>;
  return rows.map((r) => ({
    ean: r.ean,
    hits: r.hits,
    autoResolved: r.autoResolved ?? 0,
    twIds: JSON.parse(r.twIds || "[]") as number[],
    lastSeen: r.lastSeen,
  }));
}
