import fs from "node:fs";
import type { FastifyInstance } from "fastify";
import { userOf } from "../context.js";
import { eanConflictReport } from "../services/ean.js";
import {
  exportCsv,
  listByDelivery,
  listUnresolved,
  photoPath,
  photoRefOf,
  raiseProblem,
  resolveProblem,
  zapiszPrzesylke,
} from "../services/problems.js";

/* ── Faza 2: wyjątki widoczne i mierzalne (D8) ──────────────────────────── */

export async function problemRoutes(app: FastifyInstance) {
  /**
   * Nierozwiązane wyjątki — pytane przy starcie aplikacji. Bez tego ekranu
   * wyjątki znikają z pola widzenia i nikt się nimi nie zajmuje.
   */
  app.get("/api/problems/unresolved", async () => ({ problems: listUnresolved() }));

  app.post<{ Params: { id: string }; Body: { note?: string } }>(
    "/api/problems/:id/resolve",
    async (req, reply) => {
      const r = resolveProblem(Number(req.params.id), req.body?.note, userOf(req));
      if ("error" in r) return reply.code(404).send({ error: r.error });
      return r;
    }
  );

  /** Zdjęcie dowodowe (reklamacja u dostawcy). */
  app.get<{ Params: { id: string } }>("/api/problems/:id/photo", async (req, reply) => {
    const ref = photoRefOf(Number(req.params.id));
    if (!ref) return reply.code(404).send({ error: "Brak zdjęcia" });
    const file = photoPath(ref);
    if (!file) return reply.code(404).send({ error: "Brak pliku" });
    return reply.type("image/jpeg").send(fs.createReadStream(file));
  });

  /** Zgłoszenie wyjątku dla linii dostawy. */
  app.post<{
    Params: { id: string };
    Body: {
      lineId?: number;
      typ: string;
      qty?: number;
      symObcy?: string;
      zamiastIlosc?: number;
      opis?: string;
      photoBase64?: string;
    };
  }>("/api/delivery/:id/problems", async (req, reply) => {
    const b = req.body ?? ({} as any);
    const r = raiseProblem(
      {
        deliveryId: Number(req.params.id),
        lineId: b.lineId ?? null,
        typ: b.typ,
        qty: b.qty ?? null,
        symObcy: b.symObcy ?? null,
        zamiastIlosc: b.zamiastIlosc ?? null,
        opis: b.opis ?? null,
        photoBase64: b.photoBase64 ?? null,
      },
      userOf(req)
    );
    if ("error" in r) return reply.code(400).send({ error: r.error });
    return r;
  });

  /**
   * Przesyłka: numer i odpowiedź o protokole kuriera.
   *
   * Osobna trasa, bo te dane dotyczą CAŁEJ paczki, nie pojedynczego artykułu.
   * Wpisane przy każdym uszkodzonym towarze z osobna mogłyby się różnić —
   * a to jedna przesyłka i jeden numer.
   */
  app.post<{ Params: { id: string }; Body: { nrPrzesylki?: string; kurierProtokol?: string } }>(
    "/api/delivery/:id/przesylka",
    async (req, reply) => {
      const r = zapiszPrzesylke(
        Number(req.params.id),
        req.body?.nrPrzesylki ?? null,
        req.body?.kurierProtokol ?? null,
        userOf(req)
      );
      if ("error" in r) return reply.code(400).send({ error: r.error });
      return r;
    }
  );

  /** Wyjątki JEDNEJ dostawy — źródło formularza reklamacyjnego w podglądzie biura. */
  app.get<{ Params: { id: string } }>("/api/delivery/:id/problems", async (req) => ({
    problems: listByDelivery(Number(req.params.id)),
  }));

  /** CSV do reklamacji — podstawa rozmowy z dostawcą. */
  app.get<{ Params: { id: string } }>("/api/delivery/:id/problems.csv", async (req, reply) => {
    const csv = exportCsv(Number(req.params.id));
    return reply
      .type("text/csv; charset=utf-8")
      .header("content-disposition", `attachment; filename="problemy-${req.params.id}.csv"`)
      .send(csv);
  });

  /** Raport kolizji EAN dla biura — lista kodów do naprawy w kartotece. */
  app.get("/api/ean-conflicts", async () => ({ conflicts: eanConflictReport() }));
}
