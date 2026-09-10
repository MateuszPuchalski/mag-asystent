import React from "react";
import { Karta } from "../ui";
import type { SkutecznoscDoboru as Raport } from "../api/typy";
import { Liczba } from "./PokrycieSygnatur";
import { NAZWA_DROGI } from "../skrzynka/statusy";

/* ── Skuteczność doboru (0.267.0) ────────────────────────────────────────────
   Karta istnieje po to, żeby decyzja „w który szczebel doboru zainwestować"
   zapadła na liczbach. `dobor_rozmowy.wybrany_droga` zbierała odpowiedź od
   0.229.0 i nikt jej nie czytał.

   Trzy nawyki wzięte z `PomiarCopilota.tsx`, bo każdy z nich pilnuje czegoś,
   czego sam procent nie powie:

   PIERWSZY: `n` STOI OBOK każdej liczby pochodnej. „Mediana 12 minut" bez
   informacji, z ilu wyborów, jest liczbą bez wagi — a i tak zostanie
   przeczytana jako fakt o pracy zespołu.

   DRUGI: szczebel z zerem ZOSTAJE na liście. To jest najcenniejsze ustalenie
   tego raportu: droga utrzymywana w kodzie, która nie dała jeszcze nikomu
   odpowiedzi. Wypadnięcie jej razem z zerem zamieniłoby ustalenie w ciszę.

   TRZECI: granica historii jest WYPISANA. Retencja kasuje rozmowy sprzed
   `ALLEGRO_INBOX_OD`, więc selektor „90 dni" potrafi obiecywać kwartał,
   którego w bazie nie ma. Zdanie o tym stoi pod selektorem, a nie w niczyjej
   pamięci.

   OŚ OSOBOWA I KODEKS PRACY. Tabela osób to monitoring pracowniczy
   (art. 22²). Podstawa prawna jedzie z serwera i jest wypisana POD tabelą,
   nie schowana w tooltipie — ta karta nie ma prawa pozwolić o niej zapomnieć.
   Świadomie NIE ma tu kolumny, po której da się posortować ludzi od
   najlepszego do najgorszego: „najczęstsza droga" mówi, JAK ktoś pracuje,
   czyli komu warto pokazać bazę wiedzy.                                     */

const OKNA = [7, 30, 90];

export function SkutecznoscDoboru({ dane, dni, onDni }: {
  dane: Raport | undefined; dni: number; onDni: (d: number) => void;
}) {
  if (!dane) return null;
  const zeroDrog = dane.drogi.filter((d) => d.wybranych === 0);
  return <Karta className="overflow-hidden">
    <header className="flex flex-wrap items-baseline gap-2 border-b p-4">
      <b className="text-naglowek mr-auto">Skuteczność doboru — którędy przychodzi odpowiedź</b>
      <div className="flex gap-1" role="group" aria-label="Okno raportu">
        {OKNA.map((d) => <button key={d} type="button" onClick={() => onDni(d)}
          aria-pressed={d === dni}
          className={`rounded px-2 py-0.5 text-xs ${d === dni
            ? "bg-slate-200 font-semibold text-slate-900" : "text-slate-500 hover:text-slate-800"}`}>
          {d} dni</button>)}
      </div>
    </header>

    <div className="flex flex-wrap gap-8 p-4">
      <Liczba etykieta="wyborów kandydata" ile={dane.wyborow} />
      <Liczba etykieta="doborów na stole" ile={dane.naStole.doborow} />
      <Liczba etykieta="bez konta autora" ile={dane.bezKonta}
        ton={dane.bezKonta > 0 ? "text-ranga-uwaga" : ""} />
    </div>

    <p className="border-t p-4 text-sm text-slate-600">
      Mediana od pytania klienta do wyboru: <b>{dane.medianaDoWyboruMin === null
        ? "—" : `${dane.medianaDoWyboruMin} min`}</b> z {dane.wyborowZCzasem} wyborów.
      {dane.granicaHistorii && <> Rozmów sprzed <b>{dane.granicaHistorii.slice(0, 10)}</b>
        {" "}w bazie nie ma, więc dłuższe okno nie doda historii.</>}
    </p>

    <div className="border-t p-4">
      <table className="w-full text-sm">
        <thead><tr className="text-left text-xs text-slate-500">
          <th className="font-normal">szczebel §11.2</th>
          <th className="font-normal">wybrany</th>
          <th className="font-normal">z tego zatwierdzony</th>
        </tr></thead>
        <tbody>
          {dane.drogi.map((d) => <tr key={d.droga} className="border-t border-slate-100">
            <td className="py-1">{NAZWA_DROGI[d.droga]}</td>
            {/* Zero NIE jest wyszarzone, i to jest ta sama myśl, co w nagłówku
                pliku: szczebel bez wyboru to najcenniejsze ustalenie tego
                raportu. Wyciszenie go poniżej czytelności byłoby ukryciem
                faktu, nie wyciszeniem (§4.3, strażnik `Kontrast.test.ts`). */}
            <td className={d.wybranych === 0 ? "" : "font-semibold"}>{d.wybranych}</td>
            <td>{d.zatwierdzonych}</td>
          </tr>)}
        </tbody>
      </table>
      {/* Zero jako ZDANIE, nie jako brak wiersza — patrz nagłówek pliku. */}
      {zeroDrog.length > 0 && <p className="mt-2 text-xs text-slate-500">
        Bez ani jednego wyboru w tym oknie: <b>{zeroDrog.map((d) => NAZWA_DROGI[d.droga]).join(", ")}</b>.
        {" "}To są szczeble, które utrzymujemy w kodzie, a które jeszcze nikomu nie odpowiedziały.
      </p>}
    </div>

    {dane.osoby.length > 0 && <div className="border-t p-4">
      <table className="w-full text-sm">
        <thead><tr className="text-left text-xs text-slate-500">
          <th className="font-normal">kto</th>
          <th className="font-normal">wyborów</th>
          <th className="font-normal">zatwierdzonych</th>
          <th className="font-normal">najczęściej kończy na</th>
          <th className="font-normal">mediana</th>
        </tr></thead>
        <tbody>
          {dane.osoby.map((o) => <tr key={o.userId ?? o.osoba} className="border-t border-slate-100">
            <td className="py-1">{o.osoba}</td>
            <td>{o.wybranych}</td>
            <td>{o.zatwierdzonych}</td>
            <td>{o.najczestszaDroga ? NAZWA_DROGI[o.najczestszaDroga] : "—"}</td>
            {/* `null` poniżej progu wypisujemy jako kreskę z powodem, nie jako zero. */}
            <td>{o.medianaMin === null
              ? <span className="text-slate-500" title={`poniżej ${dane.progWiarygodnosci} wyborów`}>—</span>
              : `${o.medianaMin} min`}</td>
          </tr>)}
        </tbody>
      </table>
      <p className="mt-2 text-xs text-slate-500">
        Mediana pokazuje się od <b>{dane.progWiarygodnosci}</b> wyborów — niżej byłaby szumem
        postawionym przy nazwisku. Kolumna „najczęściej kończy na" mówi, JAK ktoś pracuje,
        a nie jak dobrze.
      </p>
      <p className="mt-2 text-xs text-ranga-uwaga">{dane.podstawaPrawna}</p>
    </div>}
  </Karta>;
}
