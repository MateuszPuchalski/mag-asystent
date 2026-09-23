import React from "react";
import type { RaportUzycia } from "../api/wglad";
import { KartaWgladu, Tabela, Td } from "../ui/wglad";
import { Liczba } from "../ui/wykres";
import { czas } from "../ui";

/* ── Zakres UŻYCIE (23 września 2026) ────────────────────────────────────────
   Odpowiedź na „co można zdjąć z ekranu" z danych, nie ze sporu. Serwer liczy
   ją z dziennika zdarzeń (`services/uzycie.ts`) — każda czynność w panelu i na
   kolektorze zostawia tam wpis.

   RAPORT WIDZI CZYNNOŚCI, NIE WEJŚCIA NA EKRAN. Zero zapisu przy patrzeniu
   znaczy, że samo otwarcie ekranu nie zostawia śladu — więc ekran, na który
   się tylko patrzy, zawsze wyjdzie tu „nieużywany". Opis karty mówi to wprost,
   bo bez tego raport doradziłby zdjęcie Analizy.

   UŻYWANE SĄ ZWINIĘTE. Pytanie brzmi „czego nikt nie nacisnął", a lista stu
   czynności z licznikami zagłuszyłaby tę odpowiedź. */

export function ZakresUzycia({ r }: { r: RaportUzycia }) {
  const martwe = r.obszary.reduce((s, o) => s + o.nieuzywane.length, 0);
  const zywe = r.obszary.reduce((s, o) => s + o.uzywane.length, 0);
  return <>
    <KartaWgladu tytul={`Czego nikt nie użył w ${r.dni} dniach`}
      opis="Czynności z dziennika zdarzeń. Samo otwarcie ekranu nie zostawia śladu.">
      <div className="flex flex-wrap gap-8">
        <Liczba ile={martwe} etykieta="czynności bez ani jednego użycia" />
        <Liczba ile={zywe} etykieta="czynności użyte" />
      </div>
    </KartaWgladu>

    {r.obszary.map((o) => <KartaWgladu key={o.obszar} tytul={o.obszar}
      opis={`${o.nieuzywane.length} nieużyte · ${o.uzywane.length} użyte`}>
      <Tabela naglowki={["czynność", "ostatnio"]} pusto="Wszystko w tym obszarze było użyte.">
        {o.nieuzywane.map((w) => <tr key={w.typ}>
          <Td className="font-mono text-xs">{w.typ}</Td>
          <Td className="text-slate-600">{w.ostatnio ? czas(w.ostatnio) : "nigdy"}</Td>
        </tr>)}
      </Tabela>
      {o.uzywane.length > 0 && <details className="mt-2 text-sm">
        <summary className="cursor-pointer text-slate-600">Użyte ({o.uzywane.length})</summary>
        <ul className="mt-1 space-y-0.5">
          {o.uzywane.map((w) => <li key={w.typ} className="flex gap-3">
            <span className="w-12 shrink-0 text-right tabular-nums">{w.ile}</span>
            <span className="font-mono text-xs">{w.typ}</span></li>)}
        </ul>
      </details>}
    </KartaWgladu>)}

    {/* Typ w dzienniku, którego rejestr nie zna — stary albo dopisany bez
        wpisu. Stoi osobno, żeby raport nie chował niczego po cichu. */}
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
