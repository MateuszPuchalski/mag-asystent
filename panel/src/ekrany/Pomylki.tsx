import React, { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ChevronDown, ChevronLeft, ChevronRight, PackageX, Plus, ReceiptText } from "lucide-react";
import { Konflikt } from "../api/klient";
import {
  pomylkaZKonfliktu, useNowaPomylka, useOsobyPomylek, usePomylki, usePozycjePomylki, useWznowPomylke,
  useZakonczPomylke, useZmienPomylke, type FiltrPomylek, type OdpowiedzPomylek, type OsobaPomylki,
  type Pomylka, type ZmianaPomylki,
} from "../api/pomylki";
import { etykietaKodu } from "../zwroty/Pieniadze";
import {
  Blad, FiltrSegmentowy, Karta, Plakietka, Przycisk, Pusto, Skopiuj, dataCyfrowa, dataLokalna,
  dzienMiesiac, ile, miesiacSlownie,
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

    {lista.data && <Podsumowanie d={lista.data.podsumowanie} />}

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
                {["Data", "Klient", "Pomyłka", "Zbierał", "Pakował", "Nowy towar", "Towar wrócił",
                  "Odmowa w Allegro", "Stan", "Zamówienie"].map((n) =>
                  <th key={n} scope="col" className="whitespace-nowrap px-3 py-2 font-semibold">{n}</th>)}
              </tr>
            </thead>
            <tbody>
              {wiersze.map((p) => <Wiersz key={p.id} p={p} rozwiniety={rozwiniety === p.id}
                pozaFiltrem={rozwiniety === p.id && !pasuje(filtr, p.stan)
                  ? FILTRY.find(([k]) => k === filtr)?.[1] ?? null : null}
                onPrzelacz={() => przelacz(p.id)}
                onZapisano={(nowa) => setPrzypiety((s) => ({ p: nowa, miejsce: s?.miejsce ?? 0 }))} />)}
            </tbody>
          </table>
        </Karta>}
    {nieMa && <p role="status" className="text-sm text-slate-600">
      Pomyłki nr {rozwiniety} nie ma w zestawieniu za {miesiacSlownie(miesiac)}.</p>}
  </div>;
}

/* Kto ile razy był winny w miesiącu — pytanie, z którym właściciel otwierał
   arkusz na koniec miesiąca. Liczby zbierał i pakował stoją w podpowiedzi,
   bo bez nich „trzy razy winny" nie mówi, z ilu paczek.

   ZESTAWIENIE OSÓB WIDZI TYLKO ADMIN, decyzją właściciela: to monitoring
   pracowników. Innym rolom serwer oddaje pustą listę osób. Pusta lista nie
   znaczy więc „nikt nie zawinił" i ekran mówi wtedy samą liczbę pomyłek. */
function Podsumowanie({ d }: { d: OdpowiedzPomylek["podsumowanie"] }) {
  const winni = [...d.osoby].filter((o) => o.winny > 0).sort((a, b) => b.winny - a.winny);
  return <Karta className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2 text-sm" role="region"
    aria-label="Podsumowanie miesiąca">
    <span>W miesiącu: <b className="tabular-nums">{ile(d.razem, "pomyłka", "pomyłki", "pomyłek")}</b></span>
    {d.osoby.length === 0 ? null : winni.length === 0
      ? <span className="text-slate-600">nikt nie jest jeszcze wskazany jako winny</span>
      : <span className="flex flex-wrap gap-x-3 gap-y-1">
          <span className="text-slate-600">Winni:</span>
          {winni.map((o) => <span key={`${o.userId}-${o.nazwa}`}
            title={`${o.nazwa}: zbierał ${o.zbieral}, pakował ${o.pakowal}, winny ${o.winny}`}>
            <b>{o.nazwa}</b> <span className="tabular-nums text-ranga-zle">{o.winny}×</span></span>)}
        </span>}
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

function Wiersz({ p, rozwiniety, pozaFiltrem, onPrzelacz, onZapisano }: {
  p: Pomylka; rozwiniety: boolean; pozaFiltrem: string | null;
  onPrzelacz: () => void; onZapisano: (p: Pomylka) => void;
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
      <td className="px-3 py-2"><Fakt tekst={p.nowyTowar.wartosc ? NOWY_TOWAR[p.nowyTowar.wartosc] : null}
        zKolejki={p.nowyTowar.zKolejki} /></td>
      <td className="px-3 py-2"><Fakt tekst={opisPowrotu(p.towarWrocil.wartosc)} zKolejki={p.towarWrocil.zKolejki} /></td>
      <td className="px-3 py-2"><Fakt tekst={opisOdmowy(p.odmowa)} zKolejki={p.odmowa.zKolejki} /></td>
      <td className="whitespace-nowrap px-3 py-2">
        <Plakietka status={STAN[p.stan].status}>{STAN[p.stan].slowo}</Plakietka>
        {p.zakonczonaRecznie && <span className="block text-podpis text-slate-600">ręcznie</span>}
      </td>
      <td className="whitespace-nowrap px-3 py-2">
        {p.zamowienie
          ? <span className="font-mono text-xs" title={p.zamowienie}>{p.zamowienie.slice(0, 8)}</span>
          : <span className="text-slate-600">paragon</span>}
      </td>
    </tr>
    {rozwiniety && <tr id={idPanelu} className="bg-slate-50">
      <td colSpan={10} className="px-4 pb-4 pt-1">
        <Uzupelnianie key={p.id} p={p} pozaFiltrem={pozaFiltrem} onZapisano={onZapisano} onZwin={onPrzelacz} />
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

function Uzupelnianie({ p, pozaFiltrem, onZapisano, onZwin }: {
  p: Pomylka; pozaFiltrem: string | null; onZapisano: (p: Pomylka) => void; onZwin: () => void;
}) {
  const zmien = useZmienPomylke();
  const zakoncz = useZakonczPomylke();
  const wznow = useWznowPomylke();
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

  /* Trzy stany jednym przyciskiem, jak czerwone tło w arkuszu: pierwszy klik
     wybiera osobę, klik w wybraną robi ją winną, trzeci zdejmuje wybór.
     Osobne pole „winny" byłoby drugą decyzją o tej samej osobie. */
  const klikOsoby = (rola: Rola, userId: number | null) => {
    const obecna = rola === "zbieral" ? p.zbieral : p.pakowal;
    const winna = rola === "zbieral" ? p.winaZbierajacego : p.winaPakujacego;
    const kluczId = rola === "zbieral" ? "zbieralUserId" : "pakowalUserId";
    const kluczWiny = rola === "zbieral" ? "winaZbierajacego" : "winaPakujacego";
    if (!obecna || obecna.userId !== userId) wyslij({ [kluczId]: userId, [kluczWiny]: false });
    else if (!winna) wyslij({ [kluczWiny]: true });
    else wyslij({ [kluczId]: null, [kluczWiny]: false });
  };

  const bladZapisu = [zmien.error, zakoncz.error, wznow.error]
    .find((e) => e && !(e instanceof Konflikt)) as Error | undefined;
  const bladOsob = osoby.error ? "Nie udało się wczytać listy magazynierów." : null;

  const rzadOsob = (rola: Rola, etykieta: string) => {
    const obecna = rola === "zbieral" ? p.zbieral : p.pakowal;
    const winna = rola === "zbieral" ? p.winaZbierajacego : p.winaPakujacego;
    const lista = osoby.data ?? [];
    /* Osoba spoza listy (konto skasowane albo nie z hali) i tak ma stać:
       inaczej zapisany wybór byłby na ekranie niewidoczny. */
    const wszyscy = obecna && !lista.some((o) => o.userId === obecna.userId) ? [...lista, obecna] : lista;
    return <div role="group" aria-label={etykieta}>
      <p className="mb-1 text-xs font-semibold text-slate-700">{etykieta}</p>
      <div className="flex flex-wrap gap-2">
        {wszyscy.map((o) => {
          /* Konto skasowane ma `userId: null`, więc rozpoznaje się je po imieniu. */
          const wybrany = obecna !== null && (obecna.userId !== null
            ? obecna.userId === o.userId : o.userId === null && obecna.nazwa === o.nazwa);
          const winny = wybrany && winna;
          return <Wybor key={`${o.userId}-${o.nazwa}`} wybrany={wybrany} winny={winny}
            title={!wybrany ? `${etykieta}: ${o.nazwa}` : !winny ? "Kliknij jeszcze raz: winny" : "Kliknij jeszcze raz: odznacz"}
            onClick={() => klikOsoby(rola, o.userId)}>
            {o.nazwa}{winny && <span className="text-podpis font-bold">· winny</span>}</Wybor>;
        })}
        {osoby.isLoading && <span className="text-sm text-slate-600">Wczytuję osoby…</span>}
      </div>
    </div>;
  };

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
    <p className="text-podpis text-slate-600">Klik w imię wybiera osobę, drugi klik oznacza ją jako winną, trzeci odznacza.</p>

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
      <button type="button" onClick={onZwin} className="ml-auto font-semibold text-slate-700 underline underline-offset-2">
        Zwiń</button>
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
