import type { FastifyInstance } from "fastify";
import { db } from "../db/db.js";
import { cofnijFlage } from "../services/delivery-flag.js";

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
    detail: r.detail + (r.sgt_doc_number ? ` · dok. MM ${r.sgt_doc_number}` : ""),
    errMsg: r.error_msg,
    time: (r.processed_at ?? r.created_at).slice(11, 16),
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
    return { ok: true };
  });

  // anulowanie zadania oczekującego (pomyłka przy skanie) — tylko zanim worker je weźmie
  app.post<{ Params: { id: string } }>("/api/queue/:id/cancel", async (req, reply) => {
    const id = Number(req.params.id);
    const r = db()
      .prepare("SELECT status, type, source_doc_id FROM sfera_queue WHERE id = ?")
      .get(id) as { status: string; type: string; source_doc_id: number | null } | undefined;
    if (!r) return reply.code(404).send({ error: "Brak zadania" });
    if (r.status !== "pending")
      return reply.code(409).send({ error: "Można anulować tylko zadanie oczekujące (nie w trakcie zapisu)" });
    db()
      .prepare("UPDATE sfera_queue SET status='cancelled', processed_at=(strftime('%Y-%m-%dT%H:%M:%fZ','now')) WHERE id=?")
      .run(id);
    // Anulowane zadanie flagi zostawiłoby `flaga_wyslana` mówiące nieprawdę,
    // a rekoncyliacja szuka tylko zadań w stanie `error` — czyli tego jednego
    // kliknięcia by nie zobaczyła. Cofamy zapis, żeby `syncFlag` policzył
    // stan od nowa.
    if (r.type === "set_doc_flag" && r.source_doc_id != null) {
      cofnijFlage(r.source_doc_id, `zadanie #${id} anulowane`);
    }
    return { ok: true };
  });
}
