import React, { useState } from "react";
import { CalendarRange } from "lucide-react";
import { useRaportTygodnia, useTygodnie, type Migawka, type RaportTygodnia } from "../api/wglad";
import { Blad, FiltrSegmentowy, Pusto, godzina, wiek } from "../ui";
import { Slupki } from "../ui/wykres";
import { KartaWgladu, Tabela, Td } from "../ui/wglad";
import { dzienSkrot, liczbaPl } from "./liczby";
import { podpisTygodnia, zmiana } from "./porownanie";

/* ── Zakres TYDZIEŃ (0.497.0) ────────────────────────────────────────────
   Raport tygodnia liczy serwer sam, w pierwszym takcie po poniedziałkowej
   północy, i zapisuje go na stałe (`services/raport-tygodnia.ts`). Ten ekran
   tylko czyta — zero zapisu przy patrzeniu, jak każdy zakres Analizy.

   JEDNA TABELA PORÓWNANIA, NIE KAFLE. Kafel pokazuje liczbę, a pytanie
   tego ekranu brzmi „co się zmieniło". Kolumna poprzedniego tygodnia
   i kolumna różnicy stoją obok siebie, więc oko nie skacze między kartami.

   MIGAWKI OSOBNO. Tabela porównania mówi, co się wydarzyło (przepływ),
   migawki — ile czekało (stan). Zaległość rośnie, gdy wpływa więcej, niż
   się rozstrzyga, i to widać dopiero przy obu naraz.

   Osiem ostatnich tygodni w czipach — dwa miesiące wystarczają, żeby
   zobaczyć kierunek. Starsze raporty zostają w bazie, ale ekran nie jest
   archiwum, a wybór z pięćdziesięciu pozycji to decyzja za dużo. */

const WIDOCZNE_TYGODNIE = 8;

type Wiersz = [etykieta: string, teraz: number | null, przed: number | null | undefined, jednostka?: string];

function wiersze(r: RaportTygodnia, p: RaportTygodnia | null): Array<{ grupa: string; wiersze: Wiersz[] }> {
  return [
    { grupa: "Hala", wiersze: [
      ["Pozycje rozłożone i przeniesione", r.magazyn.pozycje, p?.magazyn.pozycje],
      ["Dostawy domknięte", r.magazyn.dostawZamknietych, p?.magazyn.dostawZamknietych],
      ["Mediana czasu rozłożenia dostawy", r.magazyn.medianaMinutDostawy, p?.magazyn.medianaMinutDostawy, "min"],
      ["Wyjątki zgłoszone", r.magazyn.problemyZgloszone, p?.magazyn.problemyZgloszone],
      ["Wyjątki rozstrzygnięte", r.magazyn.problemyRozwiazane, p?.magazyn.problemyRozwiazane],
      ["Dotknięcia na pozycję (cel poniżej 0,3)", r.magazyn.dotknieciaNaPozycje, p?.magazyn.dotknieciaNaPozycje],
      ["p95 odpowiedzi na skan", r.magazyn.p95SkanuMs, p?.magazyn.p95SkanuMs, "ms"],
      ["Upadki kolektorów", r.magazyn.upadkiKolektorow, p?.magazyn.upadkiKolektorow],
      ["Operacje z bufora odrzucone", r.magazyn.odrzuconeOperacje, p?.magazyn.odrzuconeOperacje],
    ] },
    { grupa: "Obsługa klienta", wiersze: [
      ["Wiadomości od klientów", r.obsluga.wiadomosciOdKlientow, p?.obsluga.wiadomosciOdKlientow],
      ["Odpowiedzi", r.obsluga.odpowiedzi, p?.obsluga.odpowiedzi],
      ["Mediana czasu odpowiedzi", r.obsluga.medianaMin, p?.obsluga.medianaMin, "min"],
      ["p90 czasu odpowiedzi", r.obsluga.p90Min, p?.obsluga.p90Min, "min"],
      ["Klienci czekający na zamknięcie tygodnia", r.obsluga.klientCzekaNaKoniec.n, p?.obsluga.klientCzekaNaKoniec.n],
      ["Zwroty nowe", r.obsluga.zwrotyNowe, p?.obsluga.zwrotyNowe],
      ["Zwroty zamknięte", r.obsluga.zwrotyZamkniete, p?.obsluga.zwrotyZamkniete],
      ["Reklamacje i dyskusje nowe", r.obsluga.reklamacjeNowe, p?.obsluga.reklamacjeNowe],
      ["Reklamacje rozstrzygnięte", r.obsluga.reklamacjeRozstrzygniete, p?.obsluga.reklamacjeRozstrzygniete],
    ] },
    { grupa: "Copilot i system", wiersze: [
      ["Wywołania Copilota", r.copilot.wywolan, p?.copilot.wywolan],
      ["Błędy Copilota", r.copilot.bledow, p?.copilot.bledow],
      ["Koszt Copilota", r.copilot.kosztUsd, p?.copilot.kosztUsd, "USD"],
      ["Noce z kopią bazy (z 7)", r.system.kopieNocne, p?.system.kopieNocne],
      ["Rozjazdy w ostatniej rekoncyliacji", r.system.rozjazdyRekoncyliacji, p?.system.rozjazdyRekoncyliacji],
      ["Zapisy do Subiekta nieudane", r.system.zapisyNieudane, p?.system.zapisyNieudane],
      ["Żądania odrzucone przez serwer", r.system.odrzuconeZadaniaHttp, p?.system.odrzuconeZadaniaHttp],
    ] },
  ];
}

const wartosc = (n: number | null | undefined, jednostka?: string) =>
  n == null ? "—" : `${liczbaPl(n)}${jednostka ? ` ${jednostka}` : ""}`;

/** Kubełek „do decyzji" z migawki — `null` sekcji to „nie policzono", nie zero. */
const kubelek = (m: Record<string, number> | null, klucz: string) => (m ? m[klucz] ?? 0 : null);

function WierszMigawki({ data, at, stan }: { data: string; at: string; stan: Migawka }) {
  const dd = stan.doDecyzji;
  return <tr>
    <Td className="whitespace-nowrap">{dzienSkrot(data)} <span className="text-slate-600">{godzina(at)}</span></Td>
    <Td className="tabular-nums">{dd ? <>{dd.wszystko}{dd.pilne > 0 && <span className="text-slate-600"> · pilne {dd.pilne}</span>}</> : "—"}</Td>
    <Td>{dd?.najstarszaGodz == null ? "—" : wiek(dd.najstarszaGodz * 3_600_000)}</Td>
    <Td className="tabular-nums">{stan.klientCzeka ? stan.klientCzeka.n : "—"}</Td>
    <Td className="tabular-nums">{wartosc(kubelek(stan.zwroty, "decyzja"))}</Td>
    <Td className="tabular-nums">{wartosc(kubelek(stan.reklamacje, "decyzja"))}</Td>
    <Td className="tabular-nums">{wartosc(stan.problemyOtwarte)}</Td>
    <Td className="tabular-nums">{stan.kolejka ? stan.kolejka.bledy : "—"}</Td>
  </tr>;
}

export function ZakresTygodnia() {
  const lista = useTygodnie(true);
  const [wybrany, setWybrany] = useState<string | null>(null);
  const tygodnie = lista.data?.tygodnie ?? [];
  /* Domyślnie najnowszy. Wybór trzymany jako etykieta, nie indeks — lista
     rośnie w poniedziałek i indeks przesunąłby się pod ręką. */
  const tydzien = wybrany ?? tygodnie[0]?.tydzien ?? null;
  const raport = useRaportTygodnia(tydzien);

  if (lista.error) return <Blad>{lista.error.message}</Blad>;
  if (lista.data && !tygodnie.length) {
    return <Pusto ikona={CalendarRange}>
      Pierwszy raport powstanie sam w poniedziałek po pierwszym pełnym tygodniu pracy WERTIS.
      Tydzień zaczęty w połowie nie dostaje raportu, bo w porównaniu wyglądałby na przestój.
    </Pusto>;
  }

  const r = raport.data?.raport;
  const p = raport.data?.poprzedni ?? null;
  return <>
    {tygodnie.length > 0 && <nav aria-label="Tydzień raportu" className="flex flex-wrap gap-1">
      <FiltrSegmentowy<string> wybrany={tydzien ?? ""} onWybierz={setWybrany}
        pozycje={tygodnie.slice(0, WIDOCZNE_TYGODNIE).map((t) => ({
          klucz: t.tydzien, etykieta: `t${Number(t.tydzien.slice(-2))}`, podpowiedz: `Tydzień ${t.tydzien}`,
        }))} />
    </nav>}
    <Blad>{raport.error?.message}</Blad>

    {r && <>
      <KartaWgladu tytul={`Tydzień ${podpisTygodnia(r)}`}
        opis={p ? `Obok tydzień ${podpisTygodnia(p)}. Różnica w sztukach — przy tak małych liczbach procent brzmiałby jak alarm.`
          : "Poprzedniego tygodnia nie policzono, więc nie ma z czym porównać."}>
        <Tabela naglowki={["Miara", "Ten tydzień", "Poprzedni", "Zmiana"]} pusto="Raport jest pusty.">
          {wiersze(r, p).flatMap((g) => [
            <tr key={g.grupa}><td colSpan={4} className="pb-1.5 pt-4 text-xs font-bold uppercase text-slate-600">{g.grupa}</td></tr>,
            ...g.wiersze.map(([etykieta, teraz, przed, jedn]) => <tr key={`${g.grupa}:${etykieta}`}>
              <Td>{etykieta}</Td>
              <Td className="font-semibold tabular-nums">{wartosc(teraz, jedn)}</Td>
              <Td className="tabular-nums text-slate-600">{p ? wartosc(przed, jedn) : "—"}</Td>
              <Td className="tabular-nums">{p ? zmiana(teraz, przed) : "—"}</Td>
            </tr>),
          ])}
        </Tabela>
      </KartaWgladu>

      <KartaWgladu tytul="Praca hali dzień po dniu" opis="Pozycje po dobie lokalnej magazynu. Dzień z zerem zostaje na osi.">
        <Slupki opis={`Pozycje w kolejnych dniach tygodnia ${r.tydzien}`} co={1}
          dane={r.dni.map((d, i) => ({ ile: r.magazyn.pozycjeWgDnia[i] ?? 0, podpis: dzienSkrot(d), tytul: d }))} />
      </KartaWgladu>

      {/* Stan, nie przepływ — patrz nagłówek pliku. Godzina przy dniu, bo
          migawka z północy i migawka z 7:40 mówią o innej chwili. */}
      <KartaWgladu tytul="Ile czekało, dzień po dniu"
        opis="Migawka z pierwszego taktu doby. Wiersz z następnego poniedziałku to stan na zamknięcie tygodnia. Kreska znaczy „nie policzono”, nie zero.">
        <Tabela naglowki={["Dzień", "Do decyzji", "Najstarsza", "Klient czeka", "Zwroty do decyzji",
          "Reklamacje do decyzji", "Wyjątki otwarte", "Zapisy w błędzie"]}
          pusto="W tym tygodniu serwer nie zrobił ani jednej migawki. Pierwsza powstaje w pierwszym takcie doby po wdrożeniu.">
          {r.migawki.map((m) => <WierszMigawki key={m.data} {...m} />)}
        </Tabela>
      </KartaWgladu>

      <KartaWgladu tytul="Do poprawienia po tym tygodniu"
        opis="Regały wpisywane z ręki to etykiety do przedruku. Szukania bez wyniku to towar bez kartoteki albo bez aliasu.">
        <div className="grid gap-6 md:grid-cols-2">
          <Tabela naglowki={["Regał", "Wpisany ręcznie"]} pusto="Żadnego regału nie wpisywano z ręki.">
            {r.magazyn.etykietyDoPrzedruku.map((e) => <tr key={e.kod}>
              <Td className="font-mono">{e.kod}</Td><Td className="tabular-nums">{e.reczne}</Td></tr>)}
          </Tabela>
          <Tabela naglowki={["Szukane", "Razy bez wyniku"]} pusto="Każde szukanie coś znalazło.">
            {r.magazyn.szukaniaBezWynikow.map((s) => <tr key={s.q}>
              <Td>{s.q}</Td><Td className="tabular-nums">{s.ile}</Td></tr>)}
          </Tabela>
        </div>
      </KartaWgladu>
    </>}
  </>;
}
