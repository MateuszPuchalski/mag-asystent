import type { FastifyInstance, FastifyReply } from "fastify";
import { sesjaZadania } from "../context.js";
import { RODZAJE_SPRAW, type RodzajSprawy } from "../services/sprawy.js";
import {
  BladTagu,
  dodajRegule,
  dodajTag,
  listaRegul,
  skasujRegule,
  slownikTagow,
  tagiSprawy,
  usunTag,
  zapiszRegule,
  zastosujReguly,
} from "../services/tagi.js";

/* ── Tagi i reguły — trasy biura (0.136.0) ───────────────────────────────────
   Bramka biuro|admin jak przy szablonach: to codzienne narzędzie agenta, nie
   konfiguracja systemu. Zapisy dzieją się po jawnym kliknięciu; ZASTOSUJ
   REGUŁY jest osobnym przyciskiem, a nie skutkiem ubocznym wejścia na ekran.

   Reguła tagująca i przydzielająca nie mówi do klienta ani słowa — dlatego
   wolno jej działać automatem (zasada 6 z docs/architektura-spraw.md).     */

const ORZEKAJACY = ["biuro", "admin"];

export async function tagiRoutes(app: FastifyInstance) {
  function odmowa(): { kod: number; error: string } | null {
    const s = sesjaZadania();
    if (!s) return { kod: 401, error: "Brak sesji — zaloguj się" };
    if (!ORZEKAJACY.includes(s.user.role)) {
      return { kod: 403, error: "Tagi spraw są dostępne dla biura" };
    }
    return null;
  }

  const autor = (): string => sesjaZadania()?.user.name ?? "?";

  function zBledem<T>(reply: FastifyReply, fn: () => T): T | FastifyReply {
    try {
      return fn();
    } catch (e) {
      if (e instanceof BladTagu) return reply.code(e.kod).send({ error: e.message });
      throw e;
    }
  }

  /** Rodzaj i id źródła z querystringu — wspólne dla wszystkich tras tagów. */
  function zrodlo(
    rodzajSurowy: string | undefined,
    idSurowy: string | undefined
  ): { rodzaj: RodzajSprawy; id: number } | null {
    const id = Number(idSurowy);
    if (!rodzajSurowy || !(RODZAJE_SPRAW as string[]).includes(rodzajSurowy)) return null;
    if (!Number.isInteger(id) || id <= 0) return null;
    return { rodzaj: rodzajSurowy as RodzajSprawy, id };
  }

  app.get<{ Querystring: { rodzaj?: string; id?: string } }>(
    "/api/biuro/tagi",
    async (req, reply) => {
      const nie = odmowa();
      if (nie) return reply.code(nie.kod).send({ error: nie.error });
      const z = zrodlo(req.query.rodzaj, req.query.id);
      if (!z) {
        return reply
          .code(400)
          .send({ error: `Podaj rodzaj (${RODZAJE_SPRAW.join(", ")}) i dodatnie id sprawy` });
      }
      return { tagi: tagiSprawy(z.rodzaj, z.id), slownik: slownikTagow() };
    }
  );

  app.post<{ Body: { rodzaj?: string; id?: number; tag?: string } }>(
    "/api/biuro/tagi",
    async (req, reply) => {
      const nie = odmowa();
      if (nie) return reply.code(nie.kod).send({ error: nie.error });
      const z = zrodlo(req.body?.rodzaj, String(req.body?.id));
      if (!z) return reply.code(400).send({ error: "Podaj rodzaj i dodatnie id sprawy" });
      return zBledem(reply, () => ({ tagi: dodajTag(z.rodzaj, z.id, req.body?.tag ?? "", autor()) }));
    }
  );

  app.delete<{ Querystring: { rodzaj?: string; id?: string; tag?: string } }>(
    "/api/biuro/tagi",
    async (req, reply) => {
      const nie = odmowa();
      if (nie) return reply.code(nie.kod).send({ error: nie.error });
      const z = zrodlo(req.query.rodzaj, req.query.id);
      if (!z) return reply.code(400).send({ error: "Podaj rodzaj i dodatnie id sprawy" });
      return zBledem(reply, () => ({ tagi: usunTag(z.rodzaj, z.id, req.query.tag ?? "", autor()) }));
    }
  );

  // ── Reguły ────────────────────────────────────────────────────────────────

  app.get("/api/biuro/reguly", async (_req, reply) => {
    const nie = odmowa();
    if (nie) return reply.code(nie.kod).send({ error: nie.error });
    return { reguly: listaRegul() };
  });

  app.post<{
    Body: { nazwa?: string; rodzaj?: string; wzorzec?: string; tag?: string; przydziel?: string };
  }>("/api/biuro/reguly", async (req, reply) => {
    const nie = odmowa();
    if (nie) return reply.code(nie.kod).send({ error: nie.error });
    const b = req.body ?? {};
    return zBledem(reply, () =>
      dodajRegule(
        { nazwa: b.nazwa ?? "", rodzaj: b.rodzaj, wzorzec: b.wzorzec ?? "", tag: b.tag, przydziel: b.przydziel },
        autor()
      )
    );
  });

  app.put<{
    Params: { id: string };
    Body: {
      nazwa?: string;
      rodzaj?: string;
      wzorzec?: string;
      tag?: string;
      przydziel?: string;
      aktywna?: boolean;
    };
  }>("/api/biuro/reguly/:id", async (req, reply) => {
    const nie = odmowa();
    if (nie) return reply.code(nie.kod).send({ error: nie.error });
    const b = req.body ?? {};
    return zBledem(reply, () =>
      zapiszRegule(
        Number(req.params.id),
        {
          nazwa: b.nazwa ?? "",
          rodzaj: b.rodzaj,
          wzorzec: b.wzorzec ?? "",
          tag: b.tag,
          przydziel: b.przydziel,
          aktywna: b.aktywna,
        },
        autor()
      )
    );
  });

  app.delete<{ Params: { id: string } }>("/api/biuro/reguly/:id", async (req, reply) => {
    const nie = odmowa();
    if (nie) return reply.code(nie.kod).send({ error: nie.error });
    return zBledem(reply, () => {
      skasujRegule(Number(req.params.id), autor());
      return { skasowano: true };
    });
  });

  /* Ręczne uruchomienie na żądanie. Reguły chodzą też po każdej
     synchronizacji, ale świeżo zapisaną chce się zobaczyć od razu — bez
     czekania na następne pobranie. */
  app.post("/api/biuro/reguly/zastosuj", async (_req, reply) => {
    const nie = odmowa();
    if (nie) return reply.code(nie.kod).send({ error: nie.error });
    return zastosujReguly(autor());
  });
}
