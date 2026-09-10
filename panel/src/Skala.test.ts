import { describe, expect, it } from "vitest";

/* Konfiguracja wchodzi jako TEKST, nie jako moduł. Import `tailwind.config.js`
   przechodzi przez Vitest, ale wywala `tsc -b` (brak deklaracji typów) — a to
   właśnie `npm run build` robi typecheck panelu w CI. Poza tym czytanie tekstu
   jest zgodne z trzema pozostałymi strażnikami: sprawdzamy, co NAPISANO, a nie
   co rozwiąże bundler. */
import konfiguracjaTekst from "../tailwind.config.js?raw";

/* Źródła przez `?raw`, jak w trzech pozostałych strażnikach — `tsconfig.json`
   zapisuje, że panel jest aplikacją przeglądarki, więc żadnego `node:fs`. */
const ZRODLA = import.meta.glob(["./**/*.tsx", "!./**/*.test.tsx"],
  { query: "?raw", eager: true, import: "default" }) as Record<string, string>;

/* ── Strażnik drabiny typograficznej (0.258.0) ───────────────────────────────
   Zmierzone przed tym wydaniem: 664 wystąpienia klas rozmiaru w `panel/src`,
   z czego 95,2% w paśmie 11–14 px. Powyżej 16 px było DZIEWIĘĆ wystąpień na
   664, a cztery z nich to liczby, nie tekst. Osiem różnych rozmiarów wzięło
   się nie z decyzji, tylko z tego, że każdy dokładał, co mu pasowało.

   CO PILNUJE. Jednej rzeczy: **żadnych nowych arbitralnych `text-[NNpx]`**.
   Rozmiar bierze się z drabiny (`podpis`, `tresc`, `naglowek`, `tytul`) albo
   ze szczebla kontrolki (`text-xs`, `text-sm`). Arbitralna wartość to sposób,
   w jaki drabina rozpadła się poprzednio — i ma dwie wady naraz: nie mówi
   o ROLI oraz nie niesie interlinii, bo Tailwind nie przypisuje jej do
   wartości arbitralnych. Osiemdziesiąt dwa `text-[11px]` dziedziczyły przez
   to 1,5 z przeglądarki zamiast pary przypisanej do klasy.

   Pilnuje też, że drabina w konfiguracji ISTNIEJE i ma pary z interlinią —
   bez tego cztery szczeble dałoby się rozbroić jedną linijką i nikt by nie
   zauważył.

   CZEGO NIE PILNUJE. Nie wie, czy szczebel dobrano właściwie: `text-tresc`
   na kontrolce przejdzie, a `text-xs` na sześciowierszowym akapicie też.
   Rola jest decyzją człowieka i bramka jej nie zastąpi. Nie mierzy niczego
   w pikselach — czy nagłówek 17 px zawija się w kolumnie 400 px, sprawdza
   się w przeglądarce, nie w jsdomie.

   ZWOLNIENIA SĄ JAWNE. Komentarz `skala: <powód>` w linii albo do sześciu
   linii nad nią zdejmuje zgłoszenie, a powód musi mieć co najmniej trzy
   wyrazy — ten sam mechanizm i próg co `kontrast:` oraz `ergonomia:`.
   Dziś jest jedno zwolnienie i jest prawdziwe: napis „bez zdjęcia" musi się
   zmieścić w kafelku 44 px, a najniższy szczebel go rozsadza. To jedyne
   miejsce, gdzie rozmiar dyktuje POJEMNIK, a nie rola tekstu.            */

/** Powód zwolnienia — co najmniej trzy wyrazy po dwukropku. */
const ZWOLNIENIE = /skala:\s*\S+(?:\s+\S+){2,}/;

/** Arbitralny rozmiar pisma: `text-[15px]`, `text-[0.9rem]` i podobne. */
const ARBITRALNY = /\btext-\[[\d.]+(px|rem|em|pt)\]/;

/** Kod bez komentarzy, z zachowanymi numerami linii — patrz `Kontrast.test.ts`. */
function bezKomentarzy(tekst: string): string {
  return tekst
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/\/\/[^\n]*/g, (m) => " ".repeat(m.length));
}

describe("Rozmiar pisma bierze się z drabiny, nie z palca", () => {
  it("w `panel/src` nie ma nowych arbitralnych `text-[NNpx]`", () => {
    const winne: string[] = [];
    for (const [plik, zrodlo] of Object.entries(ZRODLA)) {
      const linie = bezKomentarzy(zrodlo).split("\n");
      const surowe = zrodlo.split("\n");
      linie.forEach((l, i) => {
        if (!ARBITRALNY.test(l)) return;
        /* Zwolnienie stoi w komentarzu, więc szukamy go w tekście ORYGINALNYM. */
        if (surowe.slice(Math.max(0, i - 6), i + 1).some((x) => ZWOLNIENIE.test(x))) return;
        winne.push(`${plik}:${i + 1} → ${l.trim().slice(0, 72)}`);
      });
    }
    expect(winne).toEqual([]);
  });
});

/** Pary `nazwa: ["11px", "16px"]` z bloku `fontSize` w konfiguracji. */
function szczeble(): Record<string, [string, string]> {
  const blok = konfiguracjaTekst.match(/fontSize:\s*\{([\s\S]*?)\n\s*\},/)?.[1] ?? "";
  const out: Record<string, [string, string]> = {};
  for (const m of blok.matchAll(/(\w+):\s*\[\s*"([^"]+)"\s*,\s*"([^"]+)"\s*\]/g))
    out[m[1]] = [m[2], m[3]];
  /* Nazwy zapisane BEZ pary wyłapujemy osobno — inaczej szczebel bez interlinii
     zniknąłby z wyniku zamiast zapalić test. */
  for (const m of blok.matchAll(/(\w+):\s*"([^"]+)"/g)) out[m[1]] = [m[2], ""];
  return out;
}

describe("Drabina stoi w konfiguracji i niesie interlinię", () => {
  const skala = szczeble();

  it("ma cztery szczeble nazwane ROLĄ, nie rozmiarem", () => {
    /* Nazwa jest tu połową roboty. Piszący ma wybierać „to jest treść", a nie
       „to jest 15 px" — inaczej za pół roku będzie tu znowu osiem rozmiarów. */
    expect(Object.keys(skala).sort())
      .toEqual(["naglowek", "podpis", "tresc", "tytul"]);
  });

  it("każdy szczebel niesie PARĘ [rozmiar, interlinia]", () => {
    /* To nie jest ozdoba. Arbitralne `text-[NNpx]` nie mają w Tailwindzie
       domyślnej interlinii i dziedziczą 1,5 z przeglądarki — para przypisana
       do nazwy jest jedynym powodem, dla którego 95 miejsc przestało to robić. */
    for (const [nazwa, [rozmiar, interlinia]] of Object.entries(skala)) {
      expect(interlinia, `${nazwa} musi być parą [rozmiar, interlinia]`).not.toBe("");
      expect(rozmiar, nazwa).toMatch(/^\d+px$/);
      expect(interlinia, nazwa).toMatch(/^\d+px$/);
      /* Interlinia ciaśniejsza niż sam rozmiar to zawsze pomyłka w zapisie. */
      expect(parseInt(interlinia, 10)).toBeGreaterThan(parseInt(rozmiar, 10));
    }
  });

  it("szczeble idą w górę i nie mają duplikatów", () => {
    /* Dwa szczeble o tym samym rozmiarze to ten sam błąd, co dwa zapisy jednej
       roli — drabina bez odstępu między szczeblami nie jest drabiną. */
    const px = ["podpis", "tresc", "naglowek", "tytul"].map((k) => parseInt(skala[k][0], 10));
    expect(px).toEqual([...px].sort((a, b) => a - b));
    expect(new Set(px).size).toBe(px.length);
  });
});
