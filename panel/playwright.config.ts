import { defineConfig } from "@playwright/test";

/* Test dymny stoi na SAMYM panelu, bez serwera API: sprawdza, że build się
   uruchamia i że niezalogowany trafia na logowanie, a nie na pusty ekran.
   Pełny przebieg z §23.3 — pytanie, pomiar, konflikt świeżości, wysyłka —
   wchodzi razem z wysyłką, bo dopiero wtedy jest co przechodzić.

   `PLAYWRIGHT_CHROMIUM` wskazuje gotową przeglądarkę, gdy stoi w systemie
   pod inną wersją niż ta, której żąda `@playwright/test`. Bez tego jedyną
   drogą jest `npx playwright install`, czyli kilkaset megabajtów pobierania
   przy każdym świeżym klonie. */
const przegladarka = process.env.PLAYWRIGHT_CHROMIUM;

export default defineConfig({
  testDir: "./e2e",
  use: {
    baseURL: "http://127.0.0.1:5174",
    ...(przegladarka ? { launchOptions: { executablePath: przegladarka } } : {}),
  },
  webServer: {
    command: "npm run dev",
    url: "http://127.0.0.1:5174/obsluga/",
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
