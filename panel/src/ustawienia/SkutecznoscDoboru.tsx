import React from "react";
import { KartaWgladu, Tabela, Td } from "../ui/wglad";
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
   którego w bazie nie ma. Zdanie o tym stoi pod selektorem okna zakresu,
   a nie w niczyjej pamięci.

   OŚ OSOBOWA I KODEKS PRACY. Tabela osób to monitoring pracowniczy
   (art. 22²). Podstawa prawna jedzie z serwera i jest wypisana POD tabelą,
   nie schowana w tooltipie — ta karta nie ma prawa pozwolić o niej zapomnieć.
   Świadomie NIE ma tu kolumny, po której da się posortować ludzi od
   najlepszego do najgorszego: „najczęstsza droga" mówi, JAK ktoś pracuje,
   czyli komu warto pokazać bazę wiedzy.                                     */

/* SELEKTOR OKNA ZESZEDŁ (@wydanie). Od 0.444.0 był opcjonalny, a jedyny
   odbiorca — analiza — go nie podawał: karta stoi pod nagłówkiem z oknem
   7/30/90 dla całego zakresu. Z tego samego powodu zeszło „okno N dni"
   w nagłówku karty — ten sam fakt drugi raz, dwa wiersze niżej.

   RAMA I TABELE WSPÓLNE z resztą analizy (@wydanie), a tabela osób zwinięta
   pod „Szczegóły": czyta się ją rzadko, a otwarta była połową karty.
   Podstawa prawna jedzie z nią — stoi POD tabelą, tam gdzie monitoring. */
export function SkutecznoscDoboru({ dane }: { dane: Raport | undefined }) {
  if (!dane) return null;
  const zeroDrog = dane.drogi.filter((d) => d.wybranych === 0);
  return <KartaWgladu tytul="Skuteczność doboru — którędy przychodzi odpowiedź">
    <div className="flex flex-wrap gap-8">
      <Liczba etykieta="wyborów kandydata" ile={dane.wyborow} />
      <Liczba etykieta="doborów na stole" ile={dane.naStole.doborow} />
      <Liczba etykieta="bez konta autora" ile={dane.bezKonta}
        ton={dane.bezKonta > 0 ? "text-ranga-uwaga" : ""} />
    </div>

    <p className="mt-4 border-t pt-4 text-sm text-slate-600">
      Mediana od pytania klienta do wyboru: <b>{dane.medianaDoWyboruMin === null
        ? "—" : `${dane.medianaDoWyboruMin} min`}</b> z {dane.wyborowZCzasem} wyborów.
      {dane.granicaHistorii && <> Rozmów sprzed <b>{dane.granicaHistorii.slice(0, 10)}</b>
        {" "}w bazie nie ma, więc dłuższe okno nie doda historii.</>}
    </p>

    <div className="mt-4 border-t pt-4">
      {/* Nagłówek „szczebel §11.2" był odsyłaczem do dokumentu, nie do
          pracy agenta (@wydanie) — kolumna mówi „droga", jak nazwy w niej. */}
      <Tabela naglowki={["droga", "wybrany", "z tego zatwierdzony"]} pusto="">
        {dane.drogi.map((d) => <tr key={d.droga}>
          <Td>{NAZWA_DROGI[d.droga]}</Td>
          {/* Zero NIE jest wyszarzone, i to jest ta sama myśl, co w nagłówku
              pliku: szczebel bez wyboru to najcenniejsze ustalenie tego
              raportu. Wyciszenie go poniżej czytelności byłoby ukryciem
              faktu, nie wyciszeniem (§4.3, strażnik `Kontrast.test.ts`). */}
          <Td className={d.wybranych === 0 ? "" : "font-semibold"}>{d.wybranych}</Td>
          <Td>{d.zatwierdzonych}</Td>
        </tr>)}
      </Tabela>
      {/* Zero jako ZDANIE, nie jako brak wiersza — patrz nagłówek pliku.
          Dopisek „to szczeble, które utrzymujemy w kodzie" zszedł (@wydanie):
          to wniosek dla programisty, agentowi wystarczy sama lista. */}
      {zeroDrog.length > 0 && <p className="mt-2 text-xs text-slate-500">
        Bez ani jednego wyboru w tym oknie: <b>{zeroDrog.map((d) => NAZWA_DROGI[d.droga]).join(", ")}</b>.
      </p>}
    </div>

    {dane.osoby.length > 0 && <details className="mt-4 border-t pt-4 text-sm">
      <summary className="cursor-pointer text-slate-600">Szczegóły</summary>
      <div className="mt-2">
        <Tabela naglowki={["kto", "wyborów", "zatwierdzonych", "najczęściej kończy na", "mediana"]} pusto="">
          {dane.osoby.map((o) => <tr key={o.userId ?? o.osoba}>
            <Td>{o.osoba}</Td>
            <Td>{o.wybranych}</Td>
            <Td>{o.zatwierdzonych}</Td>
            <Td>{o.najczestszaDroga ? NAZWA_DROGI[o.najczestszaDroga] : "—"}</Td>
            {/* `null` poniżej progu wypisujemy jako kreskę z powodem, nie jako zero. */}
            <Td>{o.medianaMin === null
              ? <span className="text-slate-500" title={`poniżej ${dane.progWiarygodnosci} wyborów`}>—</span>
              : `${o.medianaMin} min`}</Td>
          </tr>)}
        </Tabela>
      </div>
      <p className="mt-2 text-xs text-slate-500">
        Mediana pokazuje się od <b>{dane.progWiarygodnosci}</b> wyborów — niżej byłaby szumem
        postawionym przy nazwisku. Kolumna „najczęściej kończy na" mówi, JAK ktoś pracuje,
        a nie jak dobrze.
      </p>
      <p className="mt-2 text-xs text-ranga-uwaga">{dane.podstawaPrawna}</p>
    </details>}
  </KartaWgladu>;
}
