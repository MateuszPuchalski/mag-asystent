-- Wybór zadania MM czekającego na wyjście dokumentu z bufora
-- (status 'waiting_for_doc', gotowe do ponownego sprawdzenia).
--
-- Pass PRZED pick_mm_pending.sql — jak w workerze Node (kolejka.ts:pickTask):
-- zadanie, które już czekało, ma pierwszeństwo przed świeżym. Guard kolejności
-- identyczny jak tam — uzasadnienie i decyzje w pick_mm_pending.sql, to jest
-- ten sam zamysł w drugim statusie.
SELECT q.id, q.type, q.payload, q.attempts, q.source_doc_id, q.tw_id,
       q.created_by, q.created_by_ref
FROM sfera_queue q
WHERE q.type IN ('mm', 'korekta_zwrot')
  AND q.status = 'waiting_for_doc'
  AND (q.next_attempt_at IS NULL OR q.next_attempt_at <= @now)
  AND NOT EXISTS (
    SELECT 1 FROM sfera_queue p
    WHERE p.type = 'set_location'
      AND p.tw_id = q.tw_id
      AND p.id < q.id
      AND p.status IN ('pending', 'processing', 'error'))
ORDER BY q.id
LIMIT 1;
