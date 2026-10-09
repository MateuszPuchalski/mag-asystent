import React, { useEffect, useId, useRef, useState } from "react";
import { ListFilter, X } from "lucide-react";
import type { ProgKolejki, TagSprawy } from "../api/typy";
import { useOkno } from "../nawigacja/fokus";
import { NaglowekSekcji } from "../ui";
import { PasekPorzadku, type OsPorzadku } from "../sprawy/Porzadek";
import { PasekTla } from "../sprawy/PasekTla";
import { FiltrTagow } from "../sprawy/Tagi";

/* ── Filtr kolejki za jednym przyciskiem ─────────────────────────────────────
   Tagi, porządek i próg daty zmienia się rzadko, a patrzy na listę ciągle.
   Stały rząd przełączników nad kolejką kosztował miejsce przy każdej sprawie,
   więc stoją za przyciskiem obok tytułu (dekalog, punkt 2).

   PRZYCISK MÓWI, ŻE COŚ JEST WŁĄCZONE. Schowany filtr, który zawęża listę po
   cichu, to sprawa zgubiona bez śladu. Kropka i nazwa dla czytnika mówią, że
   lista nie jest pełna, a ekran dopisuje to samo zdaniem nad wierszami.

   OKNO NIEMODALNE. Stoi obok pracy, więc skróty kolejki działają dalej,
   a Escape i kliknięcie obok je zamykają. */

export function FiltrKolejki({ wgTagow, tag, onTag, porzadek, osie, onPorzadek, prog, onPrzelaczProg,
  stanTekst }: {
  wgTagow: Array<[TagSprawy, number]>;
  tag: number | null;
  onTag: (id: number | null) => void;
  porzadek: OsPorzadku;
  /** Osie tej kolejki; pierwsza jest domyślna, inny wybór zapala znak filtra. */
  osie: OsPorzadku[];
  onPorzadek: (p: OsPorzadku) => void;
  prog?: ProgKolejki | null;
  onPrzelaczProg: (zdejmij: boolean) => void;
  /** Zdanie o zakresie listy, np. ile dyskusji synchronizacja odsiała. */
  stanTekst?: string;
}) {
  const [otwarte, setOtwarte] = useState(false);
  const wyzwalacz = useRef<HTMLButtonElement | null>(null);
  const idOkna = useId();
  const wlaczony = tag !== null || porzadek !== osie[0] || Boolean(prog?.zdjety);
  /* Ten sam warunek co w `PasekTla`: gdy pasek milczy, zdanie mówi, że lista
     jest pełna, zamiast zostawić sekcję pustą. */
  const mowiOZakresie = Boolean(stanTekst || (prog?.od && (prog.zdjety || prog.ukrytych > 0)));
  return <div className="relative">
    <button ref={wyzwalacz} type="button" aria-expanded={otwarte} aria-controls={otwarte ? idOkna : undefined}
      aria-label={`Filtr tagów i sortowanie${wlaczony ? " (włączony)" : ""}`}
      title="Filtr tagów, porządek i zakres listy" onClick={() => setOtwarte((o) => !o)}
      className="relative flex h-11 w-11 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-900 hover:bg-slate-50">
      <ListFilter size={18} aria-hidden="true" />
      {wlaczony && <span aria-hidden="true"
        className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-wertis-ink" />}
    </button>
    {otwarte && <OknoFiltra id={idOkna} wyzwalacz={wyzwalacz} onZamknij={() => setOtwarte(false)}>
      <div className="flex flex-col gap-1.5">
        <NaglowekSekcji jako="p">Porządek</NaglowekSekcji>
        <PasekPorzadku porzadek={porzadek} dozwolone={osie} onZmien={onPorzadek} />
      </div>
      {wgTagow.length > 0 && <div className="flex flex-col gap-1.5">
        <NaglowekSekcji jako="p">Tagi</NaglowekSekcji>
        <div className="flex flex-wrap gap-1"><FiltrTagow wgLiczby={wgTagow} wybrany={tag} onWybierz={onTag} /></div>
      </div>}
      <div className="flex flex-col gap-1.5">
        <NaglowekSekcji jako="p">Zakres listy</NaglowekSekcji>
        <PasekTla prog={prog} onPrzelaczProg={onPrzelaczProg} stanTekst={stanTekst} />
        {!mowiOZakresie && <p className="px-1 text-podpis text-slate-600">Lista pokazuje wszystkie sprawy.</p>}
      </div>
    </OknoFiltra>}
  </div>;
}

/** Samo okno — osobno, bo `useOkno` wiąże fokus z chwilą montażu. */
function OknoFiltra({ id, wyzwalacz, onZamknij, children }: {
  id: string;
  wyzwalacz: React.RefObject<HTMLButtonElement | null>;
  onZamknij: () => void;
  children: React.ReactNode;
}) {
  const okno = useOkno<HTMLDivElement>({ modalne: false, onZamknij });
  /* Kliknięcie obok zamyka okno, jak menu. Klik w przycisk filtra robi to
     sam, więc go pomijamy — inaczej okno zamknęłoby się i od razu otworzyło. */
  useEffect(() => {
    const obok = (e: PointerEvent) => {
      const cel = e.target as Node | null;
      if (!cel || okno.ref.current?.contains(cel) || wyzwalacz.current?.contains(cel)) return;
      onZamknij();
    };
    document.addEventListener("pointerdown", obok);
    return () => document.removeEventListener("pointerdown", obok);
  }, [onZamknij]);
  return <div id={id} role="dialog" {...okno} aria-label="Filtr i porządek kolejki"
    className="absolute right-0 z-20 mt-1 flex w-[min(22rem,calc(100vw-2rem))] flex-col gap-3 rounded-lg border border-slate-200 bg-white p-3 shadow-lg">
    <div className="flex items-center justify-between">
      <span className="text-sm font-bold text-slate-900">Filtr i porządek</span>
      <button type="button" onClick={onZamknij} aria-label="Zamknij filtr"
        className="flex h-8 w-8 items-center justify-center rounded text-slate-700 hover:bg-slate-100">
        <X size={16} aria-hidden="true" /></button>
    </div>
    {children}
  </div>;
}
