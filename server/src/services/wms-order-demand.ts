// Jedna miara niepokrytych zamówień zapobiega sprzecznym priorytetom odkładania i uzupełnień.
export const orderDemandCtes = `order_needs AS (
    SELECT l.tw_id,o.id,o.priority,o.due_at,
      sum(max(0,l.quantity-coalesce((SELECT sum(a.quantity) FROM wms_allocation a WHERE a.line_id=l.id),0))) AS missing
    FROM wms_line l JOIN wms_order o ON o.id=l.order_id
    WHERE (o.status IN ('new','allocated','picking') OR (o.status='packing' AND o.hold_reason IS NULL AND EXISTS(SELECT 1 FROM wms_pack_recovery r WHERE r.order_id=o.id AND r.completed_at IS NULL AND r.cancelled_at IS NULL))) AND (o.hold_reason IS NULL OR o.status<>'new')
    GROUP BY l.tw_id,o.id HAVING missing>0
  ), pick_stock AS (
    SELECT s.*,p.symbol AS sku,p.nazwa AS name,p.ean AS barcode,
      sum(s.on_hand-s.reserved) OVER(PARTITION BY s.tw_id) AS available,
      coalesce((SELECT sum(r.quantity) FROM wms_replenishment r WHERE r.tw_id=s.tw_id AND r.target=s.bin AND r.completed_at IS NULL AND r.cancelled_at IS NULL),0) AS incoming
    FROM wms_stock s JOIN wms_product p ON p.tw_id=s.tw_id LEFT JOIN wms_bin b ON b.bin=s.bin
    WHERE coalesce(b.mode,'pick')='pick' AND NOT EXISTS(SELECT 1 FROM wms_stock_check c WHERE c.tw_id=s.tw_id AND c.bin=s.bin AND c.resolved_at IS NULL)
  ), coverage AS (
    SELECT tw_id,sum(on_hand-reserved+incoming) AS covered FROM pick_stock GROUP BY tw_id
  ), order_queue AS (
    SELECT o.*,coalesce(c.covered,0) AS covered,
      sum(missing) OVER(PARTITION BY o.tw_id ORDER BY priority DESC,due_at,id ROWS UNBOUNDED PRECEDING) AS cumulative
    FROM order_needs o LEFT JOIN coverage c ON c.tw_id=o.tw_id
  ), order_shortfalls AS (
    SELECT *,min(missing,max(0,cumulative-covered)) AS shortage FROM order_queue
  ), demand AS (
    SELECT tw_id,sum(missing) AS needed,sum(shortage) AS order_shortage,
      max(CASE WHEN shortage>0 THEN priority END) AS order_priority FROM order_shortfalls GROUP BY tw_id
  )`;
