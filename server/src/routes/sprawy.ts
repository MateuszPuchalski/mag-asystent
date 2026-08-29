import type { FastifyInstance } from "fastify";
import { sesjaZadania } from "../context.js";
import { stanPolaczenia } from "../services/allegro-token.js";
import {
  RODZAJE_SPRAW,
  licznikSpraw,
  listaSpraw,
  powiazaneSprawy,
  sprawyKlienta,
  szukajKlientow,
  type RodzajSprawy,
} from "../services/sprawy.js";
import { BladPytania, stempelProwadzi } from "../services/pytania.js";
import { BladZwrotu, stempelProwadziZwrotu } from "../services/zwroty.js";
import { stempelProwadziReklamacji } from "../services/reklamacje.js";
import { BladDyskusji, stempelProwadziDyskusji } from "../services/dyskusje.js";
import { osCzasuSprawy } from "../services/os-sprawy.js";
import {
  BladSprawy,
  rozklejSprawe,
  scalSprawy,
  stempelProwadziSprawy,
  zrodlaSprawy,
} from "../services/sprawa.js";

/* ── Sprawy — trasy jednej kolejki obsługi klienta ───────────────────────────
   Prawie wyłącznie ODCZYT: kolejka, licznik na zakładkę, Klient 360
   i powiązania. Mutacje mieszkają przy rejestrach źródłowych (pytania.ts,
   zwroty.ts, dyskusje.ts) — sprawa to widok, nie nowy byt. Bramka biuro|admin
   jak przy dyskusjach: prowadzenie spraw klienckich to robota biura, nie hali.

   TRZY WYJĄTKI od „wyłącznie odczytu": przejęcie sprawy (0.121.0) oraz SCAL
   i ROZKLEJ (0.129.0). Wszystkie trzy mają ten sam powód i żaden nie łamie
   reguły: klika się je Z KOLEJKI, a tylko ten moduł wie, przez ile rejestrów
   przechodzi jeden wiersz. Każdy zapis dzieje się po jawnym kliknięciu —
   nigdy przy samym wejściu na ekran.

   Dlaczego w ogóle: przy 168 sprawach w kolejce i kilku osobach w biurze
   kolumna PROWADZI miała myślnik w KAŻDYM wierszu, bo znacznik stawiało
   dopiero wejście w sprawę. Dwie osoby odpowiadały na to samo pytanie i nikt
   się o tym nie dowiadywał.                                                  */

const ORZEKAJACY = ["biuro", "admin"];

export async function sprawyRoutes(app: FastifyInstance) {
  function odmowa(): { kod: number; error: string } | null {
    const s = sesjaZadania();
    if (!s) return { kod: 401, error: "Brak sesji — zaloguj się" };
    if (!ORZEKAJACY.includes(s.user.role)) {
      return { kod: 403, error: "Sprawy klientów są dostępne dla biura" };
    }
    return null;
  }

  const autor = (): string => sesjaZadania()?.user.name ?? "?";

  /** Zły rodzaj to literówka w kliencie — 400 z listą, nie pusta odpowiedź. */
  function rodzajZapytania(surowy: string | undefined): RodzajSprawy | null | "blad" {
    if (!surowy) return null;
    return (RODZAJE_SPRAW as string[]).includes(surowy) ? (surowy as RodzajSprawy) : "blad";
  }

  // ── Kolejka ───────────────────────────────────────────────────────────────

  app.get<{ Querystring: { rodzaj?: string } }>("/api/biuro/sprawy", async (req, reply) => {
    const nie = odmowa();
    if (nie) return reply.code(nie.kod).send({ error: nie.error });
    const rodzaj = rodzajZapytania(req.query.rodzaj);
    if (rodzaj === "blad") {
      return reply
        .code(400)
        .send({ error: `Nieznany rodzaj sprawy — dozwolone: ${RODZAJE_SPRAW.join(", ")}` });
    }
    return { sprawy: listaSpraw(rodzaj ?? undefined), allegro: stanPolaczenia() };
  });

  /* Osobna, celowo TANIA trasa — pigułka na zakładce odświeża się co 30 s
     (ten sam powód co /api/biuro/pytania/licznik). */
  app.get("/api/biuro/sprawy/licznik", async (_req, reply) => {
    const nie = odmowa();
    if (nie) return reply.code(nie.kod).send({ error: nie.error });
    return licznikSpraw();
  });

  // ── Klient 360 ────────────────────────────────────────────────────────────

  /* Login w querystring, nie w ścieżce: to dowolny tekst z Allegro
     (ukośniki, spacje), a brak parametru ma czyste znaczenie — kubełek
     spraw bez klienta. */
  app.get<{ Querystring: { login?: string } }>(
    "/api/biuro/sprawy/klient",
    async (req, reply) => {
      const nie = odmowa();
      if (nie) return reply.code(nie.kod).send({ error: nie.error });
      const login = req.query.login?.trim() || null;
      return { login, ...sprawyKlienta(login) };
    }
  );

  /* Liczba mnoga obok istniejącej pojedynczej i to nie jest przypadek:
     `/klient` POKAZUJE jednego, `/klienci` SZUKA wielu. Odczyt jak cała
     rodzina spraw — SQLite, zero ruchu do Allegro (audyt 0.109.1). */
  app.get<{ Querystring: { q?: string } }>("/api/biuro/sprawy/klienci", async (req, reply) => {
    const nie = odmowa();
    if (nie) return reply.code(nie.kod).send({ error: nie.error });
    return { klienci: szukajKlientow(req.query.q ?? "") };
  });

  // ── Powiązania ────────────────────────────────────────────────────────────

  app.get<{ Querystring: { rodzaj?: string; id?: string } }>(
    "/api/biuro/sprawy/powiazane",
    async (req, reply) => {
      const nie = odmowa();
      if (nie) return reply.code(nie.kod).send({ error: nie.error });
      const rodzaj = rodzajZapytania(req.query.rodzaj);
      const id = Number(req.query.id);
      if (rodzaj === null || rodzaj === "blad" || !Number.isInteger(id) || id <= 0) {
        return reply
          .code(400)
          .send({ error: `Podaj rodzaj (${RODZAJE_SPRAW.join(", ")}) i dodatnie id sprawy` });
      }
      return powiazaneSprawy(rodzaj, id);
    }
  );

  // ── Oś czasu sprawy (0.130.0) ─────────────────────────────────────────────

  /* Wejściem jest ŹRÓDŁO, bo tyle wie każdy z trzech szczegółów panelu —
     a wyjściem oś czasu CAŁEJ sprawy, do której to źródło dziś należy.
     Czysty odczyt: zdarzenia dopisują mutacje w rejestrach, nigdy ten GET. */
  app.get<{ Querystring: { rodzaj?: string; id?: string } }>(
    "/api/biuro/sprawy/os",
    async (req, reply) => {
      const nie = odmowa();
      if (nie) return reply.code(nie.kod).send({ error: nie.error });
      const rodzaj = rodzajZapytania(req.query.rodzaj);
      const id = Number(req.query.id);
      if (rodzaj === null || rodzaj === "blad" || !Number.isInteger(id) || id <= 0) {
        return reply
          .code(400)
          .send({ error: `Podaj rodzaj (${RODZAJE_SPRAW.join(", ")}) i dodatnie id sprawy` });
      }
      return osCzasuSprawy(rodzaj, id);
    }
  );

  // ── Sklejanie ręką człowieka (0.129.0) ────────────────────────────────────

  /* Identyfikatory w CIELE, nie w ścieżce: dwa id tego samego rodzaju w URL-u
     proszą się o zamianę miejscami, a nazwane pola w JSON-ie tego nie zrobią.
     Serwis i tak scala pod mniejsze id, ale czytelność żądania to nie
     drobiazg przy operacji, która łączy dwa problemy klienta w jeden. */
  app.post<{ Body: { docelowa?: number; dawca?: number } }>(
    "/api/biuro/sprawy/scal",
    async (req, reply) => {
      const nie = odmowa();
      if (nie) return reply.code(nie.kod).send({ error: nie.error });
      const { docelowa, dawca } = req.body ?? {};
      if (!Number.isInteger(docelowa) || !Number.isInteger(dawca)) {
        return reply.code(400).send({ error: "Podaj dwa identyfikatory spraw do scalenia" });
      }
      try {
        return { sprawaId: scalSprawy(docelowa as number, dawca as number, autor()) };
      } catch (e) {
        if (e instanceof BladSprawy) return reply.code(e.kod).send({ error: e.message });
        throw e;
      }
    }
  );

  /* ROZKLEJ cofa SCAL w całości: jednostką jest sprawa, tak samo jak przy
     scalaniu. Rozklejanie po jednym źródle zostawiało sprawy w stanach,
     których nikt nie zamawiał. */
  app.post<{ Body: { sprawaId?: number } }>(
    "/api/biuro/sprawy/rozklej",
    async (req, reply) => {
      const nie = odmowa();
      if (nie) return reply.code(nie.kod).send({ error: nie.error });
      const sprawaId = req.body?.sprawaId;
      if (!Number.isInteger(sprawaId)) {
        return reply.code(400).send({ error: "Podaj identyfikator sprawy do rozklejenia" });
      }
      try {
        return { sprawaId: rozklejSprawe(sprawaId as number, autor()) };
      } catch (e) {
        if (e instanceof BladSprawy) return reply.code(e.kod).send({ error: e.message });
        throw e;
      }
    }
  );

  // ── Przejęcie sprawy ──────────────────────────────────────────────────────

  /**
   * „Wezmę to" z kolejki. ZNACZNIK, NIE BLOKADA: nie odbiera nikomu dostępu,
   * mówi tylko, że ktoś przy tej sprawie siedzi. Każdy rejestr stempluje
   * po swojemu i sam pilnuje swoich warunków (sprawa zamknięta odmawia),
   * więc tutaj zostaje wyłącznie rozdzielenie po rodzaju.
   *
   * Reklamacja bierze `id` POZYCJI zwrotu, nie zwrotu — tak samo jak wiersz
   * kolejki, który ją niesie (`sprawyReklamacji` zwraca `p.id`).
   *
   * Od 0.128.0 rodzaj `sprawa` przejmuje CAŁĄ sprawę wielźródłową: stempel
   * na encji plus stemple per-typ na każdym otwartym źródle — wiedza „który
   * rejestr" mieszka odtąd w `sprawa_zrodlo`, nie w kliencie.
   */
  app.post<{ Params: { rodzaj: string; id: string } }>(
    "/api/biuro/sprawy/:rodzaj/:id/prowadzi",
    async (req, reply) => {
      const nie = odmowa();
      if (nie) return reply.code(nie.kod).send({ error: nie.error });
      const surowy = req.params.rodzaj;
      const rodzaj = surowy === "sprawa" ? null : rodzajZapytania(surowy);
      const id = Number(req.params.id);
      if ((surowy !== "sprawa" && (rodzaj === null || rodzaj === "blad")) ||
          !Number.isInteger(id) || id <= 0) {
        return reply.code(400).send({
          error: `Podaj rodzaj (sprawa, ${RODZAJE_SPRAW.join(", ")}) i dodatnie id sprawy`,
        });
      }
      /* Każdy rejestr rzuca SWOIM błędem z własnym kodem HTTP („sprawa
         zamknięta", „nie ma takiej pozycji") — i te kody muszą dojechać do
         kolejki. Bez tego odmowa wyglądałaby na awarię serwera, a klik
         w wierszu po cichu nie robiłby nic. `BladZwrotu` obsługuje też
         reklamacje: `stempelProwadziReklamacji` rzuca właśnie nim. */
      const stempelZrodla = (r: RodzajSprawy, lokalnyId: number) => {
        if (r === "pytanie") stempelProwadzi(lokalnyId, autor());
        else if (r === "zwrot") stempelProwadziZwrotu(lokalnyId, autor());
        else if (r === "dyskusja") stempelProwadziDyskusji(lokalnyId, autor());
        else stempelProwadziReklamacji(lokalnyId, autor());
      };
      try {
        if (surowy === "sprawa") {
          stempelProwadziSprawy(id, autor());
          /* Tylko OTWARTE źródła: rejestr zamknięty odmówiłby stempla,
             a przejęcie żywej części sprawy to nie jest błąd. */
          for (const z of zrodlaSprawy(id).filter((x) => x.otwarte)) {
            stempelZrodla(z.rodzaj, z.lokalnyId);
          }
        } else {
          stempelZrodla(rodzaj as RodzajSprawy, id);
        }
      } catch (e) {
        if (e instanceof BladZwrotu || e instanceof BladPytania || e instanceof BladDyskusji) {
          return reply.code(e.kod).send({ error: e.message });
        }
        if (e instanceof Error && /Nie ma takiej sprawy/.test(e.message)) {
          return reply.code(404).send({ error: e.message });
        }
        throw e;
      }
      return { prowadzi: autor() };
    }
  );
}
