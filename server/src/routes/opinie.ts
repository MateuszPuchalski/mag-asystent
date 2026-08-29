import type { FastifyInstance, FastifyReply } from "fastify";
import { sesjaZadania } from "../context.js";
import { stanPolaczenia } from "../services/allegro-token.js";
import {
  BladOpinii,
  licznikOpinii,
  listaOpinii,
  stanSynchronizacjiOpinii,
  synchronizujOpinie,
  zmienStatusOpinii,
} from "../services/opinie.js";

/* ── Opinie o sprzedawcy — trasy biura (0.135.0) ─────────────────────────────
   Bramka biuro|admin jak przy dyskusjach. Dwa zapisy: POBIERZ (synchronizacja
   z Allegro) i zmiana statusu. Odpowiadanie na opinię przez API świadomie NIE
   ma tu trasy — końcówka jest [WERYFIKUJ], a pisanie do klienta przez
   niezweryfikowany zasób to jedyny błąd, którego nie da się cofnąć.

   Awaria integracji wraca jako 502 ze zdaniem z adaptera (wzorzec dyskusji):
   to ono mówi, co naprawić — token, uprawnienie, brak zgody na zasób.       */

const ORZEKAJACY = ["biuro", "admin"];

export async function opinieRoutes(app: FastifyInstance) {
  function odmowa(): { kod: number; error: string } | null {
    const s = sesjaZadania();
    if (!s) return { kod: 401, error: "Brak sesji — zaloguj się" };
    if (!ORZEKAJACY.includes(s.user.role)) {
      return { kod: 403, error: "Opinie Allegro są dostępne dla biura" };
    }
    return null;
  }

  const autor = (): string => sesjaZadania()?.user.name ?? "?";

  app.get<{ Querystring: { status?: string } }>("/api/biuro/opinie", async (req, reply) => {
    const nie = odmowa();
    if (nie) return reply.code(nie.kod).send({ error: nie.error });
    return {
      opinie: listaOpinii(req.query.status),
      licznik: licznikOpinii(),
      synchronizacja: stanSynchronizacjiOpinii(),
      allegro: stanPolaczenia(),
    };
  });

  app.post("/api/biuro/opinie/odswiez", async (_req, reply) => {
    const nie = odmowa();
    if (nie) return reply.code(nie.kod).send({ error: nie.error });
    try {
      return await synchronizujOpinie(autor());
    } catch (e) {
      return reply
        .code(502)
        .send({ error: e instanceof Error ? e.message : "Allegro nie odpowiada" });
    }
  });

  app.post<{ Params: { id: string }; Body: { status?: string } }>(
    "/api/biuro/opinie/:id/status",
    async (req, reply) => {
      const nie = odmowa();
      if (nie) return reply.code(nie.kod).send({ error: nie.error });
      return zBledem(reply, () =>
        zmienStatusOpinii(Number(req.params.id), req.body?.status ?? "", autor())
      );
    }
  );

  function zBledem<T>(reply: FastifyReply, fn: () => T): T | FastifyReply {
    try {
      return fn();
    } catch (e) {
      if (e instanceof BladOpinii) return reply.code(e.kod).send({ error: e.message });
      throw e;
    }
  }
}
