/* ── Serwer API dla przebiegu przeglądarkowego ───────────────────────────────
   Uruchamiany przez `webServer` z `playwright.config.ts`. Trzy kroki: świeży
   katalog tymczasowy, baza zasiana od zera, serwer na własnym porcie.

   ŚWIEŻA BAZA PRZY KAŻDYM PRZEBIEGU, bo drogi, dla których te testy powstały,
   są nieodwracalne: odpowiedź wysłana, pieniądze oddane, werdykt wydany.
   Drugi przebieg na bazie po pierwszym zastałby sprawy już załatwione
   i padał bez żadnej zmiany w kodzie.

   NIGDY `server/data/wertis.db`. To baza czyjejś pracy z `npm run dev`,
   a `DB_PATH` niżej jest jedynym, co ją od tego przebiegu oddziela. Skrypt
   odmawia startu, gdyby katalog przebiegu wypadł w repozytorium.

   Kolejność z Playwrighta: `webServer` rusza PRZED `globalSetup`. Zasianie
   bazy musi więc stać tutaj, bo serwer migruje bazę przy starcie i zakłada
   konto demo w pustej. */
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const tutaj = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(tutaj, "../..");
const serwer = path.join(repo, "server");

/* Te same wartości co w `srodowisko.ts`. Powtórzone, bo ten plik rusza gołym
   Node'em, bez kompilacji TypeScriptu, a wspólne źródło wymagałoby jej tylko
   dla dwóch liczb. Rozjazd wychodzi od razu: Playwright czeka na serwer pod
   adresem z tamtego pliku. */
const PORT_API = 3187;
const katalog = path.join(os.tmpdir(), `wertis-e2e-${PORT_API}`);

if (!path.relative(repo, katalog).startsWith("..")) {
  console.error(`[e2e] katalog przebiegu ${katalog} leży w repozytorium — odmawiam startu`);
  process.exit(1);
}
fs.rmSync(katalog, { recursive: true, force: true });
fs.mkdirSync(katalog, { recursive: true });

const plikEnv = path.join(katalog, "puste.env");
fs.writeFileSync(plikEnv, "");

/* ── Środowisko budowane OD ZERA, nie odziedziczone ──────────────────────────
   Serwer bierze z otoczenia wszystko: klucz dostawcy modelu, konto Allegro,
   hasło do bazy Subiekta. Powłoka programisty miewa je ustawione, a lista
   „czego nie przepuszczać" starzeje się przy każdym nowym kluczu. Lista
   „co przepuszczamy" jest krótka i nie rośnie razem z serwerem.

   Zmienne pośrednika sieci zostają za drzwiami celowo: proces, który by z nich
   skorzystał, łączyłby się z pośrednikiem na własnej maszynie i mur
   z `bez-sieci.cjs` uznałby to za ruch lokalny. */
const zOtoczenia = ["PATH", "HOME", "TMPDIR", "TEMP", "TMP", "LANG", "SystemRoot", "PATHEXT", "ComSpec"];
const env = Object.fromEntries(zOtoczenia.filter((k) => process.env[k]).map((k) => [k, process.env[k]]));
Object.assign(env, {
  DB_PATH: path.join(katalog, "wertis.db"),
  PORT: String(PORT_API),
  HOST: "127.0.0.1",
  SGT_MODE: "seeded",
  /* Serwer szuka `wertis.env` w katalogu roboczym i wyżej. Jawna ścieżka do
     pustego pliku zamyka tę drogę: plik z prawdziwej instalacji, leżący
     piętro nad repozytorium, przestawiłby przebieg na konto firmy. */
  WERTIS_ENV_FILE: plikEnv,
  ALLEGRO_MODE: "dev",
  COPILOT_MODE: "off",
  AKTUALIZACJA_AUTO: "wylaczona",
  E2E_DZIENNIK_ODMOW: path.join(katalog, "odmowy-sieci.log"),
});

const mur = path.join(tutaj, "bez-sieci.cjs");
const node = (plik) => [process.execPath, ["--require", mur, "--import", "tsx", plik]];

/* Seed kartoteki, potem scenariusze: drugi dopisuje się do pierwszego,
   a pierwszy czyści tabele, na których drugi stoi (`docs/scenariusze-testowe.md`). */
for (const plik of ["src/db/seed.ts", "src/db/seed-scenariusze.ts"]) {
  const [program, argumenty] = node(plik);
  const w = spawnSync(program, argumenty, { cwd: serwer, env, encoding: "utf8" });
  if (w.status !== 0) {
    console.error(`[e2e] ${plik} nie przeszedł:\n${w.stdout}\n${w.stderr}`);
    process.exit(1);
  }
}

const [program, argumenty] = node("src/index.ts");
const api = spawn(program, argumenty, { cwd: serwer, env, stdio: "inherit" });

/* Sprzątanie przy zamknięciu. Baza niesie wyłącznie dane z seeda, więc nie
   chodzi o tajemnicę, tylko o to, żeby katalog tymczasowy nie rósł o trzy
   megabajty z każdym przebiegiem przerwanym w połowie. */
let koniec = false;
function zakoncz(kod) {
  if (koniec) return;
  koniec = true;
  api.kill("SIGTERM");
  fs.rmSync(katalog, { recursive: true, force: true });
  process.exit(kod);
}
process.on("SIGTERM", () => zakoncz(0));
process.on("SIGINT", () => zakoncz(0));
api.on("exit", (kod) => {
  if (koniec) return;
  console.error(`[e2e] serwer API zakończył się sam, kod ${kod}`);
  zakoncz(kod ?? 1);
});
