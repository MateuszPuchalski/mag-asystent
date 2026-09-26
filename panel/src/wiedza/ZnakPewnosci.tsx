import React from "react";
import type { PewnoscZSieci } from "../api/typy";
import { ile } from "../ui";

/* ── Pewność propozycji z sieci (@wydanie) ──────────────────────────────────
   Reguła z SZPERACZA, paczki, której biuro używa do ręcznego researchu:
   „potwierdzone” to dwa NIEZALEŻNE źródła, w tym katalog producenta albo
   baza części z rysunkami. Liczy ją serwer (`services/zrodla-sieci.ts`),
   ekran tylko ją nazywa.

   Po co na ekranie: przegląd sortuje się od potwierdzonych, więc oko ma
   wiedzieć, gdzie kończy się to, co wystarczy przejrzeć, a zaczyna to,
   przy którym warto otworzyć źródło. Słowo, nie sama barwa — kolor nie
   może być jedynym nośnikiem znaczenia. */

const OPIS: Record<PewnoscZSieci, { slowo: string; klasa: string; podpowiedz: string }> = {
  potwierdzone: {
    slowo: "potwierdzone", klasa: "bg-green-50 text-green-900",
    podpowiedz: "Dwa niezależne źródła, w tym katalog producenta albo baza części.",
  },
  prawdopodobne: {
    slowo: "prawdopodobne", klasa: "bg-slate-100 text-slate-700",
    podpowiedz: "Jedno mocne źródło albo dwa sklepy. Warto rzucić okiem na cytat.",
  },
  slabe: {
    slowo: "słabe", klasa: "bg-amber-50 text-amber-900",
    podpowiedz: "Jedno źródło spoza katalogów. Otwórz stronę, zanim zatwierdzisz.",
  },
};

export function ZnakPewnosci({ pewnosc, zrodel }: { pewnosc?: PewnoscZSieci; zrodel?: number }) {
  if (!pewnosc) return null;
  const o = OPIS[pewnosc];
  return <span className={`ml-2 rounded px-1.5 text-xs font-semibold ${o.klasa}`} title={o.podpowiedz}>
    {o.slowo}{zrodel != null && zrodel > 1 && ` · ${ile(zrodel, "źródło", "źródła", "źródeł")}`}</span>;
}
