/* ── Serwer API dla przebiegu przeglądarkowego ───────────────────────────────
   Uruchamiany przez `webServer` z `playwright.config.ts`. Kroki po kolei:
   świeży katalog tymczasowy, baza zasiana od zera, token Allegro, udawane
   Allegro na własnym porcie i dopiero wtedy serwer.

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
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { uruchomUdawaneAllegro } from "./udawane-allegro.mjs";

const tutaj = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(tutaj, "../..");
const serwer = path.join(repo, "server");

/* Te same wartości co w `srodowisko.ts`. Powtórzone, bo ten plik rusza gołym
   Node'em, bez kompilacji TypeScriptu, a wspólne źródło wymagałoby jej tylko
   dla dwóch liczb. Rozjazd wychodzi od razu: Playwright czeka na serwer pod
   adresem z tamtego pliku. */
const PORT_API = 3187;
const PORT_ALLEGRO = 3188;
const ALLEGRO = `http://127.0.0.1:${PORT_ALLEGRO}`;
const TOKEN_ALLEGRO = "token-e2e";
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
  /* ── Allegro: tryb dev, a za nim udawany serwer na własnej maszynie ────────
     Tryb `dev` zostaje, bo w nim nie startuje żaden takt odpytujący Allegro:
     przebieg ma wysyłać wyłącznie to, co wywołał test. Wysyłka, wypłata
     i werdykt trybu nie pytają, potrzebują tylko tokena i adresu. Adres
     wskazuje `udawane-allegro.mjs`, więc prawdziwy klient HTTP idzie swoją
     drogą, a mur z `bez-sieci.cjs` przepuszcza go jak każdy ruch lokalny. */
  ALLEGRO_MODE: "dev",
  /* To samo konto kanału, na którym seed postawił sprawy
     (`KONTO_KANALU_SCENARIUSZY`). Inna wartość kazałaby synchronizacji
     skrzynki założyć drugie konto i dopisek klienta trafiłby do nowej
     rozmowy zamiast do tej, którą test ma otwartą. */
  ALLEGRO_CLIENT_ID: "scenariusze",
  ALLEGRO_CLIENT_SECRET: "nie-jest-sekretem",
  ALLEGRO_API_URL: ALLEGRO,
  ALLEGRO_AUTH_URL: `${ALLEGRO}/auth/oauth`,
  /* Lista wątków w `public.v1`: w tym kształcie seed zasiał lądowisko
     i tylko taki umie oddać udawany serwer. */
  ALLEGRO_WATKI_BETA: "0",
  /* Zero wyłącza odstęp między ręcznymi synchronizacjami skrzynki. Test
     konfliktu świeżości woła ją sam, a druga w tej samej minucie dostałaby
     odmowę serwera zamiast dopisku klienta. */
  ALLEGRO_INBOX_SYNC_MS: "0",
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

/* ── Co zasiał seed: z tego udawane Allegro składa swoje odpowiedzi ─────────
   Lądowiska trzymają wątki, wiadomości i sprawę w kształcie Allegro. Czytane
   stąd, a nie przepisane do testu, zostają zgodne z seedem bez pilnowania:
   odświeżenie reklamacji NADPISUJE wiersz odpowiedzią, więc ładunek uboższy
   od zasianego wyzerowałby sprawę, którą test ma właśnie otwartą. */
const baza = new DatabaseSync(env.DB_PATH);
const ladunki = (sql) => baza.prepare(sql).all().map((w) => JSON.parse(w.surowe_json));
const watki = ladunki("SELECT surowe_json FROM allegro_inbox_thread");
const wiadomosci = {};
for (const w of ladunki("SELECT surowe_json FROM allegro_inbox_message ORDER BY created_at DESC")) {
  (wiadomosci[w.thread.id] ??= []).push(w);
}
const sprawy = ladunki("SELECT surowe_json FROM allegro_reklamacja");
if (watki.length === 0 || sprawy.length === 0) {
  console.error("[e2e] seed scenariuszy nie zostawił rozmów albo reklamacji — nie ma czego testować");
  process.exit(1);
}

/* TOKEN DOPIERO PO OBU SEEDACH. Seed scenariuszy nie buduje spraw obsługi
   klienta na bazie ze sparowanym kontem (`kontoAllegroSparowane`), bo na
   prawdziwej instalacji takty pytałyby Allegro o zmyślone numery. Token
   wstawiony wcześniej dałby więc puste kolejki. `srodowisko` musi brzmieć
   `prod`: klient odrzuca token z innego środowiska niż skonfigurowane. */
baza.prepare(`INSERT INTO allegro_token(id, access_token, refresh_token, wygasa_at, scope,
  srodowisko, polaczono_at, polaczono_przez) VALUES (1, ?, 'odswiezanie-e2e',
  '2099-01-01T00:00:00.000Z', NULL, 'prod', ?, 'e2e')`).run(TOKEN_ALLEGRO, new Date().toISOString());
baza.close();

const allegro = await uruchomUdawaneAllegro({
  port: PORT_ALLEGRO, token: TOKEN_ALLEGRO, watki, wiadomosci, sprawy,
});

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
  allegro.close();
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
