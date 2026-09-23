import { alarmyWymiany, czasyWymiany } from "../services/wymiana.js";
import type { FastifyInstance, FastifyReply } from "fastify";
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
import { archiwumDostaw } from "../services/archiwum-dostaw.js";
import { doDecyzji } from "../services/do-decyzji.js";
import { BladFirmy, daneFirmy, zapiszDaneFirmy, type PoleFirmy } from "../services/firma.js";

/* ── Trasy biura (strona `/biuro` zniknęła w 0.446.0) ─────────────────────
   Do 0.446.0 ten plik serwował też stronę biura: jeden HTML bez builda,
   jej ikonę i fonty Barlow. Biuro przeszło do panelu widok po widoku
   (`docs/obsluga-klienta.md` §7), a ostatnie wydanie zostawiło stronę jako
   drogowskaz. Teraz zostały tu TRASY API biura — dostawy zdjęte poza WERTIS,
   notatki, archiwum, DO DECYZJI, dane firmy — i przekierowanie starych adresów.

   Zapisy dostaw mieszkają dalej tutaj, a nie przy trasach kolektora: to
   jedyne operacje w aplikacji, których NIE WOLNO wykonać z hali. Zdejmują
   pracę z listy bez ani jednego skanu, więc stoją za rolą `biuro`, a logika
   siedzi w `services/delivery.ts` razem z resztą reguł dostaw.             */

export async function biuroRoutes(app: FastifyInstance) {
  /* ── STARE ADRESY PROWADZĄ DO PANELU (0.446.0) ─────────────────────────
     Zakładka w przeglądarce, skrót na pulpicie i nawyk ręki prowadzą pod
     `/biuro` jeszcze długo po przeprowadzce. 404 wyglądałoby na awarię
     serwera; przekierowanie mówi „jesteś w dobrym miejscu, tylko pod nowym
     adresem". Łapiemy też to, co leżało pod `/biuro/` (ikona, fonty):
     przeglądarka pamięta takie adresy w historii i w podpowiedziach.

     302, nie 301. Stały 301 przeglądarka zapamiętuje na zawsze — gdyby pod
     `/biuro` kiedyś wróciło cokolwiek, stare przeglądarki nie zapytałyby
     serwera już nigdy. Tymczasowe przekierowanie kosztuje jedno żądanie.

     Korzeń prowadzi tu samo: `http://serwer:3001` w pasku przeglądarki biura
     ma pokazać panel, a nie 404. Panel sam odsyła niezalogowanych do
     logowania, a zalogowanych — na DO DECYZJI. */
  const doPanelu = async (_req: unknown, reply: FastifyReply) => reply.redirect("/obsluga/");
  app.get("/", doPanelu);
  app.get("/biuro", doPanelu);
  app.get("/biuro/*", doPanelu);

  /**
   * Pozycje dokumentu dla biura — CZYTA, nigdy nie otwiera dostawy.
   *
   * Trasa mieszka TU, a nie przy pozostałych trasach dostaw, i to jest decyzja
   * o bezpieczeństwie, nie o porządku: jej sąsiadem byłby `POST
   * /api/delivery/documents/:dokId/open`, czyli zapis różniący się o jeden
   * człon ścieżki. `routes/delivery.ts` zostaje o ścieżce pracy kolektora,
   * a to jedyna trasa czytana wyłącznie przez biuro (dziś: Dostawy w panelu).
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
   * Archiwum dostaw — te, których dokument wypadł już z okna importu.
   *
   * Ta sama bramka co u sąsiadów wyżej i niżej: zwykły odczyt, sesja globalna
   * wystarcza, `autoryzuj()` byłoby tu szkodliwe (zapisuje zdarzenie
   * `privileged` przy każdym sprawdzeniu).
   *
   * Wyszukiwanie liczy SERWER, w odróżnieniu od listy rozkładania, którą panel
   * filtruje u siebie. Powód jest jeden: lista pracy ma kilkanaście wierszy
   * i mieści się w przeglądarce w całości, a archiwum rośnie z każdym rokiem.
   * Filtrowanie po stronie panelu znaczyłoby, że faktura sprzed roku nie
   * znajduje się mimo poprawnego numeru — i wygląda to identycznie jak
   * faktura, której nigdy nie było.
   */
  app.get<{ Querystring: { q?: string } }>("/api/biuro/dostawy/archiwum", async (req) =>
    archiwumDostaw(req.query.q ?? "")
  );

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

  /* ── ILE TRWA WYMIANA Z HALĄ (0.361.0) ───────────────────────────────────
     §22 wymienia „czas realizacji zadania magazynowego" wśród metryk i nie
     podaje przy nim ani progu, ani miejsca. W kodzie nie było go wcale:
     znaczniki obu końców leżą w bazie od lat, a różnicy nie liczył nikt.

     GET, więc umowa zapisów panelu zostaje nietknięta — patrzenie na miarę
     niczego nie mutuje. Bramka roli ta sama co przy notatkach: to liczby
     o pracy ludzi i nie mają po co jeździć poza biuro. */
  app.get<{ Querystring: { dni?: string } }>("/api/biuro/wymiana", async (req, reply) => {
    const nie = odmowa();
    if (nie) return reply.code(nie.kod).send({ error: nie.error });
    return czasyWymiany(Number(req.query.dni) || 30);
  });

  /* ── CO STOI DŁUŻEJ, NIŻ STOI ZWYKLE (0.364.0) ───────────────────────────
     Tabela wyżej odpowiada na pytanie zadane — a żeby je zadać, trzeba wejść
     na STAN SYSTEMU i spojrzeć. Ta trasa odpowiada na pytanie NIEZADANE
     i dlatego chodzi w cyklu, na każdej zakładce: własność „Wiek" wymaga,
     żeby widać było, co czeka najdłużej, BEZ PYTANIA KOGOKOLWIEK.

     Bez parametru `dni`: okno jest stałe (30 dni). Suwak przy tabeli rządzi
     tabelą; sygnał, który zmienia treść przy przestawieniu listy rozwijanej,
     przestaje być sygnałem. */
  app.get("/api/biuro/alarm-wymiany", async (_req, reply) => {
    const nie = odmowa();
    if (nie) return reply.code(nie.kod).send({ error: nie.error });
    return alarmyWymiany();
  });

  /* ── DO DECYZJI (0.435.0) ────────────────────────────────────────────────
     Ekran startowy panelu biura — wszystko, co czeka na rozstrzygnięcie
     biura, jedną listą. Całe uzasadnienie przy `services/do-decyzji.ts`.

     GET i ani jednego zapisu: to jest ekran, na który się WCHODZI, więc umowa
     „zero zapisu przy patrzeniu" obowiązuje go bardziej niż każdy inny.
     Bramka biura, bo lista niesie liczby kolejek klienta i rozmowy hali —
     magazynier nie ma tu czego rozstrzygać. */
  app.get("/api/biuro/do-decyzji", async (_req, reply) => {
    const s = sesjaZadania();
    if (!s) return reply.code(401).send({ error: "Brak sesji — zaloguj się" });
    if (!ORZEKAJACY.includes(s.user.role)) {
      return reply.code(403).send({ error: "Decyzje biura podejmuje biuro" });
    }
    return doDecyzji();
  });

  /* ── Dane firmy na wydrukach (0.444.0) ─────────────────────────────────
     Przeszły z localStorage przeglądarki na serwer: jedna firma, jedna kopia.
     Bramka lekka, jak reguły strefy — to zapis konfiguracji, który ludzie
     drukujący protokoły robią kilka razy w roku, a nie orzeczenie o pracy,
     więc bez `autoryzuj()` i wpisu `privileged`. Ślad `firma_zapis` pisze
     serwis. Magazynier nie drukuje protokołów i nie ma tu czego zmieniać. */
  function odmowaFirmy(): { kod: number; error: string } | null {
    const s = sesjaZadania();
    if (!s) return { kod: 401, error: "Brak sesji — zaloguj się" };
    if (!ORZEKAJACY.includes(s.user.role)) return { kod: 403, error: "Dane firmy prowadzi biuro" };
    return null;
  }

  app.get("/api/biuro/firma", async (_req, reply) => {
    const nie = odmowaFirmy();
    if (nie) return reply.code(nie.kod).send({ error: nie.error });
    return daneFirmy();
  });

  app.put<{ Body: Partial<Record<PoleFirmy, unknown>> }>("/api/biuro/firma", async (req, reply) => {
    const nie = odmowaFirmy();
    if (nie) return reply.code(nie.kod).send({ error: nie.error });
    try {
      return zapiszDaneFirmy(req.body ?? {}, sesjaZadania()?.user.name ?? "?");
    } catch (e) {
      if (e instanceof BladFirmy) return reply.code(400).send({ error: e.message });
      throw e;
    }
  });

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
