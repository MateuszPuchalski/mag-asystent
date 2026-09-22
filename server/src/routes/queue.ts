import type { FastifyInstance } from "fastify";
import { db } from "../db/db.js";
import { czasLokalny } from "../czas.js";
import { logEvent } from "../services/events.js";
import { sesjaZadania } from "../context.js";

interface QueueRow {
  id: number;
  type: string;
  status: string;
  label: string;
  detail: string;
  error_msg: string | null;
  sgt_doc_number: string | null;
  created_at: string;
  processed_at: string | null;
}

function mapRow(r: QueueRow) {
  return {
    id: r.id,
    type: r.type,
    status: r.status,
    label: r.label,
    /* „MM" tylko przy MM. Numer ZW (0.349.0) niesie własny symbol, a dopisek
       „dok. MM ZW 12/MAG/09/2026" wysłałby magazyniera po zły dokument. */
    detail: r.detail + (r.sgt_doc_number
      ? ` · dok. ${r.type === "mm" ? "MM " : ""}${r.sgt_doc_number}` : ""),
    errMsg: r.error_msg,
    /* Godzina LOKALNA, nie wycinek z ISO. Wycinek pokazywał UTC, czyli latem
       dwie godziny wstecz — „zapisano 12:05" przy zegarze wskazującym 14:05. */
    time: czasLokalny(r.processed_at ?? r.created_at),
  };
}

export async function queueRoutes(app: FastifyInstance) {
  app.get("/api/queue", async () => {
    const rows = db()
      .prepare("SELECT * FROM sfera_queue ORDER BY id DESC LIMIT 100")
      .all() as unknown as QueueRow[];
    const summary = {
      pending: rows.filter((r) => r.status === "pending" || r.status === "processing" || r.status === "waiting_for_doc").length,
      error: rows.filter((r) => r.status === "error").length,
      done: rows.filter((r) => r.status === "done").length,
    };
    return { items: rows.map(mapRow), summary };
  });

  // ponowienie zadania błędnego (przycisk PONÓW na kolektorze)
  app.post<{ Params: { id: string } }>("/api/queue/:id/retry", async (req, reply) => {
    const id = Number(req.params.id);
    const r = db().prepare("SELECT status FROM sfera_queue WHERE id = ?").get(id) as
      | { status: string }
      | undefined;
    if (!r) return reply.code(404).send({ error: "Brak zadania" });
    if (r.status !== "error") return reply.code(409).send({ error: "Zadanie nie jest w błędzie" });
    db()
      .prepare(
        "UPDATE sfera_queue SET status='pending', attempts=0, error_msg=NULL, next_attempt_at=NULL, processed_at=NULL WHERE id=?"
      )
      .run(id);
    /* Ręczne ponowienie zapisu do bazy firmy (0.431.0). Do tej wersji nie
       zostawiało śladu: dziennik biura nie umiał powiedzieć, kto wysłał
       drugi raz zapis, który raz już się nie udał. Rola zostaje bez zmian,
       bo PONÓW woła też kolektor, przy półce. */
    logEvent("queue_ponowione_recznie", sesjaZadania()?.user.name ?? "?", null, { queueId: id });
    return { ok: true };
  });

  // anulowanie zadania oczekującego (pomyłka przy skanie) — tylko zanim worker je weźmie
  app.post<{ Params: { id: string } }>("/api/queue/:id/cancel", async (req, reply) => {
    const id = Number(req.params.id);
    const r = db()
      .prepare("SELECT status FROM sfera_queue WHERE id = ?")
      .get(id) as { status: string } | undefined;
    if (!r) return reply.code(404).send({ error: "Brak zadania" });
    if (r.status !== "pending")
      return reply.code(409).send({ error: "Można anulować tylko zadanie oczekujące (nie w trakcie zapisu)" });
    db()
      .prepare("UPDATE sfera_queue SET status='cancelled', processed_at=(strftime('%Y-%m-%dT%H:%M:%fZ','now')) WHERE id=?")
      .run(id);
    // Anulowanie zapisu do Subiekta to decyzja, której dziennik nie może przemilczeć.
    logEvent("queue_anulowane_recznie", sesjaZadania()?.user.name ?? "?", null, { queueId: id });
    return { ok: true };
  });
}
