import React, { useState } from "react";
import type { RaportUzycia } from "../api/wglad";
import { KartaWgladu, Tabela, Td } from "../ui/wglad";
import { Liczba, PasekUdzialu } from "../ui/wykres";
import { czas } from "../ui";
import { nazwaZdarzenia } from "../dziennik/nazwy";

/* ── Zakres UŻYCIE (23 września 2026) ────────────────────────────────────────
   Odpowiedź na „co można zdjąć z ekranu" z danych, nie ze sporu. Serwer liczy
   ją z dziennika zdarzeń (`services/uzycie.ts`) — każda czynność w panelu i na
   kolektorze zostawia tam wpis.

   RAPORT WIDZI CZYNNOŚCI, NIE WEJŚCIA NA EKRAN. Zero zapisu przy patrzeniu
   znaczy, że samo otwarcie ekranu nie zostawia śladu — więc ekran, na który
   się tylko patrzy, zawsze wyjdzie tu „nieużywany". Opis karty mówi to wprost,
   bo bez tego raport doradziłby zdjęcie Analizy.

   UŻYWANE SĄ ZWINIĘTE. Pytanie brzmi „czego nikt nie nacisnął", a l/* ── OBSZARY JEDNĄ LINIĄ, CZYNNOŚCI PO POLSKU (0.542.0) ─────────────────
   Decyzja właściciela z 27 września 2026, wariant C Analizy. Zakres był
   najdłuższym ekranem panelu: 10 700 px przy 1180, bo każdy obszar stał
   otwartą kartą z listą kluczy w rodzaju `zwrot_faktura_cofnieta`.

   Obszar jest teraz wierszem z dwiema liczbami i paskiem udziału nieużytych,
   a jego czynności otwiera klik. Czynności mają polskie nazwy ze słownika
   dziennika (`dziennik/nazwy.ts`), klucz stoi w dymku — po nim szuka się
   w kodzie, zanim się coś zdejmie. */

export function ZakresUzycia({ r }: { r: RaportUzycia }) {
  const martwe = r.obszary.reduce((s, o) => s + o.nieuzywane.length, 0);
  const zywe = r.obszary.reduce((s, o) => s + o.uzywane.length, 0);
  const [otwarte, setOtwarte] = useState<ReadonlySet<string>>(new Set());
  const przelacz = (obszar: string) => setOtwarte((o) => {
    const n = new Set(o);
    if (n.has(obszar)) n.delete(obszar); else n.add(obszar);
    return n;
  });
  return <>
    <KartaWgladu tytul={`Czego nikt nie użył w ${r.dni} dniach`}
      opis="Czynności z dziennika zdarzeń. Samo otwarcie ekranu nie zostawia śladu.">
      <div className="flex flex-wrap gap-8">
        <Liczba ile={martwe} etykieta="czynności bez ani jednego użycia" />
        <Liczba ile={zywe} etykieta="czynności użyte" />
      </div>
      <table className="mt-4 w-full border-t text-sm">
        <thead><tr className="text-left text-xs text-slate-600">
          <th className="py-2 pr-3 font-bold">obszar</th>
          <th className="py-2 pr-3 font-bold">nieużyte</th>
          <th className="py-2 pr-3 font-bold">użyte</th>
          <th className="w-1/3 py-2 font-bold"><span className="sr-only">udział nieużytych</span></th></tr></thead>
        <tbody className="divide-y divide-slate-100">
          {r.obszary.map((o) => {
            const otwarty = otwarte.has(o.obszar);
            const razem = o.nieuzywane.length + o.uzywane.length;
            return <React.Fragment key={o.obszar}>
              <tr>
                <td className="py-1.5 pr-3">
                  <button type="button" aria-expanded={otwarty} onClick={() => przelacz(o.obszar)}
                    className="font-semibold text-slate-900 hover:underline">{otwarty ? "▾" : "▸"} {o.obszar}</button></td>
                <td className="py-1.5 pr-3 tabular-nums">{o.nieuzywane.length}</td>
                <td className="py-1.5 pr-3 tabular-nums text-slate-600">{o.uzywane.length}</td>
                <td className="py-1.5"><PasekUdzialu ile={o.nieuzywane.length} max={razem}
                  etykieta={`${o.nieuzywane.length} z ${razem} nieużyte`} /></td>
              </tr>
              {otwarty && <tr><td colSpan={4} className="bg-slate-50 px-3 py-2">
                {o.nieuzywane.length === 0
                  ? <p className="text-slate-600">Wszystko w tym obszarze było użyte.</p>
                  : <ul className="grid gap-x-6 gap-y-1 sm:grid-cols-2 xl:grid-cols-3" aria-label={`Nieużyte: ${o.obszar}`}>
                      {o.nieuzywane.map((w) => <li key={w.typ} title={w.typ}>
                        {nazwaZdarzenia(w.typ)} <span className="text-slate-600">· {w.ostatnio ? czas(w.ostatnio) : "nigdy"}</span></li>)}
                    </ul>}
                {o.uzywane.length > 0 && <details className="mt-2">
                  <summary className="cursor-pointer text-slate-600">Użyte ({o.uzywane.length})</summary>
                  <ul className="mt-1 space-y-0.5">
                    {o.uzywane.map((w) => <li key={w.typ} title={w.typ} className="flex gap-3">
                      <span className="w-12 shrink-0 text-right tabular-nums">{w.ile}</span>
                      <span>{nazwaZdarzenia(w.typ)}</span></li>)}
                  </ul>
                </details>}
              </td></tr>}
            </React.Fragment>;
          })}
        </tbody>
      </table>
    </KartaWgladu>

    {/* Typ w dzienniku, którego rejestr nie zna — stary albo dopisany bez
        wpisu. Stoi osobno i surowym kluczem: słownik go nie zna z definicji. */}
    {r.spozaRejestru.length > 0 && <KartaWgladu tytul="Spoza rejestru"
      opis="Typy z dziennika, których rejestr zdarzeń nie zna.">
      <Tabela naglowki={["typ", "w oknie", "ostatnio"]} pusto="">
        {r.spozaRejestru.map((w) => <tr key={w.typ}>
          <Td className="font-mono text-xs">{w.typ}</Td>
          <Td className="tabular-nums">{w.ile}</Td>
          <Td>{czas(w.ostatnio)}</Td>
        </tr>)}
      </Tabela>
    </KartaWgladu>}
  </>;
}
