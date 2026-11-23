import fs from "node:fs";
import { createHash } from "node:crypto";
import { bezMigracji, db } from "./db/db.js";
import { config } from "./config.js";
import { subiekt } from "./context.js";
import { INSTRUKCJA_SZKICU, nadawcaSzkicuZ, PROMPT_SZKICU } from "./adapters/copilot.anthropic.js";
import { zestawNarzedzi } from "./services/copilot-narzedzia.js";
import {
  paryZestawu, przebiegZestawu, raportZestawu, sprawyZestawu, wycenaZestawu,
} from "./services/copilot-zestaw.js";

/* ── Zestaw testowy Copilota: polecenie ──────────────────────────────────────
   Puszcza zapisane wejścia szkiców jeszcze raz i porównuje wynik ze szkicem
   biura. Reguły pomiaru stoją w `services/copilot-zestaw.ts`.

   BEZ `--pusc` NIE WYDAJE ANI GROSZA. Samo polecenie pokazuje, ile spraw
   czeka i ile mniej więcej będzie kosztować powtórka. Wywołania modelu idą
   dopiero z `--pusc`, bo pomyłka w wierszu poleceń nie ma kosztować pieniędzy.

   URUCHAMIA SIĘ RĘCZNIE, NA SERWERZE Z BAZĄ. Taktu ani trasy nie ma: zestaw
   wydaje pieniądze i czyta treść rozmów, więc ma go puszczać człowiek, który
   wie, po co.

   ALLEGRO NIE PYTAMY. Narzędzie ofert odpowiada tu wyłącznie z kopii w bazie.
   Drugi proces odświeżający token Allegro obok serwera unieważniłby token
   serwerowi, a skrzynka stanęłaby do ponownego połączenia konta.

   Uruchomienie w `server/`:
     npm run copilot:zestaw                               (wycena, nic nie wysyła)
     npm run copilot:zestaw -- --pusc                     (bieżący model i instrukcja)
     npm run copilot:zestaw -- --pusc --model claude-sonnet-5-5
     npm run copilot:zestaw -- --pusc --instrukcja nowa.txt --pary pary.md
   Dalsze: --limit 20 (ile spraw, od najnowszej), --od 2026-11-01,
   --raport plik.md (raport do pliku zamiast na ekran).

   Tekst do poprawiania daje `--pokaz-instrukcje > nowa.txt`: wypisuje bieżącą
   instrukcję szkicu i kończy, bez bazy i bez modelu.                        */

const arg = (nazwa: string): string | null => {
  const i = process.argv.indexOf(nazwa);
  if (i < 0) return null;
  const v = process.argv[i + 1];
  if (!v || v.startsWith("--")) {
    console.error(`${nazwa} wymaga wartości.`);
    process.exit(2);
  }
  return v;
};

const ZNANE = new Set([
  "--pusc", "--model", "--instrukcja", "--pary", "--raport", "--limit", "--od", "--pokaz-instrukcje",
]);
const nieznane = process.argv.slice(2).filter((a) => a.startsWith("--") && !ZNANE.has(a));
if (nieznane.length) {
  /* Literówka w `--pusc` dałaby cichą wycenę zamiast przebiegu, a w `--model`
     przebieg na modelu biura. Obie pomyłki wyglądają jak wynik. */
  console.error(`Nieznane opcje: ${nieznane.join(", ")}`);
  process.exit(2);
}

if (process.argv.includes("--pokaz-instrukcje")) {
  /* Przed otwarciem bazy: punkt wyjścia do poprawek ma dać się wziąć także
     tam, gdzie bazy nie ma. */
  console.log(INSTRUKCJA_SZKICU);
  process.exit(0);
}

const pusc = process.argv.includes("--pusc");
const model = arg("--model") ?? config.copilot.model;
const plikInstrukcji = arg("--instrukcja");
const plikPar = arg("--pary");
const plikRaportu = arg("--raport");
const od = arg("--od");
const limit = Math.min(200, Math.max(1, Number(arg("--limit") ?? 20) || 20));

if (od && !/^\d{4}-\d{2}-\d{2}/.test(od)) {
  console.error("--od oczekuje daty, np. 2026-11-01.");
  process.exit(2);
}

const instrukcja = plikInstrukcji ? fs.readFileSync(plikInstrukcji, "utf8").trim() : undefined;
/* Etykieta własnej instrukcji to skrót jej tekstu. Dwa przebiegi tego samego
   pliku liczą się w księdze razem, a poprawiony plik dostaje nową etykietę. */
const wersja = instrukcja === undefined ? PROMPT_SZKICU
  : `plik:${createHash("sha256").update(instrukcja).digest("hex").slice(0, 8)}`;

/* Schemat zakłada wyłącznie serwer API, a to polecenie chodzi obok niego. */
bezMigracji();

async function main(): Promise<void> {
  const sprawy = sprawyZestawu(db(), { od, limit });
  const w = wycenaZestawu(sprawy, model);
  console.error(`Spraw do powtórki: ${w.spraw}. Pominiętych, bo mają zdjęcia: ${w.pominietych}.`);
  console.error(`Model: ${model}. Instrukcja: ${wersja}.`);
  console.error(`Szacunek kosztu: ${w.usd.toFixed(4)} USD`
    + (w.bezRachunku ? ` (bez ${w.bezRachunku} spraw, których szkic biura nie ma rachunku)` : "")
    + ". Liczony z tokenów szkiców biura, więc zgrubny.");
  if (w.spraw === 0) {
    console.error("Nie ma czego puszczać. Zapis wejść włącza COPILOT_ZAPIS_WEJSCIA, a trzyma je 90 dni.");
    return;
  }
  if (!pusc) {
    console.error("To była wycena. Dodaj --pusc, żeby puścić sprawy przez model.");
    return;
  }
  if (config.copilot.mode !== "anthropic" || !config.copilot.klucz) {
    console.error("Copilot jest wyłączony albo nie ma klucza (COPILOT_MODE, ANTHROPIC_API_KEY).");
    process.exitCode = 1;
    return;
  }

  const przebieg = await przebiegZestawu(db(), sprawy, {
    nadaj: nadawcaSzkicuZ({
      model, instrukcja, wersja: instrukcja === undefined ? undefined : wersja,
    }),
    model,
    zNarzedziami: config.copilot.szkicNarzedzia,
    narzedziaNaZywo: zestawNarzedzi(subiekt, db(), { ofertyPoSygnaturze: async () => new Map() }),
    postep: (zrobione, wszystkich) => console.error(`  ${zrobione}/${wszystkich}`),
  });

  const raport = raportZestawu(przebieg, { model, wersja, od });
  if (plikRaportu) {
    fs.writeFileSync(plikRaportu, raport);
    console.error(`Raport: ${plikRaportu}`);
  } else {
    console.log(raport);
  }
  if (plikPar) {
    fs.writeFileSync(plikPar, paryZestawu(przebieg));
    console.error(`Pary szkiców: ${plikPar}. To treść rozmów — skasuj plik po przeczytaniu.`);
  }
  if (przebieg.przerwano) process.exitCode = 1;
}

main().catch((e) => {
  /* Sam komunikat: stos i obiekt błędu dostawcy bywają długie i nic nie
     mówią człowiekowi przy konsoli. */
  console.error(`Zestaw się wywrócił: ${e instanceof Error ? e.message : String(e)}`);
  process.exitCode = 1;
});
