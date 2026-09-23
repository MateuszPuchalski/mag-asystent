import React, { useState } from "react";
import { BarChart3, Download } from "lucide-react";
import { pobierzPlik } from "../api/klient";
import { useAnaliza, useAnalizaDostaw, useCzasOdpowiedzi, useMetryki } from "../api/wglad";
import { Blad, FiltrSegmentowy, Karta, Przycisk, czas } from "../ui";
import { ZakresDostaw } from "../analiza/ZakresDostaw";
import { ZakresHali } from "../analiza/ZakresHali";
import { Strefa } from "../analiza/Strefa";
import { ZakresObslugi } from "../analiza/ZakresObslugi";

/* ── ANALIZA (0.440.0) ───────────────────────────────────────────────────
   Przeniesiona z ANALIZY w `biuro.html`. Wgląd, nie praca: nic tu nie czeka
   na decyzję, a jedyny zapis to wgranie CSV zbiórek, które robi człowiek.

   DWA ZAKRESY, KAŻDY ZE SWOIM OKNEM. Trasy przyjmują różne okna — dostawy
   30/90/180, praca hali 7/30/90 — bo dostaw jest mniej i tydzień bywa
   w nich pusty. Jedna wspólna lista kazałaby jednej stronie kłamać: czip
   „7 dni" przy dostawach wyglądałby na wybrany, a serwer policzyłby swoje
   domyślne. Każdy zakres PAMIĘTA swoje okno, więc przełączenie zakresu tam
   i z powrotem nie gubi wyboru.

   DOSTAWY PIERWSZE. Cel biura z §7 to droga towaru przez magazyn, a „u kogo
   są problemy" jest pytaniem, z którym się tu przychodzi. Makieta F0 stawia
   je na starcie tak samo.

   ZAKRES „OBSŁUGA KLIENTA" doszedł 23 września 2026. Do tej wersji go nie
   było, choć makieta F0 go pokazała: brakowało źródła danych, a przeprowadzka
   nie wymyśla liczb. Źródłem jest czas odpowiedzi liczony z wiadomości —
   patrz `analiza/ZakresObslugi.tsx`.

   Pobierany jest WYŁĄCZNIE widoczny zakres — ta sama zasada, która trzymała
   biuro: nie pobiera się danych, na które nikt nie patrzy. */

type Zakres = "dostawy" | "hala" | "obsluga";

const OKNA: Record<Zakres, number[]> = { dostawy: [30, 90, 180], hala: [7, 30, 90], obsluga: [7, 30, 90] };

export function Analiza() {
  const [zakres, setZakres] = useState<Zakres>("dostawy");
  const [okna, setOkna] = useState<Record<Zakres, number>>({ dostawy: 90, hala: 7, obsluga: 30 });
  const dni = okna[zakres];
  const dostawy = useAnalizaDostaw(okna.dostawy, zakres === "dostawy");
  const hala = useAnaliza(okna.hala, zakres === "hala");
  const metryki = useMetryki(okna.hala, zakres === "hala");
  const obsluga = useCzasOdpowiedzi(okna.obsluga, zakres === "obsluga");
  const [bladCsv, setBladCsv] = useState("");

  const biezacy = zakres === "dostawy" ? dostawy : zakres === "hala" ? hala : obsluga;
  /* „Dane do…" — DO KTÓREJ CHWILI sięga zestawienie, liczone z najświeższego
     rekordu, nie z zegara serwera. Zegar mówiłby „przed chwilą" nawet wtedy,
     gdy kolektory od wczoraj nic nie dosyłają. */
  const daneDo = biezacy.data?.daneDo;

  return <div className="space-y-4 lg:h-full lg:overflow-y-auto">
    <Karta className="flex flex-wrap items-center gap-3 p-4">
      <BarChart3 size={18} /><b className="text-naglowek">Analiza</b>
      <span className="mr-auto text-sm text-slate-500">
        Okno {dni} dni{daneDo ? ` · dane do ${czas(daneDo)}` : ""}</span>
      {/* CSV ma tylko praca hali — zakres dostaw nie ma trasy eksportu.
          Przycisk, który pobiera plik z innego zakresu, jest gorszy od
          przycisku, którego nie ma. */}
      {zakres === "hala" && <Przycisk onClick={() => {
        setBladCsv("");
        pobierzPlik(`/api/analiza/csv?days=${dni}`, "wertis-analiza.csv").catch((e: Error) => setBladCsv(e.message));
      }}><Download size={16} />CSV</Przycisk>}
      {/* Filtry w JEDNYM rzędzie pod tytułem, na bieli nagłówka — rządzą
          wszystkimi kartami niżej, więc nie stoją w żadnej z nich. Na tle
          strony niewybrana pigułka (`slate-100` na `slate-50`) znikała. */}
      <div className="flex w-full flex-wrap items-center gap-4">
        <nav aria-label="Zakres analizy" className="flex gap-1">
          <FiltrSegmentowy<Zakres> wybrany={zakres} onWybierz={setZakres} pozycje={[
            { klucz: "dostawy", etykieta: "Dostawy", podpowiedz: "U kogo są problemy — dostawcy i wyjątki" },
            { klucz: "hala", etykieta: "Praca hali", podpowiedz: "Tempo, szczyty, wyszukiwania, kolektory" },
            { klucz: "obsluga", etykieta: "Obsługa klienta", podpowiedz: "Czas odpowiedzi klientowi" },
          ]} /></nav>
        <div role="group" aria-label="Okno analizy" className="flex gap-1">
          <FiltrSegmentowy<number> wybrany={dni} onWybierz={(d) => setOkna((o) => ({ ...o, [zakres]: d }))}
            pozycje={OKNA[zakres].map((d) => ({ klucz: d, etykieta: `${d} dni` }))} /></div>
      </div>
    </Karta>

    <Blad>{bladCsv || biezacy.error?.message}</Blad>

    {/* Poprzedni wynik stoi przy zmianie okna, przygaszony, zamiast mrugać
        pustką — liczby nie skaczą do zera i z powrotem. */}
    <div className={`space-y-4 ${biezacy.isPlaceholderData ? "opacity-60" : ""}`}>
      {zakres === "dostawy" && dostawy.data && <ZakresDostaw a={dostawy.data} />}
      {zakres === "obsluga" && obsluga.data && <ZakresObslugi a={obsluga.data} />}
      {zakres === "hala" && hala.data && <>
        <ZakresHali a={hala.data} m={metryki.data} />
        <Strefa />
      </>}
    </div>
  </div>;
}
