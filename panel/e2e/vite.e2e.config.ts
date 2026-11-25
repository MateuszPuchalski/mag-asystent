import { mergeConfig, type UserConfig } from "vite";
import podstawa from "../vite.config.ts";

/* Panel przebiegu przeglądarkowego: ten sam build co `npm run dev`, inny port
   i inny serwer API za pośrednikiem.

   Osobny plik, a nie zmienna w `vite.config.ts`. Tamten buduje też wydanie,
   więc przełącznik dla testów stałby w konfiguracji produkcyjnej. Tu dziedziczy
   się ją w całości i podmienia wyłącznie dwie rzeczy, których test potrzebuje.

   Bez `E2E_API` pośrednik wskazuje port, na którym nic nie słucha. Tak chodzi
   test dymny: sprawdza sam panel, a jego założeniem jest brak serwera API. */
const port = Number(process.env.E2E_PORT);
const api = process.env.E2E_API || "http://127.0.0.1:9";

export default mergeConfig(podstawa as UserConfig, {
  /* Własna pamięć zależności na każdy port. Dwa serwery Vite startują w jednym
     przebiegu, a wspólny katalog przepisywałyby sobie nawzajem w trakcie
     pierwszego uruchomienia. */
  cacheDir: `node_modules/.vite-e2e-${port}`,
  server: { host: "127.0.0.1", port, strictPort: true, proxy: { "/api": api } },
});
