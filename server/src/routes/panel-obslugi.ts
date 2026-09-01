import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { FastifyInstance, FastifyReply } from "fastify";

const tutaj = path.dirname(fileURLToPath(import.meta.url));

function katalog() {
  const kandydaci = [
    path.join(tutaj, "../web/obsluga"),
    path.join(tutaj, "../../../panel/dist"),
    path.join(process.cwd(), "../panel/dist"),
    path.join(process.cwd(), "panel/dist"),
  ];
  return kandydaci.find((p) => fs.existsSync(path.join(p, "index.html"))) ?? null;
}

const MIME: Record<string, string> = {
  ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon",
};

/** Osobny frontend ma własny build, ale nadal serwuje go ten sam proces i origin. */
export async function panelObslugiRoutes(app: FastifyInstance) {
  const dir = katalog();

  const strona = (reply: FastifyReply) => {
    if (!dir) {
      return reply.code(503).type("text/plain; charset=utf-8")
        .send("Panel nie został zbudowany — uruchom npm run build");
    }
    return reply.type("text/html; charset=utf-8").send(fs.readFileSync(path.join(dir, "index.html")));
  };

  app.get("/obsluga", async (_req, reply) => reply.redirect("/obsluga/"));

  /* Zasoby PRZED gwiazdką: trasa statyczna wygrywa z wieloznacznikiem, ale
     kolejność zapisu mówi czytelnikowi, że tak ma być. Nazwa pliku przechodzi
     przez białą listę, żeby `..` nie wyszło poza katalog builda. */
  app.get<{ Params: { file: string } }>("/obsluga/assets/:file", async (req, reply) => {
    if (!dir || !/^[-.\w]+$/.test(req.params.file)) return reply.code(404).send();
    const file = path.join(dir, "assets", req.params.file);
    if (!fs.existsSync(file)) return reply.code(404).send();
    return reply.type(MIME[path.extname(file)] ?? "application/octet-stream")
      .header("cache-control", "public,max-age=31536000,immutable")
      .send(fs.readFileSync(file));
  });

  /* Trasy ekranów obsługuje przeglądarka, ale wejście z paska adresu
     i odświeżenie idą do serwera. Do 0.146.0 stały tu dwie ścieżki wypisane
     z ręki — i każdy nowy ekran panelu dawał 404 po odświeżeniu, dopóki ktoś
     nie dopisał go TUTAJ. Rozmowa ma własny adres (`/obsluga/skrzynka/4821`),
     więc lista ścieżek rosłaby bez końca. */
  app.get("/obsluga/*", async (_req, reply) => strona(reply));
  app.get("/obsluga/", async (_req, reply) => strona(reply));
}
