import { config } from "../config.js";

/* ── Kody typów dokumentów a ich symbole ─────────────────────────────────────
   Subiekt trzyma typ dokumentu jako LICZBĘ (`dok_Typ`), read-model `sgt_*` — jako
   NAPIS (`FZ`, `PZ`). Tłumaczenie musi być w jednym miejscu, i to jest ten plik.

   Do 0.22.1 tłumaczenie stało w dwóch, każde z własnym błędem:

     importer  (`subiekt.mssql.ts`)  — `dok_Typ === FZ ? "FZ" : "PZ"`,
                                       czyli KAŻDY inny kod lądował w bazie jako
                                       „PZ" i pokazywał się magazynierowi pod
                                       cudzą nazwą;
     odczyt    (`subiekt.seeded.ts`) — kod spoza pary FZ/PZ wypadał z listy
                                       etykiet.

   Skutek dla wdrożenia był taki, że dopisanie trzeciego typu do
   `DOK_TYPY_DOSTAW` — czynność na jedno ustawienie — dawało dokumenty
   z FAŁSZYWYM symbolem na ekranie, bez jednego słowa błędu po drodze.

   Teraz kod bez nazwy dostaje symbol `TYP-<kod>`: widoczny, odróżnialny
   i nieudający niczego innego. Że nie umiemy go nazwać, mówi `/api/health`.  */

/** Kody, których symbol znamy z konfiguracji. */
function nazwane(): Map<number, string> {
  const { dokTypFZ, dokTypPZ, dokTypZD } = config.mssql;
  return new Map([
    [dokTypFZ, "FZ"],
    [dokTypPZ, "PZ"],
    [dokTypZD, "ZD"],
  ]);
}

/**
 * Symbol dokumentu dla kodu `dok_Typ`.
 *
 * Kod nienazwany zwraca `TYP-<kod>`, a nie symbol któregoś z sąsiadów. Zły
 * symbol jest gorszy niż brzydki: magazynier czyta go jako fakt o dokumencie,
 * a biuro szuka potem w Subiekcie czegoś, czego tam nie ma.
 */
export function symbolTypu(kod: number): string {
  return nazwane().get(kod) ?? `TYP-${kod}`;
}

/**
 * Symbole typów uznawanych za dostawę — do filtrów listy rozkładania.
 *
 * Kolejność i liczba idą ZA `DOK_TYPY_DOSTAW`: lista jest lustrem ustawienia,
 * a nie jego poprawioną wersją. Nienazwany kod zostaje na liście pod swoim
 * `TYP-<kod>`, bo cichy brak dokumentów jest trudniejszy do zdiagnozowania niż
 * dokument z dziwną nazwą.
 */
export function etykietyDostaw(): string[] {
  return config.mssql.dokTypyDostaw.map(symbolTypu);
}

/**
 * Kody dostaw, których nie umiemy nazwać — dla `/api/health`.
 *
 * `null`, gdy wszystko jest nazwane. Nie jest to błąd konfiguracji (system
 * pracuje), więc nie zatrzymuje startu — ale jest czymś, co ktoś powinien
 * dokończyć, więc nie ma prawa zniknąć bez śladu.
 */
export const nienazwaneTypyDostaw = (): string | null => {
  const znane = nazwane();
  const { dokTypyDostaw, dokTypZD } = config.mssql;
  const uwagi: string[] = [];

  const obce = dokTypyDostaw.filter((k) => !znane.has(k));
  if (obce.length) {
    uwagi.push(
      `DOK_TYPY_DOSTAW zawiera kody bez nazwy: ${obce.join(", ")} — ` +
        `dokumenty pokazują się jako ${obce.map((k) => `TYP-${k}`).join(", ")}. ` +
        "Sprawdź listę: SELECT DISTINCT dok_Typ FROM dok__Dokument."
    );
  }

  /* Osobno, bo to NIE jest brak nazwy, tylko pomyłka co do znaczenia. Kod ZD
     nazwać umiemy — tyle że zamówienie do dostawcy nie jest dostawą i nie ma
     czego rozkładać. Bez tej gałęzi pomyłka przeszłaby cicho, pod poprawnie
     wyglądającą etykietą „ZD" na liście pracy. */
  if (dokTypyDostaw.includes(dokTypZD)) {
    uwagi.push(
      `DOK_TYPY_DOSTAW zawiera ${dokTypZD} — to kod zamówienia do dostawcy (ZD), ` +
        "nie dostawy. Zamówienia mają własną listę na karcie towaru."
    );
  }

  return uwagi.length ? uwagi.join(" ") : null;
};
