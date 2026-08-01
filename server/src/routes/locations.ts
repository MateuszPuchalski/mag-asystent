import type { FastifyInstance } from "fastify";
import { config } from "../config.js";
import { listLocations, getProductsByLocation } from "../services/locations.js";

export async function locationRoutes(app: FastifyInstance) {
  // Słownik lokalizacji + REGUŁA rozpoznawania kodu. Serwer jest jej jedynym
  // właścicielem (plan §3) — kolektor cache'uje to, co dostanie, i nie zgaduje
  // wzorca, gdy nigdy nie zdążył pobrać.
  app.get("/api/locations", async () => ({
    codes: listLocations(),
    patterns: config.locPatterns,
    /** Wersja reguły — po niej klient poznaje, że jego cache jest nieaktualny. */
    /** Zgodność wsteczna ze starszym kolektorem (jeden wzorzec zamiast listy). */
    format: config.locPatterns[0],
    strict: config.locStrict,
    allowManual: config.allowManualLoc,
  }));

  // reverse lookup: co leży w danej lokalizacji (spec — analiza)
  app.get<{ Params: { code: string } }>("/api/locations/:code/products", async (req) => {
    const code = decodeURIComponent(req.params.code);
    return { code: code.trim().toUpperCase(), products: getProductsByLocation(code) };
  });
}
