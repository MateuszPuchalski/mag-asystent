import fs from "node:fs";
import path from "node:path";
import { config } from "../config.js";

/**
 * Magazyn zdjęć dowodowych z kolektora — jeden katalog, jedna droga zapisu.
 *
 * DLACZEGO OSOBNY MODUŁ. Odbiorców jest dwóch: niezgodność w dostawie
 * i zadanie terenowe (projekt panelu §13.3, „robi zdjęcie"). Druga kopia
 * `photoDir()` rozjeżdżałaby katalog po pierwszej literówce.
 *
 * KATALOG JEST INNY NIŻ `zdjecia.ts`. Tam są zdjęcia kartotek pobrane
 * z Subiekta — cudze, odtwarzalne, kasowalne. Tu są zdjęcia ZROBIONE przez
 * człowieka na hali: dowód do reklamacji i odpowiedź dla biura. Skasowane nie
 * wracają znikąd.
 */

let katalogGotowy = false;

/** `data/photos` obok pliku bazy — ścieżka, pod którą leżą już zdjęcia. */
export function katalogZdjec(): string {
  const dir = path.resolve(path.dirname(config.dbPath), "photos");
  if (!katalogGotowy) {
    fs.mkdirSync(dir, { recursive: true });
    katalogGotowy = true;
  }
  return dir;
}

/**
 * Zapis zdjęcia (base64 z aparatu kolektora); zwraca nazwę pliku.
 *
 * Nazwa niesie ROZMIAR w kilobajtach i to nie jest ozdoba: przy pełnym dysku
 * `ls` w tym katalogu od razu mówi, które zdjęcia są winne, bez otwierania
 * ani jednego pliku.
 */
export function zapiszZdjecie(base64: string, prefiks = "p"): string {
  const czysty = base64.replace(/^data:image\/\w+;base64,/, "");
  const buf = Buffer.from(czysty, "base64");
  if (!buf.length) throw new Error("Zdjęcie jest puste");
  const name = `${prefiks}${Date.now()}-${Math.round(buf.length / 1024)}kb.jpg`;
  fs.writeFileSync(path.join(katalogZdjec(), name), buf);
  return name;
}

/** Ścieżka pliku albo `null`, gdy zdjęcia nie ma na dysku. */
export function sciezkaZdjecia(ref: string): string | null {
  /* `basename` obowiązkowo: `ref` pochodzi z bazy, ale baza nie jest
     gwarancją — jedno `../../etc` w kolumnie wystarczyłoby, żeby trasa
     serwowała cudzy plik. */
  const bezpieczna = path.basename(ref);
  const p = path.join(katalogZdjec(), bezpieczna);
  return fs.existsSync(p) ? p : null;
}
