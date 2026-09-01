import React from "react";

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
const STATUS: Record<string, string> = {
  "new": "bg-stan-new text-stan-new-tekst",
  "open": "bg-stan-open text-stan-open-tekst",
  "waiting_for_customer": "bg-stan-klient text-stan-klient-tekst",
  "waiting_for_internal": "bg-stan-wewnetrzne text-stan-wewnetrzne-tekst",
  "resolved": "bg-stan-zrobione text-stan-zrobione-tekst",
};
export const Plakietka = ({ status, children, className = "" }:
  { status?: string; children: React.ReactNode; className?: string }) =>
  <span className={`rounded px-1.5 py-0.5 text-[11px] font-bold uppercase tracking-wide ${
    STATUS[status ?? ""] ?? "bg-slate-100 text-slate-600"} ${className}`}>{children}</span>;

export const Pusto = ({ ikona, children }: { ikona: React.ReactNode; children: React.ReactNode }) =>
  <div className="grid flex-1 place-items-center p-16 text-center text-slate-500">
    {ikona}<p className="mt-3 font-semibold">{children}</p>
  </div>;

export const Blad = ({ children }: { children: React.ReactNode }) =>
  children ? <p className="rounded-lg bg-red-50 p-4 text-sm text-red-700">{children}</p> : null;

/** Czas w formacie, który czyta biuro — jedna funkcja na cały panel. */
export const czas = (v: string | null | undefined) =>
  v ? new Date(v).toLocaleString("pl") : "—";
