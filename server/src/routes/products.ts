import type { FastifyInstance } from "fastify";
import { subiekt, userOf } from "../context.js";
import { config } from "../config.js";
import { buildProductCard } from "../services/stock.js";
import { enqueueSetLocation } from "../services/queue.js";
import { logEvent } from "../services/events.js";

type LocAction = "replace" | "add" | "remove" | "replace_one";

interface LocBody {
  action: LocAction;
  value?: string;
  replaced?: string;
}

/** Walidacja kodu lokalizacji: bez spacji (spec §4, §12). */
function validCode(code: string): string | null {
  if (!code) return "Pusty kod lokalizacji";
  if (/\s/.test(code)) return "Kod lokalizacji nie może zawierać spacji";
  return null;
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
  // rozpoznanie skanu → karta / wyniki (spec §4)
  app.get<{ Params: { code: string } }>("/api/products/scan/:code", async (req) => {
    const code = decodeURIComponent(req.params.code).trim();
    logEvent("scan", userOf(req), null, { code });
    if (/^\d{8}$|^\d{12,14}$/.test(code)) {
      const p = subiekt.getProductByEan(code);
      if (p) return { type: "product", card: buildProductCard(subiekt, p.tw_id) };
      return { type: "notfound", code };
    }
    const bySym = subiekt.getProductBySymbol(code);
    if (bySym) return { type: "product", card: buildProductCard(subiekt, bySym.tw_id) };
    const results = subiekt.search(code, 20);
    if (results.length === 1) {
      return { type: "product", card: buildProductCard(subiekt, results[0].id) };
    }
    return { type: "search", results };
  });

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

  // zmiana lokalizacji → zadanie set_location (spec §5.2)
  app.post<{ Params: { twId: string }; Body: LocBody }>(
    "/api/products/:twId/location",
    async (req, reply) => {
      const twId = Number(req.params.twId);
      const p = subiekt.getProductById(twId);
      if (!p) return reply.code(404).send({ error: "Nie znaleziono towaru" });

      const body = req.body;
      if (body.action !== "remove") {
        const err = validCode((body.value ?? "").trim().toUpperCase());
        if (err) return reply.code(400).send({ error: err });
      }
      const current = p.lokalizacja ? p.lokalizacja.split(" ").filter(Boolean) : [];
      const next = computeNewLocs(current, body);
      const joined = next.join(" ");
      if (joined.length > config.locFieldLimit) {
        // twardy błąd, NIE ciche ucięcie (spec §5.2, §12)
        return reply.code(400).send({
          error: `Przekroczono limit pola tw_Lokalizacja (${config.locFieldLimit} znaków)`,
        });
      }

      const user = userOf(req);
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
        { action: body.action, value: body.value, result: joined }
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
