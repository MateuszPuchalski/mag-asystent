import React from "react";
import type { AnalizaDostaw } from "../api/wglad";
import { odmien } from "../ui";
import { Liczba, PasekUdzialu, Slupki } from "../ui/wykres";
import { dniPl, liczbaPl, zdanieOSzczycie } from "./liczby";
import { KartaWgladu, Tabela, Td } from "../ui/wglad";

/* ── Zakres DOSTAWY (z `biuro.html`, w panelu od 0.440.0) ────────────────
   Pytanie brzmi „U KOGO SĄ PROBLEMY". Do 0.100.0 biuro odpowiadało na nie
   tylko otwieraniem faktur po kolei — jedyne liczby o dostawcy stały
   w kontekście otwartej faktury, po jednym dostawcy naraz. */

export function ZakresDostaw({ a }: { a: AnalizaDostaw }) {
  const maxUdzial = Math.max(...a.dostawcy.map((x) => x.udzialWyjatkow ?? 0), 0);
  /* Jedna skala na CAŁĄ tabelę wyjątków, licząc obie kolumny razem. Dwie
     skale dałyby pasek „otwarte" dłuższy od „rozwiązanych" przy mniejszej
     liczbie. Jedna skala na tabelę albo żadna. */
  const maxWyjatkow = Math.max(...a.wyjatki.flatMap((w) => [w.otwartych, w.rozwiazanych]), 0);
  return <>
    <KartaWgladu tytul="Dostawy w oknie">
      <div className="flex flex-wrap gap-8">
        <Liczba ile={a.zamknietych}
          etykieta={`${odmien(a.zamknietych, "dostawa domknięta", "dostawy domknięte", "dostaw domkniętych")} w ${a.dni} dniach`} />
        <Liczba ile={a.pozycjiRozlozonych}
          etykieta={odmien(a.pozycjiRozlozonych, "pozycja rozłożona", "pozycje rozłożone", "pozycji rozłożonych")} />
        <Liczba ile={dniPl(a.medianaDni)} etykieta="mediana czasu rozłożenia" />
        {/* Uwaga od 10%: nie próg z ustawy, tylko wartość, przy której warto
            spojrzeć na dostawcę. Ten sam próg co przy wskaźniku zwrotów. */}
        <Liczba ile={a.udzialWyjatkow == null ? "—" : `${liczbaPl(a.udzialWyjatkow)}%`}
          etykieta="pozycji z wyjątkiem"
          ton={a.udzialWyjatkow != null && a.udzialWyjatkow >= 10 ? "text-ranga-uwaga" : ""} />
        {/* Bez czerwieni: zamknięcie poza WERTIS jest legalną drogą, nie wpadką. */}
        <Liczba ile={a.pozaWertis} etykieta="z tego poza WERTIS" />
      </div>
    </KartaWgladu>

    <KartaWgladu tytul="Dostawy per tydzień" opis="Tydzień z zerem zostaje na osi.">
      <Slupki opis={`Dostawy domknięte w kolejnych tygodniach okna ${a.dni} dni`} co={a.tygodnie.length > 12 ? 4 : 1}
        dane={a.tygodnie.map((t) => ({ ile: t.ile, podpis: "t" + t.tydzien.slice(-2), tytul: `tydzień ${t.tydzien}` }))} />
      {a.szczyt && <p className="mt-3 text-sm text-slate-600">{zdanieOSzczycie(a.szczyt.ile, a.szczyt.medianaPozostalych,
        `w tygodniu ${a.szczyt.tydzien.slice(-2)}`, odmien(a.szczyt.ile, "dostawa", "dostawy", "dostaw"))}</p>}
    </KartaWgladu>

    {/* Sortowanie po UDZIALE (liczy serwer), nie po liczbie dostaw, i to jest
        cała treść tej tabeli: dostawca z dwiema fakturami i połową pozycji do
        wyjaśnienia jest ważniejszy od tego z czterdziestoma czystymi. */}
    <KartaWgladu tytul="Dostawcy · gdzie się psuje"
      opis="Najpierw ci z największym udziałem pozycji do wyjaśnienia. Mediana czasu liczy się z dostaw rozłożonych u nas — te zdjęte poza WERTIS wchodzą do liczby, ale nie do czasu.">
      <Tabela naglowki={["Dostawca", "Dostaw", "Pozycji", "Z wyjątkiem", "Mediana"]}
        pusto="Żadna dostawa nie domknęła się w tym oknie.">
        {a.dostawcy.map((x) => <tr key={x.dostawca}>
          <Td className="font-semibold">{x.dostawca}</Td>
          <Td className="tabular-nums">{x.dostaw}</Td>
          <Td className="tabular-nums text-slate-600">{x.pozycji}</Td>
          <Td>{x.udzialWyjatkow == null ? "—"
            : <PasekUdzialu ile={x.udzialWyjatkow} max={maxUdzial} etykieta={`${liczbaPl(x.udzialWyjatkow)}%`} />}</Td>
          <Td>{dniPl(x.medianaDni)}</Td>
        </tr>)}
      </Tabela>
    </KartaWgladu>

    <KartaWgladu tytul="Najczęstsze wyjątki"
      opis="Liczone po dacie zgłoszenia, nie po dacie domknięcia dostawy. Otwarte i rozwiązane osobno — ile się psuje i ile biuro nadąża domykać.">
      <Tabela naglowki={["Wyjątek", "Otwarte", "Rozwiązane"]} pusto="Nikt nie zgłosił wyjątku w tym oknie.">
        {a.wyjatki.map((w) => <tr key={w.typ}>
          <Td className="font-semibold">{w.nazwa}</Td>
          <Td><PasekUdzialu ile={w.otwartych} max={maxWyjatkow} /></Td>
          <Td><PasekUdzialu ile={w.rozwiazanych} max={maxWyjatkow} /></Td>
        </tr>)}
      </Tabela>
    </KartaWgladu>
  </>;
}
