import { defineConfig } from "@playwright/test";
import { PORT_DYMU, PORT_PANELU, URL_API, URL_DYMU, URL_PANELU } from "./e2e/srodowisko";

/* DWA PROJEKTY, bo sprawdzają dwie różne rzeczy i mają sprzeczne założenia.

   `dym` stoi na SAMYM panelu, bez serwera API: sprawdza, że build się
   uruchamia, że niezalogowany trafia na logowanie i że rama trzyma okno.
   Jego test ramy wkłada do przeglądarki zmyślony token, więc z prawdziwym
   serwerem za plecami zostałby wylogowany, zanim rama się narysuje.

   `pelny` idzie przez prawdziwy ekran do prawdziwego serwera na własnej,
   świeżo zasianej bazie (`e2e/serwer-api.mjs`). Powód: każde zielone
   scalenie samo trafia do magazynu, a jsdom nie przechodzi drogi od
   logowania przez kolejkę do zapisu na serwerze.

   Każdy projekt ma własny panel na własnym porcie, a żaden nie pożycza
   serwera, który już chodzi (`reuseExistingServer: false`). Pożyczony
   `npm run dev` wskazuje bazę czyjejś pracy.

   `PLAYWRIGHT_CHROMIUM` wskazuje gotową przeglądarkę, gdy stoi w systemie
   pod inną wersją niż ta, której żąda `@playwright/test`. Bez tego jedyną
   drogą jest `npx playwright install`, czyli kilkaset megabajtów pobierania
   przy każdym świeżym klonie. */
const przegladarka = process.env.PLAYWRIGHT_CHROMIUM;

const panel = (port: number, adres: string, api?: string) => ({
  command: "npx vite --config e2e/vite.e2e.config.ts",
  env: { E2E_PORT: String(port), ...(api ? { E2E_API: api } : {}) },
  url: `${adres}/obsluga/`,
  reuseExistingServer: false,
  timeout: 60_000,
});

export default defineConfig({
  testDir: "./e2e",
  /* JEDEN PROCES TESTÓW. Projekt `pelny` dzieli jedną bazę, a jego drogi ją
     zmieniają: dwa testy naraz na tej samej sprawie dałyby konflikt wersji,
     którego w kodzie nie ma. Kolejność plików jest wtedy alfabetyczna
     i stała, więc wynik nie zależy od liczby rdzeni maszyny. */
  workers: 1,
  fullyParallel: false,
  /* `test.only` zostawione w pliku wyciąłby na CI całą resztę przy zielonym
     wyniku. Lokalnie zostaje narzędziem pracy. */
  forbidOnly: Boolean(process.env.CI),
  /* Po ostatnim teście, a przed zamknięciem serwera: dziennik odmów sieci
     leży w katalogu, który serwer sprząta przy wyjściu. */
  globalTeardown: "./e2e/straz-sieci.ts",
  use: {
    ...(przegladarka ? { launchOptions: { executablePath: przegladarka } } : {}),
  },
  projects: [
    { name: "dym", testMatch: "dym.spec.ts", use: { baseURL: URL_DYMU } },
    { name: "pelny", testIgnore: "dym.spec.ts", use: { baseURL: URL_PANELU } },
  ],
  webServer: [
    {
      command: "node e2e/serwer-api.mjs",
      url: `${URL_API}/api/health`,
      reuseExistingServer: false,
      timeout: 60_000,
      /* Sygnał zamiast zabicia: skrypt sprząta po sobie katalog z bazą. */
      gracefulShutdown: { signal: "SIGTERM", timeout: 5_000 },
    },
    panel(PORT_DYMU, URL_DYMU),
    panel(PORT_PANELU, URL_PANELU, URL_API),
  ],
});
