import { config } from "../config.js";
import { db } from "../db/db.js";
import { logEvent } from "./events.js";
import {
  czytajStan,
  kopiaNocna,
  rekoncyliacjaDzisiaj,
  wOknieNocnym,
  zapiszRekoncyliacje,
} from "./kopie-bazy.js";
import { reconcile, zapiszRaportRekoncyliacji } from "./reconcile.js";

/* ── Przebieg nocny: kopia bazy i rekoncyliacja (0.487.0) ────────────────────
   Obie czynności były wpisami w Harmonogramie zadań, które człowiek miał
   założyć po instalacji. Instalator kończył prośbą, a bramka etapu 4
   wdrożenia (`docs/wdrozenie.md`) stała na obu. Serwer chodzi przez całą
   noc, więc robi je sam i żadna instalacja nie zostaje bez nich.

   Dawny argument za osobnym procesem rekoncyliacji brzmiał: „cron go
   pilnuje, a awaria nie dotyka serwera". Pilnowania nie było, bo wpisu
   nikt nie zakładał. Rekoncyliacja tylko CZYTA, a jej wyjątek łapie tu
   parasol, więc serwera nie położy.

   Kopia i rekoncyliacja mają OSOBNE znaczniki doby. Kopia, która padła
   (pełny dysk), nie może zabrać ze sobą rekoncyliacji, i odwrotnie.

   Takt co godzinę, a nie o stałej porze: `uruchomTakt` daje rozrzut, a okno
   nocne ma cztery godziny. Serwer wstający o 3:30 dostanie kopię tej samej
   nocy, zamiast czekać do jutra.                                           */

export const TAKT_NOCNY_MS = 60 * 60 * 1000;

export interface WynikNocy {
  kopia: string | null;
  rozjazdow: number | null;
}

export function przebiegNocny(teraz: string = new Date().toISOString()): WynikNocy {
  const wynik: WynikNocy = { kopia: null, rozjazdow: null };
  if (!wOknieNocnym(teraz)) return wynik;

  try {
    wynik.kopia = kopiaNocna(db(), config.kopie.katalog, teraz);
    if (wynik.kopia) {
      console.log(`[noc] kopia bazy: ${wynik.kopia}`);
      logEvent("kopia_bazy", "system", null, { plik: wynik.kopia, katalog: config.kopie.katalog });
    }
  } catch (e) {
    console.error(`[noc] kopia bazy NIE POWSTAŁA: ${e instanceof Error ? e.message : e}`);
  }

  if (!rekoncyliacjaDzisiaj(czytajStan(), teraz)) {
    try {
      const r = reconcile();
      const plik = zapiszRaportRekoncyliacji(r);
      zapiszRekoncyliacje(r.rozjazdy.length, plik, config.kopie.katalog, teraz);
      wynik.rozjazdow = r.rozjazdy.length;
      /* Wpis w dzienniku także przy zerze: „rekoncyliacja przeszła czysto"
         to odpowiedź, a nie jej brak. Jeden wiersz na dobę. */
      logEvent("rekoncyliacja", "system", null, { rozjazdow: r.rozjazdy.length, plik });
      if (plik) console.warn(`[noc] rekoncyliacja: ${r.rozjazdy.length} rozjazdów → ${plik}`);
    } catch (e) {
      console.error(`[noc] rekoncyliacja nieudana: ${e instanceof Error ? e.message : e}`);
    }
  }
  return wynik;
}
