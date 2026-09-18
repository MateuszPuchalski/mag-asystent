import React, { useState } from "react";
import { ArrowDownWideNarrow, Check } from "lucide-react";

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
 * Wybór osi — JEDEN PRZYCISK Z MENU (0.402.0).
 *
 * 0.401.0 postawiło tu pasmo pigułek, po jednej na oś. Zgłoszenie właściciela
 * ze zrzutem — „panel wygląda chaotycznie" — i policzenie tego na ekranie
 * reklamacji pokazało, ile to kosztowało: pasmo zajmowało cały wiersz
 * w kolumnie szerokiej na 280 px, zawijało się razem z sitem „Moje", a agent
 * i tak musiał przeczytać CZTERY napisy, żeby poznać jeden — ten wybrany.
 *
 * NAPIS NA PRZYCISKU MÓWI BIEŻĄCĄ OŚ, więc jedno spojrzenie zamiast czterech.
 * Wybór z menu kosztuje kliknięcie więcej niż pigułka i to jest cena zapłacona
 * świadomie: oś przestawia się rzadko, a patrzy się na nią za każdym razem.
 *
 * Pigułek nie zabrakło żadnej — menu niesie te same osie, w tej samej
 * kolejności, z tymi samymi podpowiedziami.
 */
export function PasekPorzadku({ porzadek, dozwolone, onZmien }: {
  porzadek: OsPorzadku;
  dozwolone: OsPorzadku[];
  onZmien: (p: OsPorzadku) => void;
}) {
  const [otwarte, setOtwarte] = useState(false);
  if (dozwolone.length < 2) return null;
  return <div className="relative shrink-0">
    <button type="button" aria-haspopup="menu" aria-expanded={otwarte}
      title={`Kolejność: ${PODPISY[porzadek].podpowiedz}`}
      onClick={() => setOtwarte((o) => !o)}
      className="flex items-center gap-1 rounded border border-slate-300 px-2 py-1 text-podpis font-semibold text-slate-700 hover:bg-slate-100 hover:text-slate-900">
      <ArrowDownWideNarrow size={12} className="shrink-0 text-slate-500" />
      {PODPISY[porzadek].napis}
    </button>
    {otwarte && <>
      {/* Kliknięcie POZA menu zamyka je — bez tego menu zostaje otwarte po
          wyborze innego przycisku i zasłania listę. */}
      <button type="button" aria-label="Zamknij wybór kolejności" tabIndex={-1}
        onClick={() => setOtwarte(false)} className="fixed inset-0 z-10 cursor-default" />
      <div role="menu" aria-label="Kolejność kolejki"
        className="absolute right-0 z-20 mt-1 w-56 rounded-lg border border-slate-200 bg-white p-1 shadow-lg">
        {dozwolone.map((o) => <button key={o} type="button" role="menuitemradio"
          aria-checked={porzadek === o} title={PODPISY[o].podpowiedz}
          onClick={() => { onZmien(o); setOtwarte(false); }}
          className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs ${porzadek === o
            ? "bg-slate-100 font-semibold text-slate-900" : "text-slate-700 hover:bg-slate-50"}`}>
          <Check size={13} className={porzadek === o ? "shrink-0 text-ranga-ok" : "shrink-0 opacity-0"} />
          <span className="min-w-0">{PODPISY[o].napis}</span>
        </button>)}
      </div>
    </>}
  </div>;
}
