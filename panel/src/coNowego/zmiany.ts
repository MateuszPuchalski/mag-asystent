/* ── „CO SIĘ ZMIENIŁO" — WYCIĄG Z HISTORII ZMIAN (@wydanie) ──────────────────
   Panel zmienia się kilka razy w tygodniu, a agent dowiadywał się o tym,
   trafiając na przycisk w innym miejscu. Zaskoczenie kosztuje uwagę przy
   KAŻDEJ zmianie; jedno zdanie przy pierwszym wejściu po wydaniu — raz.

   WYCIĄG POWSTAJE PRZY BUDOWANIU, NIE W PRZEGLĄDARCE. `CHANGELOG.md` ma ponad
   megabajt i nie jedzie w paczce wydania (`tools/paczka.sh`), więc serwer nie
   ma go skąd podać. Budowanie panelu bierze z niego tylko nagłówki kilku
   ostatnich wydań — kilkaset bajtów zamiast całego pliku.

   TYLKO WYDANIA `minor`. Rodzaj `minor` to z definicji widoczna funkcja albo
   działanie przy wdrożeniu (`zmiany/README.md`); `patch` to reszta, zwykle
   instalator albo poprawka, której agent nie zauważy. Pokazywanie jej uczyłoby
   zamykać pasek bez czytania — ta sama pułapka co okno „czy na pewno".

   Plik jest czysty i bez zależności od przeglądarki, bo woła go też
   `vite.config.ts` w Node przy budowaniu. */

export interface WydanieZmian {
  wersja: string;
  data: string;
  /** Pogrubione otwarcia akapitów — tytuły fragmentów zmian. */
  naglowki: string[];
}

const SEKCJA = /^## (\d+\.\d+\.\d+) — (.+)$/;

/** Nagłówki `ile` najnowszych wydań `minor` z treści `CHANGELOG.md`. */
export function najnowszeZmiany(md: string, ile = 3): WydanieZmian[] {
  const wynik: WydanieZmian[] = [];
  let biezace: WydanieZmian | null = null;
  for (const linia of md.split("\n")) {
    const s = SEKCJA.exec(linia);
    if (s) {
      if (biezace && biezace.naglowki.length) wynik.push(biezace);
      if (wynik.length >= ile) return wynik;
      biezace = s[1].endsWith(".0") ? { wersja: s[1], data: s[2].trim(), naglowki: [] } : null;
      continue;
    }
    /* Tylko akapit OTWARTY pogrubieniem — punkt listy z pogrubionym słowem
       to szczegół wewnątrz zmiany, nie jej tytuł. */
    const n = biezace && /^\*\*(.+?)\*\*/.exec(linia);
    if (biezace && n) biezace.naglowki.push(n[1].replace(/[.:]\s*$/, ""));
  }
  if (biezace && biezace.naglowki.length && wynik.length < ile) wynik.push(biezace);
  return wynik;
}

/** Porównanie numerów wersji po częściach — „0.99.0" jest starsze niż „0.100.0". */
export function starsza(a: string, b: string): boolean {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) < (pb[i] ?? 0);
  return false;
}

/**
 * Wydania do pokazania: nowsze niż ostatnio zamknięte. Bez zapamiętanego
 * numeru (pierwsze wejście, wyczyszczona przeglądarka) — tylko najnowsze,
 * bo trzy wydania naraz dla kogoś, kto panel widzi pierwszy raz, to lista,
 * nie wiadomość.
 */
export function doPokazania(zmiany: WydanieZmian[], widziana: string | null): WydanieZmian[] {
  if (widziana === null) return zmiany.slice(0, 1);
  return zmiany.filter((z) => starsza(widziana, z.wersja));
}
