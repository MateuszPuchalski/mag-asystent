import { describe, expect, it } from "vitest";

/* Źródła wchodzą przez `?raw`, nie przez `node:fs` — ta sama decyzja co
   w `RamaOkna.test.ts`: `tsconfig.json` zapisuje, że panel jest aplikacją
   przeglądarki, a `?raw` daje surowy tekst bez wykonywania modułu. `eager`,
   bo test ma być synchroniczny. */
const ZRODLA = import.meta.glob(["./**/*.tsx", "!./**/*.test.tsx"],
  { query: "?raw", eager: true, import: "default" }) as Record<string, string>;

/* ── Strażnik czytelności (0.255.0) ──────────────────────────────────────────
   Audyt wizualny ośmiu ekranów `/obsluga` znalazł cztery miejsca poniżej progu
   kontrastu WCAG AA. DWA Z NICH WESZŁY W 0.251.0 — przy wydaniu, które
   nazywało się poprawą czytelności, czyli dokładnie wtedy, gdy uwagi było
   najwięcej. Poprawka bez bramki wraca przy pierwszym pośpiechu.

   CO PILNUJE — trzy pary barw, każda zmierzona, nie oszacowana:

     `text-slate-400` na tekście       #94A3B8 na bieli        = 2.56:1
     `text-slate-500` na `bg-slate-100` #64748B na #F1F5F9     = 4.34:1
     `text-wertis-amber` na tekście     #F7A600 na bieli        = 2.02:1

   Próg dla pisma poniżej 18 px to 4.5:1, dla 24 px/700 — 3:1. Żadna z tych
   trzech par nie przechodzi nigdzie, więc zakaz jest bezwarunkowy.

   Bursztyn jest zakazany jako PISMO, nie w ogóle: `bg-wertis-amber` pod
   `text-wertis-ink` daje 7.10:1 i zostaje barwą marki. Usterką było użycie
   barwy tła jako barwy liter.

   CZEGO NIE PILNUJE. Nie liczy kontrastu. Czyta tekst źródła, więc nie wie,
   na jakim tle element naprawdę wyląduje — tło bierze się z rodzica albo
   z `@apply` w `index.css`. Zna trzy konkretne złe pary i tyle: nie wykryje
   nowej złej barwy ani złego zestawienia, którego nie ma na liście. Zielony
   wynik NIE znaczy „panel przechodzi WCAG"; znaczy, że te trzy nie wróciły.
   Prawdziwy pomiar robi się w przeglądarce, po złożeniu alfy przez cały stos
   tła — audyt pokazał dwa razy pod rząd, że bez tego wyniki są bzdurą.

   ZWOLNIENIA SĄ JAWNE. Komentarz `kontrast: <powód>` w linii albo do sześciu
   linii nad nią zdejmuje zgłoszenie, a powód musi mieć co najmniej trzy
   wyrazy — ten sam mechanizm i ten sam próg co `ergonomia: <powód>`
   w `tools/ergonomia_check.py`, bo zwolnienie bez uzasadnienia to brak
   zwolnienia. Zwolnienia są prawdziwe: pasek nawigacji stoi na `#2A2A2C`
   i tam `slate-400` daje 5.59:1, czyli lepiej, niż `slate-600` dałoby
   na bieli.                                                                 */

/** Powód zwolnienia — co najmniej trzy wyrazy po dwukropku. */
const ZWOLNIENIE = /kontrast:\s*\S+(?:\s+\S+){2,}/;

/**
 * Ikona nie niesie pisma i nie podlega progowi 4.5:1. Rozpoznajemy ją po
 * `size={` (tak wygląda każda ikona z `lucide-react`) albo po `sr-only`, czyli
 * nazwie dla czytnika ekranu. Okno trzech linii, bo element bywa rozbity.
 */
const IKONA = /size=\{|sr-only/;

/**
 * Kod bez komentarzy, z zachowanymi numerami linii.
 *
 * Bez tego strażnik wywraca się o WŁASNE uzasadnienia: komentarz, który
 * tłumaczy, czemu `text-slate-400` jest zakazane, sam zawiera `text-slate-400`.
 * `RamaOkna.test.ts` nadział się na to pierwszy i stąd jego reguła „szukaj
 * w samym `className`". Tu idziemy szerzej — zerujemy każdy komentarz, ale
 * zostawiamy znaki nowej linii, żeby numer w zgłoszeniu dalej wskazywał
 * prawdziwą linię pliku. Zwolnień `kontrast:` szukamy w tekście ORYGINALNYM,
 * bo one z definicji stoją w komentarzach.
 */
function bezKomentarzy(tekst: string): string {
  return tekst
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/\/\/[^\n]*/g, (m) => " ".repeat(m.length));
}

/** Zgłoszenia dla jednego wzorca, z pominięciem ikon i zwolnień. */
function znajdz(wzorzec: RegExp, { pomijajIkony = false } = {}): string[] {
  const trafienia: string[] = [];
  for (const [plik, zrodlo] of Object.entries(ZRODLA)) {
    const tekst = bezKomentarzy(zrodlo);
    const linie = tekst.split("\n");
    const surowe = zrodlo.split("\n");
    linie.forEach((l, i) => {
      if (!wzorzec.test(l)) return;
      if (pomijajIkony && IKONA.test(linie.slice(i, i + 3).join(" "))) return;
      /* Zwolnienie stoi w linii albo w komentarzu nad nią. */
      if (surowe.slice(Math.max(0, i - 6), i + 1).some((x) => ZWOLNIENIE.test(x))) return;
      trafienia.push(`${plik}:${i + 1} → ${l.trim().slice(0, 72)}`);
    });
  }
  return trafienia;
}

describe("Czytelność: trzy pary barw, które nie przechodzą nigdzie", () => {
  it("`text-slate-400` nie niesie tekstu — 2.56:1 przy progu 4.5", () => {
    /* Na ikonie ta klasa zostaje: ikona nie ma progu dla pisma. Na tekście
       jest zakazana, bo wyciszenie poniżej czytelności to już nie wyciszenie,
       tylko ukrycie faktu — a §4.3 pozwala tylko na to pierwsze. */
    expect(znajdz(/text-slate-400/, { pomijajIkony: true })).toEqual([]);
  });

  it("`text-slate-500` nie stoi na `bg-slate-100` — 4.34:1 przy progu 4.5", () => {
    /* Ta para jest podstępna, bo `slate-500` przechodzi na bieli (4.76) i cały
       panel przyzwyczaił się traktować ją jako bezpieczną. Na tle strony,
       które ma `bg-slate-100`, już nie przechodzi. Tam idzie `slate-600`. */
    /* `(?<!hover:)` jest tu istotne: `hover:bg-slate-100` to stan NAJECHANIA,
       a nie tło, na którym tekst spoczywa — pierwsza wersja tego strażnika
       zgłaszała dwa przyciski ikonowe właśnie dlatego. */
    const PARA = /(?<!hover:)bg-slate-100[^"`]*text-slate-500|text-slate-500[^"`]*(?<!hover:)bg-slate-100/;
    expect(znajdz(PARA)).toEqual([]);
  });

  it("`text-wertis-amber` nie istnieje — bursztyn jest tłem, nie pismem", () => {
    /* 2.02:1 przy 24 px i wadze 700, przy progu 3:1. `bg-wertis-amber` pod
       ciemnym pismem daje 7.10:1 i zostaje — zakaz dotyczy wyłącznie liter. */
    expect(znajdz(/text-wertis-amber/)).toEqual([]);
  });
});

describe("Cele klikalne w kolejkach mają 24 px", () => {
  it("żaden przycisk kolejki nie stoi na `py-0.5`", () => {
    /* Ta jedna klasa dała w 0.251.0 pigułki kubełków o wysokości 20 px przy
       progu 24×24 z WCAG 2.2 AA (2.5.8). Zakres wąski celowo: bramka ma łapać
       TĘ regresję, a nie zgadywać wysokość dowolnego przycisku. Wysokość
       w pikselach mierzy się w przeglądarce, nie w jsdomie. */
    const winne: string[] = [];
    for (const [plik, zrodlo] of Object.entries(ZRODLA)) {
      if (!/Kolejka|Zwroty|Reklamacje|Dyskusje/.test(plik)) continue;
      const linie = bezKomentarzy(zrodlo).split("\n");
      const surowe = zrodlo.split("\n");
      linie.forEach((l, i) => {
        if (!/\bpy-0\.5\b/.test(l)) return;
        if (!/<button/.test(linie.slice(Math.max(0, i - 2), i + 1).join(" "))) return;
        if (surowe.slice(Math.max(0, i - 6), i + 1).some((x) => ZWOLNIENIE.test(x))) return;
        winne.push(`${plik}:${i + 1} → ${l.trim().slice(0, 72)}`);
      });
    }
    expect(winne).toEqual([]);
  });
});
