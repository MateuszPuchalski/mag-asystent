import React, { useEffect, useId, useRef, useState } from "react";
import { Camera } from "lucide-react";
import type { Wyjatek as WyjatekHali } from "../api/dostawy";
import { ilosc } from "../api/dostawy";
import { useZdjecieDowodu } from "../towar/useZdjecie";
import { Pole, Przycisk, czas } from "../ui";

/* ── Wyjątek zgłoszony przez halę ──────────────────────────────────────────
   „OTWARTY" pisany WPROST: brak czegoś nie jest komunikatem.

   ROZWIĄZANIE W MIEJSCU, NIE W OKNIE. Pole otwiera się pod wyjątkiem,
   którego dotyczy — oko nie skacze na środek ekranu i z powrotem, a przy
   kilku wyjątkach jednej faktury widać, który się właśnie zamyka
   (dekalog pkt 5: mniej ruchu). Notatka jest opcjonalna i trafia do
   protokołu dla dostawcy.

   OPIS Z HALI MA CAŁĄ SZEROKOŚĆ. Rodzaj, stan i przycisk stoją w jednym
   krótkim rzędzie, a zdania pod nim. Opis obok przycisku dostaje pół
   kolumny i łamie się po dwa słowa, a to jego biuro czyta przed decyzją. */

/**
 * Co policzyła hala — zdaniem, które znaczy jedno.
 *
 * BŁĘDNY ARTYKUŁ CZYTA SIĘ JAKO ZAMIANA. „6 z 6 szt." przy pozycji 0/6
 * wyglądałoby na komplet zamówionego towaru, a chodzi o coś odwrotnego:
 * przyszło sześć sztuk CZEGO INNEGO w miejsce zamówionych.
 */
function Policzone({ p }: { p: WyjatekHali }) {
  const j = p.unit ? ` ${p.unit}` : "";
  if (p.typ === "wrong_item") {
    const zamiast = p.zamiastIlosc ?? p.qtyDok;
    return <span>przyszło {p.qty != null ? `${ilosc(p.qty)}${j} ` : ""}<b>{p.symObcy ?? "innego towaru"}</b>
      {zamiast != null && <> zamiast {ilosc(zamiast)}{j} {p.sym ?? "zamówionego"}</>}</span>;
  }
  return <>
    {p.symObcy && <b>{p.symObcy}</b>}
    {p.qty != null && <span>policzone: {ilosc(p.qty)}{p.qtyDok != null ? ` z ${ilosc(p.qtyDok)}` : ""}{j}</span>}
    {p.zamiastIlosc != null && <span>· zamiast {ilosc(p.zamiastIlosc)}</span>}
  </>;
}

/**
 * Zdjęcie z hali o jedno kliknięcie od zgłoszenia, którego dotyczy.
 *
 * Miniatury stoją w kolumnie dowodów i trzeba je dopasować do wyjątku po
 * podpisie. Przycisk przy wyjątku tego nie wymaga. Towar spoza dokumentu nie
 * ma kolumny dowodów wcale, więc tam to jedyna droga do zdjęcia.
 *
 * BRAK ZDJĘCIA MA TU POWÓD, bo przy towarze spoza dokumentu nikt inny go nie
 * poda. Nieudane pobranie daje „ponów", a zgubiony plik zdanie wprost.
 * Cisza w obu przypadkach wyglądałaby jak zgłoszenie bez zdjęcia, a to
 * zdjęcie jest podstawą reklamacji u dostawcy.
 */
function ZdjecieWyjatku({ id, onPowieksz }: { id: number; onPowieksz: (url: string) => void }) {
  const { url, blad, ponow } = useZdjecieDowodu(id);
  if (blad) {
    return <Przycisk className="!px-2.5 !py-1 !text-xs" title={blad} onClick={ponow}>
      <Camera size={14} aria-hidden="true" />Ponów zdjęcie</Przycisk>;
  }
  if (url === null) {
    return <span className="text-xs text-ranga-zle"
      title="Hala dołączyła zdjęcie, ale serwer nie ma jego pliku — dowód do reklamacji przepadł">
      pliku zdjęcia brak</span>;
  }
  return <Przycisk className="!px-2.5 !py-1 !text-xs disabled:opacity-50" disabled={!url}
    onClick={() => { if (url) onPowieksz(url); }}>
    <Camera size={14} aria-hidden="true" />Zdjęcie</Przycisk>;
}

export function Wyjatek({ p, trwa, blad, onRozwiaz, onPowieksz }: {
  p: WyjatekHali;
  trwa: boolean;
  blad: string;
  onRozwiaz: (id: number, note: string) => void;
  /** Otwiera powiększenie dowodu; bez niego wyjątek nie pokazuje przycisku zdjęcia. */
  onPowieksz?: (url: string) => void;
}) {
  const [otwarte, setOtwarte] = useState(false);
  const [nota, setNota] = useState("");
  const idPodpowiedzi = useId();
  /* Zgłoszenie bez żadnego wskazania towaru — ani pozycji, ani symbolu,
     np. zrobione na całą dostawę. Brak mówimy wprost: pusty wiersz wyglądałby,
     jakby ekran zgubił nazwę, a nie jakby jej nigdy nie było — a protokół
     dla dostawcy wyjdzie z takiego wiersza bez towaru. */
  const bezTowaru = p.lineId == null && !p.sym && !p.symObcy;
  const maLiczby = p.typ === "wrong_item" || Boolean(p.symObcy) || p.qty != null || p.zamiastIlosc != null;
  /* PO WYCOFANIU FOKUS WRACA NA „ROZWIĄŻ". Pole znika razem z formularzem,
     a fokus bez adresu spada na początek strony i klawiatura gubi wyjątek,
     przy którym człowiek stał. */
  const rozwiazRef = useRef<HTMLButtonElement | null>(null);
  const oddajFokus = useRef(false);
  const anuluj = () => { oddajFokus.current = true; setOtwarte(false); setNota(""); };
  useEffect(() => {
    if (otwarte || !oddajFokus.current) return;
    oddajFokus.current = false;
    rozwiazRef.current?.focus();
  }, [otwarte]);
  /* STAN I PRZYCISK ZAWSZE Z PRAWEJ W PIERWSZYM RZĘDZIE. Rząd niesie tylko
     krótkie plakietki, więc „rozwiązany" i „otwarty" stoją w tym samym
     miejscu przy każdym wyjątku, bez względu na długość opisu. */
  return <div className="border-t border-slate-100 py-2 text-sm first:border-t-0">
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <span className="rounded bg-red-100 px-1.5 py-0.5 text-xs font-bold text-ranga-zle">{p.typLabel || p.typ}</span>
      <span className="ml-auto flex shrink-0 items-center gap-2">
        {p.hasPhoto && onPowieksz && <ZdjecieWyjatku id={p.id} onPowieksz={onPowieksz} />}
        {p.resolvedAt
          ? <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-xs font-bold text-ranga-ok">rozwiązany</span>
          : <>
              {/* Stan zostaje przy otwartym formularzu: znika tylko przycisk,
                  który formularz zastąpił. */}
              <span className="rounded bg-red-100 px-1.5 py-0.5 text-xs font-bold text-ranga-zle">otwarty</span>
              {!otwarte && <button ref={rozwiazRef} type="button" className="btn-secondary !px-2.5 !py-1 !text-xs"
                onClick={() => setOtwarte(true)}>Rozwiąż</button>}
            </>}
      </span>
    </div>
    {(bezTowaru || maLiczby) && <div className="mt-1 flex flex-wrap items-baseline gap-x-2">
      {bezTowaru && <span className="text-xs italic text-slate-600">bez wskazania towaru</span>}
      <Policzone p={p} />
    </div>}
    {p.opis && <p className="mt-0.5 text-slate-700">{p.opis}</p>}
    <p className="mt-0.5 text-xs text-slate-600">{p.createdBy ?? ""} · {czas(p.createdAt)}</p>
    {/* Kto i kiedy zamknął stoi zawsze, nie tylko przy notatce: wyjątek
        zamknięty bez słowa też ktoś zamknął i biuro pyta o to po miesiącu. */}
    {p.resolvedAt &&
      <p className="mt-1 text-xs text-slate-600">
        Zamknięty: {p.resolvedBy ? `${p.resolvedBy} · ` : ""}{czas(p.resolvedAt)}
        {p.resolvedNote && <> — <span className="text-slate-800">{p.resolvedNote}</span></>}</p>}
    {otwarte && !p.resolvedAt &&
      /* POLE W CAŁEJ SZEROKOŚCI, PRZYCISKI POD NIM. W jednym rzędzie
         z przyciskami pole ma sto pikseli i ucina własną podpowiedź.
         Escape wycofuje się z formularza jak „Anuluj", bo ręka jest na
         klawiaturze. */
      <form className="mt-2"
        onSubmit={(e) => { e.preventDefault(); onRozwiaz(p.id, nota.trim()); }}
        onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); anuluj(); } }}>
        <Pole autoFocus value={nota} onChange={(e) => setNota(e.target.value)}
          placeholder="Jak to załatwiono?"
          aria-label="Jak załatwiono wyjątek" aria-describedby={idPodpowiedzi} />
        <p id={idPodpowiedzi} className="mt-1 text-xs text-slate-600">
          Opcjonalnie. Notatka trafi do protokołu dla dostawcy.</p>
        <div className="mt-2 flex flex-wrap gap-2">
          <Przycisk wariant="glowny" type="submit" disabled={trwa}>Zamknij wyjątek</Przycisk>
          <Przycisk type="button" onClick={anuluj}>Anuluj</Przycisk>
        </div>
        {blad && <p className="mt-1 text-xs text-ranga-zle">{blad}</p>}
      </form>}
  </div>;
}
