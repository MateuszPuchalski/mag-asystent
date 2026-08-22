import type { FastifyInstance, FastifyReply } from "fastify";
import { sesjaZadania } from "../context.js";
import {
  listaPrzyjec,
  otworzPrzyjecie,
  oznaczRozlozonePozaAplikacja,
} from "../services/przyjecia.js";
import {
  BladKosza,
  cofnijPozycje,
  cofnijZakonczenie,
  koszPoKodzie,
  koszeDlaKolektora,
  listaKoszy,
  odepnijZwrot,
  odlozPozycje,
  pominietePozycje,
  pominPozycjeKosza,
  przesunNaKoniec,
  przypnijZwrot,
  skanTowaruKosza,
  szczegolKosza,
  szukajWKoszach,
  zakonczKosz,
  zalatwPominiecie,
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

  /* Pominięte pozycje ze wszystkich koszy — lista pracy biura, nie historia.
     Stoi PRZED `/:id` świadomie: router i tak przedkłada segment stały nad
     parametr, ale czytelnik nie ma obowiązku tego wiedzieć. */
  app.get("/api/biuro/kosze/pominiete", async (_req, reply) => {
    const nie = odmowaBiuro();
    if (nie) return reply.code(nie.kod).send({ error: nie.error });
    return { pominiete: pominietePozycje() };
  });

  /* Zamknięcie sprawy pominięcia — bramka BIURA, bo to decyzja o tym, że
     sprawa jest wyjaśniona, a nie o tym, co leży w koszu. */
  app.post<{ Params: { id: string }; Body: { notatka?: string } }>(
    "/api/biuro/kosze/pominiete/:id/zalatwione",
    async (req, reply) => {
      const nie = odmowaBiuro();
      if (nie) return reply.code(nie.kod).send({ error: nie.error });
      return zBledem(reply, () => {
        zalatwPominiecie(Number(req.params.id), autor(), req.body?.notatka ?? "");
        return { pominiete: pominietePozycje() };
      });
    }
  );

  app.get<{ Querystring: { q?: string } }>("/api/biuro/kosze/szukaj", async (req, reply) => {
    const nie = odmowaBiuro();
    if (nie) return reply.code(nie.kod).send({ error: nie.error });
    return zBledem(reply, () => ({ znalezione: szukajWKoszach(req.query?.q ?? "") }));
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

  /* Pominięcie pozycji, której w koszu nie ma. Ta sama bramka co odkładanie —
     to decyzja magazyniera stojącego przy koszu, nie biura. */
  app.post<{ Params: { id: string }; Body: { powod?: string } }>(
    "/api/kosze/pozycje/:id/pomin",
    async (req, reply) =>
      zBledem(reply, () => pominPozycjeKosza(Number(req.params.id), req.body?.powod ?? "", autor()))
  );

  /* Cofanie pomyłek. Bez bramki roli — tak samo jak korekta ilości przy
     dostawie: to poprawianie WŁASNEJ pracy w jej trakcie, a nie orzeczenie.
     Jedna trasa na pozycję, bo magazynier nie ma obowiązku pamiętać, czy
     pomylił się przy odkładaniu, czy przy pomijaniu — serwer to widzi. */
  /* „Wrócę do tego" — regał zastawiony albo towar na dnie kosza. Pozycja
     zjeżdża na koniec listy i nadal czeka; to NIE jest pominięcie. */
  app.post<{ Params: { id: string } }>("/api/kosze/pozycje/:id/pozniej", async (req, reply) =>
    zBledem(reply, () => ({ kosz: przesunNaKoniec(Number(req.params.id), autor()) }))
  );

  app.post<{ Params: { id: string } }>("/api/kosze/pozycje/:id/cofnij", async (req, reply) =>
    zBledem(reply, () => ({ kosz: cofnijPozycje(Number(req.params.id), autor()) }))
  );

  app.post<{ Params: { id: string } }>("/api/kosze/:id/cofnij-zakonczenie", async (req, reply) =>
    zBledem(reply, () => ({ kosz: cofnijZakonczenie(Number(req.params.id), autor()) }))
  );

  app.post<{ Params: { id: string } }>("/api/kosze/:id/zakoncz", async (req, reply) =>
    zBledem(reply, () => ({ kosz: zakonczKosz(Number(req.params.id), autor()) }))
  );

  // ── Przyjęcia na regał zwrotów (kosze z dokumentu MM) ─────────────────────

  app.get("/api/przyjecia", async () => ({ przyjecia: listaPrzyjec() }));

  /* Otwarcie kosza NUMEREM Z KARTKI — magazynier podchodzi z koszem i czyta
     to, co ktoś napisał długopisem. Numer, nie id: id nie ma na kartce. */
  app.post<{ Body: { numer?: string } }>("/api/przyjecia/otworz", async (req, reply) =>
    zBledem(reply, () => ({ kosz: otworzPrzyjecie(req.body?.numer ?? "", autor()) }))
  );

  /* „Już rozłożony" — tylko admin. To jedyny sposób zdjęcia z listy pracy,
     której aplikacja nie widziała (dokumenty sprzed wdrożenia), więc nie ma
     prawa być dostępny przy każdym kolektorze. */
  app.post<{ Params: { dokId: string } }>(
    "/api/przyjecia/:dokId/poza-aplikacja",
    async (req, reply) => {
      const s = sesjaZadania();
      if (!s) return reply.code(401).send({ error: "Brak sesji — zaloguj się" });
      if (s.user.role !== "admin") {
        return reply.code(403).send({ error: "Zdjęcie przyjęcia z listy wykonuje admin" });
      }
      return zBledem(reply, () => {
        oznaczRozlozonePozaAplikacja(Number(req.params.dokId), autor());
        return { przyjecia: listaPrzyjec() };
      });
    }
  );
}
