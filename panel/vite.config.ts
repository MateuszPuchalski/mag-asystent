import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  base: "/obsluga/",
  server: {
    port: 5174,
    /* `strictPort`, bo test dymny Playwrighta czeka pod konkretnym adresem.
       Bez tego Vite po cichu bierze 5175 i test wisi do timeoutu. */
    strictPort: true,
    proxy: { "/api": "http://localhost:3001" },
  },
});
