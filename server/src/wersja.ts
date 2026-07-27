import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Wersja serwera — czytana z `server/package.json`, nie wpisana w kod.
 *
 * Numer stoi w `package.json` korzenia repo i z niego biorą go wszyscy:
 * serwer tutaj, APK w `android/app/build.gradle.kts`. Wpisanie go w kod
 * dołożyłoby trzecie miejsce do pamiętania — a dokładnie tak `0.3.0`
 * przetrwało sześć zmergowanych zmian.
 *
 * Ścieżka `../package.json` działa w obu układach: `src/` w dev i `dist/`
 * po zbudowaniu — oba leżą jeden poziom pod `server/`.
 */
export const WERSJA: string = (() => {
  try {
    const p = path.resolve(__dirname, "../package.json");
    const pkg = JSON.parse(fs.readFileSync(p, "utf8")) as { version?: string };
    return pkg.version ?? "nieznana";
  } catch {
    // Brak pliku nie może wywrócić startu serwera — to informacja
    // diagnostyczna, nie warunek działania.
    return "nieznana";
  }
})();
