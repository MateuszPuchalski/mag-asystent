import { db } from "../db/db.js";
import { WmsError } from "./wms.js";

const fail = (message: string): never => {
  throw new WmsError(409, message);
};
export function packingContents(orderId: number) {
  return db()
    .prepare(
      `SELECT c.line_id,c.parcel_no,c.quantity,l.sku,l.name FROM wms_pack_content c
    JOIN wms_line l ON l.id=c.line_id WHERE l.order_id=? ORDER BY c.parcel_no,l.id`,
    )
    .all(orderId)
    .map((r) => ({ ...r }));
}
export function parcelContents(shipmentId: number) {
  return db()
    .prepare(
      "SELECT line_id,tw_id,sku,name,quantity FROM wms_shipment_content WHERE shipment_id=? ORDER BY line_id",
    )
    .all(shipmentId)
    .map((r) => ({ ...r }));
}
export function addPackedContent(
  lineId: number,
  parcelNo: number,
  quantity: number,
) {
  db()
    .prepare(
      `INSERT INTO wms_pack_content(line_id,parcel_no,quantity) VALUES (?,?,?)
    ON CONFLICT(line_id,parcel_no) DO UPDATE SET quantity=quantity+excluded.quantity`,
    )
    .run(lineId, parcelNo, quantity);
}
export function clearPackingContents(orderId: number) {
  db()
    .prepare(
      "DELETE FROM wms_pack_content WHERE line_id IN (SELECT id FROM wms_line WHERE order_id=?)",
    )
    .run(orderId);
}
export function movePackedContent(
  lineId: number,
  from: number,
  to: number,
  quantity: number,
) {
  if (from === to) fail("Wybierz inną paczkę docelową");
  const old = db()
    .prepare(
      "SELECT quantity FROM wms_pack_content WHERE line_id=? AND parcel_no=?",
    )
    .get(lineId, from);
  if (!old || Number(old.quantity) < quantity)
    fail("W paczce źródłowej nie ma tylu sprawdzonych sztuk");
  if (Number(old!.quantity) === quantity)
    db()
      .prepare("DELETE FROM wms_pack_content WHERE line_id=? AND parcel_no=?")
      .run(lineId, from);
  else
    db()
      .prepare(
        "UPDATE wms_pack_content SET quantity=quantity-? WHERE line_id=? AND parcel_no=?",
      )
      .run(quantity, lineId, from);
  addPackedContent(lineId, to, quantity);
}
export function validatePackingContents(orderId: number, parcelCount: number) {
  const d = db();
  // Jedna etykieta jednoznacznie obejmuje całą skontrolowaną zawartość, także po aktualizacji starej sesji.
  if (
    parcelCount === 1 &&
    !d
      .prepare(
        `SELECT 1 FROM wms_pack_content c JOIN wms_line l ON l.id=c.line_id
    WHERE l.order_id=? AND c.parcel_no<>1`,
      )
      .get(orderId)
  ) {
    clearPackingContents(orderId);
    d.prepare(
      "INSERT INTO wms_pack_content(line_id,parcel_no,quantity) SELECT id,1,packed FROM wms_line WHERE order_id=? AND packed>0",
    ).run(orderId);
  }
  const mismatch = d
    .prepare(
      `SELECT l.sku FROM wms_line l LEFT JOIN wms_pack_content c ON c.line_id=l.id
    WHERE l.order_id=? GROUP BY l.id HAVING coalesce(sum(c.quantity),0)<>l.packed LIMIT 1`,
    )
    .get(orderId);
  if (mismatch)
    fail(
      `Brak pełnego podziału zawartości dla ${mismatch.sku}. Powtórz kontrolę pakowania`,
    );
  const parcels = d
    .prepare(
      `SELECT c.parcel_no FROM wms_pack_content c JOIN wms_line l ON l.id=c.line_id
    WHERE l.order_id=? GROUP BY c.parcel_no ORDER BY c.parcel_no`,
    )
    .all(orderId);
  if (
    parcels.length !== parcelCount ||
    parcels.some((p, i) => Number(p.parcel_no) !== i + 1)
  )
    fail(
      "Każda paczka musi mieć zawartość i etykietę. Użyj kolejnych numerów od 1",
    );
}
export function saveParcelContents(
  orderId: number,
  shipmentId: number,
  parcelNo: number,
) {
  db()
    .prepare(
      `INSERT INTO wms_shipment_content(shipment_id,line_id,tw_id,sku,name,quantity)
    SELECT ?,l.id,l.tw_id,l.sku,l.name,c.quantity FROM wms_pack_content c JOIN wms_line l ON l.id=c.line_id
    WHERE l.order_id=? AND c.parcel_no=?`,
    )
    .run(shipmentId, orderId, parcelNo);
}
