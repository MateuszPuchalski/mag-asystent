import React from "react";
import { Karta, Pusto } from "../ui";

/* ── Rama kart analizy (0.440.0) ─────────────────────────────────────────
   Biuro miało na ANALIZIE jedenaście kart w jednym kształcie: wersalikowy
   nagłówek, zdanie „co ta liczba znaczy" i tabela. Tu ten kształt stoi raz,
   żeby następna karta nie wymyślała go od nowa. Zdanie pod nagłówkiem nie
   jest ozdobą — przy każdej karcie mówi, jak NIE czytać liczby (np. że
   zgłoszony problem nie jest miarą błędu). */

export function KartaWgladu({ tytul, opis, akcje, children }: {
  tytul: string; opis?: React.ReactNode; akcje?: React.ReactNode; children: React.ReactNode;
}) {
  return <Karta className="overflow-hidden">
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
