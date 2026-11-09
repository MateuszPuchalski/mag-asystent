import React, { useState } from "react";
import { FiltrSegmentowy, Karta, Pusto } from "./index";

/* ── Rama kart wglądu ────────────────────────────────────────────────────
   Analiza i stan systemu mają kilkanaście kart w jednym kształcie:
   nagłówek, zdanie „co ta liczba znaczy" i tabela. Tu ten kształt stoi raz,
   żeby następna karta nie wymyślała go od nowa.
   Zdanie pod nagłówkiem nie jest ozdobą — mówi, jak NIE czytać liczby. */

export function KartaWgladu({ tytul, opis, akcje, id, pusta, children }: {
  tytul: string; opis?: React.ReactNode; akcje?: React.ReactNode;
  /** Kotwica dla głębokiego linku (`?karta=…`) — stan systemu skacze do karty. */
  id?: string;
  /**
   * Zdanie „czemu nic tu nie ma" — karta staje się JEDNĄ LINIĄ. Karta bez
   * danych w oknie nie zajmuje tyle miejsca co karta z danymi, bo zakres
   * przewijałby się przez tysiące pikseli zer i kresek.
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

/**
 * Nagłówek kolumny: napis albo nazwa tylko dla czytnika ekranu.
 *
 * Kolumna z samymi przyciskami albo z logo nie potrzebuje napisu na ekranie,
 * ale czytnik ekranu czyta nagłówek przy każdej komórce. Pusty napis dałby
 * pusty `<th>` — naruszenie WCAG 1.3.1 — i przy dwóch takich kolumnach ten
 * sam klucz React dwa razy.
 */
export type Naglowek = string | { ukryty: string };

export function NaglowekKolumny({ n }: { n: Naglowek }) {
  return <th className="py-1.5 pr-3 font-bold">
    {typeof n === "string" ? n : <span className="sr-only">{n.ukryty}</span>}
  </th>;
}

/** Tabela wglądu — nagłówki podane raz, pusta tabela mówi zdaniem, nie ciszą. */
export function Tabela({ naglowki, pusto, children }: {
  naglowki: Naglowek[]; pusto: string; children: React.ReactNode[];
}) {
  if (!children.length) return <Pusto waga="lista">{pusto}</Pusto>;
  return <div className="overflow-x-auto">
    <table className="w-full text-sm">
      <thead><tr className="border-b text-left text-xs text-slate-600">
        {naglowki.map((n, i) => <NaglowekKolumny key={i} n={n} />)}</tr></thead>
      <tbody className="divide-y divide-slate-100">{children}</tbody>
    </table>
  </div>;
}

/** Komórka z odstępem wspólnym dla wszystkich tabel analizy. */
export const Td = ({ className = "", children }: { className?: string; children: React.ReactNode }) =>
  <td className={`py-1.5 pr-3 align-top ${className}`}>{children}</td>;

/**
 * Jedna karta, kilka przekrojów tych samych liczb.
 *
 * „Według kategorii" i „według osoby" to jeden pomiar w dwóch przekrojach,
 * więc przełącznik trzyma je w karcie liczby; osobne karty czytałyby się
 * jak trzy różne pomiary. Przekrój bez danych (osoba dla roli biuro) po
 * prostu nie przychodzi i nie ma pozycji.
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
