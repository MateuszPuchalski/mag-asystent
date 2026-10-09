import React, { useEffect, useRef, useState } from "react";

/* ── Menu pod przyciskiem ────────────────────────────────────────────────────
   Krótka lista czynności albo widoków, które nie zasługują na stałe miejsce
   na ekranie. Głowica chowa tu odświeżenie z Allegro, przełącznik
   kubełków — widoki „tylko wgląd”. Jeden kształt, żeby ręka nie uczyła się
   dwóch menu na jednym ekranie.

   Fokus wchodzi do pierwszej pozycji przy otwarciu, a Escape i wybór oddają
   go przyciskowi. Kliknięcie poza menu je zamyka, bez wyboru czegokolwiek. */

export interface PozycjaMenu {
  klucz: string;
  napis: React.ReactNode;
  onWybierz: () => void;
  wylaczona?: boolean;
  /** Pozycja zaznaczona — wtedy menu jest wyborem jednego, nie listą czynności. */
  wybrana?: boolean;
}

export function MenuPrzycisku({ etykieta, nazwaPrzycisku, przycisk, klasaPrzycisku, pozycje, wcisniety,
  szerokosc = "w-56" }: {
  /** Nazwa menu dla czytnika ekranu. */
  etykieta: string;
  /** Nazwa przycisku samej ikony; przycisk z napisem nazywa się napisem. */
  nazwaPrzycisku?: string;
  przycisk: React.ReactNode;
  klasaPrzycisku: string;
  pozycje: PozycjaMenu[];
  /** Przycisk niesie bieżący wybór — wtedy jest też wciśnięty. */
  wcisniety?: boolean;
  szerokosc?: string;
}) {
  const [otwarte, setOtwarte] = useState(false);
  const wyzwalacz = useRef<HTMLButtonElement | null>(null);
  const menu = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (otwarte) menu.current?.querySelector<HTMLButtonElement>("button:not([disabled])")?.focus();
  }, [otwarte]);
  if (!pozycje.length) return null;
  const zamknij = () => { setOtwarte(false); wyzwalacz.current?.focus(); };
  const wybor = pozycje.some((p) => p.wybrana !== undefined);
  return <div className="relative min-w-0">
    <button ref={wyzwalacz} type="button" aria-label={nazwaPrzycisku} aria-haspopup="menu"
      aria-expanded={otwarte} aria-pressed={wcisniety} title={nazwaPrzycisku}
      onClick={() => setOtwarte((o) => !o)} className={klasaPrzycisku}>
      {przycisk}</button>
    {otwarte && <>
      {/* okno: przezroczysta warstwa pod menu, sama oknem nie jest. */}
      <button type="button" aria-label={`Zamknij: ${etykieta}`} tabIndex={-1}
        onClick={() => setOtwarte(false)} className="fixed inset-0 z-10 cursor-default" />
      <div ref={menu} role="menu" aria-label={etykieta}
        onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); zamknij(); } }}
        className={`absolute right-0 z-20 mt-1 ${szerokosc} rounded-lg border border-slate-200 bg-white p-1 shadow-lg`}>
        {pozycje.map((p) => <button key={p.klucz} type="button"
          role={wybor ? "menuitemradio" : "menuitem"} aria-checked={wybor ? Boolean(p.wybrana) : undefined}
          disabled={p.wylaczona} onClick={() => { p.onWybierz(); zamknij(); }}
          className={`flex w-full items-center gap-2 rounded px-2 py-2 text-left text-sm disabled:opacity-50 ${
            p.wybrana ? "bg-slate-100 font-semibold text-slate-900" : "text-slate-800 hover:bg-slate-50"}`}>
          {p.napis}</button>)}
      </div>
    </>}
  </div>;
}
