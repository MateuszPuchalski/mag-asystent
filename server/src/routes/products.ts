import type { FastifyInstance } from "fastify";
import { autorOperacji, subiekt, userOf } from "../context.js";
import { config } from "../config.js";
import { buildProductCard } from "../services/stock.js";
import { enqueueSetLocation } from "../services/queue.js";
import { logEvent, productHistory } from "../services/events.js";
import {
  validateLocationCode,
  listLocations,
  getProductsByLocation,
} from "../services/locations.js";
import { classifyScan, normalizeLoc } from "../scan.js";
import { parseLocs } from "../locs.js";

type LocAction = "replace" | "add" | "remove" | "replace_one";

interface LocBody {
  action: LocAction;
  value?: string;
  replaced?: string;
}

function computeNewLocs(current: string[], body: LocBody): string[] {
  const v = (body.value ?? "").trim().toUpperCase();
  switch (body.action) {
    case "replace":
      return [v];
    case "add":
      return current.includes(v) ? current : [...current, v];
    case "remove":
      return current.filter((l) => l !== v);
    case "replace_one":
      return current.map((l) => (l === body.replaced ? v : l));
  }
}

export async function productRoutes(app: FastifyInstance) {
  /**
   * Rozpoznanie skanu → karta / zawartość regału / wyniki (spec §4, plan §4).
   *
   * Klasyfikacja idzie PRZED wyszukiwaniem, bo bez niej skan etykiety regału
   * trafiał do wyszukiwarki towarów (`subiekt.search` nie zna lokalizacji),
   * zwracał zero wyników i magazynier oglądał pustą listę z kodem półki
   * w polu — zamiast jej zawartości.
   *
   * Po klasyfikacji obowiązuje JEDNO wyszukanie w JEDNEJ dziedzinie, bez
   * fallbacku na drugą. Fallback jest zależny od kolejności, a zależność od
   * kolejności to sposób, w jaki mis-skan cicho robi coś innego, niż wygląda.
   */
  app.get<{ Params: { code: string }; Querystring: { manual?: string; screen?: string } }>(
    "/api/products/scan/:code",
    async (req) => {
    const raw = decodeURIComponent(req.params.code).trim();
    const scan = classifyScan(raw);
    // Wejście RĘCZNE liczone osobno od skanu — udział wpisów per lokalizacja to
    // darmowy raport jakości etykiet („który regał wymaga przedruku"), a per
    // towar mówi, która kartoteka nie ma czytelnego kodu. Wrzucone do jednego
    // worka z `scan` nie mierzy niczego.
    const reczne = req.query.manual === "1";
    logEvent(reczne ? "manual_entry" : "scan", userOf(req), null, {
      code: raw,
      kind: scan.kind,
      ...(reczne && req.query.screen ? { screen: req.query.screen } : {}),
    });

    if (scan.kind === "LOC") {
      const code = normalizeLoc(scan.code);
      // Pusty regał to POPRAWNA odpowiedź, nie błąd — magazynier skanuje półkę
      // między innymi po to, żeby sprawdzić, czy jest wolna. `known` mówi tylko,
      // czy ten adres występuje dziś w kartotece.
      return {
        type: "location",
        code,
        known: listLocations().includes(code),
        products: getProductsByLocation(code),
      };
    }
    if (scan.kind === "EAN") {
      const p = subiekt.getProductByEan(scan.code);
      if (p) return { type: "product", card: buildProductCard(subiekt, p.tw_id) };
      return { type: "notfound", code: scan.code };
    }
    const bySym = subiekt.getProductBySymbol(scan.code);
    if (bySym) return { type: "product", card: buildProductCard(subiekt, bySym.tw_id) };
    const results = subiekt.search(scan.code, 20);
    if (results.length === 1) {
      return { type: "product", card: buildProductCard(subiekt, results[0].id) };
    }
      return { type: "search", results };
    }
  );

  // wyszukiwarka (spec §5.1)
  app.get<{ Querystring: { q?: string } }>("/api/products/search", async (req) => {
    const q = (req.query.q ?? "").trim();
    if (!q) return { results: [] };
    logEvent("search", userOf(req), null, { q });
    return { results: subiekt.search(q, 20) };
  });

  // karta towaru
  app.get<{ Params: { twId: string } }>("/api/products/:twId", async (req, reply) => {
    const card = buildProductCard(subiekt, Number(req.params.twId));
    if (!card) return reply.code(404).send({ error: "Nie znaleziono towaru" });
    return card;
  });

  // historia ruchów lokalizacji/MM towaru (analiza — „kto/kiedy")
  app.get<{ Params: { twId: string } }>("/api/products/:twId/history", async (req) => {
    return { entries: productHistory(Number(req.params.twId)) };
  });

  // zmiana lokalizacji → zadanie set_location (spec §5.2)
  app.post<{ Params: { twId: string }; Body: LocBody }>(
    "/api/products/:twId/location",
    async (req, reply) => {
      const twId = Number(req.params.twId);
      const p = subiekt.getProductById(twId);
      if (!p) return reply.code(404).send({ error: "Nie znaleziono towaru" });

      const body = req.body;
      if (body.action !== "remove") {
        const err = validateLocationCode(body.value ?? "");
        if (err) return reply.code(400).send({ error: err });
      }
      const current = parseLocs(p.lokalizacja);
      const next = computeNewLocs(current, body);
      const joined = next.join(" ");
      if (joined.length > config.locFieldLimit) {
        // twardy błąd, NIE ciche ucięcie (spec §5.2, §12)
        return reply.code(400).send({
          error: `Przekroczono limit pola tw_Lokalizacja (${config.locFieldLimit} znaków)`,
        });
      }

      // Autor Z CHWILI WYKONANIA, nie z chwili wysyłki — operacja z bufora
      // offline może dojechać po zmianie zmiany (patrz `autorOperacji`).
      const autor = autorOperacji(req);
      const user = autor.nazwa;
      const desc = describeLoc(body, current);
      const queueId = enqueueSetLocation(twId, joined, {
        createdBy: user,
        twId,
        label: "Lokalizacja · " + p.symbol,
        detail: desc,
      });
      logEvent(
        body.action === "remove" ? "location_removed" : "location_set",
        user,
        twId,
        { action: body.action, value: body.value, result: joined, wyslanePrzez: autor.wyslanePrzez },
        autor.ref
      );
      return { queueId };
    }
  );
}

function describeLoc(body: LocBody, current: string[]): string {
  const v = (body.value ?? "").toUpperCase();
  switch (body.action) {
    case "replace":
      return `${v} (zastąpiono ${current[0] ?? "brak"})`;
    case "add":
      return `${v} (dodano)`;
    case "remove":
      return `(usunięto ${body.value})`;
    case "replace_one":
      return `${v} (zamiast ${body.replaced})`;
  }
}
