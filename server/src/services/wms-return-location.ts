import { db } from "../db/db.js";
import { assertDestinationSpace, move, WmsError, type Actor } from "./wms.js";

type PickedAllocation = {
  id: number;
  line_id: number;
  bin: string;
  quantity: number;
  picked: number;
};

/** Zwrócone sztuki nadal należą do wstrzymanego zamówienia. Inna półka musi
 * przenieść również ich rezerwację, bez pozornego ruchu ze starej półki. */
export function restorePickedAllocation(
  actor: Actor,
  allocation: PickedAllocation,
  twId: number,
  orderId: number,
  quantity: number,
  target: string,
  reason: string,
) {
  const d = db();
  if (!d.isTransaction) throw new Error("Zwrot WMS wymaga transakcji command");
  const destination = d
    .prepare(
      `SELECT mode FROM wms_bin WHERE bin=? UNION ALL SELECT 'pick' AS mode
    WHERE EXISTS(SELECT 1 FROM wms_stock WHERE bin=?) AND NOT EXISTS(SELECT 1 FROM wms_bin WHERE bin=?) LIMIT 1`,
    )
    .get(target, target, target);
  if (destination?.mode !== "pick")
    throw new WmsError(
      409,
      "Zwrot zamówienia wymaga półki kompletacji. Wybierz inną półkę; kwarantanna i zaplecze nie mogą przejąć rezerwacji.",
    );
  if (target !== allocation.bin) {
    if (
      d
        .prepare(
          "SELECT 1 FROM wms_stock_check WHERE tw_id=? AND bin=? AND resolved_at IS NULL",
        )
        .get(twId, target)
    )
      throw new WmsError(
        409,
        "Wybrana półka czeka na przeliczenie. Wybierz inne miejsce",
      );
    assertDestinationSpace(twId, target, quantity);
  }
  move(actor, twId, target, quantity, quantity, "return", reason, orderId);
  if (target === allocation.bin) {
    d.prepare("UPDATE wms_allocation SET picked=picked-? WHERE id=?").run(
      quantity,
      allocation.id,
    );
    return;
  }
  const existing = d
    .prepare("SELECT id FROM wms_allocation WHERE line_id=? AND bin=?")
    .get(allocation.line_id, target);
  if (quantity === allocation.quantity && !existing) {
    d.prepare("UPDATE wms_allocation SET bin=?,picked=0 WHERE id=?").run(
      target,
      allocation.id,
    );
    return;
  }
  d.prepare(
    `INSERT INTO wms_allocation(line_id,bin,quantity) VALUES (?,?,?)
    ON CONFLICT(line_id,bin) DO UPDATE SET quantity=wms_allocation.quantity+excluded.quantity`,
  ).run(allocation.line_id, target, quantity);
  if (quantity === allocation.quantity)
    d.prepare("DELETE FROM wms_allocation WHERE id=?").run(allocation.id);
  else
    d.prepare(
      "UPDATE wms_allocation SET quantity=quantity-?,picked=picked-? WHERE id=?",
    ).run(quantity, quantity, allocation.id);
}
