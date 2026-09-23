import React from "react";
import { ChevronRight, FileText, Package, Truck, Warehouse } from "lucide-react";

/* ── Droga koszyka: cztery przystanki zamiast akapitu (0.453.0) ───────────────
   Zgłoszenie właściciela po przeglądzie ekranu: „ulżyj przeładowaniu tekstem,
   użyj ikon". Pasek koszyka nosił stałe zdanie o MM, korektach i hali — to samo
   przy każdym pudle, codziennie. Czytane raz, potem przeskakiwane wzrokiem,
   a przez to przeskakiwane także wtedy, gdy stan naprawdę się zmieniał.

   Droga mówi TO SAMO układem: gdzie pudło jest teraz i co jeszcze przed nim.
   Pełne zdanie zostaje w podpowiedzi każdego przystanku, więc nic nie ginie —
   przestaje tylko zajmować wiersz (dekalog, punkt 2: pokazuj to, co potrzebne
   teraz). Kolor niesie stan, a nie ozdobę: czerwony tylko przy odmowie Sfery,
   bursztynowy tylko przy czekaniu. Obok koloru stoi zawsze słowo, bo kolor
   sam nie jest informacją dla każdego oka.                                   */

export type EtapKoszyka = "pakowanie" | "korekty" | "mm" | "regal";

const KOLEJNOSC: EtapKoszyka[] = ["pakowanie", "korekty", "mm", "regal"];

export function DrogaKoszyka({ etap, rodzaj, brakuje = 0, blad = false }: {
  etap: EtapKoszyka;
  rodzaj: "zwroty" | "odpad";
  /** Ile korekt jeszcze brakuje — liczba zamiast listy, lista jest obok. */
  brakuje?: number;
  /** Sfera odrzuciła MM; przystanek MM świeci wtedy na czerwono. */
  blad?: boolean;
}) {
  const dokad = rodzaj === "odpad" ? "na magazyn odpadu" : "na regał zwrotów";
  const przystanki: Record<EtapKoszyka, { ikona: React.ReactNode; nazwa: string; opis: string }> = {
    pakowanie: {
      ikona: <Package size={13} aria-hidden="true" />,
      nazwa: "Pakowanie",
      opis: "Zbierasz towar do pudła. Zamknięcie kończy koszyk.",
    },
    korekty: {
      ikona: <FileText size={13} aria-hidden="true" />,
      nazwa: brakuje > 0 ? `Korekty · brak ${brakuje}` : "Korekty",
      opis: "MM czeka, aż każdy zwrot z koszyka ma numer korekty — ze zwrotu towar "
        + "wraca na magazyn główny dopiero po korekcie.",
    },
    mm: {
      ikona: <Truck size={13} aria-hidden="true" />,
      nazwa: blad ? "MM odrzucona" : "MM",
      opis: `MM z magazynu głównego ${dokad}.`,
    },
    regal: {
      ikona: <Warehouse size={13} aria-hidden="true" />,
      nazwa: rodzaj === "odpad" ? "Odpad" : "Regał",
      opis: "Na hali rozkłada się kosz z numerem tego MM, nie ten koszyk.",
    },
  };
  const teraz = KOLEJNOSC.indexOf(etap);

  return <ol aria-label="Droga koszyka" className="flex shrink-0 items-center gap-0.5">
    {KOLEJNOSC.map((e, i) => {
      const p = przystanki[e];
      /* Trzy wyglądy i ani jednego więcej: za nami, teraz, przed nami.
         „Teraz" dostaje kolor stanu — czekanie, błąd albo zwykła praca. */
      const klasa = i < teraz
        ? "border-emerald-200 bg-emerald-50 text-emerald-800"
        : i > teraz
          ? "border-slate-200 bg-white text-slate-600"
          : blad
            ? "border-red-300 bg-red-50 font-semibold text-red-800"
            : e === "pakowanie"
              ? "border-sky-300 bg-white font-semibold text-sky-900"
              : "border-amber-300 bg-amber-50 font-semibold text-amber-900";
      return <li key={e} className="flex items-center gap-0.5">
        {i > 0 && <ChevronRight size={12} aria-hidden="true" className="text-slate-400" />}
        <span title={p.opis} aria-current={i === teraz ? "step" : undefined}
          className={`inline-flex h-6 items-center gap-1 whitespace-nowrap rounded-full border px-2 ${klasa}`}>
          {p.ikona}{p.nazwa}
        </span>
      </li>;
    })}
  </ol>;
}
