import type { FastifyInstance } from "fastify";
import { sesjaZadania } from "../context.js";
import {
  listaDostawcow,
  logo,
  usunLogo,
  zapiszLogo,
} from "../services/logo-dostawcy.js";

/* ── Logo dostawcy — trasy (0.56.0) ──────────────────────────────────────────
   Trzy trasy biura (wgranie, kasowanie, lista) i jedna czytana przez kolektor.

   Podział pliku idzie za CZYTELNIKIEM, nie za tematem: `/api/dostawcy/:id/logo`
   nie jest trasą biura — sięga po nią każdy kolektor przy każdym otwarciu listy
   dostaw i jako jedyna z tej czwórki musi być tania. Dlatego siedzi obok tamtych
   trzech, ale ma osobny kontrakt: ETag, 304 i cache po stronie urządzenia.   */

const ORZEKAJACY = ["biuro", "admin"];

/** Logo waży kilka kB; 1 MB starcza z zapasem i nie zjada globalnego limitu. */
const LIMIT_WGRANIA = 1024 * 1024;

export async function dostawcyRoutes(app: FastifyInstance) {
  /* Bramka lekka, bez `autoryzuj()`. Wgranie logo to zapis konfiguracyjny,
     a nie orzeczenie o pracy — wpis `privileged` przy każdym podglądzie listy
     byłby szumem w dzienniku, dokładnie tym, który 0.52.3 z niego usuwało. */
  function odmowa(): { kod: number; error: string } | null {
    const s = sesjaZadania();
    if (!s) return { kod: 401, error: "Brak sesji — zaloguj się" };
    if (!ORZEKAJACY.includes(s.user.role)) {
      return { kod: 403, error: "Logo dostawców jest dostępne dla biura" };
    }
    return null;
  }

  /** Dostawcy z dokumentów, z flagą „ma logo" — także ci, którym brakuje. */
  app.get("/api/biuro/dostawcy", async (_req, reply) => {
    const nie = odmowa();
    if (nie) return reply.code(nie.kod).send({ error: nie.error });
    return { dostawcy: listaDostawcow() };
  });

  app.put<{ Params: { khId: string }; Body: { nazwa?: string; logoBase64?: string } }>(
    "/api/biuro/dostawcy/:khId/logo",
    { bodyLimit: LIMIT_WGRANIA },
    async (req, reply) => {
      const nie = odmowa();
      if (nie) return reply.code(nie.kod).send({ error: nie.error });
      const s = sesjaZadania();
      const r = zapiszLogo(
        Number(req.params.khId),
        req.body?.nazwa ?? "",
        req.body?.logoBase64 ?? "",
        s?.user.name ?? "?"
      );
      if (!r.ok) return reply.code(400).send({ error: r.error });
      return { etag: r.etag, bajtow: r.bajtow };
    }
  );

  app.delete<{ Params: { khId: string } }>(
    "/api/biuro/dostawcy/:khId/logo",
    async (req, reply) => {
      const nie = odmowa();
      if (nie) return reply.code(nie.kod).send({ error: nie.error });
      const s = sesjaZadania();
      const bylo = usunLogo(Number(req.params.khId), s?.user.name ?? "?");
      if (!bylo) return reply.code(404).send({ error: "Ten dostawca nie ma logo" });
      return { ok: true };
    }
  );

  /**
   * Logo dla kolektora. Kontrakt przepisany z trasy zdjęcia kartoteki, bo to
   * ten sam problem: obraz, który rzadko się zmienia, a jest pobierany często.
   *
   * 304 sprawdzane PRZED sięgnięciem po bajty — cały sens ETagu polega na tym,
   * żeby przy niezmienionym logo nie ruszyć obrazu w ogóle.
   */
  app.get<{ Params: { khId: string } }>(
    "/api/dostawcy/:khId/logo",
    async (req, reply) => {
      const w = logo(Number(req.params.khId));
      if (!w) return reply.code(404).send({ error: "Brak logo" });

      const etag = `"${w.etag}"`;
      if (req.headers["if-none-match"] === etag) {
        return reply.code(304).header("etag", etag).send();
      }
      return reply
        .type("image/png")
        .header("etag", etag)
        .header("cache-control", "private, max-age=86400")
        .header("content-length", String(w.obraz.length))
        .send(w.obraz);
    }
  );
}
