import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

/* Testy frontu do 0.146.0 nie istniały wcale — `docs/obsluga-klienta.md` §7
   wymienia je wprost jako to, co kupujemy za ośmiu zależności. Środowisko to
   jsdom: sprawdzamy, co widzi agent, a nie co zwraca funkcja. */
export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    /* Katalog `e2e/` należy do Playwrighta. Bez wykluczenia Vitest próbowałby
       uruchomić jego testy i wywracał się na braku przeglądarki. */
    exclude: ["node_modules/**", "dist/**", "e2e/**"],
  },
});
