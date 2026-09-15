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

/**
 * Wersja ZBUDOWANEGO panelu — `null`, gdy panelu nie ma albo nie ma pieczątki.
 *
 * ── NAJCICHSZA POMYŁKA WDROŻENIA (audyt, 15 września 2026) ────────────────
 * `npm run build` w `server/` nie przebudowuje panelu — robi to dopiero
 * polecenie z KORZENIA repo. Kto pomyli katalog, dostaje API z nowego kodu
 * i ekran obsługi ze starego builda. `/api/health` melduje wtedy nową wersję
 * i wszystko wygląda na wdrożone, a poprawki po prostu nie ma na ekranie.
 *
 * Siedemnaście wydań panelu zeszło z tej gałęzi bez ani jednego potwierdzenia,
 * że dotarły na wdrożony ekran. Recepta na dwa polecenia istniała i nie
 * została uruchomiona ani razu — więc recepta była złym rozwiązaniem.
 *
 * `null` MILCZY, i to jest ważne: w środowisku deweloperskim panelu nie ma
 * wcale, a zdanie o tym robiłoby każdy `npm run dev` czerwonym.
 */
export function wersjaPaneluObslugi(): string | null {
  const dir = katalog();
  if (!dir) return null;
  try {
    return wersjaZHtml(fs.readFileSync(path.join(dir, "index.html"), "utf8"));
  } catch {
    return null;
  }
}

/**
 * Sama pieczątka z HTML-a — osobno od czytania pliku, żeby dało się to
 * przetestować BEZ zbudowanego panelu.
 *
 * W CI `npm test` biegnie przed `npm run build`, więc test sięgający po
 * prawdziwy katalog zachowywałby się inaczej u programisty (panel zbudowany)
 * niż na maszynie (panelu nie ma). Taki test nie pilnuje niczego.
 */
export function wersjaZHtml(html: string): string | null {
  return /<meta name="wertis-panel" content="([^"]+)"/.exec(html)?.[1] ?? null;
}

/**
 * Zdanie na listę problemów zdrowia, gdy panel został na starszym buildzie.
 *
 * MÓWI, CO ZROBIĆ, nie że „jest rozjazd" — przyczyna jest zawsze ta sama
 * i zawsze ta sama jest naprawa.
 */
export function problemPaneluObslugi(wersjaSerwera: string): string | null {
  return problemZWersji(wersjaPaneluObslugi(), wersjaSerwera);
}

/** Reguła bez wejścia na dysk — patrz `wersjaZHtml`. */
export function problemZWersji(panel: string | null, serwer: string): string | null {
  /* Brak panelu albo brak pieczątki to nie rozjazd. Pieczątki nie ma
     w buildach sprzed tego wydania, a instalacja bez panelu jest normą na
     etapie, na którym biuro jeszcze go nie używa. Milczenie jest tu wyborem:
     zdanie w obu tych przypadkach robiłoby czerwonym każdy `npm run dev`
     i każdą starą instalację, czyli uczyłoby ignorować listę problemów. */
  if (panel === null || panel === serwer) return null;
  return `Panel obsługi został na wersji ${panel}, a serwer ma ${serwer}. `
    + "Przebuduj panel: `npm run build` w KORZENIU repo, nie w `server/`.";
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
