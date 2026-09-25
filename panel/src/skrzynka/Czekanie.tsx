import React from "react";

/* ── CZEKANIE JAKO KRESKI, NIE ZDANIE (23 września 2026) ─────────────────────
   Zgłoszenie właściciela: „za dużo tekstu". Wiersz kolejki mówił „czeka 14 g
   42 min" — trzy wyrazy i minuty, których nikt nie czyta przy czternastu
   godzinach. Cztery kreski rosną z czasem i ciemnieją ku czerwieni, więc
   rozmowę po terminie widać w przewijanej liście, zanim wzrok dojdzie do liczby.

   Liczba ZOSTAJE, skrócona do jednej jednostki. Kreski mówią „jak bardzo",
   liczba „ile" — a pierwsze bez drugiego kazałoby zgadywać, gdzie jest próg.

   Progi to pytanie „za co się wziąć", nie SLA: godzina, cztery, osiem. Ustawowy
   termin nie dotyczy rozmów (§26), więc kreski nie udają, że go liczą.

   Barwy pisma są ciemne, bo liczba jest TEKSTEM (strażnik `Kontrast.test.ts`):
   pomarańcz marki i jasna żółć odpadają przy białym tle. */

/** Skrót czasu oczekiwania: jedna jednostka, bez minut przy godzinach. */
export function czekaKrotko(ms: number): string {
  const minuty = Math.floor(ms / 60_000);
  if (minuty < 60) return `${minuty} min`;
  const godziny = Math.floor(minuty / 60);
  if (godziny < 24) return `${godziny} g`;
  return `${Math.floor(godziny / 24)} d`;
}

/** Ile kresek z czterech i jaka barwa — próg po progu. */
export function stopienCzekania(ms: number): { kreski: number; pismo: string; kreska: string } {
  const g = ms / 3_600_000;
  if (g < 1) return { kreski: 1, pismo: "text-slate-600", kreska: "bg-slate-500" };
  if (g < 4) return { kreski: 2, pismo: "text-amber-800", kreska: "bg-amber-600" };
  if (g < 8) return { kreski: 3, pismo: "text-orange-700", kreska: "bg-orange-600" };
  return { kreski: 4, pismo: "text-ranga-zle", kreska: "bg-ranga-zle" };
}

/* ── LICZBA BEZ KRESEK (@wydanie) ────────────────────────────────────────────
   Zgłoszenie agenta: „przytłacza". Cztery kreski przy KAŻDYM wierszu mówiły
   to samo co barwa liczby obok — dwa znaki jednego faktu w liście, która
   i tak niesie kafel kategorii, kropkę i podgląd. Zostaje liczba w barwie
   progu: ta sama drabina (szarość, bursztyn, pomarańcz, czerwień), ten sam
   próg „za co się wziąć", o jeden rysunek mniej na wiersz. */
export function Czekanie({ ms }: { ms: number }) {
  const s = stopienCzekania(ms);
  const tekst = czekaKrotko(ms);
  return <span title={`czeka ${tekst}`}
    className={`inline-flex shrink-0 text-sm font-bold leading-none tabular-nums ${s.pismo}`}>
    <span className="sr-only">czeka </span>{tekst}</span>;
}
