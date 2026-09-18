import React, { useState } from "react";
import { ArrowDownWideNarrow } from "lucide-react";

/* ── Porządek kolejek obsługi (0.401.0) ──────────────────────────────────────
   Zgłoszenie właściciela: „dodaj sortowanie po dacie etc". Reklamacje,
   dyskusje i zwroty miały kolejność ZASZYTĄ — najpierw termin, potem data
   otwarcia malejąco — i ani jednego przełącznika. Agent szukający „co przyszło
   wczoraj" przewijał listę.

   OSIE SĄ DEKLAROWANE PRZEZ EKRAN, nie wspólne dla wszystkich. Dyskusja NIE MA
   terminu (Allegro nie oddaje przy niej ani `decisionDueDate`, ani
   `statusDueDate` — patrz `dyskusje/Fakty.tsx`) ani kwoty, więc pokazanie jej
   tych dwóch pigułek byłoby obietnicą sortowania po polu, którego nie ma.
   Przełącznik, który nic nie robi, uczy, że przełączniki nic nie robią.

   WYBÓR JEST PAMIĘTANY, osobno dla każdej kolejki — decyzja właściciela i ten
   sam nawyk, co przy porządku w skrzynce od 0.259.0. Osobno, bo „po kwocie"
   ma sens w reklamacjach i nie ma go w dyskusjach; wspólny klucz przenosiłby
   wybór tam, gdzie tej osi nie ma.

   SORTOWANIE JEST STABILNE i liczy się W PAMIĘCI EKRANU. Lista i tak
   przyjeżdża w całości (ten sam wzorzec, co kubełki i szukanie), więc zmiana
   osi nie kosztuje ani jednego żądania.                                      */

export type OsPorzadku = "otwarto" | "ruch" | "termin" | "kwota" | "czekanie";

/** Co dana kolejka umie oddać pod każdą z osi; `null` znaczy „tego nie ma". */
export interface KluczePorzadku<T> {
  otwarto?: (x: T) => string | null;
  ruch?: (x: T) => string | null;
  termin?: (x: T) => string | null;
  kwota?: (x: T) => number | null;
  /** Ile sprawa czeka na NAS; liczba rosnąca, więc najdłużej czekające na górze. */
  czekanie?: (x: T) => number | null;
}

const PODPISY: Record<OsPorzadku, { napis: string; podpowiedz: string }> = {
  otwarto: { napis: "Od najnowszych", podpowiedz: "Data założenia sprawy, najnowsze na górze" },
  ruch: { napis: "Ostatni ruch", podpowiedz: "Kiedy w sprawie ostatnio cokolwiek się wydarzyło" },
  termin: { napis: "Termin", podpowiedz: "Najbliższy termin decyzji na górze — co się pali" },
  kwota: { napis: "Kwota", podpowiedz: "Najdroższe sprawy na górze" },
  /* Oś WYŁĄCZNIE skrzynki: rozmowa nie ma terminu, więc jedyną miarą pilności
     jest to, jak długo piłka leży po naszej stronie (powód przy `czekaOdMs`). */
  czekanie: { napis: "Najdłużej czeka", podpowiedz: "Jak długo pytanie klienta leży po naszej stronie" },
};

function zapamietany(klucz: string, dozwolone: OsPorzadku[], domyslny: OsPorzadku): OsPorzadku {
  try {
    const z = localStorage.getItem(klucz) as OsPorzadku | null;
    /* Wartość spoza listy TEJ kolejki odpada: klucz bywa starszy niż zestaw
       osi, a przywrócenie nieistniejącej dałoby pustą pigułkę i listę
       posortowaną po niczym. */
    return z && dozwolone.includes(z) ? z : domyslny;
  } catch { return domyslny; }
}

export function usePorzadek(klucz: string, dozwolone: OsPorzadku[], domyslny: OsPorzadku) {
  const [porzadek, setPorzadek] = useState<OsPorzadku>(() => zapamietany(klucz, dozwolone, domyslny));
  const ustaw = (p: OsPorzadku) => {
    setPorzadek(p);
    try { localStorage.setItem(klucz, p); } catch { /* prywatne okno — wybór na jedno otwarcie */ }
  };
  return { porzadek, ustaw };
}

/**
 * Posortowana KOPIA listy.
 *
 * `null` ZAWSZE NA KOŃCU, niezależnie od osi i kierunku. Sprawa bez terminu
 * nie jest „najpilniejsza" ani „najmniej pilna" — jest sprawą, o której ta oś
 * nic nie mówi, więc nie ma prawa wypłynąć na górę przez samą pustkę.
 *
 * Daty i kwoty idą MALEJĄCO, bo na wszystkich trzech osiach czasowych pytanie
 * brzmi „co najnowsze", a przy kwocie — „co najdroższe". Wyjątkiem jest
 * termin: tam rosnąco, bo najbliższy termin to ten, który się pali.
 */
export function posortuj<T>(lista: T[], porzadek: OsPorzadku, klucze: KluczePorzadku<T>): T[] {
  const kopia = [...lista];
  if (porzadek === "kwota" || porzadek === "czekanie") {
    const f = klucze[porzadek];
    if (!f) return kopia;
    return kopia.sort((a, b) => {
      const x = f(a); const y = f(b);
      if (x == null && y == null) return 0;
      if (x == null) return 1;
      if (y == null) return -1;
      return y - x;
    });
  }
  /* Osie liczbowe skończyły się wyżej; niżej zostają same daty. */
  const f = klucze[porzadek];
  if (!f) return kopia;
  const rosnaco = porzadek === "termin";
  return kopia.sort((a, b) => {
    const x = f(a); const y = f(b);
    if (!x && !y) return 0;
    if (!x) return 1;
    if (!y) return -1;
    return rosnaco ? x.localeCompare(y) : y.localeCompare(x);
  });
}

/**
 * Pasek wyboru osi.
 *
 * JEDNA LINIA, drobnym drukiem: porządek jest nastawieniem widoku, a nie
 * czynnością przy sprawie. Pigułka w wadze filtra kubełków przeciągałaby na
 * siebie uwagę należną kolejce.
 */
export function PasekPorzadku({ porzadek, dozwolone, onZmien }: {
  porzadek: OsPorzadku;
  dozwolone: OsPorzadku[];
  onZmien: (p: OsPorzadku) => void;
}) {
  if (dozwolone.length < 2) return null;
  return <div className="flex shrink-0 flex-wrap items-center gap-1 text-podpis">
    <ArrowDownWideNarrow size={12} className="shrink-0 text-slate-500" />
    <span className="mr-1 text-slate-500">Kolejność</span>
    {dozwolone.map((o) => <button key={o} type="button" title={PODPISY[o].podpowiedz}
      aria-pressed={porzadek === o} onClick={() => onZmien(o)}
      className={`rounded px-1.5 py-0.5 ${porzadek === o
        ? "bg-slate-200 font-semibold text-slate-900" : "text-slate-600 hover:bg-slate-100"}`}>
      {PODPISY[o].napis}</button>)}
  </div>;
}
