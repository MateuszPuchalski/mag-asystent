import type { FastifyInstance } from "fastify";
import { csv, policzZdarzenia, typyZdarzen, zdarzenia, type FiltrAudytu } from "../services/audyt.js";
import { logEvent } from "../services/events.js";
import { sesjaZadania } from "../context.js";

/* ── Trasy audytu ────────────────────────────────────────────────────────────
   Odpowiedź na zdanie „za miesiąc ktoś powie, że aplikacja zjadła mu 30 sztuk".
   Dane były w bazie od zawsze; brakowało sposobu, żeby je z niej wyjąć bez
   `sqlite3` na serwerze.

   BRAMKA NA ROLĘ, bez PIN-u. Idzie za precedensem z `routes/auth.ts:112`:
   `GET` sprawdza samą rolę, PIN chroni ZMIANY. Log niczego nie zmienia — ale
   mówi, kto co robił i o której, więc jest narzędziem nadzoru i hala go nie
   ogląda.                                                                     */

const CZYTAJACY = ["brygadzista", "biuro"];

/** Filtr z query stringa. Puste i śmieciowe wartości znikają, nie wywracają. */
function filtr(q: Record<string, string | undefined>): FiltrAudytu {
  const liczba = (v: string | undefined): number | null => {
    const n = Number(v);
    return v != null && v !== "" && Number.isFinite(n) ? Math.trunc(n) : null;
  };
  return {
    od: q.od || null,
    do: q.do || null,
    typy: q.typ ? q.typ.split(",").map((s) => s.trim()).filter(Boolean) : null,
    userRef: liczba(q.userRef),
    twId: liczba(q.twId),
    device: q.device || null,
    limit: liczba(q.limit),
    offset: liczba(q.offset),
  };
}

export async function audytRoutes(app: FastifyInstance) {
  /** `null` = wolno czytać; inaczej gotowa odmowa. */
  function odmowa(): { kod: number; error: string } | null {
    const s = sesjaZadania();
    if (!s) return { kod: 401, error: "Brak sesji — zaloguj się" };
    if (!CZYTAJACY.includes(s.user.role)) {
      return { kod: 403, error: "Ślad audytowy jest dostępny dla brygadzisty albo biura" };
    }
    return null;
  }

  app.get<{ Querystring: Record<string, string | undefined> }>("/api/events", async (req, reply) => {
    const nie = odmowa();
    if (nie) return reply.code(nie.kod).send({ error: nie.error });
    const f = filtr(req.query ?? {});
    return {
      wpisy: zdarzenia(f),
      /* Liczba WSZYSTKICH pasujących, nie długość strony. Bez niej człowiek
         widzi 100 wierszy i nie wie, czy to komplet, czy pierwszy ekran
         z tysiąca — a to rozstrzyga, czy wolno wyciągnąć wniosek. */
      razem: policzZdarzenia(f),
      typy: typyZdarzen(),
    };
  });

  app.get<{ Querystring: Record<string, string | undefined> }>(
    "/api/events/csv",
    async (req, reply) => {
      const nie = odmowa();
      if (nie) return reply.code(nie.kod).send({ error: nie.error });
      const f = filtr(req.query ?? {});
      /* Kto wyniósł ślad audytowy, sam trafia do śladu. Eksport to kopia
         historii pracy ludzi opuszczająca serwer — bez tego wpisu log
         audytowy miałby dziurę dokładnie w miejscu, gdzie jest najbardziej
         potrzebny. */
      logEvent("audyt_eksport", nazwaCzytajacego(), null, {
        filtr: { ...f, limit: undefined, offset: undefined },
        wierszy: policzZdarzenia(f),
      });
      return reply
        .header("content-type", "text/csv; charset=utf-8")
        .header("content-disposition", 'attachment; filename="wertis-audyt.csv"')
        .send(csv(zdarzenia(f)));
    }
  );

  /**
   * Meldunek kolektora o operacji, której NIE DAŁO SIĘ wykonać.
   *
   * Bufor offline kasował takie operacje po cichu, więc znikały bez śladu —
   * dokładnie ten przypadek, przed którym ma chronić log po stronie serwera.
   *
   * Prefiks `klient_` jest celowy: to RELACJA URZĄDZENIA, a nie fakt
   * zaobserwowany przez serwer. Audyt musi widzieć tę różnicę, bo kolektor
   * może się mylić, a serwer o tym zdarzeniu nic nie wie z pierwszej ręki.
   */
  app.post<{ Body: { operacje?: MeldunekOperacji[] } }>(
    "/api/events/kolektor",
    async (req, reply) => {
      const operacje = req.body?.operacje;
      if (!Array.isArray(operacje) || operacje.length === 0) {
        return reply.code(400).send({ error: "Brak operacji do zameldowania" });
      }
      if (operacje.length > MAX_MELDUNKOW) {
        return reply
          .code(400)
          .send({ error: `Naraz można zameldować najwyżej ${MAX_MELDUNKOW} operacji` });
      }
      for (const o of operacje) {
        logEvent("klient_odrzucona", nazwaCzytajacego(), liczbaLubNull(o.twId), {
          rodzaj: String(o.rodzaj ?? "").slice(0, 40),
          powod: String(o.powod ?? "").slice(0, 300),
          status: liczbaLubNull(o.status),
          proby: liczbaLubNull(o.proby),
          /* Czas WYKONANIA na kolektorze, nie dosłania. Operacja mogła czekać
             w buforze godzinami — `created_at` wiersza mówi, kiedy się o niej
             dowiedzieliśmy, a to pole, kiedy naprawdę się wydarzyła. */
          wykonanoNaKolektorze: typeof o.at === "string" ? o.at.slice(0, 40) : null,
        });
      }
      return { przyjeto: operacje.length };
    }
  );
}

/** Ile meldunków naraz — bufor kolektora bywa długi po dniu bez Wi-Fi. */
const MAX_MELDUNKOW = 200;

interface MeldunekOperacji {
  rodzaj?: unknown;
  twId?: unknown;
  powod?: unknown;
  status?: unknown;
  proby?: unknown;
  at?: unknown;
}

const liczbaLubNull = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? Math.trunc(v) : null;

/** Nazwa z sesji; `logEvent` i tak dokłada `user_ref` z kontekstu żądania. */
function nazwaCzytajacego(): string {
  return sesjaZadania()?.user.name ?? "anonim";
}
