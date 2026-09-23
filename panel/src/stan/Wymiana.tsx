import React, { useState } from "react";
import { useAlarmWymiany, useWymiana, type KanalWymiany } from "../api/stan";
import { Blad, FiltrSegmentowy, wiek } from "../ui";
import { KartaWgladu, Tabela, Td } from "../ui/wglad";

/* ── Ile trwa wymiana z halą (z `biuro.html` 0.361.0, 0.441.0) ───────────
   Pierwsza w tym repo liczba mówiąca, ILE trwa sprawa między halą a biurem.
   MEDIANA mówi, jak wygląda zwykły dzień, OGON (p90) — jak wygląda zły.
   Średniej nie ma celowo: jedna sprawa sprzed tygodnia utopiłaby sto
   załatwionych w kwadrans.

   ALARM POD TABELĄ LICZY Z OKNA STAŁEGO (30 dni), a tabela z wyboru obok.
   Dlatego stoi pod własnym nagłówkiem i sam mówi, z czego liczy — dwie liczby
   z różnych okresów bez podpisu to gotowy sprzeczny wniosek.

   Minuty na zdanie dla człowieka dają `wiek()` z `ui/` — ta sama funkcja,
   której używa zegar zadań terenowych. „4320 min" trzeba podzielić w głowie,
   żeby się przestraszyć. */

const NAZWA_KANALU: Record<KanalWymiany, string> = {
  zadanie: "Zadanie terenowe",
  niezgodnosc: "Niezgodność w dostawie",
  pominiecie: "Pominięcie w koszu",
  kolizja: "Kolizja kodu",
  notatka: "Notatka do dostawy",
};

const minuty = (m: number | null) => (m == null ? "—" : wiek(m * 60_000));

export function KartaWymiany() {
  const [dni, setDni] = useState(7);
  const wymiana = useWymiana(dni);
  const alarm = useAlarmWymiany();
  const a = alarm.data;
  const spoznione = (a?.kanaly ?? []).filter((k) => k.spoznionych > 0);
  /* Kanały bez progu wymieniamy Z NAZWY. Cisza znaczyłaby „nic nie stoi",
     a znaczy „jeszcze nie ma z czego liczyć". */
  const bezProgu = (a?.kanaly ?? []).filter((k) => k.progMin === null);

  return <KartaWgladu id="karta-wymiana" tytul="Ile trwa wymiana z halą"
    opis="Otwarte to sprawy, które trwają do dziś — bez nich tabela pokazywałaby wyłącznie to, co ktoś domknął. Notatka do dostawy jest jedynym kanałem, w którym brak odpowiedzi wstrzymuje pracę."
    akcje={<div role="group" aria-label="Okno tabeli wymiany" className="flex gap-1">
      <FiltrSegmentowy<number> wybrany={dni} onWybierz={setDni}
        pozycje={[7, 30, 90].map((d) => ({ klucz: d, etykieta: `${d} dni` }))} /></div>}>
    <Blad>{wymiana.error?.message}</Blad>
    <Tabela naglowki={["Kanał", "Kierunek", "Zamkniętych", "Mediana", "Ogon (p90)", "Otwarte", "Najstarsza otwarta"]}
      pusto="Brak spraw w tym oknie.">
      {(wymiana.data ?? []).map((w) => <tr key={w.kanal}>
        <Td className="font-semibold">{NAZWA_KANALU[w.kanal] ?? w.kanal}</Td>
        <Td className="whitespace-nowrap text-slate-600">{w.kierunek}</Td>
        <Td className="tabular-nums">{w.zamknietych}</Td>
        <Td>{minuty(w.medianaMin)}</Td>
        <Td className="text-slate-600">{minuty(w.p90Min)}</Td>
        <Td className="tabular-nums">{w.otwartych}</Td>
        <Td className="text-slate-600">{minuty(w.najstarszaOtwartaMin)}</Td>
      </tr>)}
    </Tabela>

    {a && <div className="mt-5 border-t pt-4">
      <h3 className={`text-sm font-bold ${spoznione.length ? "" : "text-slate-600"}`}>
        Co stoi dłużej, niż stoi zwykle — {spoznione.length ? a.spoznionychRazem : "nic"}</h3>
      {spoznione.length > 0 && <ul className="mt-2 space-y-1 text-sm">
        {spoznione.map((k) => <li key={k.kanal} className="flex flex-wrap gap-x-3">
          <b>{NAZWA_KANALU[k.kanal] ?? k.kanal}</b>
          <span className="tabular-nums">{k.spoznionych}</span>
          {/* Próg nie jest niczyim werdyktem: to p90 spraw domkniętych w tym
              samym kanale. Liczba bez pochodzenia byłaby wyrocznią. */}
          <span className="text-slate-600">próg {minuty(k.progMin)} {k.podstawa === "podloga" ? "(podłoga)" : `(p90 z ${k.n})`}</span>
          <span>najdłuższa: {minuty(k.najstarszaSpoznionaMin)}</span>
        </li>)}
      </ul>}
      {bezProgu.length > 0 && <p className="mt-2 text-sm text-slate-600">
        Bez progu — za mało domkniętych spraw (potrzeba {a.minSpraw}):{" "}
        {bezProgu.map((k) => `${NAZWA_KANALU[k.kanal] ?? k.kanal} (${k.n})`).join(", ")}.</p>}
      <p className="mt-2 text-sm text-slate-600">
        Próg liczony osobno dla każdego kanału z ostatnich {a.dni} dni; nie zależy od okna wybranego przy tabeli.</p>
    </div>}
  </KartaWgladu>;
}
