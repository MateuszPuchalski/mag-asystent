-- Wybór następnego zadania MM do wykonania (status 'pending').
--
-- JEDNO ŹRÓDŁO PRAWDY dla dwóch światów: worker Sfery (C#) wykonuje ten plik
-- jako EmbeddedResource, a test server/src/worker/sfera-pick.test.ts wykonuje
-- DOKŁADNIE TEN SAM plik na testowej bazie SQLite. Zmiana tutaj jest od razu
-- mierzona w CI, bez dotneta i bez Windows.
--
-- Guard NOT EXISTS pilnuje niezmiennika „ADRES PRZED SPRZEDAWALNOŚCIĄ"
-- (server/src/services/przesuniecie.ts): przy jednym workerze Node kolejność
-- wykonania była kolejnością wstawienia (ORDER BY id), ale dwa niezależne
-- pollery tę gwarancję łamią konstrukcyjnie. MM czyni towar sprzedawalnym;
-- wykonane przed zapisem lokalizacji dawałoby okno, w którym towar jest już
-- sprzedawalny, a jego adres w kartotece stary albo pusty.
--
-- Decyzje w guardzie:
--  • po KOLUMNIE tw_id, nie po payloadzie — każde MM jest jednopozycyjne
--    z ustawionym tw_id (niezmiennik przy enqueueMM w services/queue.ts);
--  • poprzednik w 'error' BLOKUJE — stan bezpieczny to „adres zapisany, stan
--    czeka"; zadanie nie traci prób, inne tw_id idą dalej, po PONÓW
--    lokalizacji MM wchodzi samo. Cichy zakleszcz mierzy rekoncyliacja
--    (mm_czeka) i /api/health (zaleglosciMm);
--  • 'cancelled' NIE blokuje — człowiek świadomie wycofał zapis lokalizacji;
--  • set_location nigdy nie bywa w 'waiting_for_doc' (czekanie na dokument
--    dotyczy wyłącznie mm), więc lista statusów jest kompletna;
--  • tw_id IS NULL w q → porównanie z NULL nie dopasowuje → NOT EXISTS
--    przepuszcza; dziś nie występuje (patrz niezmiennik wyżej).
SELECT q.id, q.type, q.payload, q.attempts, q.source_doc_id, q.tw_id,
       q.created_by, q.created_by_ref
FROM sfera_queue q
WHERE q.type = 'mm'
  AND q.status = 'pending'
  AND (q.next_attempt_at IS NULL OR q.next_attempt_at <= @now)
  AND NOT EXISTS (
    SELECT 1 FROM sfera_queue p
    WHERE p.type = 'set_location'
      AND p.tw_id = q.tw_id
      AND p.id < q.id
      AND p.status IN ('pending', 'processing', 'error'))
ORDER BY q.id
LIMIT 1;
