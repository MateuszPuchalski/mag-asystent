import React, { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  ChevronDown, ChevronLeft, ChevronRight, PackageCheck, PackageX, Plus, ReceiptText, Trash2, UserPlus,
} from "lucide-react";
import { Konflikt } from "../api/klient";
import {
  pomylkaZKonfliktu, useNowaPomylka, useOsobyPomylek, usePomylki, usePozycjePomylki, useUsunPomylke,
  useWznowPomylke, useZakonczPomylke, useZlapanePomylki, useZmienPomylke, type FiltrPomylek, type OsobaPomylki,
  type PodsumowaniePomylek, type Pomylka, type ZmianaPomylki,
} from "../api/pomylki";
import { etykietaKodu } from "../zwroty/Pieniadze";
import {
  Blad, FiltrSegmentowy, Karta, Plakietka, Przycisk, Pusto, Skopiuj, dataCyfrowa, dataLokalna,
  dzienMiesiac, ile, miesiacKrotko, miesiacSlownie,
} from "../ui";

/* ── POMYŁKI WYSYŁKOWE ───────────────────────────────────────────────────────
   Rejestr złych paczek, który biuro prowadziło w arkuszu: data, klient, co
   pomylono, kto zbierał, kto pakował, kto winny i czy sprawa domknięta.

   AGENT WPISUJE TYLKO TO, CZEGO SYSTEM NIE WIE. Klienta, zamówienie i datę
   daje kolejka, z której pomyłka się założyła. Nowy towar, powrót paczki
   i odmowę wypłaty znają zwroty i dosyłki, więc stoją jako fakt „z Allegro"
   i nie dają się edytować. Zostaje: co zamówił, co dostał, kto zbierał i kto
   pakował. Typowa pomyłka to trzy kliknięcia i dwa słowa.

   UZUPEŁNIANIE W MIEJSCU, BEZ OKNA. Wiersz rozwija się pod sobą, bo agent
   uzupełnia kilka pomyłek pod rząd i okno kazałoby za każdym razem szukać
   wiersza od nowa. Każdy klik zapisuje się od razu, a pole tekstowe przy
   wyjściu z pola albo Enterze.

   TABELA POKAZUJE TYLKO TO, PO CZYM SIĘ SZUKA: dzień, klient, co pomylono,
   osoby i stan. Nowy towar, powrót i odmowa stoją w rozwiniętym wierszu, bo
   w tabeli były głównie kreskami i spychały resztę w bok.

   WIERSZ NIE ZNIKA SPOD RĘKI. Zapis często przenosi pomyłkę poza bieżący
   filtr, np. z „Do uzupełnienia" do „W toku". Rozwinięty wiersz zostaje
   wtedy na swoim miejscu z dopiskiem i schodzi z listy dopiero po zwinięciu.

   OTWARCIE NICZEGO NIE ZAPISUJE, także wejście z adresu `?id=`. Pilnuje
   `Pomylki.zapis.test.tsx`. */

const FILTRY: Array<[FiltrPomylek, string]> = [
  ["do_uzupelnienia", "Do uzupełnienia"], ["w_toku", "W toku"],
  ["zakonczone", "Zakończone"], ["wszystkie", "Wszystkie"],
];

const STAN: Record<Pomylka["stan"], { slowo: string; status: string }> = {
  do_uzupelnienia: { slowo: "do uzupełnienia", status: "new" },
  w_toku: { slowo: "w toku", status: "open" },
  zakonczona: { slowo: "zakończona", status: "resolved" },
};

/** Czy pomyłka w tym stanie stoi w tym filtrze — ta sama reguła, którą liczy serwer. */
const pasuje = (f: FiltrPomylek, s: Pomylka["stan"]) =>
  f === "wszystkie" || (f === "zakonczone" ? s === "zakonczona" : s === f);

const dzisiaj = () => dataLokalna(new Date().toISOString());
const biezacyMiesiac = () => dzisiaj().slice(0, 7);

/** Miesiąc obok „RRRR-MM" — o `krok` w przód albo w tył. */
function przesunMiesiac(m: string, krok: number): string {
  const [r, mm] = m.split("-").map(Number);
  const d = new Date(r, mm - 1 + krok, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

const PRAWIDLOWY_MIESIAC = /^\d{4}-(0[1-9]|1[0-2])$/;

const KOLUMNY = ["Data", "Klient", "Pomyłka", "Zbierał", "Pakował", "Stan"];

export function Pomylki() {
  const [parametry, ustawParametry] = useSearchParams();
  const idZAdresu = Number(parametry.get("id")) || null;
  const miesiacZAdresu = parametry.get("miesiac");
  /* Wejście z „Zła paczka" albo z profilu: pomyłka ma być widoczna od razu,
     więc filtr staje na „Wszystkie", a miesiąc przychodzi w adresie. */
  const [filtr, setFiltr] = useState<FiltrPomylek>(idZAdresu ? "wszystkie" : "do_uzupelnienia");
  const [miesiac, setMiesiac] = useState(
    miesiacZAdresu && PRAWIDLOWY_MIESIAC.test(miesiacZAdresu) ? miesiacZAdresu : biezacyMiesiac());
  const [rozwiniety, setRozwiniety] = useState<number | null>(idZAdresu);
  const [przypiety, setPrzypiety] = useState<{ p: Pomylka; miejsce: number } | null>(null);
  const [paragon, setParagon] = useState(false);

  /* Drugi link z `?id=` przy otwartym ekranie (np. z profilu w drugiej karcie
     tej samej sesji routera) też ma rozwinąć swój wiersz. */
  useEffect(() => {
    if (!idZAdresu) return;
    setRozwiniety(idZAdresu);
    setFiltr("wszystkie");
    if (miesiacZAdresu && PRAWIDLOWY_MIESIAC.test(miesiacZAdresu)) setMiesiac(miesiacZAdresu);
  }, [idZAdresu, miesiacZAdresu]);

  const lista = usePomylki(filtr, miesiac);
  const pomylki = lista.data?.pomylki ?? [];
  const miejsce = rozwiniety === null ? -1 : pomylki.findIndex((p) => p.id === rozwiniety);

  /* Ostatni znany kształt rozwiniętego wiersza i jego miejsce na liście —
     z tego wiersz staje, gdy zapis wyprowadzi go poza filtr. */
  useEffect(() => {
    if (miejsce >= 0) setPrzypiety({ p: pomylki[miejsce], miejsce });
  }, [lista.data, miejsce]);

  const zostaje = miejsce < 0 && przypiety !== null && przypiety.p.id === rozwiniety;
  const wiersze = zostaje
    ? [...pomylki.slice(0, przypiety!.miejsce), przypiety!.p, ...pomylki.slice(przypiety!.miejsce)]
    : pomylki;

  const zwin = () => {
    setRozwiniety(null);
    setPrzypiety(null);
    if (parametry.has("id")) ustawParametry({}, { replace: true });
  };
  const przelacz = (id: number) => {
    if (rozwiniety === id) return zwin();
    setRozwiniety(id);
    setPrzypiety(null);
  };
  const zmienSito = (f: FiltrPomylek) => { zwin(); setFiltr(f); };
  const zmienMiesiac = (m: string) => { zwin(); setMiesiac(m); };

  /* Licznik tylko przy danych. Przy awarii „0" znaczyłoby „nic nie czeka". */
  const doUzupelnienia = lista.data?.doUzupelnienia;
  const nieMa = !lista.isLoading && !lista.error && rozwiniety !== null && miejsce < 0 && !zostaje;

  return <div className="space-y-4 lg:h-full lg:overflow-y-auto">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex gap-1">
          <FiltrSegmentowy<FiltrPomylek> wybrany={filtr} onWybierz={zmienSito}
            pozycje={FILTRY.map(([klucz, etykieta]) => ({
              klucz, etykieta, ...(klucz === "do_uzupelnienia" && doUzupelnienia !== undefined ? { ile: doUzupelnienia } : {}),
            }))} />
        </div>
        <div className="flex items-center gap-1">
          <button type="button" onClick={() => zmienMiesiac(przesunMiesiac(miesiac, -1))}
            aria-label="Poprzedni miesiąc" title="Poprzedni miesiąc"
            className="grid h-8 w-8 place-items-center rounded-lg hover:bg-slate-100"><ChevronLeft size={16} /></button>
          <span className="min-w-36 text-center text-sm font-semibold" aria-live="polite">{miesiacSlownie(miesiac)}</span>
          <button type="button" onClick={() => zmienMiesiac(przesunMiesiac(miesiac, 1))}
            disabled={miesiac >= biezacyMiesiac()}
            aria-label="Następny miesiąc" title="Następny miesiąc"
            className="grid h-8 w-8 place-items-center rounded-lg hover:bg-slate-100 disabled:opacity-40"><ChevronRight size={16} /></button>
        </div>
      </div>
      {/* Paragon to jedyna pomyłka bez zamówienia, więc jedyna z pustym
          formularzem. Resztę zakłada „Zła paczka" w zwrocie, rozmowie
          i profilu albo sama odmowa wypłaty. */}
      <Przycisk onClick={() => setParagon((o) => !o)} aria-expanded={paragon}>
        <ReceiptText size={16} />Paragon</Przycisk>
    </div>

    {paragon && <NowyParagon zamknij={() => setParagon(false)} onZalozono={(p) => {
      setParagon(false);
      setMiesiac(p.zgloszono.slice(0, 7));
      setRozwiniety(p.id);
      setPrzypiety({ p, miejsce: 0 });
    }} />}

    {lista.data && <Podsumowanie d={lista.data.podsumowanie} onMiesiac={zmienMiesiac} />}
    <ZlapanePrzyPakowaniu />

    {lista.error && !lista.data
      ? <Blad>{(lista.error as Error).message}</Blad>
      : lista.isLoading
      ? <Pusto waga="lista">Wczytuję pomyłki…</Pusto>
      : wiersze.length === 0
      ? <Karta><Pusto ikona={PackageX}>
          {filtr === "do_uzupelnienia" ? "Nic nie czeka na uzupełnienie w tym miesiącu" : "Brak pomyłek w tym widoku"}</Pusto></Karta>
      : <Karta className="overflow-x-auto p-0">
          <table className="w-full text-sm">
            <caption className="sr-only">Pomyłki wysyłkowe, {miesiacSlownie(miesiac)}</caption>
            <thead className="bg-slate-50 text-left text-podpis text-slate-600">
              <tr>
                {KOLUMNY.map((n) =>
                  <th key={n} scope="col" className="whitespace-nowrap px-3 py-2 font-semibold">{n}</th>)}
              </tr>
            </thead>
            <tbody>
              {wiersze.map((p) => <Wiersz key={p.id} p={p} rozwiniety={rozwiniety === p.id}
                pozaFiltrem={rozwiniety === p.id && !pasuje(filtr, p.stan)
                  ? FILTRY.find(([k]) => k === filtr)?.[1] ?? null : null}
                osobyReczne={lista.data?.osobyReczne ?? []}
                onPrzelacz={() => przelacz(p.id)} onUsunieto={zwin}
                onZapisano={(nowa) => setPrzypiety((s) => ({ p: nowa, miejsce: s?.miejsce ?? 0 }))} />)}
            </tbody>
          </table>
        </Karta>}
    {nieMa && <p role="status" className="text-sm text-slate-600">
      Pomyłki nr {rozwiniety} nie ma w zestawieniu za {miesiacSlownie(miesiac)}.</p>}
  </div>;
}

/* Kto ile razy był winny w miesiącu — pytanie, z którym właściciel otwierał
   arkusz na koniec miesiąca. Liczby zbierał i pakował stoją obok winy,
   bo bez nich „trzy razy winny" nie mówi, z ilu paczek.

   ZESTAWIENIE OSÓB WIDZI TYLKO ADMIN, decyzją właściciela: to monitoring
   pracowników. Innym rolom serwer oddaje pustą listę osób. Pusta lista nie
   znaczy więc „nikt nie zawinił" i ekran mówi wtedy samą liczbę pomyłek. */
const ZRODLO: Record<Pomylka["zrodlo"], string> = {
  odmowa: "z odmowy wypłaty", dosylka: "z dosyłki", recznie: "zgłoszone ręcznie",
};

/* Statystyki miesiąca w czterech kolumnach: stany, pół roku wstecz, mylone
   towary i — dla admina — osoby. Wykres pół roku odpowiada na pytanie „lepiej
   czy gorzej", którego jedna liczba miesiąca nie rozstrzyga. Słupek to
   przycisk, bo następne pytanie brzmi zwykle „co było w tamtym miesiącu". */
function Podsumowanie({ d, onMiesiac }: { d: PodsumowaniePomylek; onMiesiac: (m: string) => void }) {
  const najwiecej = Math.max(1, ...d.trend.map((t) => t.razem));
  const zrodla = (Object.keys(ZRODLO) as Array<Pomylka["zrodlo"]>).filter((z) => d.zrodla[z] > 0);
  return <Karta className="grid gap-x-6 gap-y-4 px-4 py-3 text-sm md:grid-cols-2 xl:grid-cols-4" role="region"
    aria-label="Podsumowanie miesiąca">
    <div className="space-y-2">
      <p>W miesiącu: <b className="tabular-nums">{ile(d.razem, "pomyłka", "pomyłki", "pomyłek")}</b></p>
      <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-0.5 text-slate-700">
        <dt>do uzupełnienia</dt><dd className="text-right font-semibold tabular-nums">{d.stany.do_uzupelnienia}</dd>
        <dt>w toku</dt><dd className="text-right font-semibold tabular-nums">{d.stany.w_toku}</dd>
        <dt>zakończone</dt><dd className="text-right font-semibold tabular-nums">{d.stany.zakonczona}</dd>
      </dl>
      {zrodla.length > 0 && <p className="text-podpis text-slate-600">
        {zrodla.map((z) => `${d.zrodla[z]} ${ZRODLO[z]}`).join(" · ")}</p>}
      {/* Osoba bez winy nie trafia do rachunku osób, więc liczba stoi osobno. */}
      {d.bezWinnego > 0 && <p className="text-podpis text-slate-700">
        {ile(d.bezWinnego, "pomyłka", "pomyłki", "pomyłek")} bez wskazanego winnego</p>}
    </div>

    <div>
      <p className="mb-1 text-xs font-semibold text-slate-700">Ostatnie pół roku</p>
      <ol aria-label="Pomyłki w ostatnich miesiącach" className="flex items-end gap-1.5">
        {d.trend.map((t) => {
          const biezacy = t.miesiac === d.miesiac;
          return <li key={t.miesiac} className="flex-1">
            <button type="button" onClick={() => onMiesiac(t.miesiac)} aria-current={biezacy ? "true" : undefined}
              aria-label={`${miesiacSlownie(t.miesiac)}: ${ile(t.razem, "pomyłka", "pomyłki", "pomyłek")}`}
              className="flex w-full flex-col items-center gap-0.5 rounded hover:bg-slate-50">
              <span className={`text-podpis tabular-nums ${biezacy ? "font-semibold" : "text-slate-600"}`}>{t.razem}</span>
              <span className="flex h-12 w-full items-end" aria-hidden="true">
                <span className={`w-full rounded-t ${biezacy ? "bg-wertis-ink" : "bg-slate-300"}`}
                  style={{ height: `${Math.max(4, (t.razem / najwiecej) * 100)}%` }} />
              </span>
              <span className="text-podpis text-slate-600" aria-hidden="true">{miesiacKrotko(t.miesiac)}</span>
            </button>
          </li>;
        })}
      </ol>
    </div>

    <div>
      <p className="mb-1 text-xs font-semibold text-slate-700">Najczęściej mylone</p>
      {d.towary.length === 0
        ? <p className="text-slate-600">Żadna pomyłka nie ma jeszcze wpisanego towaru.</p>
        : <ol aria-label="Najczęściej mylone towary" className="space-y-0.5">
            {d.towary.map((t) => <li key={t.nazwa} className="flex gap-2">
              <span className="min-w-0 flex-1 truncate" title={t.nazwa}>{t.nazwa}</span>
              <span className="font-semibold tabular-nums">{t.ile}×</span>
            </li>)}
          </ol>}
    </div>

    {d.osoby.length > 0 && <div>
      <p className="mb-1 text-xs font-semibold text-slate-700">Osoby</p>
      <table className="w-full">
        <caption className="sr-only">Osoby w pomyłkach miesiąca</caption>
        <thead className="text-left text-podpis text-slate-600">
          <tr><th scope="col" className="font-semibold">Kto</th>
            <th scope="col" className="text-right font-semibold">zbierał</th>
            <th scope="col" className="text-right font-semibold">pakował</th>
            <th scope="col" className="text-right font-semibold">winny</th></tr>
        </thead>
        <tbody>
          {d.osoby.map((o) => <tr key={`${o.userId}-${o.nazwa}`}>
            <th scope="row" className="truncate text-left font-normal">{o.nazwa}</th>
            <td className="text-right tabular-nums">{o.zbieral}</td>
            <td className="text-right tabular-nums">{o.pakowal}</td>
            <td className={`text-right font-semibold tabular-nums ${o.winny > 0 ? "text-ranga-zle" : "text-slate-600"}`}>
              {o.winny}</td>
          </tr>)}
        </tbody>
      </table>
    </div>}
  </Karta>;
}

/* Pomyłki zbierania złapane przy pakowaniu, czyli DOBRA wiadomość: paczka nie
   wyszła z błędem, bo brak wyszedł przy pakowaniu. Stoją osobno od
   podsumowania, bo rejestr niżej liczy pomyłki, które doszły do klienta.
   Jedna liczba z obu mieszałaby złapane z przepuszczonymi. Obie stoją więc
   obok siebie w zdaniu, z tych samych dni: tak widać, czy kontrola działa.

   BEZ OSÓB. Dziennik zna konto, które zmieniło status, ale mapowanie je
   odrzuca: kto zbierał źle, to monitoring pracowniczy (art. 22² KP).

   BRAK DANYCH TO NIE ZERO. Pusta lista dni znaczy, że Sellasist nie oddał
   jeszcze żadnej pełnej doby. Padnięte zapytanie daje błąd zamiast bloku.
   Wyłączona integracja nie rysuje nic, bo zdanie o niej nie pomaga w żadnej
   pracy. */
function ZlapanePrzyPakowaniu() {
  const z = useZlapanePomylki();
  if (z.error && !z.data) {
    return <Blad>Nie udało się wczytać pomyłek złapanych przy pakowaniu: {(z.error as Error).message}</Blad>;
  }
  if (!z.data?.wlaczone) return null;
  const { dni, razem, doKlienta } = z.data;
  const ikona = <PackageCheck size={16} className="shrink-0 text-ranga-ok" aria-hidden="true" />;
  if (dni.length === 0 || razem === null) {
    return <Karta className="flex items-center gap-2 px-4 py-2 text-sm" role="region" aria-label="Złapane przy pakowaniu">
      {ikona}
      <p className="text-slate-600">Pomyłki złapane przy pakowaniu: Sellasist nie podał jeszcze pełnego dnia.
        Liczba pojawi się po pierwszej pełnej dobie synchronizacji z ustawionym statusem.</p>
    </Karta>;
  }
  const wykrytych = razem + (doKlienta ?? 0);
  const od = dzienMiesiac(dni[0].data), doDnia = dzienMiesiac(dni[dni.length - 1].data);
  /* Okres stoi w zdaniu, bo doby nie idą za miesiącem wybranym nad rejestrem:
     czternaście dni wstecz bywa na przełomie dwóch miesięcy. */
  const okres = dni.length === 1 ? `Dnia ${od}` : `Od ${od} do ${doDnia}`;
  return <Karta className="space-y-1 px-4 py-2 text-sm" role="region" aria-label="Złapane przy pakowaniu">
    <p className="flex items-start gap-2">
      {ikona}
      {/* Biernik, bo liczba jest dopełnieniem „złapało": „1 pomyłkę", „2 pomyłki", „5 pomyłek". */}
      <span>{okres} pakowanie złapało{" "}
        <b className="tabular-nums">{ile(razem, "pomyłkę", "pomyłki", "pomyłek")} zbierania</b>, zanim paczka
        wyszła do klienta.</span>
    </p>
    {/* Imiesłów odmienia się z liczbą, bo zgadza się z rzeczownikiem: „1 pomyłkę
        przepuszczoną", „2 pomyłki przepuszczone", „5 pomyłek przepuszczonych".
        Proporcja dopiero przy czymś wykrytym, bo „0 z 0" nic nie mówi. */}
    {doKlienta !== null && <p className="pl-6">
      W tych dniach rejestr niżej zapisał{" "}
      <b className="tabular-nums">{ile(doKlienta, "pomyłkę przepuszczoną", "pomyłki przepuszczone",
        "pomyłek przepuszczonych")} do klienta</b>
      {wykrytych > 0 && <>, więc pakowanie zatrzymało{" "}
        <b className="tabular-nums">{razem} z {wykrytych}</b> wykrytych</>}.
    </p>}
    {/* Dzień nad liczbą, nie obok: czternaście dni mieści się w jednym rzędzie.
        Zero zostaje cyfrą, bo ta doba przyszła z Sellasist i naprawdę była
        czysta. Jaśniejsze, żeby oko szło do dni z pomyłkami. */}
    <ol aria-label="Złapane przy pakowaniu dzień po dniu" className="flex flex-wrap gap-x-3 gap-y-1 pl-6">
      {dni.map((d) => <li key={d.data} className="flex flex-col items-center leading-tight" title={dataCyfrowa(d.data)}>
        <span className="text-podpis text-slate-600">{dzienMiesiac(d.data)}</span>
        <span className="sr-only">: </span>
        <span className={`tabular-nums ${d.zlapanych > 0 ? "font-semibold" : "text-slate-600"}`}>{d.zlapanych}</span>
      </li>)}
    </ol>
  </Karta>;
}

/** Osoba w komórce: imię, a winny słowem i czerwienią — sama barwa nie wystarczy (WCAG 1.4.1). */
function Osoba({ o, winny }: { o: OsobaPomylki | null; winny: boolean }) {
  if (!o) return <span className="text-slate-600">—</span>;
  if (!winny) return <span>{o.nazwa}</span>;
  return <span className="inline-flex items-center gap-1 rounded bg-red-50 px-1.5 py-0.5 font-semibold text-ranga-zle">
    {o.nazwa}<span className="text-podpis font-bold">winny</span></span>;
}

/** Fakt z kolejki dostaje dopisek, żeby agent wiedział, czemu nie da się go zmienić. */
function Fakt({ tekst, zKolejki }: { tekst: string | null; zKolejki: boolean }) {
  return <span className="whitespace-nowrap">{tekst ?? <span className="text-slate-600">—</span>}
    {zKolejki && tekst && <span className="block text-podpis text-slate-600">z Allegro</span>}</span>;
}

const NOWY_TOWAR: Record<"tak" | "nie", string> = { tak: "wysłany", nie: "nie wysyłamy" };
const opisPowrotu = (w: string | null) => (w === null ? null : w === "nie_wraca" ? "nie wraca" : dzienMiesiac(w));
const opisOdmowy = (o: Pomylka["odmowa"]) =>
  (o.wartosc === "tak" ? (o.kod ? etykietaKodu(o.kod) : "zgłoszona") : o.wartosc === "nie_trzeba" ? "nie trzeba" : null);

function Wiersz({ p, rozwiniety, pozaFiltrem, osobyReczne, onPrzelacz, onZapisano, onUsunieto }: {
  p: Pomylka; rozwiniety: boolean; pozaFiltrem: string | null; osobyReczne: string[];
  onPrzelacz: () => void; onZapisano: (p: Pomylka) => void; onUsunieto: () => void;
}) {
  const ref = useRef<HTMLTableRowElement>(null);
  /* Wejście z adresu rozwija wiersz, który bywa daleko w dole listy. */
  useEffect(() => { if (rozwiniety) ref.current?.scrollIntoView?.({ block: "nearest" }); }, [rozwiniety]);
  const opis = p.opis ?? (p.coDostal || p.coZamowil
    ? `${p.coDostal ?? "?"} zamiast ${p.coZamowil ?? "?"}` : null);
  const idPanelu = `pomylka-${p.id}`;
  return <>
    {/* Klik w cały wiersz rozwija go, bo to największy cel na ekranie.
        Dla klawiatury i czytnika rozwija przycisk z datą. */}
    <tr ref={ref} onClick={onPrzelacz}
      className={`cursor-pointer border-t border-slate-200 align-top ${rozwiniety ? "bg-slate-50" : "hover:bg-slate-50"}`}>
      <td className="whitespace-nowrap px-3 py-2">
        <button type="button" aria-expanded={rozwiniety} aria-controls={rozwiniety ? idPanelu : undefined}
          onClick={(e) => { e.stopPropagation(); onPrzelacz(); }}
          aria-label={`Pomyłka z ${dataCyfrowa(p.zgloszono)}, klient ${p.login} — ${rozwiniety ? "zwiń" : "rozwiń"}`}
          className="inline-flex items-center gap-1 font-semibold tabular-nums">
          {rozwiniety ? <ChevronDown size={14} aria-hidden="true" /> : <ChevronRight size={14} aria-hidden="true" />}
          {dzienMiesiac(p.zgloszono)}</button>
      </td>
      <td className="px-3 py-2">
        <Link to={`/obsluga/klient/${encodeURIComponent(p.login)}`} onClick={(e) => e.stopPropagation()}
          className="font-semibold text-sky-700 underline underline-offset-2">{p.login}</Link>
      </td>
      <td className="max-w-64 px-3 py-2">
        {opis ? <span className="line-clamp-2" title={opis}>{opis}</span>
          : <span className="italic text-slate-600">do uzupełnienia</span>}
      </td>
      <td className="whitespace-nowrap px-3 py-2"><Osoba o={p.zbieral} winny={p.winaZbierajacego} /></td>
      <td className="whitespace-nowrap px-3 py-2"><Osoba o={p.pakowal} winny={p.winaPakujacego} /></td>
      <td className="whitespace-nowrap px-3 py-2">
        <Plakietka status={STAN[p.stan].status}>{STAN[p.stan].slowo}</Plakietka>
        {p.zakonczonaRecznie && <span className="block text-podpis text-slate-600">ręcznie</span>}
        {!p.zamowienie && <span className="block text-podpis text-slate-600">paragon</span>}
      </td>
    </tr>
    {rozwiniety && <tr id={idPanelu} className="bg-slate-50">
      <td colSpan={KOLUMNY.length} className="px-4 pb-4 pt-1">
        <Uzupelnianie key={p.id} p={p} pozaFiltrem={pozaFiltrem} osobyReczne={osobyReczne}
          onZapisano={onZapisano} onZwin={onPrzelacz} onUsunieto={onUsunieto} />
      </td>
    </tr>}
  </>;
}

/** Przycisk wyboru: ten sam kształt dla pozycji, imion i faktów. */
function Wybor({ wybrany, winny = false, onClick, disabled, title, children }: {
  wybrany: boolean; winny?: boolean; onClick: () => void; disabled?: boolean; title?: string;
  children: React.ReactNode;
}) {
  const ton = winny ? "bg-red-700 text-white hover:bg-red-800"
    : wybrany ? "bg-wertis-ink text-white" : "bg-white text-slate-700 ring-1 ring-slate-300 hover:bg-slate-50";
  return <button type="button" aria-pressed={wybrany} disabled={disabled} title={title} onClick={onClick}
    className={`inline-flex min-h-10 items-center gap-1.5 rounded-lg px-3 text-sm font-semibold disabled:opacity-50 ${ton}`}>
    {children}</button>;
}

/** Pole, które zapisuje przy wyjściu albo Enterze — tylko gdy treść się zmieniła. */
function PoleZapisu({ id, etykieta, wartosc, podpowiedz, onZapisz }: {
  id: string; etykieta: string; wartosc: string | null; podpowiedz?: string | null;
  onZapisz: (v: string | null) => void;
}) {
  const [tekst, setTekst] = useState(wartosc ?? "");
  useEffect(() => { setTekst(wartosc ?? ""); }, [wartosc]);
  const zapisz = () => {
    const czysty = tekst.trim();
    if (czysty !== (wartosc ?? "")) onZapisz(czysty === "" ? null : czysty);
  };
  return <div className="min-w-0">
    <label htmlFor={id} className="mb-1 block text-xs font-semibold text-slate-700">{etykieta}</label>
    <input id={id} className="field text-sm" value={tekst} maxLength={200}
      placeholder={podpowiedz ?? ""} onChange={(e) => setTekst(e.target.value)} onBlur={zapisz}
      onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); zapisz(); } }} />
    {/* Podpowiedź z komentarza klienta w zwrocie: jedno kliknięcie zamiast
        przepisywania. Znika, gdy pole już coś ma. */}
    {podpowiedz && !tekst && <button type="button" onClick={() => { setTekst(podpowiedz); onZapisz(podpowiedz); }}
      className="mt-1 text-xs font-semibold text-sky-700 underline underline-offset-2">
      Wpisz z komentarza klienta: „{podpowiedz}”</button>}
  </div>;
}

type Rola = "zbieral" | "pakowal";

const POLA_ROLI = {
  zbieral: { id: "zbieralUserId", nazwa: "zbieralNazwa", wina: "winaZbierajacego" },
  pakowal: { id: "pakowalUserId", nazwa: "pakowalNazwa", wina: "winaPakujacego" },
} as const;

/** Ta sama osoba: po koncie, a bez konta po imieniu bez wielkości liter — tak liczy serwer. */
const taSama = (a: OsobaPomylki, b: OsobaPomylki) =>
  a.userId !== null || b.userId !== null ? a.userId === b.userId : a.nazwa.toLowerCase() === b.nazwa.toLowerCase();

/* Osoba bez konta w systemie, np. sezonowa. Pole otwiera się na klik, bo
   zwykle wystarcza lista, a stale otwarte pole kusi, żeby wpisać kogoś, kto
   na liście już stoi. */
function InnaOsoba({ etykieta, onDodaj }: { etykieta: string; onDodaj: (nazwa: string) => void }) {
  const [otwarte, setOtwarte] = useState(false);
  const [tekst, setTekst] = useState("");
  const dodaj = () => {
    const czysty = tekst.trim();
    if (!czysty) return;
    onDodaj(czysty);
    setTekst("");
    setOtwarte(false);
  };
  if (!otwarte) {
    return <Wybor wybrany={false} onClick={() => setOtwarte(true)} title={`${etykieta}: osoba spoza listy`}>
      <UserPlus size={14} aria-hidden="true" />inna osoba</Wybor>;
  }
  return <span className="inline-flex items-center gap-2">
    <input className="field w-44 text-sm" value={tekst} maxLength={60} autoFocus
      aria-label={`${etykieta}: imię osoby spoza listy`} placeholder="Imię i nazwisko"
      onChange={(e) => setTekst(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") { e.preventDefault(); dodaj(); }
        if (e.key === "Escape") setOtwarte(false);
      }} />
    <Wybor wybrany={false} disabled={!tekst.trim()} onClick={dodaj}>Dodaj</Wybor>
  </span>;
}

function Uzupelnianie({ p, pozaFiltrem, osobyReczne, onZapisano, onZwin, onUsunieto }: {
  p: Pomylka; pozaFiltrem: string | null; osobyReczne: string[];
  onZapisano: (p: Pomylka) => void; onZwin: () => void; onUsunieto: () => void;
}) {
  const zmien = useZmienPomylke();
  const zakoncz = useZakonczPomylke();
  const wznow = useWznowPomylke();
  const usun = useUsunPomylke();
  const [potwierdz, setPotwierdz] = useState(false);
  const osoby = useOsobyPomylek();
  const pozycje = usePozycjePomylki(p.zamowienie ? p.id : null);
  const [info, setInfo] = useState<string | null>(null);

  /* ZAPISY IDĄ PO KOLEI. Każdy niesie wersję, a klik w trakcie poprzedniego
     zapisu poszedłby ze starą i dostał 409. Zmiana z czasu trwania czeka
     i wychodzi zaraz po nim, z wersją z odpowiedzi. */
  const trwa = useRef(false);
  const czeka = useRef<ZmianaPomylki | null>(null);
  const wersja = useRef(p.wersja);
  useEffect(() => { if (!trwa.current) wersja.current = p.wersja; }, [p.wersja]);

  const naKonflikt = (e: unknown) => {
    czeka.current = null;
    if (!(e instanceof Konflikt)) return;
    const swieza = pomylkaZKonfliktu(e);
    if (swieza) { wersja.current = swieza.wersja; onZapisano(swieza); }
    setInfo("Ktoś zmienił tę pomyłkę w międzyczasie. Pokazuję aktualny stan, kliknij jeszcze raz, jeśli trzeba.");
  };

  const wyslij = (v: ZmianaPomylki) => {
    if (trwa.current) { czeka.current = { ...czeka.current, ...v }; return; }
    trwa.current = true;
    setInfo(null);
    zmien.mutate({ id: p.id, wersja: wersja.current, ...v }, {
      onSuccess: (d) => { wersja.current = d.pomylka.wersja; onZapisano(d.pomylka); },
      onError: naKonflikt,
      onSettled: () => {
        trwa.current = false;
        const nastepna = czeka.current;
        czeka.current = null;
        if (nastepna) wyslij(nastepna);
      },
    });
  };

  /* Klik w imię wybiera osobę, klik w wybraną odznacza. Winę wskazuje się
     osobno, w „Kto zawinił": trzy stany na jednym przycisku trzeba było
     znać, a pytanie „kto zawinił" czyta się samo. Zmiana osoby zdejmuje winę,
     bo wina należała do poprzedniej. */
  const klikOsoby = (rola: Rola, o: OsobaPomylki) => {
    const obecna = rola === "zbieral" ? p.zbieral : p.pakowal;
    const k = POLA_ROLI[rola];
    if (obecna && taSama(obecna, o)) wyslij({ [k.id]: null, [k.wina]: false });
    else if (o.userId !== null) wyslij({ [k.id]: o.userId, [k.wina]: false });
    else wyslij({ [k.nazwa]: o.nazwa, [k.wina]: false });
  };

  const bladZapisu = [zmien.error, zakoncz.error, wznow.error, usun.error]
    .find((e) => e && !(e instanceof Konflikt)) as Error | undefined;
  const bladOsob = osoby.error ? "Nie udało się wczytać listy magazynierów." : null;

  const rzadOsob = (rola: Rola, etykieta: string) => {
    const obecna = rola === "zbieral" ? p.zbieral : p.pakowal;
    /* Konta, potem imiona wpisane ręcznie przy innych pomyłkach. Osoba
       spoza obu list (konto skasowane) i tak ma stać: inaczej zapisany
       wybór byłby na ekranie niewidoczny. */
    const wszyscy: OsobaPomylki[] = [...(osoby.data ?? [])];
    for (const nazwa of osobyReczne) {
      const o = { userId: null, nazwa };
      if (!wszyscy.some((x) => taSama(x, o))) wszyscy.push(o);
    }
    if (obecna && !wszyscy.some((x) => taSama(x, obecna))) wszyscy.push(obecna);
    return <div role="group" aria-label={etykieta}>
      <p className="mb-1 text-xs font-semibold text-slate-700">{etykieta}</p>
      <div className="flex flex-wrap items-center gap-2">
        {wszyscy.map((o) => {
          const wybrany = obecna !== null && taSama(obecna, o);
          return <Wybor key={`${o.userId}-${o.nazwa}`} wybrany={wybrany}
            title={wybrany ? "Kliknij jeszcze raz: odznacz" : `${etykieta}: ${o.nazwa}`}
            onClick={() => klikOsoby(rola, o)}>{o.nazwa}</Wybor>;
        })}
        {osoby.isLoading && <span className="text-sm text-slate-600">Wczytuję osoby…</span>}
        <InnaOsoba etykieta={etykieta}
          onDodaj={(nazwa) => wyslij({ [POLA_ROLI[rola].nazwa]: nazwa, [POLA_ROLI[rola].wina]: false })} />
      </div>
    </div>;
  };

  /* Wina per rola, nie per osoba: kto zbierał i pakował tę samą paczkę,
     mógł zawinić tylko przy jednym z tych kroków. */
  const winni: Array<{ rola: Rola; kto: OsobaPomylki; winna: boolean; slowo: string }> = [];
  if (p.zbieral) winni.push({ rola: "zbieral", kto: p.zbieral, winna: p.winaZbierajacego, slowo: "zbierał" });
  if (p.pakowal) winni.push({ rola: "pakowal", kto: p.pakowal, winna: p.winaPakujacego, slowo: "pakował" });

  const lista = pozycje.data?.pozycje ?? [];
  const wrocil = p.towarWrocil.wartosc;
  const dzis = dzisiaj();

  return <div className="space-y-4">
    {pozaFiltrem && <p role="status" className="text-xs text-slate-700">
      Ta pomyłka nie pasuje już do filtru „{pozaFiltrem}”. Zostaje tu do zwinięcia.</p>}
    {info && <p role="status" className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">{info}</p>}
    <Blad>{bladZapisu?.message ?? bladOsob}</Blad>

    {/* Co zamówił: pozycje zamówienia jednym kliknięciem. Paragon nie ma
        pozycji, więc wpis ręczny. */}
    <div className="grid gap-4 lg:grid-cols-2">
      {p.zamowienie && lista.length > 0
        ? <div role="group" aria-label="Co zamówił">
            <p className="mb-1 text-xs font-semibold text-slate-700">Co zamówił</p>
            <div className="flex flex-wrap gap-2">
              {lista.map((poz, i) => <Wybor key={`${poz.nazwa}-${i}`} wybrany={p.coZamowil === poz.nazwa}
                onClick={() => wyslij({ coZamowil: p.coZamowil === poz.nazwa ? null : poz.nazwa })}>
                {poz.ilosc > 1 && <span className="tabular-nums">{poz.ilosc}×</span>}{poz.nazwa}</Wybor>)}
            </div>
          </div>
        : <PoleZapisu id={`co-zamowil-${p.id}`} etykieta="Co zamówił" wartosc={p.coZamowil}
            onZapisz={(v) => wyslij({ coZamowil: v })} />}
      <PoleZapisu id={`co-dostal-${p.id}`} etykieta="Co dostał" wartosc={p.coDostal}
        podpowiedz={pozycje.data?.podpowiedz} onZapisz={(v) => wyslij({ coDostal: v })} />
    </div>
    {pozycje.error && <Blad>Nie udało się wczytać pozycji zamówienia: {(pozycje.error as Error).message}</Blad>}

    <div className="grid gap-4 lg:grid-cols-2">
      {rzadOsob("zbieral", "Zbierał")}
      {rzadOsob("pakowal", "Pakował")}
    </div>
    <div role="group" aria-label="Kto zawinił">
      <p className="mb-1 text-xs font-semibold text-slate-700">Kto zawinił</p>
      {winni.length === 0
        ? <p className="text-sm text-slate-600">Najpierw wybierz, kto zbierał albo pakował.</p>
        : <div className="flex flex-wrap gap-2">
            {winni.map((w) => <Wybor key={w.rola} wybrany={w.winna} winny={w.winna}
              onClick={() => wyslij({ [POLA_ROLI[w.rola].wina]: !w.winna })}>
              {w.kto.nazwa} <span className="font-normal">({w.slowo})</span></Wybor>)}
          </div>}
    </div>

    <div className="grid gap-4 md:grid-cols-3">
      <div role="group" aria-label="Nowy towar">
        <p className="mb-1 text-xs font-semibold text-slate-700">Nowy towar</p>
        {p.nowyTowar.zKolejki
          ? <Fakt tekst={p.nowyTowar.wartosc ? NOWY_TOWAR[p.nowyTowar.wartosc] : null} zKolejki />
          : <div className="flex flex-wrap gap-2">
              {(["tak", "nie"] as const).map((w) => <Wybor key={w} wybrany={p.nowyTowar.wartosc === w}
                onClick={() => wyslij({ nowyTowar: p.nowyTowar.wartosc === w ? null : w })}>{NOWY_TOWAR[w]}</Wybor>)}
            </div>}
      </div>
      <div role="group" aria-label="Towar wrócił">
        <p className="mb-1 text-xs font-semibold text-slate-700">Towar wrócił</p>
        {p.towarWrocil.zKolejki
          ? <Fakt tekst={opisPowrotu(wrocil)} zKolejki />
          : <div className="flex flex-wrap items-center gap-2">
              <Wybor wybrany={wrocil === dzis} onClick={() => wyslij({ towarWrocil: wrocil === dzis ? null : dzis })}>
                dziś</Wybor>
              <label className="sr-only" htmlFor={`wrocil-${p.id}`}>Dzień powrotu towaru</label>
              <input id={`wrocil-${p.id}`} type="date" className="field w-40 text-sm" max={dzis}
                value={wrocil && wrocil !== "nie_wraca" ? wrocil : ""}
                onChange={(e) => wyslij({ towarWrocil: e.target.value || null })} />
              <Wybor wybrany={wrocil === "nie_wraca"}
                onClick={() => wyslij({ towarWrocil: wrocil === "nie_wraca" ? null : "nie_wraca" })}>nie wraca</Wybor>
            </div>}
      </div>
      <div role="group" aria-label="Odmowa zwrotu pieniędzy w Allegro">
        <p className="mb-1 text-xs font-semibold text-slate-700">Odmowa w Allegro</p>
        {p.odmowa.zKolejki
          ? <Fakt tekst={opisOdmowy(p.odmowa)} zKolejki />
          : <div className="flex flex-wrap gap-2">
              {([["tak", "zgłoszona"], ["nie_trzeba", "nie trzeba"]] as const).map(([w, napis]) =>
                <Wybor key={w} wybrany={p.odmowa.wartosc === w}
                  onClick={() => wyslij({ odmowa: p.odmowa.wartosc === w ? null : w })}>{napis}</Wybor>)}
            </div>}
      </div>
    </div>

    <PoleZapisu id={`uwagi-${p.id}`} etykieta="Uwagi" wartosc={p.uwagi} onZapisz={(v) => wyslij({ uwagi: v })} />

    <div className="flex flex-wrap items-center gap-3 border-t border-slate-200 pt-3 text-sm">
      {/* Zakończenie liczy się samo z faktów. Ręczne to wyjątek, np. klient
          zatrzymał towar i nic więcej się nie wydarzy. */}
      {p.stan === "zakonczona"
        ? <Przycisk disabled={wznow.isPending} onClick={() => wznow.mutate({ id: p.id, wersja: wersja.current },
            { onSuccess: (d) => onZapisano(d.pomylka), onError: naKonflikt })}>Wznów</Przycisk>
        : <Przycisk disabled={zakoncz.isPending} title="Wyjątek: zakończ, choć brakuje faktów"
            onClick={() => zakoncz.mutate({ id: p.id, wersja: wersja.current },
              { onSuccess: (d) => onZapisano(d.pomylka), onError: naKonflikt })}>Zakończ ręcznie</Przycisk>}
      <Link to={`/obsluga/klient/${encodeURIComponent(p.login)}`}
        className="font-semibold text-sky-700 underline underline-offset-2">Profil klienta</Link>
      {p.zwrotId !== null && <Link to={`/obsluga/zwroty/${p.zwrotId}`}
        className="font-semibold text-sky-700 underline underline-offset-2">Zwrot</Link>}
      {p.zamowienie && <span className="inline-flex items-center gap-1 text-slate-700">
        zamówienie <span className="font-mono text-xs">{p.zamowienie}</span>
        <Skopiuj tekst={p.zamowienie} tytul="Kopiuj numer zamówienia" /></span>}
      <span className="ml-auto inline-flex items-center gap-3">
        {/* Usunięcie pyta drugi raz w tym samym miejscu, bez okna: pomyłki
            nie da się przywrócić, a okno zasłoniłoby, którą się kasuje. */}
        {potwierdz
          ? <span role="group" aria-label="Potwierdź usunięcie" className="inline-flex items-center gap-2">
              <span className="text-slate-700">Usunąć tę pomyłkę na stałe?</span>
              <Przycisk disabled={usun.isPending} onClick={() => usun.mutate({ id: p.id, wersja: wersja.current }, {
                onSuccess: onUsunieto,
                onError: (e) => { setPotwierdz(false); naKonflikt(e); },
              })}>Tak, usuń</Przycisk>
              <Przycisk onClick={() => setPotwierdz(false)}>Nie</Przycisk>
            </span>
          : <button type="button" onClick={() => setPotwierdz(true)} title="Np. gdy klient nie miał racji"
              className="inline-flex items-center gap-1 font-semibold text-ranga-zle underline underline-offset-2">
              <Trash2 size={14} aria-hidden="true" />Usuń pomyłkę</button>}
        <button type="button" onClick={onZwin} className="font-semibold text-slate-700 underline underline-offset-2">
          Zwiń</button>
      </span>
    </div>
  </div>;
}

/* Paragon: sprzedaż poza Allegro, więc nikt nie zna klienta ani zamówienia.
   Trzy pola i nic więcej — osoby agent wybiera już w rozwiniętym wierszu. */
function NowyParagon({ zamknij, onZalozono }: { zamknij: () => void; onZalozono: (p: Pomylka) => void }) {
  const nowa = useNowaPomylka();
  const [login, setLogin] = useState("");
  const [coZamowil, setCoZamowil] = useState("");
  const [coDostal, setCoDostal] = useState("");
  const gotowe = login.trim().length > 0;
  return <Karta className="p-4" role="region" aria-label="Nowa pomyłka z paragonu">
    <form className="grid gap-3 md:grid-cols-[repeat(3,minmax(0,1fr))_auto] md:items-end" onSubmit={(e) => {
      e.preventDefault();
      if (!gotowe) return;
      nowa.mutate({ login: login.trim(), coZamowil: coZamowil.trim() || null, coDostal: coDostal.trim() || null },
        { onSuccess: (d) => onZalozono(d.pomylka) });
    }}>
      {/* Podpowiedź pod polem, bo przy paragonie nie ma loginu i agent wpisuje
          klienta sam. Rejestr trzyma tylko nazwę, bez adresu i telefonu
          (`docs/obsluga-klienta.md`). */}
      <div>
        <label className="text-xs font-semibold text-slate-700">Klient
          <input className="field mt-1 text-sm" value={login} onChange={(e) => setLogin(e.target.value)}
            aria-describedby="paragon-klient-podpowiedz" autoFocus /></label>
        <p id="paragon-klient-podpowiedz" className="mt-1 text-podpis text-slate-600">
          Najkrótsza nazwa, po której poznasz klienta. Bez adresu i telefonu.</p>
      </div>
      <label className="text-xs font-semibold text-slate-700">Co zamówił
        <input className="field mt-1 text-sm" value={coZamowil} onChange={(e) => setCoZamowil(e.target.value)} /></label>
      <label className="text-xs font-semibold text-slate-700">Co dostał
        <input className="field mt-1 text-sm" value={coDostal} onChange={(e) => setCoDostal(e.target.value)} /></label>
      <div className="flex gap-2">
        <Przycisk type="button" onClick={zamknij}>Anuluj</Przycisk>
        <Przycisk wariant="glowny" disabled={!gotowe || nowa.isPending}><Plus size={16} />Załóż</Przycisk>
      </div>
    </form>
    <div className="mt-2"><Blad>{(nowa.error as Error | null)?.message}</Blad></div>
  </Karta>;
}
