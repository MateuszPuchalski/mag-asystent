import { describe, expect, it } from "vitest";

/* Źródła przez `?raw`, jak w strażnikach w `src/`: `tsconfig.json` zapisuje,
   że panel jest aplikacją przeglądarki, więc żadnego `node:fs`. Lista jest
   jawna, bo zasada dotyczy jednej kolumny, nie całego panelu: zwroty,
   reklamacje i profil klienta mają własne ramy i własne kreski. */
const ZRODLA = import.meta.glob([
  "./Kontekst.tsx", "./PasmoOdpowiedzi.tsx", "./Soczewki.tsx", "./OfertaRozmowy.tsx",
  "./TowarRozmowy.tsx", "./ZamowienieRozmowy.tsx", "./ZamowieniaKlienta.tsx", "./ZwrotRozmowy.tsx",
  "./Paczka.tsx", "./Dobor.tsx", "./Wiedza.tsx", "./odnosniki.tsx",
], { query: "?raw", eager: true, import: "default" }) as Record<string, string>;

/* ── PRAWA KOLUMNA SKRZYNKI MA JEDNĄ GRAMATYKĘ ─────────────────────────────────
   Zgłoszenie właściciela: „prawy panel w skrzynce jest nadal dość chaotyczny".
   Każdy blok kolumny przyniósł własne kreski, tła, wersaliki i wcięcia. Blok
   z własną kreską stawał obok sąsiada z jego kreską i w pięciu miejscach
   stały podwójne linie. Odnośnik miał siedem zapisów, więc agent nie odróżniał
   pracy w panelu od poprawki i od wyjścia do Allegro.

   CO PILNUJE. Zasad, które łamie się jedną klasą:
     - kreskę między blokami daje RODZIC (`divide-y` przewijaka), więc żaden
       blok nie ma własnego `border-b` ani `border-t`;
     - szare tło nie robi z treści pudełka; `hover:bg-slate-50` to stan
       kursora, nie tło, więc przechodzi;
     - wersaliki tylko przez `NaglowekSekcji`, `EtykietaWartosci` i
       `Plakietka`, bo te trzy niosą jeden kształt rangi;
     - nic nie jest większe od tytułu wiersza (14 px), więc bez `text-tresc`;
     - błąd mówi token rangi (`text-ranga-zle`), a nie gołe `text-red-700`;
     - rozwijanie ma trzy idiomy, każdy z `aria-expanded`, więc bez
       `<details>`, który był czwartym;
     - odnośniki mają trzy kształty z `odnosniki.tsx`, więc bez `text-sky-800`.

   CZEGO NIE PILNUJE. Nie widzi wcięcia ani kolejności bloków, a klasę
   złożoną w czasie działania z kawałków przepuści. Zielony wynik znaczy
   „żadna z tych ośmiu pomyłek nie wróciła tą samą klasą".

   ZWOLNIENIA SĄ JAWNE. Komentarz `gramatyka: <powód>` w linii albo do sześciu
   linii nad nią, powód co najmniej trzy wyrazy — ten sam mechanizm co
   `bursztyn:` i `kontrast:`. Dziś jest jedno i jest prawdziwe: pasmo
   odpowiedzi stoi poza przewijaniem, więc kreskę i tło niesie samo.         */

/** Powód zwolnienia — co najmniej trzy wyrazy po dwukropku. */
const ZWOLNIENIE = /gramatyka:\s*\S+(?:\s+\S+){2,}/;

/* `\b` przy `bg-slate-50` jest konieczne: bez niego wzorzec łapałby też
   `bg-slate-500`, które jest inną barwą i inną rolą. */
const ODMOWY: Array<[RegExp, string]> = [
  [/text-tresc/, "pismo większe od tytułu wiersza"],
  [/<details/, "rozwijanie bez aria-expanded"],
  [/\bborder-b\b/, "własna kreska bloku"],
  [/\bborder-t\b/, "własna kreska bloku"],
  [/(?<!hover:)\bbg-slate-50\b/, "szare pudełko"],
  [/\buppercase\b/, "ręczne wersaliki"],
  [/text-red-700/, "błąd bez tokenu rangi"],
  [/text-sky-800/, "odnośnik spoza odnosniki.tsx"],
];

/** Kod bez komentarzy, z zachowanymi numerami linii — patrz `Kontrast.test.ts`. */
function bezKomentarzy(tekst: string): string {
  return tekst
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/\/\/[^\n]*/g, (m) => " ".repeat(m.length));
}

describe("Gramatyka prawej kolumny skrzynki", () => {
  it("czyta wszystkie dwanaście plików kolumny", () => {
    /* Plik przeniesiony albo przemianowany wypada z listy po cichu, a strażnik
       bez źródeł jest zielonym kwadratem. */
    expect(Object.keys(ZRODLA)).toHaveLength(12);
  });

  it("żaden blok nie przynosi własnej kreski, tła, wersalików ani większego pisma", () => {
    const winne: string[] = [];
    for (const [plik, zrodlo] of Object.entries(ZRODLA)) {
      const linie = bezKomentarzy(zrodlo).split("\n");
      const surowe = zrodlo.split("\n");
      linie.forEach((l, i) => {
        const trafione = ODMOWY.filter(([w]) => w.test(l));
        if (trafione.length === 0) return;
        /* Zwolnienie stoi w komentarzu, więc szukamy go w tekście ORYGINALNYM. */
        if (surowe.slice(Math.max(0, i - 6), i + 1).some((x) => ZWOLNIENIE.test(x))) return;
        winne.push(`${plik}:${i + 1} (${trafione.map(([, p]) => p).join(", ")}) → ${l.trim().slice(0, 72)}`);
      });
    }
    expect(winne).toEqual([]);
  });
});
