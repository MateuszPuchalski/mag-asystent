import { db } from "../db/db.js";
import { move, WmsError, type Actor, type getOrder } from "./wms.js";

/** Część została już zdjęta z półki. Rozbieżność usuwa tylko pobranie;
 * wyłącznie fizyczne uszkodzenie tworzy zapas w kwarantannie, bez rezerwacji. */
export function removePickedAllocation(
  actor: Actor,
  order: ReturnType<typeof getOrder>,
  lineId: number,
  quantity: number,
  quarantine: string | null,
  reason: string,
  allocationId?: number,
) {
  const d = db();
  if (!d.isTransaction)
    throw new Error("Rozbieżność WMS wymaga transakcji command");
  const line = order.lines.find((l) => l.id === lineId);
  const allocations = order.allocations.filter(
    (a) =>
      a.line_id === lineId &&
      a.picked > 0 &&
      (allocationId === undefined || a.id === allocationId),
  );
  if (
    !line ||
    !Number.isInteger(quantity) ||
    quantity <= 0 ||
    quantity > line.picked ||
    quantity > allocations.reduce((sum, a) => sum + a.picked, 0)
  )
    throw new WmsError(
      409,
      "Ilość przekracza nierozliczone pobrania tej części",
    );
  if (
    quarantine !== null &&
    d.prepare("SELECT mode FROM wms_bin WHERE bin=?").get(quarantine)?.mode !==
      "quarantine"
  )
    throw new WmsError(400, "Zeskanuj lokalizację kwarantanny");
  let left = quantity;
  for (const a of allocations) {
    const take = Math.min(left, a.picked);
    if (a.quantity === take)
      d.prepare("DELETE FROM wms_allocation WHERE id=?").run(a.id);
    else
      d.prepare(
        "UPDATE wms_allocation SET quantity=quantity-?,picked=picked-? WHERE id=?",
      ).run(take, take, a.id);
    left -= take;
    if (!left) break;
  }
  if (quarantine !== null)
    move(
      actor,
      line.tw_id,
      quarantine,
      quantity,
      0,
      "return",
      reason,
      order.id,
    );
}
