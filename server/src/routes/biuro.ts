import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { FastifyInstance } from "fastify";
import { sesjaZadania } from "../context.js";
import { autoryzuj } from "../services/auth.js";
import {
  cofnijZamkniecie,
  listaZamknietychPozaWertis,
  zamknijPozaWertis,
} from "../services/delivery.js";
import {
  dodajNotatke,
  notatkiDokumentu,
  odpowiedziNieprzeczytane,
  oznaczOdpowiedzPrzeczytana,
} from "../services/notatki.js";
import { podgladDokumentu } from "../services/podglad-dostawy.js";

/* ── Podgląd biura — jedna strona pod /biuro ─────────────────────────────────
   Wycięcie flagi faktury (0.16.0) zamknęło jedyny kanał, którym biuro widziało
   stan dostaw. CSV i REST istniały dalej, ale „wywołaj curlem z tokenem" nie
   jest interfejsem dla księgowości. Ta strona jest tym interfejsem: status
   rozkładania + gotowy do druku protokół rozbieżności ze zdjęciami dowodowymi.

   ŚWIADOMIE jeden plik HTML bez builda i bez frameworka. Poprzedni podgląd
   (/lookup) zniknął razem z całym klientem PWA, bo dwa fronty to dwa razy
   utrzymanie — więc nowy nie ma prawa być drugim frontem. Strona jest cienka:
   sam odczyt istniejących tras API, z tokenem sesji w nagłówku, tak samo jak
   kolektor.

   OD 0.40.0 NIE JEST JUŻ CZYSTYM ODCZYTEM i to zdanie stało tu wcześniej jako
   „zero zapisu". Doszły dwie trasy zapisu: oznaczenie dostawy jako rozłożonej
   POZA WERTIS i cofnięcie tego. Trafiły akurat tutaj, bo są jedyną operacją
   w całej aplikacji, której NIE WOLNO wykonać z hali — zdejmują pracę z listy
   bez ani jednego skanu, więc mieszkają tam, gdzie czyta się protokoły
   rozbieżności, i za rolą `biuro`. Cienkość strony to nadal reguła: obie trasy
   mają całą logikę w `services/delivery.ts`, razem z resztą reguł dostaw.

   Plik jest wczytywany RAZ, przy rejestracji tras — nie per żądanie. Zmiana
   strony wymaga restartu usługi, dokładnie jak zmiana kodu.                  */

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export async function biuroRoutes(app: FastifyInstance) {
  const html = fs.readFileSync(path.join(__dirname, "../web/biuro.html"), "utf8");

  app.get("/biuro", async (_req, reply) => reply.type("text/html; charset=utf-8").send(html));

  const skrzynkaHtml = fs.readFileSync(path.join(__dirname, "../web/skrzynka.html"), "utf8");
  const skrzynkaJs = fs.readFileSync(path.join(__dirname, "../web/skrzynka.js"), "utf8");
  app.get("/obsluga/skrzynka", async (_req, reply) =>
    reply.type("text/html; charset=utf-8").send(skrzynkaHtml)
  );
  app.get("/obsluga/skrzynka.js", async (_req, reply) =>
    reply.type("text/javascript; charset=utf-8").send(skrzynkaJs)
  );

  /* Fonty Barlow — TE SAME pliki, którymi rysuje kolektor (kopie z zasobów
     Androida). Serwowane z własnego serwera, bo biuro pracuje w LAN-ie bez
     wyjścia w świat: link do Google Fonts dawałby pustą czcionkę i timeout.
     Wczytane raz przy rejestracji, jak sam HTML; tydzień cache'u, bo plik
     zmienia się wyłącznie z wydaniem, a wydanie restartuje usługę. */
  for (const plik of [
    "barlow_regular.ttf",
    "barlow_semibold.ttf",
    "barlow_bold.ttf",
    "barlowcondensed_bold.ttf",
    "barlowcondensed_extrabold.ttf",
  ]) {
    const font = fs.readFileSync(path.join(__dirname, "../web/fonty", plik));
    app.get(`/biuro/fonty/${plik}`, async (_req, reply) =>
      reply.type("font/ttf").header("cache-control", "public, max-age=604800").send(font)
    );
  }

  // korzeń przekierowuje do podglądu: adres `http://serwer:3001` w pasku
  // przeglądarki biura ma pokazać COŚ, a nie 404
  app.get("/", async (_req, reply) => reply.redirect("/biuro"));

  /**
   * Pozycje dokumentu dla biura — CZYTA, nigdy nie otwiera dostawy.
   *
   * Trasa mieszka TU, a nie przy pozostałych trasach dostaw, i to jest decyzja
   * o bezpieczeństwie, nie o porządku: jej sąsiadem byłby `POST
   * /api/delivery/documents/:dokId/open`, czyli zapis różniący się o jeden
   * człon ścieżki. `routes/delivery.ts` zostaje o ścieżce pracy kolektora,
   * a to jedyna trasa czytana wyłącznie przez `/biuro`.
   *
   * Klucz to `dokId` (numer dokumentu w Subiekcie), a nie lokalne `deliveryId`,
   * bo dokument, którego nikt nie tknął, żadnego `deliveryId` jeszcze nie ma —
   * a wejść w niego biuro musi tak samo.
   *
   * Bez własnej bramki ról: globalna bramka sesji obejmuje wszystko pod `/api/`
   * poza zamkniętą listą `BEZ_SESJI`, a te same dane pokazuje już lista dostaw
   * i lista wyjątków. `autoryzuj()` byłoby tu wręcz szkodliwe — zapisuje
   * zdarzenie `privileged` przy każdym sprawdzeniu, a to jest zwykły odczyt.
   *
   * ETag/304 dokłada hak `routes/etag.ts`. Warunek: w odpowiedzi NIE MA nic
   * liczonego z zegara — strona odpytuje ją co pół minuty i ma dostawać 304.
   */
  app.get<{ Params: { dokId: string } }>("/api/biuro/dokument/:dokId", async (req, reply) => {
    const d = podgladDokumentu(Number(req.params.dokId));
    if (!d) return reply.code(404).send({ error: "Nie znaleziono dokumentu" });
    return d;
  });

  /**
   * Dostawy zdjęte z listy pracy jako rozłożone poza WERTIS.
   *
   * Zwykły odczyt, więc bez `autoryzuj()` — tak samo jak podgląd dokumentu
   * wyżej. Lista musi istnieć, bo zamknięty dokument znika z listy rozkładania:
   * bez niej pomyłkowe zamknięcie nie miałoby jak zostać zauważone.
   */
  app.get("/api/biuro/zamkniete-poza", async () => ({
    documents: listaZamknietychPozaWertis(),
  }));

  /**
   * Oznacz dostawę jako rozłożoną poza WERTIS.
   *
   * Trzy bramki, każda z innego powodu. SESJA — bo bez nazwiska ta operacja nie
   * zostawia śladu, a ślad jest tu jedynym dowodem. ROLA — bo to jedyny sposób
   * na zdjęcie całej dostawy z listy bez odłożenia towaru. POWÓD — bo za pół
   * roku „kto" i „kiedy" nie odpowie na pytanie, dlaczego tej faktury nikt nie
   * rozkładał.
   */
  app.post<{ Params: { dokId: string }; Body: { powod?: string } }>(
    "/api/biuro/dokument/:dokId/zamknij",
    async (req, reply) => {
      const s = sesjaZadania();
      if (!s) return reply.code(401).send({ error: "Brak sesji — zaloguj się" });
      const w = autoryzuj(s.user, "domkniecie_dostawy");
      if (!w.ok) return reply.code(403).send({ error: w.powod });
      try {
        return zamknijPozaWertis(Number(req.params.dokId), s.user.name, req.body?.powod ?? "");
      } catch (e) {
        // stan dostawy i pusty powód to decyzje wołającego, nie awaria serwera
        return reply.code(400).send({ error: (e as Error).message });
      }
    }
  );

  /** Cofnięcie — dostawa wraca na listę pracy. Ta sama rola co zamknięcie. */
  app.post<{ Params: { dokId: string } }>(
    "/api/biuro/dokument/:dokId/otworz",
    async (req, reply) => {
      const s = sesjaZadania();
      if (!s) return reply.code(401).send({ error: "Brak sesji — zaloguj się" });
      const w = autoryzuj(s.user, "domkniecie_dostawy");
      if (!w.ok) return reply.code(403).send({ error: w.powod });
      try {
        return cofnijZamkniecie(Number(req.params.dokId), s.user.name);
      } catch (e) {
        return reply.code(400).send({ error: (e as Error).message });
      }
    }
  );

  /**
   * Notatka biura do dostawy (0.43.0) — pytanie, na które rozkładający MUSI
   * odpowiedzieć, zanim domknie fakturę.
   *
   * Bez bramki roli, w odróżnieniu od zamykania „poza WERTIS". Notatka niczego
   * nie orzeka i nie zdejmuje pracy z listy — ona ją DOKŁADA, a dokładanie
   * sobie roboty nie wymaga uprawnień. Sesja wystarczy, bo wpis jest podpisany.
   */
  app.post<{ Params: { dokId: string }; Body: { tresc?: string } }>(
    "/api/biuro/dokument/:dokId/notatka",
    async (req, reply) => {
      const s = sesjaZadania();
      if (!s) return reply.code(401).send({ error: "Brak sesji — zaloguj się" });
      const r = dodajNotatke(Number(req.params.dokId), req.body?.tresc ?? "", s.user.name);
      if ("error" in r) return reply.code(400).send(r);
      return r;
    }
  );

  /** Notatki dokumentu wraz z odpowiedziami — biuro czyta, czy już wiadomo. */
  app.get<{ Params: { dokId: string } }>(
    "/api/biuro/dokument/:dokId/notatki",
    async (req) => ({ notatki: notatkiDokumentu(Number(req.params.dokId)) })
  );

  /* ── Odpowiedzi na notatki wracają do biura (0.57.0) ──────────────────────
     Bramka lekka (biuro|admin), bez `autoryzuj()`: to potwierdzenie odczytu,
     a nie orzeczenie o pracy. Wpis `privileged` przy każdym odświeżeniu paska
     stanu byłby szumem w dzienniku — dokładnie tym, który 0.52.3 z niego
     usuwało.

     Licznik jedzie TĄ trasą, a nie przez `/api/health`: health stoi na liście
     `BEZ_SESJI`, więc dane biura wystawiłby każdemu bez logowania. */
  const ORZEKAJACY = ["biuro", "admin"];

  function odmowa(): { kod: number; error: string } | null {
    const s = sesjaZadania();
    if (!s) return { kod: 401, error: "Brak sesji — zaloguj się" };
    if (!ORZEKAJACY.includes(s.user.role)) {
      return { kod: 403, error: "Notatki do dostaw prowadzi biuro" };
    }
    return null;
  }

  app.get("/api/biuro/notatki/odpowiedzi", async (_req, reply) => {
    const nie = odmowa();
    if (nie) return reply.code(nie.kod).send({ error: nie.error });
    return { odpowiedzi: odpowiedziNieprzeczytane() };
  });

  app.post<{ Params: { id: string } }>(
    "/api/biuro/notatki/:id/przeczytane",
    async (req, reply) => {
      const nie = odmowa();
      if (nie) return reply.code(nie.kod).send({ error: nie.error });
      const s = sesjaZadania();
      const bylo = oznaczOdpowiedzPrzeczytana(Number(req.params.id), s?.user.name ?? "?");
      /* Powtórka z drugiego biurka to spóźnienie, nie błąd — odpowiadamy
         spokojnie, zamiast straszyć czerwonym komunikatem kogoś, kto
         zobaczył tę samą rzecz sekundę później. */
      return { ok: true, zmienione: bylo };
    }
  );

  /* Do 0.26.0 wisiała tu jeszcze trasa `/sw.js` — jednorazowy pogrzeb service
     workera PWA usuniętej w 0.3.0. Komputery biura przeszły od tego czasu
     przez sprzątający skrypt, więc trasa wyszła razem ze swoim powodem. */
}
