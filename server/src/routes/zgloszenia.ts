import fs from "node:fs";
import type { FastifyInstance, FastifyReply } from "fastify";
import { currentDevice, sesjaZadania } from "../context.js";
import {
  BladZgloszenia, BrakZgloszenia, listaZgloszen, mojeZgloszenia, sciezkaZdjeciaZgloszenia,
  urzadzenieSesji, zlozZgloszenie, zmienStatus,
  type NoweZgloszenie, type ZmianaStatusu,
} from "../services/zgloszenia.js";

/* ── Zgłoszenia pracowników: trasy ───────────────────────────────────────────
   Cienkie: sesja, rola, serwis, tłumaczenie błędu na kod HTTP. Logika
   i dziennik siedzą w `services/zgloszenia.ts`.

   SKŁADA KAŻDA SESJA. Panel i kolektor logują się tą samą drogą i wysyłają
   token w `x-session`, więc bramka w `context.ts` wpuszcza oba bez wyjątków.

   CZYTA WYŁĄCZNIE ADMIN, a nie `ROLE_BIUROWE`. Decyzja właściciela: biuro
   zgłasza, ale cudzych zgłoszeń nie widzi, bo uwaga o koledze ma być bezpieczna. */

function odmowa(reply: FastifyReply) {
  const s = sesjaZadania();
  if (!s) return reply.code(401).send({ error: "Brak sesji — zaloguj się" });
  if (s.user.role !== "admin") {
    return reply.code(403).send({ error: "Zgłoszenia pracowników czyta właściciel" });
  }
  return null;
}

const autor = () => {
  const u = sesjaZadania()!.user;
  return { id: u.userId, name: u.name };
};

function blad(reply: FastifyReply, e: unknown) {
  if (e instanceof BrakZgloszenia) return reply.code(404).send({ error: e.message });
  if (e instanceof BladZgloszenia) return reply.code(400).send({ error: e.message });
  throw e;
}

export async function zgloszeniaRoutes(app: FastifyInstance) {
  /* `bodyLimit` wprost, choć globalny jest taki sam. Cztery zdjęcia po
     1024 kB to w base64 około 5,4 MiB, a zmiana globalnego progu nie może
     po cichu odciąć zgłoszeń ze zdjęciami. */
  app.post<{ Body: NoweZgloszenie }>("/api/zgloszenia", { bodyLimit: 6 * 1024 * 1024 }, async (req, reply) => {
    /* Urządzenie z nagłówka albo z sesji, nigdy z ciała. Ciało pisze klient,
       a pole ma odpowiadać na pytanie, który kolektor zawiódł. */
    const urzadzenie = currentDevice() ?? urzadzenieSesji(sesjaZadania()!.token);
    try {
      return { zgloszenie: zlozZgloszenie(req.body, autor(), urzadzenie) };
    } catch (e) {
      return blad(reply, e);
    }
  });

  app.get("/api/zgloszenia/moje", async () => ({ zgloszenia: mojeZgloszenia(autor().id) }));

  app.get<{ Querystring: { status?: string } }>("/api/obsluga/zgloszenia", async (req, reply) => {
    const nie = odmowa(reply);
    if (nie) return nie;
    try {
      return listaZgloszen(req.query.status);
    } catch (e) {
      return blad(reply, e);
    }
  });

  /* Nazwa pliku niesie losowy człon i znacznik czasu, więc treść pod tym
     adresem nie zmienia się nigdy. `private`, bo zdjęcie widzi tylko admin. */
  app.get<{ Params: { id: string; zid: string } }>("/api/obsluga/zgloszenia/:id/zdjecie/:zid", async (req, reply) => {
    const nie = odmowa(reply);
    if (nie) return nie;
    const plik = sciezkaZdjeciaZgloszenia(Number(req.params.id), Number(req.params.zid));
    if (!plik) return reply.code(404).send({ error: "Brak zdjęcia" });
    return reply
      .type("image/jpeg")
      .header("cache-control", "private, max-age=31536000, immutable")
      /* Treść przyszła od pracownika, więc przeglądarka ma wierzyć typowi
         z nagłówka, a nie zgadywać go z bajtów. */
      .header("x-content-type-options", "nosniff")
      .send(fs.createReadStream(plik));
  });

  app.post<{ Params: { id: string }; Body: ZmianaStatusu }>("/api/obsluga/zgloszenia/:id/status", async (req, reply) => {
    const nie = odmowa(reply);
    if (nie) return nie;
    try {
      return { zgloszenie: zmienStatus(Number(req.params.id), req.body, autor()) };
    } catch (e) {
      return blad(reply, e);
    }
  });
}
