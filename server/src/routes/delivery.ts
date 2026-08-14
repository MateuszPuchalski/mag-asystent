import type { FastifyInstance } from "fastify";
import { config } from "../config.js";
import { autorOperacji, sesjaZadania, userOf } from "../context.js";
import { autoryzuj } from "../services/auth.js";
import {
  forceReleaseLine,
  getDelivery,
  listDocuments,
  openDelivery,
  podgladZakonczenia,
  putawayLine,
  releaseLine,
  resolveScan,
  zakonczDostawe,
} from "../services/delivery.js";
import type { LocApplyAction } from "../types.js";

/* ── Rozkładanie faktur zakupu (redesign v2.0) ───────────────────────────────
   Ścieżka codzienna: dokument → skan towaru → skan lokalizacji. Zapis wyłącznie
   `set_location` (D1), zero dokumentów. Dotyczy też kontenerów z MGP — po nich
   zostaje jeszcze przesunięcie stanu (`POST /api/przesuniecie`).             */

export async function deliveryRoutes(app: FastifyInstance) {
  /**
   * Lista dostaw z postępem; dokumenty w buforze też (D1).
   *
   * Okno bierze się z `DOK_DNI_WSTECZ`, a nie z zaszytej czternastki. Zaszyta
   * była do sierpnia 2026 i czyniła to ustawienie martwym w połowie: import
   * respektował je, lista nie — więc `DOK_DNI_WSTECZ=30` nie pokazywało ani
   * jednego dokumentu więcej.
   *
   * `dniWstecz` jedzie w odpowiedzi, bo nagłówek na kolektorze tę liczbę
   * pokazuje. Wcześniej miał ją wpisaną w kodzie i był trzecim miejscem, gdzie
   * ta sama czternastka mogła się rozjechać.
   */
  app.get("/api/delivery/documents", async () => ({
    documents: listDocuments(config.mssql.dokDniWstecz),
    dniWstecz: config.mssql.dokDniWstecz,
  }));

  /** Otwórz/wznów rozkładanie dokumentu — snapshot pozycji w chwili otwarcia. */
  app.post<{ Params: { dokId: string } }>("/api/delivery/documents/:dokId/open", async (req, reply) => {
    try {
      return { deliveryId: openDelivery(Number(req.params.dokId), userOf(req)) };
    } catch (e) {
      return reply.code(400).send({ error: e instanceof Error ? e.message : "Błąd otwarcia" });
    }
  });

  /** Widok dostawy: linie posortowane po lokalizacji, BEZ LOK na końcu. */
  app.get<{ Params: { id: string } }>("/api/delivery/:id", async (req, reply) => {
    const d = getDelivery(Number(req.params.id));
    if (!d) return reply.code(404).send({ error: "Brak dostawy" });
    return d;
  });

  /** Skan towaru → linia / kolizja EAN / spoza dokumentu / nieznany (D7). */
  app.post<{ Params: { id: string }; Body: { code: string } }>(
    "/api/delivery/:id/scan",
    async (req, reply) => {
      const code = (req.body?.code ?? "").trim();
      if (!code) return reply.code(400).send({ error: "Pusty kod" });
      return resolveScan(Number(req.params.id), code, userOf(req));
    }
  );

  /**
   * Odłożenie linii: skan lokalizacji obowiązkowy (D3). Bez MM.
   * `locAction` rozstrzyga rozjazd (§4.3): 'replace' = towar przeniesiony,
   * 'add' = druga lokalizacja tego samego towaru. Decyduje magazynier w dialogu,
   * a nie serwer — z samego skanu nie da się odróżnić tych dwóch sytuacji.
   */
  app.post<{
    Params: { id: string; lineId: string };
    Body: { location: string; qty?: number; locAction?: LocApplyAction; recznie?: boolean };
  }>(
    "/api/delivery/:id/lines/:lineId/putaway",
    async (req, reply) => {
      const { location, qty, locAction, recznie } = req.body ?? ({} as { location?: string });
      if (!location) return reply.code(400).send({ error: "Brak kodu lokalizacji" });
      if (locAction && locAction !== "add" && locAction !== "replace") {
        return reply.code(400).send({ error: `Nieznana akcja lokalizacji: ${locAction}` });
      }
      /* Autor z chwili WYKONANIA, nie wysyłki: odłożenie buforowane offline
         dojeżdża po powrocie sieci, czasem po zmianie osoby przy kolektorze —
         `x-buffered-user` niesie wtedy konto tego, kto naprawdę odłożył. */
      const autor = autorOperacji(req);
      const r = putawayLine(Number(req.params.lineId), location, autor.nazwa, {
        qty,
        locAction,
        recznie,
      });
      // uwaga: lock zwalnia sam putawayLine — tu tylko odpowiedź
      if ("error" in r) return reply.code(r.status ?? 400).send({ error: r.error });
      return r;
    }
  );

  /**
   * Podgląd zakończenia — co powstanie, gdyby zakończyć TERAZ. Czysty odczyt.
   *
   * Osobna trasa, bo kolektor pokazuje to człowiekowi PRZED zapisem: zgłoszenie
   * do dostawcy nie ma prawa powstać z przycisku, którego skutku nikt nie
   * widział.
   */
  app.get<{ Params: { id: string } }>(
    "/api/delivery/:id/zakonczenie",
    async (req) => podgladZakonczenia(Number(req.params.id))
  );

  /**
   * Zakończenie dostawy: braki ilościowe → wyjątki „zła ilość", nietknięte →
   * pominięte. Bez bramki roli — to jest czynność magazyniera przy palecie,
   * a nie orzeczenie o pracy, której nie było (tamto siedzi pod `/biuro`).
   */
  app.post<{ Params: { id: string } }>(
    "/api/delivery/:id/zakoncz",
    async (req, reply) => {
      const r = zakonczDostawe(Number(req.params.id), userOf(req));
      if ("error" in r) return reply.code(400).send(r);
      return r;
    }
  );

  /**
   * Zwolnienie linii po ANULUJ na karcie odkładania. Bez tego linia wisiałaby
   * zajęta do wygaśnięcia TTL, a kolega obok dostawałby „zajęte" bez powodu.
   */
  app.post<{ Params: { lineId: string } }>(
    "/api/delivery/:id/lines/:lineId/release",
    async (req) => releaseLine(Number(req.params.lineId), userOf(req))
  );

  /**
   * Odebranie linii koledze przed wygaśnięciem TTL — PIN, nie sam badge.
   *
   * Bez tego jedyną drogą jest odczekanie 30 minut, a najczęstsza przyczyna
   * wiszącego locka (koniec zmiany, utrata zasięgu) sprawia, że czeka się na
   * nic. Jednocześnie to jedyne miejsce w aplikacji, gdzie jedna osoba odbiera
   * pracę drugiej bez jej wiedzy — więc zastrzegamy je dla brygadzisty i biura,
   * a zdarzenie idzie do `events` zawsze.
   */
  app.post<{ Params: { lineId: string } }>(
    "/api/delivery/:id/lines/:lineId/force-release",
    async (req, reply) => {
      const s = sesjaZadania();
      if (!s) return reply.code(401).send({ error: "Brak sesji — zaloguj się" });
      const w = autoryzuj(s.user, "zdjecie_cudzego_locka");
      if (!w.ok) return reply.code(403).send({ error: w.powod });
      return forceReleaseLine(Number(req.params.lineId), s.user.name);
    }
  );
}
