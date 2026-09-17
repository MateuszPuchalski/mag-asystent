import { db } from "../db/db.js";

export type DestinationHint = {
  tw_id: number;
  bin: string;
  on_hand: number;
  mode: string;
  room: number | null;
};

/** Podpowiedź nie rezerwuje miejsca. Końcowy ruch ponownie sprawdza limit,
 * bo drugi operator może odłożyć towar podczas przejścia do półki. */
export function destinationHints(products: number[], source = "") {
  return db()
    .prepare(
      `WITH candidates AS (
      SELECT s.tw_id,s.bin,s.on_hand,coalesce(b.mode,'pick') AS mode,
      CASE WHEN s.capacity IS NULL THEN NULL ELSE max(0,s.capacity-s.on_hand-
        coalesce((SELECT sum(r.quantity) FROM wms_replenishment r
        WHERE r.tw_id=s.tw_id AND r.target=s.bin AND r.completed_at IS NULL AND r.cancelled_at IS NULL),0)) END AS room
      FROM wms_stock s LEFT JOIN wms_bin b ON b.bin=s.bin
      WHERE s.tw_id IN (SELECT value FROM json_each(?)) AND s.bin<>?
      AND coalesce(b.mode,'pick')<>'quarantine'
      AND NOT EXISTS(SELECT 1 FROM wms_stock_check c WHERE c.tw_id=s.tw_id AND c.bin=s.bin AND c.resolved_at IS NULL)
      AND NOT EXISTS(SELECT 1 FROM wms_capacity_issue c WHERE c.tw_id=s.tw_id AND c.bin=s.bin AND c.resolved_at IS NULL)
    ), ranked AS (
      SELECT *,row_number() OVER(PARTITION BY tw_id ORDER BY (mode='pick') DESC,bin) AS rank
      FROM candidates WHERE room IS NULL OR room>0
    ) SELECT tw_id,bin,on_hand,mode,room FROM ranked WHERE rank<=8 ORDER BY tw_id,rank`,
    )
    .all(JSON.stringify(products), source) as DestinationHint[];
}
