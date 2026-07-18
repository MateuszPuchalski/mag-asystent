import Fastify from "fastify";
import cors from "@fastify/cors";
import fstatic from "@fastify/static";
import fs from "node:fs";
import { config } from "./config.js";
import { db } from "./db/db.js";
import { productRoutes } from "./routes/products.js";
import { mmRoutes } from "./routes/mm.js";
import { queueRoutes } from "./routes/queue.js";
import { putawayRoutes } from "./routes/putaway.js";
import { locationRoutes } from "./routes/locations.js";
import { deviceRoutes } from "./routes/device.js";
import { importFromMssql, lastImport } from "./adapters/subiekt.mssql.js";

async function main() {
  db(); // migracja schematu przy starcie

  // SGT_MODE=mssql: read-model sgt_* zasilany z bazy Subiekta — import przy
  // starcie (twardy błąd, gdy baza nieosiągalna), potem co MSSQL_SYNC_MS.
  if (config.sgtMode === "mssql") {
    await importFromMssql();
    setInterval(() => {
      importFromMssql().catch((e) =>
        console.error("[mssql] odświeżenie nieudane:", e instanceof Error ? e.message : e)
      );
    }, config.mssql.syncMs);
  }

  const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? "info" } });
  await app.register(cors, { origin: true });

  app.get("/api/health", async () => ({
    ok: true,
    mode: config.sgtMode,
    sferaMode: config.sferaMode,
    ...(config.sgtMode === "mssql" ? { lastSync: lastImport } : {}),
  }));

  // wymuszenie odświeżenia read-modelu (mssql): np. po przyjęciu dostawy w Subiekcie
  app.post("/api/admin/resync", async (_req, reply) => {
    if (config.sgtMode !== "mssql") {
      return reply.code(400).send({ error: "resync dostępny tylko w SGT_MODE=mssql" });
    }
    const stats = await importFromMssql();
    return { ok: true, stats };
  });

  await app.register(productRoutes);
  await app.register(mmRoutes);
  await app.register(queueRoutes);
  await app.register(putawayRoutes);
  await app.register(locationRoutes);
  await app.register(deviceRoutes);

  // serwowanie zbudowanego frontendu (prod)
  if (fs.existsSync(config.webDist)) {
    await app.register(fstatic, { root: config.webDist, wildcard: false });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith("/api/")) return reply.code(404).send({ error: "Not found" });
      return reply.sendFile("index.html");
    });
  }

  await app.listen({ port: config.port, host: config.host });
  console.log(`[api] WERTIS serwer na http://${config.host}:${config.port} · SGT_MODE=${config.sgtMode}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
