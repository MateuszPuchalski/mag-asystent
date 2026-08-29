import type { FastifyInstance, FastifyReply } from "fastify";
import { sesjaZadania } from "../context.js";
import { RODZAJE_SPRAW, type RodzajSprawy } from "../services/sprawy.js";
import {
  BladSzablonu,
  dodajSzablon,
  listaSzablonow,
  skasujSzablon,
  szablonDlaSprawy,
  zapiszSzablon,
  type KanalSzablonu,
} from "../services/szablony.js";

/* ── Szablony odpowiedzi — trasy biura (0.133.0) ─────────────────────────────
   Bramka biuro|admin jak przy dyskusjach: szablony to codzienne narzędzie
   agenta, nie konfiguracja systemu. Kto odpowiada klientom, ten wie, które
   zdania działają — i ten ma je poprawiać bez czekania na admina.

   Trzy zapisy (dodanie, edycja, skasowanie) i dwa odczyty. Zapisy dzieją się
   po jawnym kliknięciu w ustawieniach; wstawienie szablonu do odpowiedzi
   NICZEGO nie zapisuje.                                                     */

const ORZEKAJACY = ["biuro", "admin"];

export async function szablonyRoutes(app: FastifyInstance) {
  function odmowa(): { kod: number; error: string } | null {
    const s = sesjaZadania();
    if (!s) return { kod: 401, error: "Brak sesji — zaloguj się" };
    if (!ORZEKAJACY.includes(s.user.role)) {
      return { kod: 403, error: "Szablony odpowiedzi są dostępne dla biura" };
    }
    return null;
  }

  const autor = (): string => sesjaZadania()?.user.name ?? "?";

  function zBledem<T>(reply: FastifyReply, fn: () => T): T | FastifyReply {
    try {
      return fn();
    } catch (e) {
      if (e instanceof BladSzablonu) return reply.code(e.kod).send({ error: e.message });
      throw e;
    }
  }

  app.get<{ Querystring: { kanal?: string } }>("/api/biuro/szablony", async (req, reply) => {
    const nie = odmowa();
    if (nie) return reply.code(nie.kod).send({ error: nie.error });
    const kanal = req.query.kanal;
    /* Zły kanał to literówka w kliencie: 400 z listą zamiast cichej pustki. */
    if (kanal !== undefined && !["pytanie", "dyskusja"].includes(kanal)) {
      return reply.code(400).send({ error: "Filtr kanału: pytanie albo dyskusja" });
    }
    return { szablony: listaSzablonow(kanal as KanalSzablonu | undefined) };
  });

  /* Szablon WYPEŁNIONY danymi sprawy. Odczyt — panel wstawia zwrócony tekst
     w miejsce kursora, a wysyła go człowiek osobnym kliknięciem. */
  app.get<{ Params: { id: string }; Querystring: { rodzaj?: string; id?: string } }>(
    "/api/biuro/szablony/:id/dla",
    async (req, reply) => {
      const nie = odmowa();
      if (nie) return reply.code(nie.kod).send({ error: nie.error });
      const szablonId = Number(req.params.id);
      const rodzaj = req.query.rodzaj;
      const lokalnyId = Number(req.query.id);
      if (
        !Number.isInteger(szablonId) ||
        !rodzaj ||
        !(RODZAJE_SPRAW as string[]).includes(rodzaj) ||
        !Number.isInteger(lokalnyId) ||
        lokalnyId <= 0
      ) {
        return reply
          .code(400)
          .send({ error: `Podaj rodzaj (${RODZAJE_SPRAW.join(", ")}) i dodatnie id sprawy` });
      }
      return zBledem(reply, () =>
        szablonDlaSprawy(szablonId, rodzaj as RodzajSprawy, lokalnyId, autor())
      );
    }
  );

  app.post<{ Body: { nazwa?: string; kanal?: string; tresc?: string } }>(
    "/api/biuro/szablony",
    async (req, reply) => {
      const nie = odmowa();
      if (nie) return reply.code(nie.kod).send({ error: nie.error });
      const { nazwa, kanal, tresc } = req.body ?? {};
      return zBledem(reply, () =>
        dodajSzablon(nazwa ?? "", kanal ?? "dowolny", tresc ?? "", autor())
      );
    }
  );

  app.put<{ Params: { id: string }; Body: { nazwa?: string; kanal?: string; tresc?: string } }>(
    "/api/biuro/szablony/:id",
    async (req, reply) => {
      const nie = odmowa();
      if (nie) return reply.code(nie.kod).send({ error: nie.error });
      const { nazwa, kanal, tresc } = req.body ?? {};
      return zBledem(reply, () =>
        zapiszSzablon(Number(req.params.id), nazwa ?? "", kanal ?? "dowolny", tresc ?? "", autor())
      );
    }
  );

  app.delete<{ Params: { id: string } }>("/api/biuro/szablony/:id", async (req, reply) => {
    const nie = odmowa();
    if (nie) return reply.code(nie.kod).send({ error: nie.error });
    return zBledem(reply, () => {
      skasujSzablon(Number(req.params.id), autor());
      return { skasowano: true };
    });
  });
}
