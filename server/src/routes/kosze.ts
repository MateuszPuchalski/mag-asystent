import type { FastifyInstance, FastifyReply } from "fastify";
import { sesjaZadania } from "../context.js";
import {
  BladKosza,
  koszPoKodzie,
  koszeDlaKolektora,
  listaKoszy,
  odepnijZwrot,
  odlozPozycje,
  przypnijZwrot,
  skanTowaruKosza,
  szczegolKosza,
  zakonczKosz,
  zamknijKosz,
} from "../services/kosze.js";
import { szczegolZwrotu } from "../services/zwroty.js";

/* ── Kosze zwrotowe — trasy ──────────────────────────────────────────────────
   Dwie publiczności jednej tabeli:

     /api/biuro/…  — przypinanie zwrotów i zamykanie koszy; rola biuro|admin,
                     jak reszta zwrotów (pieniądze klienta i dokumenty).
     /api/kosze/…  — praca hali: lista zamkniętych, skan towaru, odkładanie,
                     zakończenie. KAŻDA zalogowana rola, bo rozkłada magazynier
                     — bramka globalna z context.ts i tak wymaga sesji.       */

const ORZEKAJACY = ["biuro", "admin"];

export async function koszeRoutes(app: FastifyInstance) {
  function odmowaBiuro(): { kod: number; error: string } | null {
    const s = sesjaZadania();
    if (!s) return { kod: 401, error: "Brak sesji — zaloguj się" };
    if (!ORZEKAJACY.includes(s.user.role)) {
      return { kod: 403, error: "Kosze zamyka i przypina biuro" };
    }
    return null;
  }

  const autor = (): string => sesjaZadania()?.user.name ?? "?";

  function zBledem<T>(reply: FastifyReply, fn: () => T): T | FastifyReply {
    try {
      return fn();
    } catch (e) {
      if (e instanceof BladKosza) return reply.code(e.kod).send({ error: e.message });
      throw e;
    }
  }

  // ── Biuro: wiązanie zwrotów i zamykanie ───────────────────────────────────

  app.post<{ Params: { id: string }; Body: { kod?: string } }>(
    "/api/biuro/zwroty/:id/kosz",
    async (req, reply) => {
      const nie = odmowaBiuro();
      if (nie) return reply.code(nie.kod).send({ error: nie.error });
      return zBledem(reply, () => {
        przypnijZwrot(Number(req.params.id), req.body?.kod ?? "", autor());
        return { zwrot: szczegolZwrotu(Number(req.params.id)) };
      });
    }
  );

  app.delete<{ Params: { id: string } }>("/api/biuro/zwroty/:id/kosz", async (req, reply) => {
    const nie = odmowaBiuro();
    if (nie) return reply.code(nie.kod).send({ error: nie.error });
    return zBledem(reply, () => {
      odepnijZwrot(Number(req.params.id), autor());
      return { zwrot: szczegolZwrotu(Number(req.params.id)) };
    });
  });

  app.get("/api/biuro/kosze", async (_req, reply) => {
    const nie = odmowaBiuro();
    if (nie) return reply.code(nie.kod).send({ error: nie.error });
    return { kosze: listaKoszy() };
  });

  app.get<{ Params: { id: string } }>("/api/biuro/kosze/:id", async (req, reply) => {
    const nie = odmowaBiuro();
    if (nie) return reply.code(nie.kod).send({ error: nie.error });
    return zBledem(reply, () => ({ kosz: szczegolKosza(Number(req.params.id)) }));
  });

  app.post<{ Params: { id: string } }>("/api/biuro/kosze/:id/zamknij", async (req, reply) => {
    const nie = odmowaBiuro();
    if (nie) return reply.code(nie.kod).send({ error: nie.error });
    return zBledem(reply, () => ({ kosz: zamknijKosz(Number(req.params.id), autor()) }));
  });

  // ── Hala: rozkładanie z kosza na kolektorze ───────────────────────────────

  app.get("/api/kosze", async () => ({ kosze: koszeDlaKolektora() }));

  app.get<{ Params: { id: string } }>("/api/kosze/:id", async (req, reply) =>
    zBledem(reply, () => ({ kosz: szczegolKosza(Number(req.params.id)) }))
  );

  /* Skan ETYKIETY KOSZA — magazynier podchodzi z koszem, nie z listą. Kod
     zamiast id, bo id nie ma na fizycznej etykiecie. */
  app.get<{ Params: { kod: string } }>("/api/kosze/kod/:kod", async (req, reply) => {
    const kosz = koszPoKodzie(decodeURIComponent(req.params.kod));
    if (!kosz || kosz.status !== "zamkniety") {
      return reply.code(404).send({ error: "Brak zamkniętego kosza o tym kodzie" });
    }
    return { kosz: szczegolKosza(kosz.id) };
  });

  app.post<{ Params: { id: string }; Body: { code?: string } }>(
    "/api/kosze/:id/skan",
    async (req, reply) => {
      const code = (req.body?.code ?? "").trim();
      if (!code) return reply.code(400).send({ error: "Pusty kod" });
      return zBledem(reply, () => skanTowaruKosza(Number(req.params.id), code));
    }
  );

  app.post<{ Params: { id: string }; Body: { lokalizacja?: string; recznie?: boolean } }>(
    "/api/kosze/pozycje/:id/odloz",
    async (req, reply) =>
      zBledem(reply, () =>
        odlozPozycje(Number(req.params.id), req.body?.lokalizacja ?? "", autor(), !!req.body?.recznie)
      )
  );

  app.post<{ Params: { id: string } }>("/api/kosze/:id/zakoncz", async (req, reply) =>
    zBledem(reply, () => ({ kosz: zakonczKosz(Number(req.params.id), autor()) }))
  );
}
