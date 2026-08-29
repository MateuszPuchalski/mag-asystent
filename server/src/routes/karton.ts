import type { FastifyInstance, FastifyReply } from "fastify";
import { sesjaZadania } from "../context.js";
import {
  anulujKarton,
  dodajDoKartonu,
  usunPozycjeKartonu,
  ustawIloscKartonu,
  zalozKarton,
  zatwierdzKarton,
} from "../services/karton.js";
import { BladKosza, kartonyDlaKolektora } from "../services/kosze.js";

/* ── KARTON — trasy zbierania zawartości (0.122.0) ───────────────────────────
   Jedna publiczność: HALA. Bramka jak przy `/api/kosze/…` — każda zalogowana
   rola, bo karton składa i rozkłada magazynier, a globalna bramka z context.ts
   i tak wymaga sesji.

   Czego tu NIE MA i celowo: szczegółu kartonu, skanu towaru, odkładania,
   pomijania, cofania i ZAKOŃCZ. To wszystko robią istniejące `/api/kosze/…`,
   bo zatwierdzony karton jest koszem do rozłożenia i niczym więcej. Kopia
   tamtych tras pod inną nazwą byłaby drugim miejscem na te same usterki.    */

export async function kartonRoutes(app: FastifyInstance) {
  const autor = (): string => sesjaZadania()?.user.name ?? "?";

  function zBledem<T>(reply: FastifyReply, fn: () => T): T | FastifyReply {
    try {
      return fn();
    } catch (e) {
      if (e instanceof BladKosza) return reply.code(e.kod).send({ error: e.message });
      throw e;
    }
  }

  app.get("/api/kartony", async () => ({ kartony: kartonyDlaKolektora() }));

  app.post("/api/kartony", async (_req, reply) =>
    zBledem(reply, () => ({ kosz: zalozKarton(autor()) }))
  );

  /* Dodanie towaru. `ilosc` pominięta znaczy JEDNĄ SZTUKĘ — bo tak wygląda
     skan, a skan jest tu ruchem podstawowym. Liczbę podaje się wtedy, gdy
     ktoś policzył zawartość ręką i nie zamierza skanować jej sto razy.

     `twId` ma pierwszeństwo przed `code`: wskazanie z listy wyszukiwarki jest
     wyborem człowieka, a napis dopiero pytaniem (patrz `WyborTowaru`). */
  app.post<{ Params: { id: string }; Body: { code?: string; twId?: number; ilosc?: number } }>(
    "/api/kartony/:id/pozycje",
    async (req, reply) => {
      const twId = Number(req.body?.twId);
      const code = (req.body?.code ?? "").trim();
      const wybor = Number.isFinite(twId) && twId > 0 ? { twId } : code ? { code } : null;
      if (!wybor) return reply.code(400).send({ error: "Pusty kod" });
      return zBledem(reply, () =>
        dodajDoKartonu(Number(req.params.id), wybor, req.body?.ilosc ?? null, autor())
      );
    }
  );

  app.post<{ Params: { id: string }; Body: { ilosc?: number } }>(
    "/api/kartony/pozycje/:id/ilosc",
    async (req, reply) =>
      zBledem(reply, () => {
        ustawIloscKartonu(Number(req.params.id), Number(req.body?.ilosc), autor());
        return { ok: true };
      })
  );

  app.delete<{ Params: { id: string } }>("/api/kartony/pozycje/:id", async (req, reply) =>
    zBledem(reply, () => {
      usunPozycjeKartonu(Number(req.params.id), autor());
      return { ok: true };
    })
  );

  app.post<{ Params: { id: string } }>("/api/kartony/:id/zatwierdz", async (req, reply) =>
    zBledem(reply, () => ({ kosz: zatwierdzKarton(Number(req.params.id), autor()) }))
  );

  /* Anulowanie — bez bramki roli, jak reszta tej zakładki. Pudło zakłada
     i porzuca ta sama osoba, a odpowiedź niesie `usuniety`, żeby ekran
     wiedział, czy jest jeszcze do czego wracać. */
  app.post<{ Params: { id: string } }>("/api/kartony/:id/anuluj", async (req, reply) =>
    zBledem(reply, () => anulujKarton(Number(req.params.id), autor()))
  );
}
