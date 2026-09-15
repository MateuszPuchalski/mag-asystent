import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/* ── Każde narzędzie konsoli ma swój skrypt w `package.json` (0.342.1) ───────
   Blizna z 15 września. `zwroty:sprzatnij` doszedł w 0.340.0 razem z całym
   narzędziem i został scalony — a potem ZNIKŁ przy scalaniu równoległej
   gałęzi, która podbijała wersję w tym samym pliku. Kod narzędzia został na
   `main` w komplecie, więc żaden test ani bramka niczego nie zauważyły.
   Właściciel dowiedział się o tym dopiero z `npm error Missing script`.

   To jest dokładnie ten rodzaj straty, przed którym reszta tego repo się
   broni: cicha, w pliku, którego nikt nie czyta w całości, przy operacji
   wykonywanej kilka razy dziennie przez kilka sesji naraz.

   Reguła: plik `src/*-run.ts` JEST narzędziem konsoli — nie ma innego powodu,
   żeby istniał — więc musi dać się uruchomić przez `npm run`. Test nie pyta
   o nazwę skryptu, tylko o to, czy którykolwiek na ten plik wskazuje.      */

test("każde narzędzie `*-run.ts` da się uruchomić przez npm run", () => {
  const katalog = path.resolve(import.meta.dirname);
  const narzedzia = fs.readdirSync(katalog)
    .filter((f) => f.endsWith("-run.ts"))
    .sort();
  assert.ok(narzedzia.length > 0, "gdyby lista była pusta, test nie pilnowałby niczego");

  const pkg = JSON.parse(fs.readFileSync(
    path.resolve(katalog, "../package.json"), "utf8")) as { scripts: Record<string, string> };
  const polecenia = Object.values(pkg.scripts ?? {}).join("\n");

  const osierocone = narzedzia.filter((f) => !polecenia.includes(f));
  assert.deepEqual(osierocone, [],
    `narzędzie bez skryptu w package.json: ${osierocone.join(", ")}.\n` +
    "Plik `*-run.ts` istnieje po to, żeby go uruchomić z konsoli — bez wpisu " +
    "w `scripts` jest martwym kodem, a człowiek dostaje „Missing script”.");
});
