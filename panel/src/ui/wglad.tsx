import React, { useState } from "react";
import { FiltrSegmentowy, Karta, Pusto } from "./index";

/* ── Rama kart wglądu (0.440.0, w `ui/` od 0.441.0) ──────────────────────
   Biuro miało na ANALIZIE i w STANIE SYSTEMU kilkanaście kart w jednym
   kształcie: nagłówek, zdanie „co ta liczba znaczy" i tabela. Tu ten kształt
   stoi raz, żeby następna karta nie wymyślała go od nowa. Mieszkał
   w `analiza/`, dopóki miał jednego odbiorcę; stan systemu jest drugim.
   Zdanie pod nagłówkiem nie jest ozdobą — mówi, jak NIE czytać liczby. */

export function KartaWgladu({ tytul, opis, akcje, id, pusta, children }: {
  tytul: string; opis?: React.ReactNode; akcje?: React.ReactNode;
  /** Kotwica dla głębokiego linku (`?karta=…`) — stan systemu skacze do karty. */
  id?: string;
  /**
   * Zdanie „czemu nic tu nie ma" — karta staje się JEDNĄ LINIĄ (@wydanie).
   * Decyzja właściciela z 27 września 2026, wariant C Analizy: karta bez
   * danych w oknie zajmowała tyle miejsca co karta z danymi. Zakres „Obsługa
   * klienta" miał ich czternaście i przewijał się przez 3300 px zer i kresek.
   * Zdanie zostaje, bo pusta karta bez powodu byłaby ciszą, nie odpowiedzią.
   */
  pusta?: string | null;
  children?: React.ReactNode;
}) {
  if (pusta) return <Karta id={id} className="scroll-mt-4 flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-2.5">
    <h2 className="text-naglowek font-bold">{tytul}</h2>
    <p className="text-sm text-slate-600">{pusta}</p>
  </Karta>;
  return <Karta id={id} className="scroll-mt-4 overflow-hidden">
    <header className="flex flex-wrap items-baseline gap-2 border-b px-4 py-3">
      <h2 className="text-naglowek mr-auto font-bold">{tytul}</h2>
      {akcje}
      {opis && <p className="w-full text-sm text-slate-600">{opis}</p>}
    </header>
    <div className="p-4">{children}</div>
  </Karta>;
}

/** Tabela wglądu — nagłówki podane raz, pusta tabela mówi zdaniem, nie ciszą. */
export function Tabela({ naglowki, pusto, children }: {
  naglowki: string[]; pusto: string; children: React.ReactNode[];
}) {
  if (!children.length) return <Pusto waga="lista">{pusto}</Pusto>;
  return <div className="overflow-x-auto">
    <table className="w-full text-sm">
      <thead><tr className="border-b text-left text-xs text-slate-600">
        {naglowki.map((n) => <th key={n} className="py-1.5 pr-3 font-bold">{n}</th>)}</tr></thead>
      <tbody className="divide-y divide-slate-100">{children}</tbody>
    </table>
  </div>;
}

/** Komórka z odstępem wspólnym dla wszystkich tabel analizy. */
export const Td = ({ className = "", children }: { className?: string; children: React.ReactNode }) =>
  <td className={`py-1.5 pr-3 align-top ${className}`}>{children}</td>;

/**
 * Jedna karta, kilka przekrojów tych samych liczb (@wydanie, wariant C).
 *
 * „Według kategorii" i „według osoby" stały osobnymi kartami pod liczbą,
 * którą rozbijają. Czytało się je jak trzy różne pomiary, a to jeden pomiar
 * w dwóch przekrojach. Przełącznik trzyma je w karcie liczby; przekrój bez
 * danych (osoba dla roli biuro) po prostu nie przychodzi i nie ma pozycji.
 */
export function Przekroje({ pozycje }: {
  pozycje: Array<{ klucz: string; etykieta: string; tresc: React.ReactNode } | null | false | undefined>;
}) {
  const dostepne = pozycje.filter((p): p is { klucz: string; etykieta: string; tresc: React.ReactNode } => Boolean(p));
  const [wybrany, setWybrany] = useState(dostepne[0]?.klucz ?? "");
  const biezacy = dostepne.find((p) => p.klucz === wybrany) ?? dostepne[0];
  if (!biezacy) return null;
  return <div className="mt-4 border-t pt-3">
    {dostepne.length > 1
      ? <div role="group" aria-label="Przekrój" className="mb-2 flex gap-1">
          <FiltrSegmentowy<string> wybrany={biezacy.klucz} onWybierz={setWybrany}
            pozycje={dostepne.map((p) => ({ klucz: p.klucz, etykieta: p.etykieta }))} /></div>
      : <p className="mb-2 text-sm font-bold text-slate-700">{biezacy.etykieta}</p>}
    {biezacy.tresc}
  </div>;
}
