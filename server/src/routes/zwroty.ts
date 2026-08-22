import type { FastifyInstance, FastifyReply } from "fastify";
import { sesjaZadania } from "../context.js";
import { config } from "../config.js";
import { allegroAdapter, allegroTryb } from "../adapters/allegro.js";
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
  wystawDokumenty,
  zapiszDecyzje,
  zdejmijDokument,
} from "../services/zwroty.js";
import { listaReklamacji, raportZwrotow, rozpatrzReklamacje, ustawPolke } from "../services/reklamacje.js";
import { brakujacePaczki, pominZapowiedz, stanOdswiezania } from "../services/zapowiedzi.js";
import { oknoDni, statystykiZwrotow } from "../services/statystyki-zwrotow.js";
import { czasyZwrotow } from "../services/czasy-zwrotow.js";

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

  /* Korekta + MM na bufor — jedno kliknięcie, jedno zadanie kolejki.
     POST, nie PUT: to nie jest ustawienie pola, tylko zlecenie zapisu do bazy
     firmy. Idempotencję pilnuje serwis (`zwrot.korekta_queue_id`), bo dubel
     korekty znaczy pieniądze oddane dwa razy. */
  app.post<{ Params: { id: string } }>("/api/biuro/zwroty/:id/dokumenty", async (req, reply) => {
    const nie = odmowa();
    if (nie) return reply.code(nie.kod).send({ error: nie.error });
    return zBledem(reply, () => ({ zwrot: wystawDokumenty(Number(req.params.id), autor()) }));
  });

  app.post<{ Params: { id: string } }>("/api/biuro/zwroty/:id/zwrot-srodkow", async (req, reply) => {
    const nie = odmowa();
    if (nie) return reply.code(nie.kod).send({ error: nie.error });
    return zBledem(reply, () => ({ zwrot: oznaczZwrotSrodkow(Number(req.params.id), autor()) }));
  });

  // ── Reklamacje i raport ───────────────────────────────────────────────────
  /* Ścieżki statyczne (`/reklamacje`, `/raport`) wygrywają w routerze
     z parametryczną `/:id` — Fastify dopasowuje segment stały przed parametrem. */

  app.get<{ Querystring: { rozpatrzone?: string } }>(
    "/api/biuro/zwroty/reklamacje",
    async (req, reply) => {
      const nie = odmowa();
      if (nie) return reply.code(nie.kod).send({ error: nie.error });
      return { reklamacje: listaReklamacji({ rozpatrzone: req.query.rozpatrzone === "1" }) };
    }
  );

  app.post<{ Params: { pid: string }; Body: { wynik?: string; notatka?: string } }>(
    "/api/biuro/zwroty/reklamacje/:pid",
    async (req, reply) => {
      const nie = odmowa();
      if (nie) return reply.code(nie.kod).send({ error: nie.error });
      if (!req.body?.wynik) return reply.code(400).send({ error: "Brak pola wynik" });
      return zBledem(reply, () => {
        rozpatrzReklamacje(Number(req.params.pid), req.body!.wynik!, req.body?.notatka?.trim() || null, autor());
        return { reklamacje: listaReklamacji() };
      });
    }
  );

  app.get("/api/biuro/zwroty/raport", async (_req, reply) => {
    const nie = odmowa();
    if (nie) return reply.code(nie.kod).send({ error: nie.error });
    return { raport: raportZwrotow() };
  });

  /* Statystyki produktowe (0.78.0) — obok raportu procesu, bo odpowiadają na
     inne pytanie: nie „jak idzie robota", tylko „co wraca i czy jest problem". */
  app.get<{ Querystring: { dni?: string } }>(
    "/api/biuro/zwroty/statystyki",
    async (req, reply) => {
      const nie = odmowa();
      if (nie) return reply.code(nie.kod).send({ error: nie.error });
      return { statystyki: statystykiZwrotow(oknoDni(req.query?.dni)) };
    }
  );

  /* Czasy obsługi (0.80.0) — trzecie pytanie o zwroty: nie „jak idzie robota"
     i nie „co wraca", tylko JAK DŁUGO towar stoi, zanim wróci na półkę.
     To samo okno co statystyki produktowe, bo obie karty czyta się razem. */
  app.get<{ Querystring: { dni?: string } }>(
    "/api/biuro/zwroty/czasy",
    async (req, reply) => {
      const nie = odmowa();
      if (nie) return reply.code(nie.kod).send({ error: nie.error });
      return { czasy: czasyZwrotow(oknoDni(req.query?.dni)) };
    }
  );

  /* Zgłoszenia zwrotu czekające na paczkę dłużej niż próg (Etap 4). Ścieżka
     statyczna — ta sama zasada pierwszeństwa przed `/:id` co wyżej. */
  app.get("/api/biuro/zwroty/zapowiedzi", async (_req, reply) => {
    const nie = odmowa();
    if (nie) return reply.code(nie.kod).send({ error: nie.error });
    /* Ślad tickera jedzie razem z listą: pytanie „czemu ten wiersz nie ma
       statusu" musi mieć odpowiedź NA TYM ekranie, nie w logu serwera. */
    return { zapowiedzi: brakujacePaczki(), ticker: stanOdswiezania() };
  });

  /* Zdjęcie zgłoszenia z listy ręką — sprawa załatwiona poza aplikacją. */
  app.post<{ Params: { id: string } }>(
    "/api/biuro/zwroty/zapowiedzi/:id/pomin",
    async (req, reply) => {
      const nie = odmowa();
      if (nie) return reply.code(nie.kod).send({ error: nie.error });
      if (!pominZapowiedz(Number(req.params.id), autor())) {
        return reply.code(404).send({ error: "Nie ma takiego oczekującego zgłoszenia" });
      }
      return { zapowiedzi: brakujacePaczki() };
    }
  );

  /* Półka reklamacyjna (Etap 6) — gdzie fizycznie leży towar sprawy. */
  app.put<{ Params: { pid: string }; Body: { polka?: string } }>(
    "/api/biuro/zwroty/reklamacje/:pid/polka",
    async (req, reply) => {
      const nie = odmowa();
      if (nie) return reply.code(nie.kod).send({ error: nie.error });
      return zBledem(reply, () => {
        ustawPolke(Number(req.params.pid), req.body?.polka ?? null, autor());
        return { reklamacje: listaReklamacji() };
      });
    }
  );

  /* Dyskusje i reklamacje z panelu Allegro (Etap 6) — sam odczyt, na żądanie
     kliknięcia; nic z tego nie zapisujemy, jedno miejsce prawdy to Allegro. */
  app.get("/api/biuro/zwroty/dyskusje", async (_req, reply) => {
    const nie = odmowa();
    if (nie) return reply.code(nie.kod).send({ error: nie.error });
    try {
      return { dyskusje: await allegroAdapter().listaDyskusji() };
    } catch (e) {
      /* Awaria integracji (sieć, token) to nie 500 serwera — jak przy skanie. */
      return reply.code(502).send({ error: (e as Error).message });
    }
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
