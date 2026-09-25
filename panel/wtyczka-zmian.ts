import fs from "node:fs";
import path from "node:path";
import type { Plugin } from "vite";
import { najnowszeZmiany } from "./src/coNowego/zmiany";

/* ── Moduł `virtual:wertis-zmiany` (@wydanie) ────────────────────────────────
   Nagłówki trzech ostatnich wydań `minor` i numer wersji panelu, wyliczone
   przy budowaniu z `CHANGELOG.md` i `package.json` w korzeniu repo. Powód,
   dla którego wyciąg, a nie cały plik: `src/coNowego/zmiany.ts`.

   Wspólna dla `vite.config.ts` i `vitest.config.ts`: test, który renderuje
   ramę panelu, musi rozwiązać ten sam import co budowanie. */
const ID = "virtual:wertis-zmiany";

export function wtyczkaZmian(korzen: string): Plugin {
  return {
    name: "wertis-zmiany",
    resolveId: (id) => (id === ID ? `\0${ID}` : null),
    load(id) {
      if (id !== `\0${ID}`) return null;
      const wersja = JSON.parse(fs.readFileSync(path.join(korzen, "package.json"), "utf8")).version as string;
      /* Brak pliku nie wywraca budowania — pasek po prostu się nie pokaże. */
      const md = fs.existsSync(path.join(korzen, "CHANGELOG.md"))
        ? fs.readFileSync(path.join(korzen, "CHANGELOG.md"), "utf8") : "";
      return `export default ${JSON.stringify({ wersja, zmiany: najnowszeZmiany(md, 3) })};`;
    },
  };
}
