import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { FastifyInstance } from "fastify";

/* ── Podgląd biura — jedna strona pod /biuro ─────────────────────────────────
   Wycięcie flagi faktury (0.16.0) zamknęło jedyny kanał, którym biuro widziało
   stan dostaw. CSV i REST istniały dalej, ale „wywołaj curlem z tokenem" nie
   jest interfejsem dla księgowości. Ta strona jest tym interfejsem: status
   rozkładania + gotowy do druku protokół rozbieżności ze zdjęciami dowodowymi.

   ŚWIADOMIE jeden plik HTML bez builda i bez frameworka. Poprzedni podgląd
   (/lookup) zniknął razem z całym klientem PWA, bo dwa fronty to dwa razy
   utrzymanie — więc nowy nie ma prawa być drugim frontem. Strona jest cienka:
   sam odczyt istniejących tras API, z tokenem sesji w nagłówku, tak samo jak
   kolektor. Zero własnych uprawnień, zero zapisu.

   Plik jest wczytywany RAZ, przy rejestracji tras — nie per żądanie. Zmiana
   strony wymaga restartu usługi, dokładnie jak zmiana kodu.                  */

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export async function biuroRoutes(app: FastifyInstance) {
  const html = fs.readFileSync(path.join(__dirname, "../web/biuro.html"), "utf8");

  app.get("/biuro", async (_req, reply) => reply.type("text/html; charset=utf-8").send(html));

  // korzeń przekierowuje do podglądu: adres `http://serwer:3001` w pasku
  // przeglądarki biura ma pokazać COŚ, a nie 404
  app.get("/", async (_req, reply) => reply.redirect("/biuro"));

  /* ── Pogrzeb starej PWA ────────────────────────────────────────────────────
     Aplikacja webowa („Kolektor magazynowy · prototyp v0.2") wyszła z repo
     w 0.3.0, ale była PWA: rejestrowała service workera z precache całej
     powłoki. Na maszynie, która ją kiedyś otworzyła, ten worker ŻYJE DALEJ
     i serwuje splash z cache — kasowanie kodu na serwerze niczego tam nie
     zmienia, bo żądanie nie dociera do serwera.

     Jedyne wyjście prowadzi przez ten sam adres, spod którego worker został
     zainstalowany: przeglądarka sama sprawdza `sw.js` przy wejściu na stronę,
     a skrypt bez rejestracji zdarzeń wymiata poprzednika. Ten kasuje cache,
     wyrejestrowuje się i przeładowuje otwarte karty — po czym `/` pokazuje
     to, co powinno, czyli podgląd biura.

     Trasa jest jednorazowym sprzątaniem, nie funkcją. Można ją usunąć, gdy
     żaden komputer w firmie nie będzie już miał starej PWA.                 */
  const pogrzeb = [
    "self.addEventListener('install', () => self.skipWaiting());",
    "self.addEventListener('activate', (e) => e.waitUntil((async () => {",
    "  for (const k of await caches.keys()) await caches.delete(k);",
    "  await self.registration.unregister();",
    "  for (const c of await self.clients.matchAll({ type: 'window' })) c.navigate(c.url);",
    "})()));",
  ].join("\n");

  app.get("/sw.js", async (_req, reply) =>
    reply
      .type("application/javascript; charset=utf-8")
      // bez tego przeglądarka mogłaby podać z cache STAREGO workera i pogrzeb
      // nigdy by się nie odbył
      .header("cache-control", "no-store")
      .send(pogrzeb)
  );
}
