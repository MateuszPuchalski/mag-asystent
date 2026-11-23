import React from "react";
import { Search, X } from "lucide-react";
import { Pusto } from "./index";

/* ── JEDNA KOLUMNA LISTY NA PIĘĆ KOLEJEK ─────────────────────────────────────
   Skrzynka, Zwroty, Kosze, Reklamacje i Dostawy mają tę samą pracę: wybrać
   kubełek, znaleźć sprawę, przejść po liście. Pięć własnych układów tej kolumny
   to pięć nawyków, a agent przechodzi między nimi kilkadziesiąt razy dziennie
   (dekalog p. 2: rozpoznanie tańsze od pamiętania).

   KOLEJNOŚĆ JEST STAŁA: tytuł z działaniami po prawej, kubełki, szukanie,
   drugi filtr, lista. Każde pasmo jest opcjonalne i znika razem z treścią,
   więc kolejka bez drugiego filtru nie płaci za pusty wiersz. Każde pasmo
   stoi w JEDNYM rzędzie, a to, co się nie mieści, ucieka do „Więcej"
   (`FiltrZWiecej`) albo do działań w tytule, a nie do drugiego rzędu.

   `shrink-0` na pasmach nad listą nie jest kosmetyką: lista ma bazę 0, więc
   przy ciasnym oknie kurczyłyby się wyłącznie one.

   KOLUMNA NIE ZNA KOLEJKI. Kubełki, szukanie i filtr wchodzą jako gotowe
   elementy, bo każda kolejka ma inne zasady (skaner zwrotów, sito „Moje").
   Wspólny jest kształt, a nie treść. */

export function KolumnaKolejki({
  tytul, ikona, opis, akcje, podTytulem, kubelki, szukaj, drugi, nad, etykieta, className = "", nieswieza = false, children,
}: {
  /** Tytuł kolejki. Brak = bez rzędu tytułu (kolejka, której nazwę niesie zakładka). */
  tytul?: string;
  ikona?: React.ReactNode;
  /** Drobny podpis obok tytułu, np. godzina synchronizacji. Ucina się wielokropkiem. */
  opis?: React.ReactNode;
  /** Przyciski-ikony po prawej stronie tytułu. */
  akcje?: React.ReactNode;
  /** Zdania pod tytułem: alarmy i błędy, które mają stać przy swojej kolejce. */
  podTytulem?: React.ReactNode;
  kubelki?: React.ReactNode;
  szukaj?: React.ReactNode;
  /** Drugi filtr albo pytanie kubełka — jeden rząd. */
  drugi?: React.ReactNode;
  /** Pasma o własnej szerokości (alarm progu, pasek Copilota) nad listą. */
  nad?: React.ReactNode;
  /** Nazwa regionu dla czytnika ekranu, gdy różni się od tytułu. */
  etykieta?: string;
  /** Dodatkowe klasy sekcji — układ rodzica, np. podstawa flexa przy zawijaniu. */
  className?: string;
  /** Lista z nieświeżych danych jest przygaszona: pusta nie znaczy „nic nie ma". */
  nieswieza?: boolean;
  children: React.ReactNode;
}) {
  return <section aria-label={etykieta ?? tytul}
    className={`card flex min-h-0 flex-col overflow-hidden ${className}`}>
    {(tytul || akcje) && <header className="shrink-0 border-b border-slate-200 px-3 py-1.5">
      <div className="flex min-h-9 items-center gap-1.5">
        {ikona && <span aria-hidden="true" className="shrink-0">{ikona}</span>}
        {tytul && <h1 className="shrink-0 text-naglowek font-bold">{tytul}</h1>}
        <div className="mr-auto min-w-0 truncate text-podpis font-normal text-slate-600">{opis}</div>
        {akcje && <div className="flex shrink-0 items-center gap-1">{akcje}</div>}
      </div>
      {podTytulem}
    </header>}
    {kubelki && <div className="flex shrink-0 flex-wrap items-center gap-1 border-b border-slate-200 px-2 py-1">
      {kubelki}</div>}
    {szukaj && <div className="shrink-0 border-b border-slate-200 px-2 py-1.5">{szukaj}</div>}
    {drugi && <div className="flex shrink-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 border-b border-slate-200 bg-slate-50 px-2 py-1">
      {drugi}</div>}
    {nad}
    <div className={`min-h-0 flex-1 overflow-y-auto ${nieswieza ? "opacity-60" : ""}`}>{children}</div>
  </section>;
}

/** Pole szukania w kolejce: lupa, krzyżyk po wpisaniu i ten sam rozmiar wszędzie. */
export function SzukajWKolejce({ wartosc, onZmien, etykieta, placeholder }: {
  wartosc: string;
  onZmien: (v: string) => void;
  /** Nazwa pola dla czytnika ekranu. */
  etykieta: string;
  placeholder: string;
}) {
  return <div className="relative min-w-0 flex-1">
    <Search size={14} aria-hidden="true" className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-600" />
    <input value={wartosc} onChange={(e) => onZmien(e.target.value)}
      aria-label={etykieta} placeholder={placeholder}
      className={`field w-full py-1 pl-7 text-sm ${wartosc !== "" ? "pr-7" : "pr-2"}`} />
    {/* Krzyżyk ma 24 px boku, choć ikona 14: to najmniejszy cel wskaźnika
        w WCAG 2.2 (2.5.8), a przycisk leży na polu, więc odstęp go nie ratuje. */}
    {wartosc !== "" && <button type="button" onClick={() => onZmien("")} aria-label="Wyczyść szukanie"
      className="absolute right-1 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded text-slate-600 hover:bg-slate-100 hover:text-slate-900">
      <X size={14} aria-hidden="true" /></button>}
  </div>;
}

/**
 * Pusta lista kolejki — JEDNO zdanie i jedna ikona, żeby pustka miała tę samą
 * wysokość na każdej kolejce. Zdanie podaje kolejka, bo „nic nie czeka"
 * i „nic nie przyszło" to dwa różne komunikaty.
 */
export function PustaKolejka({ ikona, children }: {
  ikona: React.ComponentType<{ size?: number; className?: string }>;
  children: React.ReactNode;
}) {
  return <Pusto waga="lista" ikona={ikona}>{children}</Pusto>;
}
