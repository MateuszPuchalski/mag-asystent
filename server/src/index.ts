import Fastify from "fastify";
import { pathToFileURL } from "node:url";
import { config, envFile } from "./config.js";
import { withRequestContext } from "./context.js";
import { db } from "./db/db.js";
import { productRoutes } from "./routes/products.js";
import { queueRoutes } from "./routes/queue.js";
import { putawayRoutes } from "./routes/putaway.js";
import { deliveryRoutes } from "./routes/delivery.js";
import { problemRoutes } from "./routes/problems.js";
import { locationRoutes } from "./routes/locations.js";
import { deviceRoutes } from "./routes/device.js";
import { authRoutes } from "./routes/auth.js";
import { importFromMssql, lastImport } from "./adapters/subiekt.mssql.js";
import { docFlagAvailable } from "./services/delivery-flag.js";
import { zamelduj, stanWorkera } from "./services/process-state.js";

/**
 * Złożenie aplikacji BEZ nasłuchiwania.
 *
 * Wydzielone z `main()`, żeby dało się je przetestować: `app.inject()` z
 * Fastify wykonuje pełne żądanie — hooki, walidację, trasę — nie otwierając
 * portu. Wcześniej budowanie i `listen` siedziały w jednej funkcji, więc test
 * trasy wymagałby postawienia serwera i strzelania do niego po sieci.
 *
 * Poza tym zostaje tu wyłącznie to, co niepotrzebne w teście: cykliczny import
 * z MSSQL i samo `listen`.
 */
export async function buildApp() {
  const app = Fastify({
    logger: { level: process.env.LOG_LEVEL ?? "info" },
    // zdjęcia dowodowe lecą jako base64 w JSON (~300 KB → ~400 KB po kodowaniu)
    bodyLimit: 6 * 1024 * 1024,
  });
  // kontekst żądania (device_id do events) + bramka sesji — przed trasami
  withRequestContext(app);

  /* Health ma odpowiadać na pytanie „czy wdrożenie jest poprawne", a nie tylko
     „czy proces API odpowiada". Do tej pory raportował wyłącznie własny config,
     więc najgroźniejsza pomyłka wdrożenia — worker w innym trybie niż API —
     była przez niego NIEWYKRYWALNA. Teraz `ok` jest fałszywe, gdy cokolwiek
     wymaga uwagi, a `problemy` mówią zdaniami co zrobić. */
  app.get("/api/health", async () => {
    const worker = stanWorkera();
    const problemy = [worker.problem].filter((x): x is string => x !== null);
    return {
      ok: problemy.length === 0,
      mode: config.sgtMode,
      sferaMode: config.sferaMode,
      // skąd wzięła się konfiguracja — pierwsze pytanie przy „u mnie nie działa"
      configZPliku: envFile.path,
      worker: {
        zyje: worker.zyje,
        mode: worker.sgtMode,
        widziany: worker.widziany,
      },
      // flagi faktur: „off" gdy nie ma dokąd ich wysłać (edu nie ma flag
      // dokumentów, na produkcji para grupa/typ bywa jeszcze nieustalona).
      // Bez tego pola cisza po stronie flag byłaby nie do odróżnienia od awarii.
      docFlag: docFlagAvailable() ? "on" : "off (brak MSSQL_FLAG_GRUPA / MSSQL_FLAG_TYP_OBIEKTU)",
      ...(config.sgtMode === "mssql" ? { lastSync: lastImport } : {}),
      ...(problemy.length ? { problemy } : {}),
    };
  });

  // wymuszenie odświeżenia read-modelu (mssql): np. po przyjęciu dostawy w Subiekcie
  app.post("/api/admin/resync", async (_req, reply) => {
    if (config.sgtMode !== "mssql") {
      return reply.code(400).send({ error: "resync dostępny tylko w SGT_MODE=mssql" });
    }
    const stats = await importFromMssql();
    return { ok: true, stats };
  });

  await app.register(productRoutes);
  await app.register(queueRoutes);
  await app.register(putawayRoutes);
  await app.register(deliveryRoutes);
  await app.register(problemRoutes);
  await app.register(locationRoutes);
  await app.register(deviceRoutes);
  await app.register(authRoutes);

  await app.ready();
  return app;
}

async function main() {
  db(); // migracja schematu przy starcie
  zamelduj("api");

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

  const app = await buildApp();
  await app.listen({ port: config.port, host: config.host });
  console.log(`[api] WERTIS serwer na http://${config.host}:${config.port} · SGT_MODE=${config.sgtMode}`);
}

/* Import z testu nie może uruchomić serwera. `import.meta.main` jest w Node
   dopiero od 24, a repo celuje w 22.5, więc porównujemy ścieżkę wprost. */
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
