import { describe, expect, it } from "vitest";

/* Źródła przez `?raw`, jak w czterech pozostałych strażnikach — `tsconfig.json`
   zapisuje, że panel jest aplikacją przeglądarki, więc żadnego `node:fs`. */
const ZRODLA = import.meta.glob(["./**/*.tsx", "!./**/*.test.tsx"],
  { query: "?raw", eager: true, import: "default" }) as Record<string, string>;

/* ── BURSZTYN NIE JEST BARWĄ ZAZNACZENIA (0.265.0) ─────────────────────────────
   Ustalenie 02 z audytu wizualnego. Bursztyn niósł w panelu SIEDEM ról naraz:
   markę, akcję główną, ostrzeżenie, notatkę wewnętrzną, podpis klienta na osi,
   kropkę nieprzeczytanego i ZAZNACZENIE. Kiedy jedna barwa znaczy „marka",
   „wybrane" i „uwaga", nie znaczy już żadnego z tych trzech.

   Najostrzejszy przypadek dało się pokazać na jednej wartości. `bg-amber-50`
   (`#FFFBEB`) malowało jednocześnie:

     wybrany wiersz    cztery kolejki: skrzynka, zwroty, reklamacje, dyskusje
     ostrzeżenie       brak powiązania z ofertą, konflikt przejęcia, Copilot
     notatkę wewnętrzną blok komentarza na osi rozmowy
     formularz pomiaru pasmo pod osią

   Pierwsze dwa znaczenia są PRZECIWSTAWNE: „to jest to, co wybrałeś" kontra
   „tu coś jest nie tak". Agent nie ma jak ich rozróżnić, bo to ten sam piksel.

   CO PILNUJE. Jednej rzeczy: **bursztyn nie wraca jako TŁO zaznaczenia**.
   Reguła celuje w linię, która niesie naraz klasę `bg-amber-*` albo
   `bg-wertis-amber` ORAZ nazwę mówiącą o wyborze (`aktywn`, `wybran`,
   `zaznacz`). Taki kształt ma dokładnie jedno znaczenie w tym kodzie.

   CZEGO NIE PILNUJE. Nie liczy ról bursztynu i nie wie, ile ich zostało.
   Ostrzeżenia, notatka wewnętrzna, tryb pomiaru i podpis klienta na osi
   ZOSTAJĄ bursztynowe i mają prawo — to jest jedna rodzina znaczeń („uwaga"),
   a nie pięć. Nie zobaczy też nowego zaznaczenia namalowanego inną barwą.
   Zielony wynik znaczy „ta jedna pomyłka nie wróciła".

   ZWOLNIENIA SĄ JAWNE. Komentarz `bursztyn: <powód>` w linii albo do sześciu
   linii nad nią, powód co najmniej trzy wyrazy — ten sam mechanizm i próg co
   `kontrast:`, `skala:`, `segment:` i `ergonomia:`. Dziś jest jedno i jest
   prawdziwe: pasek nawigacji stoi na `#2A2A2C`, a tam bursztynowa zakładka
   jest MARKĄ na ciemnym tle, nie zaznaczeniem wiersza na bieli.            */

/** Powód zwolnienia — co najmniej trzy wyrazy po dwukropku. */
const ZWOLNIENIE = /bursztyn:\s*\S+(?:\s+\S+){2,}/;

/** Tło bursztynowe stojące w jednej linii z nazwą mówiącą o wyborze. */
const ZAZNACZENIE = /\b(?:aktywn|wybran|zaznacz)\w*\b/i;
const TLO_BURSZTYNU = /\bbg-(?:wertis-)?amber(?:-\d{2,3})?\b/;

/** Kod bez komentarzy, z zachowanymi numerami linii — patrz `Kontrast.test.ts`. */
function bezKomentarzy(tekst: string): string {
  return tekst
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/\/\/[^\n]*/g, (m) => " ".repeat(m.length));
}

describe("Bursztyn nie jest barwą zaznaczenia", () => {
  it("żadne `bg-amber-*` nie stoi w gałęzi wyboru", () => {
    const winne: string[] = [];
    for (const [plik, zrodlo] of Object.entries(ZRODLA)) {
      const linie = bezKomentarzy(zrodlo).split("\n");
      const surowe = zrodlo.split("\n");
      linie.forEach((l, i) => {
        if (!TLO_BURSZTYNU.test(l)) return;
        /* OKNO DWÓCH LINII, nie jedna. Warunek trójkowy łamie się przed
           gałęziami: `${aktywna` zostaje w linii wyżej, a `? "bg-amber-50"`
           schodzi niżej. Pierwsza wersja tej reguły szukała obu w JEDNEJ
           linii i przez to nie odmówiła, gdy wstawiłem usterkę z powrotem.
           Ta sama pomyłka co w `ui/FiltrSegmentowy.test.tsx` — strażnik,
           którego nie sprawdzono na odmowę, jest zielonym kwadratem. */
        if (!ZAZNACZENIE.test(linie.slice(Math.max(0, i - 2), i + 1).join(" "))) return;
        /* Zwolnienie stoi w komentarzu, więc szukamy go w tekście ORYGINALNYM. */
        if (surowe.slice(Math.max(0, i - 6), i + 1).some((x) => ZWOLNIENIE.test(x))) return;
        winne.push(`${plik}:${i + 1} → ${l.trim().slice(0, 72)}`);
      });
    }
    expect(winne).toEqual([]);
  });
});

describe("Zaznaczony wiersz ma belkę przy KAŻDYM wierszu", () => {
  it("`border-l-[3px]` nie stoi wyłącznie w gałęzi wybranej", () => {
    /* Belka dokładana dopiero przy zaznaczeniu przesuwa treść wiersza o trzy
       piksele w prawo — kliknięcie szarpie tekstem. Stała szerokość i sama
       BARWA warunkowa to jedyny kształt, który tego nie robi.

       Rozpoznajemy po SKŁADNI: linia zaczynająca się od `?` albo `:` to gałąź
       warunku, więc klasa o stałej szerokości nie ma prawa tam stać. Pierwsza
       wersja szukała tekstu przed `${` i przepuszczała wszystko, bo w gałęzi
       żadnego `${` nie ma. */
    const winne: string[] = [];
    for (const [plik, zrodlo] of Object.entries(ZRODLA)) {
      bezKomentarzy(zrodlo).split("\n").forEach((l, i) => {
        if (!/border-l-\[3px\]/.test(l)) return;
        if (!/^\s*[?:]/.test(l)) return;
        winne.push(`${plik}:${i + 1} → ${l.trim().slice(0, 72)}`);
      });
    }
    expect(winne).toEqual([]);
  });
});
