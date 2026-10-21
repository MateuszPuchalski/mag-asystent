import type { FastifyInstance, FastifyReply } from "fastify";
import { autorOperacji, sesjaZadania, subiekt } from "../context.js";
import { listaBezZdjecia } from "../services/zdjecia-bez.js";
import { dopasujSymbole, symboleZCiala } from "../services/zdjecia-import.js";
import {
  bajtyZeZdjecia,
  czekaNaSubiekt,
  dodawanieWlaczone,
  zapiszIZglos,
} from "../services/zdjecia-wlasne.js";
import { ROLE_BIUROWE } from "../services/users.js";

/* ── Zdjęcia kartoteki widziane z biura ──────────────────────────────────────
   Dodawanie z podglądem stoi w `products.ts`, bo kolektor woła je z karty
   towaru. Tu jest to, czego kolektor nie potrzebuje: przegląd braków
   i import zdjęć z folderu. */

const BIURO = ROLE_BIUROWE;

/* Lista braków i import to narzędzia biura. Hala dokłada zdjęcie z karty
   towaru, a pełna kartoteka na kolektorze tylko by ją spowalniała. */
function odmowa(reply: FastifyReply, czego = "Listę towarów bez zdjęcia") {
  const s = sesjaZadania();
  if (!s) return reply.code(401).send({ error: "Brak sesji — zaloguj się" });
  if (!BIURO.includes(s.user.role)) {
    return reply.code(403).send({ error: `${czego} obsługuje biuro` });
  }
  return null;
}

/* Baza Subiekta nie odpowiedziała. To awaria, nie stan funkcji, więc idzie
   jako błąd: „wyłączone" kazałoby szukać klucza, którego nikt nie zmieniał. */
function awariaBazy(reply: FastifyReply, e: unknown) {
  const powod = e instanceof Error ? e.message : String(e);
  return reply.code(503).send({ error: `Nie da się odczytać kartoteki z Subiekta (${powod}).` });
}

/** Nazwa pliku do audytu. Przycięta, bo przychodzi z dysku człowieka, nie z naszej listy. */
function nazwaPliku(surowa: unknown): string | null {
  if (typeof surowa !== "string") return null;
  const n = surowa.trim().slice(0, 120);
  return n || null;
}

export async function zdjeciaRoutes(app: FastifyInstance) {
  app.get<{ Querystring: { q?: string; limit?: string; offset?: string; sortuj?: string; naStanie?: string; sprzedane?: string } }>(
    "/api/zdjecia/bez-zdjecia",
    async (req, reply) => {
      const nie = odmowa(reply); if (nie) return nie;
      try {
        return await listaBezZdjecia(req.query);
      } catch (e) {
        return awariaBazy(reply, e);
      }
    }
  );

  /**
   * Które pliki z folderu trafią w kartotekę. Sam odczyt; POST tylko dlatego,
   * że dwa tysiące symboli nie zmieszczą się w adresie.
   */
  app.post<{ Body: { symbole?: unknown } }>("/api/zdjecia/dopasuj", async (req, reply) => {
    const nie = odmowa(reply, "Import zdjęć"); if (nie) return nie;
    const wejscie = symboleZCiala(req.body?.symbole);
    if (!wejscie.ok) return reply.code(400).send({ error: wejscie.error });
    try {
      return await dopasujSymbole(wejscie.symbole);
    } catch (e) {
      return awariaBazy(reply, e);
    }
  });

  /**
   * Zapis gotowego zdjęcia z importu — bez podglądu i bez usługi tła.
   *
   * Przeglądarka składa biały kwadrat sama, a człowiek oglądał plik, zanim
   * go wybrał. Podgląd dokładałby drugą rundę na plik przy kilkuset plikach.
   */
  app.post<{ Params: { twId: string }; Body: { gotowy?: unknown; zrodlo?: unknown; plik?: unknown } }>(
    "/api/products/:twId/zdjecie/gotowe",
    async (req, reply) => {
      const nie = odmowa(reply, "Import zdjęć"); if (nie) return nie;
      if (!dodawanieWlaczone()) {
        return reply.code(409).send({ error: "Dodawanie zdjęć jest w tej instalacji wyłączone" });
      }
      const twId = Number(req.params.twId);
      const p = Number.isInteger(twId) ? subiekt.getProductById(twId) : undefined;
      if (!p) return reply.code(404).send({ error: "Nie znaleziono towaru" });

      /* Ponowiony import nie może podmienić zdjęcia, które już czeka
         w kolejce: Subiekt dostałby wtedy inne bajty, niż biuro zatwierdziło. */
      if (czekaNaSubiekt(twId)) {
        return reply.code(409).send({
          error: `Towar ${p.symbol} ma już zdjęcie czekające na wejście do Subiekta.`,
        });
      }

      const gotowy = req.body?.gotowy;
      if (typeof gotowy !== "string") {
        return reply.code(400).send({ error: "Gotowy obraz musi być tekstem base64" });
      }
      const bajty = bajtyZeZdjecia(gotowy, "panel");
      if (!bajty.ok) return reply.code(400).send({ error: bajty.error });

      return zapiszIZglos({
        twId,
        symbol: p.symbol,
        obraz: bajty.obraz,
        mime: bajty.mime,
        tloUsuniete: false,
        zrodlo: "import",
        plik: nazwaPliku(req.body?.plik),
        autor: autorOperacji(req),
      });
    }
  );
}
