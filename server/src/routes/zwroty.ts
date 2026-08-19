import type { FastifyInstance, FastifyReply } from "fastify";
import { sesjaZadania } from "../context.js";
import { config } from "../config.js";
import { allegroTryb } from "../adapters/allegro.js";
import {
  rozlacz,
  rozpocznijParowanie,
  sprawdzParowanie,
  stanPolaczenia,
} from "../services/allegro-token.js";
import {
  BladZwrotu,
  dodajPozycjeReczna,
  listaZwrotow,
  oznaczZwrotSrodkow,
  szczegolZwrotu,
  ustawDokument,
  utworzReczny,
  utworzZAllegroId,
  utworzZeSkanu,
  watekZwrotu,
  zapiszDecyzje,
  zdejmijDokument,
} from "../services/zwroty.js";

/* ── Zwroty Allegro — trasy biura ────────────────────────────────────────────
   Wszystko za bramką ról biuro|admin (wzorzec zbiorki.ts): zwrot wiąże się
   z pieniędzmi klienta i dokumentami sprzedaży — to nie są operacje z hali.
   Parowanie i rozłączanie KONTA Allegro — wyłącznie admin: to poświadczenia
   firmy, nie ustawienie widoku.

   Bramka globalna z context.ts i tak zamyka wszystko bez sesji; lokalne
   `odmowa()` dokłada rolę i czytelne zdanie zamiast gołego 403.              */

const ORZEKAJACY = ["biuro", "admin"];

export async function zwrotyRoutes(app: FastifyInstance) {
  function odmowa(rola: string[] = ORZEKAJACY): { kod: number; error: string } | null {
    const s = sesjaZadania();
    if (!s) return { kod: 401, error: "Brak sesji — zaloguj się" };
    if (!rola.includes(s.user.role)) {
      return {
        kod: 403,
        error:
          rola.length === 1
            ? "Konto Allegro paruje wyłącznie admin"
            : "Zwroty Allegro są dostępne dla biura",
      };
    }
    return null;
  }

  const autor = (): string => sesjaZadania()?.user.name ?? "?";

  /** BladZwrotu niesie kod HTTP; reszta to 500 i niech Fastify je zaloguje. */
  function zBledem<T>(reply: FastifyReply, fn: () => T): T | FastifyReply {
    try {
      return fn();
    } catch (e) {
      if (e instanceof BladZwrotu) return reply.code(e.kod).send({ error: e.message });
      throw e;
    }
  }

  // ── Skan i tworzenie ──────────────────────────────────────────────────────

  app.post<{ Body: { kod?: string } }>("/api/biuro/zwroty/skan", async (req, reply) => {
    const nie = odmowa();
    if (nie) return reply.code(nie.kod).send({ error: nie.error });
    const kod = (req.body?.kod ?? "").trim();
    if (!kod) return reply.code(400).send({ error: "Zeskanuj albo wpisz numer z etykiety zwrotu" });
    try {
      const wynik = await utworzZeSkanu(kod, autor());
      switch (wynik.rodzaj) {
        case "utworzony":
          return reply.code(201).send({ zwrot: wynik.zwrot });
        case "istniejacy":
          return { zwrot: wynik.zwrot, istniejacy: true };
        case "kandydaci":
          /* 300 Multiple Choices — dosłownie to: jeden numer, kilka zwrotów. */
          return reply.code(300).send({ kandydaciAllegro: wynik.kandydaci, kod });
        case "brak":
          return reply.code(404).send({
            error: "Allegro nie zna tej etykiety — możesz założyć zwrot ręczny",
            mozliwyReczny: true,
            kod,
          });
      }
    } catch (e) {
      if (e instanceof BladZwrotu) return reply.code(e.kod).send({ error: e.message });
      /* Awaria integracji (sieć, token) to nie 500 serwera — biuro ma dostać
         zdanie z adaptera, bo ono mówi, co naprawić. */
      return reply.code(502).send({ error: (e as Error).message });
    }
  });

  app.post<{ Body: { allegroReturnId?: string; waybill?: string; reczny?: boolean } }>(
    "/api/biuro/zwroty",
    async (req, reply) => {
      const nie = odmowa();
      if (nie) return reply.code(nie.kod).send({ error: nie.error });
      const b = req.body ?? {};
      try {
        if (b.reczny) {
          if (!b.waybill?.trim()) return reply.code(400).send({ error: "Podaj numer etykiety" });
          return reply.code(201).send({ zwrot: utworzReczny(b.waybill, autor()) });
        }
        if (!b.allegroReturnId) {
          return reply.code(400).send({ error: "Podaj allegroReturnId (wybór kandydata) albo reczny:true" });
        }
        const zwrot = await utworzZAllegroId(b.allegroReturnId, b.waybill ?? "", autor());
        return reply.code(201).send({ zwrot });
      } catch (e) {
        if (e instanceof BladZwrotu) return reply.code(e.kod).send({ error: e.message });
        return reply.code(502).send({ error: (e as Error).message });
      }
    }
  );

  // ── Odczyty ───────────────────────────────────────────────────────────────

  app.get<{ Querystring: { status?: string; szukaj?: string; limit?: string } }>(
    "/api/biuro/zwroty",
    async (req, reply) => {
      const nie = odmowa();
      if (nie) return reply.code(nie.kod).send({ error: nie.error });
      const q = req.query;
      return {
        zwroty: listaZwrotow({
          status: q.status || undefined,
          szukaj: q.szukaj || undefined,
          limit: q.limit ? Number(q.limit) : undefined,
        }),
        allegro: stanPolaczenia(),
      };
    }
  );

  /* Wiadomości czytamy DOPIERO na kliknięcie, nie przy każdym odświeżeniu
     karty: karta odświeża się co 30 s, a rozmowa z klientem to dwa dodatkowe
     zapytania do Allegro. Rzadkie pytanie nie ma prawa obciążać częstego. */
  app.get<{ Params: { id: string } }>("/api/biuro/zwroty/:id/wiadomosci", async (req, reply) => {
    const nie = odmowa();
    if (nie) return reply.code(nie.kod).send({ error: nie.error });
    try {
      const { login, szukanie } = await watekZwrotu(Number(req.params.id));
      /* Ekran dostaje też liczniki: „przejrzano N rozmów" odróżnia klienta,
         który nie pisał, od rozmowy starszej niż zasięg szukania. */
      return {
        login,
        watek: szukanie?.watek ?? null,
        przejrzanych: szukanie?.przejrzanych ?? 0,
        najstarszaData: szukanie?.najstarszaData ?? null,
        wyczerpano: szukanie?.wyczerpano ?? false,
      };
    } catch (e) {
      if (e instanceof BladZwrotu) return reply.code(e.kod).send({ error: e.message });
      /* Najczęstsza przyczyna: aplikacja bez uprawnienia do Centrum wiadomości.
         Komunikat z adaptera mówi wtedy, co dodać na developer.allegro.pl. */
      return reply.code(502).send({ error: (e as Error).message });
    }
  });

  app.get<{ Params: { id: string } }>("/api/biuro/zwroty/:id", async (req, reply) => {
    const nie = odmowa();
    if (nie) return reply.code(nie.kod).send({ error: nie.error });
    return zBledem(reply, () => ({ zwrot: szczegolZwrotu(Number(req.params.id)) }));
  });

  // ── Decyzje, dokument, rozliczenie ────────────────────────────────────────

  app.post<{ Params: { id: string; pid: string }; Body: { decyzja?: string; notatka?: string } }>(
    "/api/biuro/zwroty/:id/pozycje/:pid/decyzja",
    async (req, reply) => {
      const nie = odmowa();
      if (nie) return reply.code(nie.kod).send({ error: nie.error });
      if (!req.body?.decyzja) return reply.code(400).send({ error: "Brak pola decyzja" });
      return zBledem(reply, () => ({
        zwrot: zapiszDecyzje(
          Number(req.params.id),
          Number(req.params.pid),
          req.body!.decyzja!,
          req.body?.notatka?.trim() || null,
          autor()
        ),
      }));
    }
  );

  app.post<{ Params: { id: string }; Body: { twId?: number; ilosc?: number } }>(
    "/api/biuro/zwroty/:id/pozycje",
    async (req, reply) => {
      const nie = odmowa();
      if (nie) return reply.code(nie.kod).send({ error: nie.error });
      const b = req.body ?? {};
      if (typeof b.twId !== "number") return reply.code(400).send({ error: "Brak pola twId" });
      return zBledem(reply, () => ({
        zwrot: dodajPozycjeReczna(Number(req.params.id), b.twId!, b.ilosc ?? 1, autor()),
      }));
    }
  );

  app.put<{ Params: { id: string }; Body: { dokId?: number } }>(
    "/api/biuro/zwroty/:id/dokument",
    async (req, reply) => {
      const nie = odmowa();
      if (nie) return reply.code(nie.kod).send({ error: nie.error });
      if (typeof req.body?.dokId !== "number") return reply.code(400).send({ error: "Brak pola dokId" });
      return zBledem(reply, () => ({
        zwrot: ustawDokument(Number(req.params.id), req.body!.dokId!, autor()),
      }));
    }
  );

  app.delete<{ Params: { id: string } }>("/api/biuro/zwroty/:id/dokument", async (req, reply) => {
    const nie = odmowa();
    if (nie) return reply.code(nie.kod).send({ error: nie.error });
    return zBledem(reply, () => ({ zwrot: zdejmijDokument(Number(req.params.id), autor()) }));
  });

  app.post<{ Params: { id: string } }>("/api/biuro/zwroty/:id/zwrot-srodkow", async (req, reply) => {
    const nie = odmowa();
    if (nie) return reply.code(nie.kod).send({ error: nie.error });
    return zBledem(reply, () => ({ zwrot: oznaczZwrotSrodkow(Number(req.params.id), autor()) }));
  });

  // ── Konto Allegro (device flow) ───────────────────────────────────────────

  app.get("/api/biuro/allegro/status", async (_req, reply) => {
    const nie = odmowa();
    if (nie) return reply.code(nie.kod).send({ error: nie.error });
    return { ...stanPolaczenia(), tryb: allegroTryb(), sandbox: config.allegro.sandbox };
  });

  app.post("/api/biuro/allegro/parowanie", async (_req, reply) => {
    const nie = odmowa(["admin"]);
    if (nie) return reply.code(nie.kod).send({ error: nie.error });
    if (allegroTryb() === "dev") {
      return reply.code(400).send({ error: "Adapter dev nie wymaga parowania — fikcyjne zwroty działają od razu" });
    }
    try {
      return await rozpocznijParowanie();
    } catch (e) {
      return reply.code(502).send({ error: (e as Error).message });
    }
  });

  app.get("/api/biuro/allegro/parowanie", async (_req, reply) => {
    const nie = odmowa(["admin"]);
    if (nie) return reply.code(nie.kod).send({ error: nie.error });
    try {
      return await sprawdzParowanie(autor());
    } catch (e) {
      return reply.code(502).send({ error: (e as Error).message });
    }
  });

  app.delete("/api/biuro/allegro", async (_req, reply) => {
    const nie = odmowa(["admin"]);
    if (nie) return reply.code(nie.kod).send({ error: nie.error });
    rozlacz(autor());
    return { ok: true };
  });
}
