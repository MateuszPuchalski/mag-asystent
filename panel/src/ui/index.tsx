import React, { useState } from "react";
import { Copy } from "lucide-react";

/* Prymitywy stoją na warstwie `@layer components` z `index.css` (`.card`,
   `.btn-primary`, `.field`). Druga, równoległa konwencja klas kosztowałaby
   więcej, niż daje — a ekranów w panelu ma być kilka, nie kilkadziesiąt. */

export const Karta = ({ className = "", ...p }: React.HTMLAttributes<HTMLDivElement>) =>
  <div className={`card ${className}`} {...p} />;

type PrzyciskProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  wariant?: "glowny" | "drugi";
};
export const Przycisk = ({ wariant = "drugi", className = "", ...p }: PrzyciskProps) =>
  <button className={`${wariant === "glowny" ? "btn-primary" : "btn-secondary"} ${className}`} {...p} />;

export const Pole = ({ className = "", ...p }: React.InputHTMLAttributes<HTMLInputElement>) =>
  <input className={`field ${className}`} {...p} />;

/** Plakietka statusu — barwy z tokenów, żeby §7 miało jedno źródło. */
export const KLASA_STATUSU: Record<string, string> = {
  "new": "bg-stan-new text-stan-new-tekst",
  "open": "bg-stan-open text-stan-open-tekst",
  "waiting_for_customer": "bg-stan-klient text-stan-klient-tekst",
  "waiting_for_internal": "bg-stan-wewnetrzne text-stan-wewnetrzne-tekst",
  "resolved": "bg-stan-zrobione text-stan-zrobione-tekst",
  "snoozed": "bg-stan-odlozona text-stan-odlozona-tekst",
  "closed": "bg-stan-zamknieta text-stan-zamknieta-tekst",
  "spam": "bg-stan-spam text-stan-spam-tekst",
};
export const Plakietka = ({ status, children, className = "" }:
  { status?: string; children: React.ReactNode; className?: string }) =>
  <span className={`rounded px-1.5 py-0.5 text-[11px] font-bold uppercase tracking-wide ${
    KLASA_STATUSU[status ?? ""] ?? "bg-slate-100 text-slate-600"} ${className}`}>{children}</span>;

/**
 * Zakładki jednej kolumny (0.180.0).
 *
 * Kolumna dowodów przy ZWROCIE ma sekcje jedna pod drugą, bo to jedna lista
 * faktów o jednej sprawie. Kolumna kontekstu przy ROZMOWIE ma zakładki, bo
 * niesie dwa RÓWNORZĘDNE tematy: co klient kupuje i co mamy na półce.
 * Sekcje kazałyby przewijać obok tematu, którego akurat nie czytasz.
 *
 * `aria-pressed` zamiast roli `tab`: pełny wzorzec zakładek żąda strzałek,
 * `aria-controls` i zarządzania ogniskiem, a to są dwa przyciski przełączające
 * treść pod spodem. Ta sama decyzja co przy kubełkach kolejki.
 */
export function Zakladki<T extends string>({ wybrana, onWybierz, pozycje }: {
  wybrana: T;
  onWybierz: (v: T) => void;
  pozycje: Array<{ klucz: T; etykieta: string }>;
}) {
  return <div className="flex gap-1 border-b border-slate-200 px-2 py-2">
    {pozycje.map((z) => <button key={z.klucz} type="button" aria-pressed={wybrana === z.klucz}
      onClick={() => onWybierz(z.klucz)}
      className={`flex-1 rounded px-2 py-1 text-xs font-semibold ${wybrana === z.klucz
        ? "bg-wertis-ink text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}>
      {z.etykieta}</button>)}
  </div>;
}

export const Pusto = ({ ikona, children }: { ikona: React.ReactNode; children: React.ReactNode }) =>
  <div className="grid flex-1 place-items-center p-16 text-center text-slate-500">
    {ikona}<p className="mt-3 font-semibold">{children}</p>
  </div>;

export const Blad = ({ children }: { children: React.ReactNode }) =>
  children ? <p className="rounded-lg bg-red-50 p-4 text-sm text-red-700">{children}</p> : null;

/** Czas w formacie, który czyta biuro — jedna funkcja na cały panel. */
export const czas = (v: string | null | undefined) =>
  v ? new Date(v).toLocaleString("pl") : "—";

/**
 * Kopiowanie tekstu, którego nikt nie przepisuje z ekranu ręcznie:
 * identyfikatora zamówienia (UUID) i numeru dokumentu z Subiekta.
 *
 * Stało to od 0.166.0 w `zwroty/Dowody.tsx`. Od 0.176.0 numer paragonu też ma
 * ten przycisk — dopóki kliknięcie nie otwiera dokumentu w Subiekcie (byłby
 * do tego potrzebny program na stanowisku, patrz `docs/architektura.md` §4),
 * schowek jest najkrótszą drogą do okna „Znajdź dokument".
 */
export function Skopiuj({ tekst, tytul = "Kopiuj" }: { tekst: string; tytul?: string }) {
  const [zrobione, setZrobione] = useState(false);
  return <button type="button" title={tytul}
    onClick={() => {
      void navigator.clipboard?.writeText(tekst).then(() => {
        setZrobione(true);
        setTimeout(() => setZrobione(false), 1500);
      }).catch(() => {});
    }}
    className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700">
    <Copy size={13} />
    <span className="sr-only">{zrobione ? "Skopiowano" : "Kopiuj"}</span>
  </button>;
}
