import type { FastifyInstance, FastifyReply } from "fastify";
import { sesjaZadania } from "../context.js";
import { db } from "../db/db.js";
import { licznikiKubelkow, listaZwrotow, osZwrotu } from "../services/zwroty.js";
import { stanZwrotowHealth } from "../services/allegro-zwroty-sync-state.js";

/* ── Trasy zwrotów klienckich (0.150.0) ──────────────────────────────────────
   SAME ODCZYTY. Ani jednego POST, PUT ani DELETE — werdykt, kwota i korekta
   wchodzą w 0.151.0, a wydanie, które tylko czyta, da się wycofać kopią
   bazy i niczego nie zostawia w Allegro.

   Bramka roli stoi na KAŻDEJ trasie, także na odczycie — tak samo jak przy
   skrzynce. Zwrot niesie numer zamówienia i nazwisko sprawy klienta; to są
   dane biura, nie hali.                                                     */

const BIURO = ["biuro", "admin"];

function odmowa(reply: FastifyReply) {
  const s = sesjaZadania();
  if (!s) return reply.code(401).send({ error: "Brak sesji — zaloguj się" });
  if (!BIURO.includes(s.user.role)) {
    return reply.code(403).send({ error: "Zwroty prowadzi biuro" });
  }
  return null;
}

export async function zwrotyRoutes(app: FastifyInstance) {
  /* Cała kolejka jednym strzałem razem z licznikami. Panel filtruje kubełkiem
     u siebie, więc przełączenie kubełka nie kosztuje żądania — a to jest
     dokładnie ten koszt, który ten ekran miał zdjąć. */
  app.get("/api/obsluga/zwroty", async (_req, reply) => {
    const nie = odmowa(reply);
    if (nie) return nie;
    const zwroty = listaZwrotow(db());
    return { zwroty, liczniki: licznikiKubelkow(zwroty), stan: stanZwrotowHealth(db()) };
  });

  app.get<{ Params: { id: string } }>("/api/obsluga/zwroty/:id", async (req, reply) => {
    const nie = odmowa(reply);
    if (nie) return nie;
    const id = Number(req.params.id);
    const zwrot = listaZwrotow(db()).find((z) => z.id === id);
    if (!zwrot) return reply.code(404).send({ error: "Nie znaleziono zwrotu" });
    return { zwrot, os: osZwrotu(db(), id) };
  });
}
