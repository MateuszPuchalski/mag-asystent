import type { FastifyInstance } from "fastify";
import { config } from "../config.js";
import { listLocations, getProductsByLocation } from "../services/locations.js";

export async function locationRoutes(app: FastifyInstance) {
  // słownik lokalizacji + parametry walidacji dla klienta
  app.get("/api/locations", async () => ({
    codes: listLocations(),
    format: config.locFormat,
    strict: config.locStrict,
    allowManual: config.allowManualLoc,
  }));

  // reverse lookup: co leży w danej lokalizacji (spec — analiza)
  app.get<{ Params: { code: string } }>("/api/locations/:code/products", async (req) => {
    const code = decodeURIComponent(req.params.code);
    return { code: code.trim().toUpperCase(), products: getProductsByLocation(code) };
  });
}
