import React from "react";
import {
  Coins, Flag, Gavel, MessageCircle, Package, ShoppingCart, type LucideIcon,
} from "lucide-react";
import { Link } from "react-router-dom";
import type { SzczegolReklamacji } from "../api/typy";
import { zlote } from "../api/zwroty";
import { STATUS_PACZKI } from "../skrzynka/statusy";
import { inneSprawyZakupu, KOLEJKI, type InnaSprawaZakupu } from "../sprawy/Spoiwo";
import { czas, dataCyfrowa, dniSlowo, dzienMiesiac, ile, kiedy, odmien, Skopiuj } from "../ui";
import { PRZEWOZNICY } from "../zwroty/Dowody";
import { rozstrzygniecie } from "./statusy";

/* ── DROGA SPRAWY W JEDNYM RZĘDZIE ───────────────────────────────────────────
   Makieta właściciela: sześć kroków od zakupu do rozliczenia, poziomo pod
   głowicą. Agent widzi jednym spojrzeniem, gdzie stoi sprawa i ile zostało
   do terminu, zamiast składać to z dat rozsianych po kolumnach.

   STAN KROKU TRZEMA CECHAMI, nie samą barwą (WCAG 1.4.1). Zrobiony ma pełne
   koło z białą ikoną, bieżący pierścień i pogrubiony napis, przyszły pusty
   okrąg. Czytnik słyszy bieżący przez `aria-current="step"`. Ikona mówi,
   CZYM jest krok, żeby oko znalazło go bez czytania nazw.

   OPŁACONY ZAKUP STOI KWOTĄ zamiast koła. O kwotę klient pyta w sporze
   najpierw, a zielona pigułka mówi naraz „zapłacił” i „ile”.

   DROGA NIESIE FAKTY ZAMÓWIENIA. Data i forma płatności, numer zamówienia,
   stan paczki i pytanie o nią stoją przy swoim kroku. Osobna karta mówiła
   to samo drugi raz, tylko bez kolejności w czasie.

   PODPIS MA NAJWYŻEJ DWIE LINIE i żadna się nie łamie. Krok rośnie w szerz,
   a rząd przewija się w poziomie, bo złamany podpis rozsadza wysokość drogi.

   BRAK DANYCH TO KROK BEZ DATY. Gdy nie znamy dnia doręczenia, krok stoi bez
   daty, a nie z dniem zgadniętym z zakupu. Zmyślona data na drodze sprawy
   byłaby argumentem w rozmowie z klientem, którego nie mamy.

   WĄSKI EKRAN PRZEWIJA RZĄD W POZIOMIE. Sześć kroków po 104 px nie mieści się
   w kolumnie telefonu, a zawinięty rząd przestaje czytać się jak droga.

   INNE SPRAWY ZAKUPU STOJĄ NA DRODZE, w swoim miejscu w czasie. Pytanie,
   zwrot czy dyskusja tego zamówienia są częścią historii klienta, więc agent
   widzi je tam, gdzie się wydarzyły. Wiązanie po numerze zamówienia działa
   w obie strony: przystanek jest łączem do tamtej sprawy.

   PRZYSTANEK NIE JEST KROKIEM tej sprawy. Ma mniejszą kropkę z ikoną rodzaju
   w barwie łącza i nie ma stanu, bo nie mówi, ile tej reklamacji zostało. */

type StanKroku = "zrobiony" | "biezacy" | "przyszly";

export interface KrokDrogi {
  klucz: "zakup" | "doreczono" | "zgloszenie" | "rozmowa" | "decyzja" | "rozliczenie";
  etykieta: string;
  /** Dopisek pod nazwą; pusty, gdy nie ma czego powiedzieć bez zgadywania. */
  podpis: string;
  /** Kwota opłaconego zakupu; tylko przy płatności, którą znamy z datą. */
  kwota?: string;
  stan: StanKroku;
  /** Kiedy krok na pewno był; `null`, gdy tego nie wiemy albo krok przed nami. */
  chwila: string | null;
}

/* Czym kończy się uznanie — od tego zależy, co jest do rozliczenia. */
const ROZLICZENIE_WERDYKTU: Record<string, string> = {
  ACCEPTED_REPAIR: "naprawa",
  ACCEPTED_EXCHANGE: "wymiana",
  ACCEPTED_REFUND: "zwrot pieniędzy",
  ACCEPTED_PARTIAL_REFUND: "częściowy zwrot",
};

/* Czego chce klient (`PostPurchaseIssueExpectation.name`), zanim zapadł werdykt. */
const ROZLICZENIE_OCZEKIWANIA: Record<string, string> = {
  REPAIR: "naprawa", EXCHANGE: "wymiana", REFUND: "zwrot pieniędzy", PARTIAL_REFUND: "częściowy zwrot",
};

/* Werdykt z panelu liczy się od chwili, gdy mógł wyjść. `send_failed` nie
   wyszedł, więc decyzja dalej czeka. */
const WYSZEDL = new Set(["sending", "sent", "send_uncertain"]);

/** Formy płatności po polsku; nieznana zostaje surowa, bo Allegro nie zamyka listy. */
const PLATNOSCI: Record<string, string> = {
  ONLINE: "online", CASH_ON_DELIVERY: "za pobraniem", WIRE_TRANSFER: "przelew",
  SPLIT_PAYMENT: "podzielona", EXTENDED_TERM: "odroczona",
};

type Przesylka = NonNullable<SzczegolReklamacji["przesylka"]>;

const przewoznik = (p: Przesylka) => (p.przewoznik ? PRZEWOZNICY[p.przewoznik] ?? p.przewoznik : null);

/**
 * Stan paczki do klienta krótko, na jedną linię podpisu.
 *
 * Trzy braki mówią trzy różne zdania, bo każdy każe zrobić co innego:
 * „nie sprawdzono”, „Allegro nie ma numeru” i „przewoźnik milczy”.
 */
function stanPaczki(p: Przesylka): string {
  if (p.dostarczonoAt) return sklej(dzienMiesiac(p.dostarczonoAt), przewoznik(p));
  if (p.sprawdzonoAt === null) return "nie sprawdzono";
  if (p.waybill === null) return "Allegro nie ma numeru";
  if (p.status === null) return sklej("bez statusu", przewoznik(p));
  return sklej(STATUS_PACZKI[p.status] ?? `przewoźnik: ${p.status}`, przewoznik(p));
}

const sklej = (...czesci: Array<string | null | false | undefined>) =>
  czesci.filter((c): c is string => Boolean(c)).join(" · ");

/** Kroki drogi z danych sprawy — czysta funkcja, żeby test nie potrzebował DOM-u. */
export function krokiDrogi(s: SzczegolReklamacji): KrokDrogi[] {
  const r = s.reklamacja;
  const kupiono = s.zamowienie?.kupionoAt ?? r.kupionoAt;
  const doreczono = s.przesylka?.dostarczonoAt ?? null;
  const z = s.zamowienie;
  /* Pigułka staje tylko przy płatności z datą. Bez niej nie wiemy, czy
     zapłacił, a zielona kwota twierdziłaby, że tak. */
  const kwota = z?.platnoscAt && z.sumaGrosze != null ? zlote(z.sumaGrosze, z.waluta) : undefined;
  const platnosc = z?.platnoscTyp ? (PLATNOSCI[z.platnoscTyp] ?? z.platnoscTyp) : null;
  const naszWerdykt = r.werdykt !== null && WYSZEDL.has(r.werdyktStatus ?? "");
  const zAllegro = rozstrzygniecie(r.statusAllegro);
  const zapadla = naszWerdykt || zAllegro !== null;
  const odrzucona = naszWerdykt ? String(r.werdykt).startsWith("REJECTED") : zAllegro === "odrzucona";

  const poDniach = r.zgloszonoPoDniach;
  const odstep = poDniach == null ? null
    : poDniach === 0 ? "w dniu zakupu"
      : `po ${poDniach} ${odmien(poDniach, "dniu", "dniach", "dniach")}`;

  /* Werdykt z Centrum Sprzedaży nie ma u nas chwili ani autora, więc podpis
     mówi tylko, że zapadł poza panelem. */
  const decyzja = naszWerdykt
    ? sklej(r.werdyktAt && dzienMiesiac(r.werdyktAt), r.werdyktNazwa)
    : zAllegro !== null
      ? `${zAllegro} poza panelem`
      : r.poTerminie
      ? sklej(r.decyzjaDo && `termin minął ${dzienMiesiac(r.decyzjaDo)}`)
      : sklej(r.decyzjaDo && `do ${dzienMiesiac(r.decyzjaDo)}`,
          r.dniDoTerminu !== null && dniSlowo(r.dniDoTerminu));

  const rozliczenie = odrzucona ? "bez rozliczenia"
    : naszWerdykt ? (ROZLICZENIE_WERDYKTU[String(r.werdykt)] ?? "")
      : ROZLICZENIE_OCZEKIWANIA[r.oczekiwanie ?? ""] ?? "";

  /* Rozmowa bez jednej wiadomości nie jest krokiem, który się odbył. Stoi
     więc pusta także przed bieżącą decyzją: werdykt bywa wydany bez słowa. */
  const rozmowaBylo = r.wiadomosciIle > 0;

  return [
    { klucz: "zakup", etykieta: "Zakup", stan: "zrobiony", chwila: kupiono ?? null, kwota,
      podpis: sklej(kupiono && dzienMiesiac(kupiono), platnosc) },
    /* Zielone koło obiecuje doręczenie, więc staje dopiero z datą od
       przewoźnika. Paczka w drodze albo niesprawdzona zostaje szara. */
    { klucz: "doreczono", etykieta: "Doręczono", stan: doreczono ? "zrobiony" : "przyszly", chwila: doreczono,
      podpis: s.przesylka ? stanPaczki(s.przesylka) : "" },
    { klucz: "zgloszenie", etykieta: "Zgłoszenie", stan: "zrobiony", chwila: r.otwartoAt ?? null,
      podpis: sklej(r.otwartoAt && dzienMiesiac(r.otwartoAt), odstep) },
    /* Rozmowa trwa do ostatniej wiadomości, więc dopiero sprawa po niej
       staje za tym krokiem. */
    { klucz: "rozmowa", etykieta: "Rozmowa", stan: rozmowaBylo ? "zrobiony" : "przyszly",
      chwila: rozmowaBylo ? r.ostatniaWiadomoscAt ?? null : null,
      podpis: rozmowaBylo
        ? sklej(ile(r.wiadomosciIle, "wiadomość", "wiadomości", "wiadomości"),
            r.ostatniaWiadomoscAt && `ostatnia ${dzienMiesiac(r.ostatniaWiadomoscAt)}`)
        : "bez wiadomości" },
    { klucz: "decyzja", etykieta: "Decyzja", stan: zapadla ? "zrobiony" : "biezacy", podpis: decyzja,
      chwila: naszWerdykt ? r.werdyktAt ?? null : null },
    /* Po odrzuceniu nie ma czego rozliczać, więc żaden krok nie jest bieżący:
       sprawa skończyła się na decyzji. Końca rozliczenia panel nie zna. */
    { klucz: "rozliczenie", etykieta: "Rozliczenie", stan: zapadla && !odrzucona ? "biezacy" : "przyszly",
      podpis: rozliczenie, chwila: null },
  ];
}

export type PozycjaDrogi =
  | { typ: "krok"; krok: KrokDrogi }
  | { typ: "sprawa"; sprawa: InnaSprawaZakupu };

/**
 * Kroki tej sprawy przeplecione z innymi sprawami zakupu, po czasie.
 *
 * Przystanek mija krok tylko wtedy, gdy WIEMY, że krok był wcześniej. Krok bez
 * daty zatrzymuje go przed sobą, bo zgadnięta kolejność byłaby zmyśloną
 * historią klienta. Sprawy o równej chwili zostają w kolejności z serwera.
 */
export function drogaZPrzystankami(kroki: KrokDrogi[], inne: InnaSprawaZakupu[]): PozycjaDrogi[] {
  const czekaja = [...inne].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const wynik: PozycjaDrogi[] = [];
  let i = 0;
  for (const krok of kroki) {
    const minal = (s: InnaSprawaZakupu) => krok.chwila === null || Date.parse(krok.chwila) > Date.parse(s.at);
    while (i < czekaja.length && minal(czekaja[i])) wynik.push({ typ: "sprawa", sprawa: czekaja[i++] });
    wynik.push({ typ: "krok", krok });
  }
  while (i < czekaja.length) wynik.push({ typ: "sprawa", sprawa: czekaja[i++] });
  return wynik;
}

/* Barwy koła i ikony per stan. Szara ikona przyszłego kroku ma `slate-500`,
   bo `slate-400` na bieli nie przechodzi progu kontrastu. */
const KOLO: Record<StanKroku, string> = {
  zrobiony: "bg-ranga-ok text-white",
  biezacy: "border-[3px] border-ranga-uwaga bg-white text-ranga-uwaga",
  przyszly: "border-2 border-slate-300 bg-white text-slate-500",
};

const IKONA_KROKU: Record<KrokDrogi["klucz"], LucideIcon> = {
  zakup: ShoppingCart, doreczono: Package, zgloszenie: Flag,
  rozmowa: MessageCircle, decyzja: Gavel, rozliczenie: Coins,
};

const NAPIS: Record<StanKroku, string> = {
  zrobiony: "font-semibold text-wertis-ink",
  biezacy: "font-bold text-ranga-uwaga",
  przyszly: "font-medium text-slate-600",
};

/* Stan dla czytnika: koło i ikona są `aria-hidden`, więc słowo musi
   stać w tekście, inaczej niewidomy dostałby same nazwy kroków. */
const STAN_SLOWEM: Record<StanKroku, string> = {
  zrobiony: "zrobione", biezacy: "teraz", przyszly: "przed nami",
};

const wielka = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

/** Długi numer skrócony w środku: początek i koniec rozpoznaje się na oko. */
export const skrotWSrodku = (t: string) => (t.length <= 11 ? t : `${t.slice(0, 4)}…${t.slice(-4)}`);

/* Linia za pozycją zielenieje, gdy droga do niej jest przebyta: krok
   zrobiony albo przystanek po kroku zrobionym. */
const LINIA = (przebyta: boolean) => `mx-1.5 h-0.5 min-w-3 flex-1 ${przebyta ? "bg-ranga-ok" : "bg-slate-300"}`;

/* Druga linia podpisu: numer w chipie mono, bo czyta się go znak po znaku.
   Pełny numer ma czytnik i podpowiedź, a schowek kopiuje go w całości. */
function Numer({ numer, href, nazwa, tytulKopii }: {
  numer: string; href?: string | null; nazwa: string; tytulKopii: string;
}) {
  const chip = "rounded bg-white px-1 font-mono text-xs";
  return <span className="inline-flex items-center">
    {href
      ? <a href={href} target="_blank" rel="noopener noreferrer" title={numer}
          className={`${chip} text-sky-700 underline underline-offset-2 hover:text-sky-900`}>
          <span aria-hidden="true">{skrotWSrodku(numer)}</span>
          <span className="sr-only">{nazwa} {numer}, otwiera się w Allegro</span></a>
      : <span title={numer} className={`${chip} text-slate-700`}>
          <span aria-hidden="true">{skrotWSrodku(numer)}</span>
          <span className="sr-only">{nazwa} {numer}</span></span>}
    <Skopiuj tekst={numer} tytul={tytulKopii} />
  </span>;
}

/** Pytanie o paczkę wyłącznie kliknięciem: patrzenie na drogę nie pyta Allegro. */
export interface PytanieOPaczke {
  onSprawdzPrzesylke?: () => void;
  sprawdzaPrzesylke?: boolean;
  bladPrzesylki?: string;
}

function SprawdzPaczke({ p, onSprawdzPrzesylke, sprawdzaPrzesylke = false }: PytanieOPaczke & { p: Przesylka }) {
  if (!onSprawdzPrzesylke) return null;
  return <button type="button" disabled={sprawdzaPrzesylke} onClick={onSprawdzPrzesylke}
    title={p.sprawdzonoAt ? `Pytaliśmy Allegro ${czas(p.sprawdzonoAt)}, ${kiedy(p.sprawdzonoAt)}` : undefined}
    className="min-h-6 font-semibold text-slate-700 underline underline-offset-2 disabled:opacity-50">
    {sprawdzaPrzesylke ? "pytam…" : "sprawdź"}</button>;
}

/** Druga linia kroku: to, czego nie da się powiedzieć samym tekstem. */
function Dopisek({ k, szczegol, pytanie }: { k: KrokDrogi; szczegol: SzczegolReklamacji; pytanie: PytanieOPaczke }) {
  const r = szczegol.reklamacja;
  const p = szczegol.przesylka;
  if (k.klucz === "zakup" && r.orderId) {
    return <Numer numer={r.orderId} href={r.linkZamowienia} nazwa="Zamówienie"
      tytulKopii="Kopiuj numer zamówienia" />;
  }
  if (k.klucz !== "doreczono" || !p) return null;
  /* Błąd pytania zastępuje drugą linię, żeby podpis nie urósł do trzech. */
  if (pytanie.bladPrzesylki) {
    return <span className="inline-flex items-center gap-1">
      <span className="text-ranga-zle">{pytanie.bladPrzesylki}</span>
      <SprawdzPaczke p={p} {...pytanie} /></span>;
  }
  if (p.waybill === null && p.sprawdzonoAt !== null) return <SprawdzPaczke p={p} {...pytanie} />;
  if (p.waybill === null) return null;
  return <span className="inline-flex items-center gap-1">
    <Numer numer={p.waybill} nazwa="Przesyłka" tytulKopii="Kopiuj numer przesyłki" />
    <SprawdzPaczke p={p} {...pytanie} /></span>;
}

/** Inna sprawa tego zakupu na drodze — łącze, nie krok tej reklamacji. */
function Przystanek({ sprawa, ostatni, przebyta }: {
  sprawa: InnaSprawaZakupu; ostatni: boolean; przebyta: boolean;
}) {
  const { nazwa, cel, ikona: Ikona, sciezka } = KOLEJKI[sprawa.rodzaj];
  /* Nazwa łącza mówi rok i cel kliku: obok kroków bez roku czytnik
     nie ma skąd wziąć, którego roku jest data ani dokąd prowadzi łącze. */
  const opis = `${wielka(nazwa)} z ${dataCyfrowa(sprawa.at)} — otwórz ${cel}`;
  return <li data-przystanek={sprawa.rodzaj} className="flex min-w-[88px] flex-[1_0_88px] flex-col">
    <Link to={`${sciezka}/${sprawa.id}`} aria-label={opis} title={opis}
      className="flex flex-col gap-1.5 rounded text-sky-700 hover:text-sky-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-700">
      <span className="flex h-6 items-center" aria-hidden="true">
        {/* Koło o połowę mniejsze od kroku i w barwie łącza: to odnośnik
            do innej sprawy, nie etap tej reklamacji. */}
        <span className="flex h-6 w-6 flex-none items-center justify-center">
          <span className="flex h-4 w-4 items-center justify-center rounded-full border-[1.5px] border-current bg-white">
            <Ikona size={9} strokeWidth={2.75} /></span>
        </span>
        {!ostatni && <span className={LINIA(przebyta)} />}
      </span>
      <span className="flex flex-col whitespace-nowrap pr-2">
        <span className="text-sm font-semibold underline underline-offset-2">{wielka(nazwa)}</span>
        <span className="text-xs">{dzienMiesiac(sprawa.at)}</span>
      </span>
    </Link>
  </li>;
}

export function DrogaSprawy({ szczegol, ...pytanie }: { szczegol: SzczegolReklamacji } & PytanieOPaczke) {
  const r = szczegol.reklamacja;
  const inne = inneSprawyZakupu(szczegol.droga, szczegol.sprawy, { rodzaj: "reklamacja", id: r.id });
  const pozycje = drogaZPrzystankami(krokiDrogi(szczegol), inne);
  /* Stan ostatniego kroku przed pozycją — przystanek nie ma własnego. */
  let poprzedni: StanKroku | null = null;
  return <ol aria-label="Droga sprawy"
    className="flex list-none overflow-x-auto border-t border-slate-200 bg-wertis-paper px-5 pb-4 pt-3.5">
    {pozycje.map((p, i) => {
      const ostatni = i === pozycje.length - 1;
      if (p.typ === "sprawa") {
        return <Przystanek key={`${p.sprawa.rodzaj}-${p.sprawa.id}`} sprawa={p.sprawa} ostatni={ostatni}
          przebyta={poprzedni === "zrobiony"} />;
      }
      const k = p.krok;
      poprzedni = k.stan;
      const Ikona = IKONA_KROKU[k.klucz];
      const dopisek = <Dopisek k={k} szczegol={szczegol} pytanie={pytanie} />;
      return <li key={k.klucz} data-stan={k.stan} aria-current={k.stan === "biezacy" ? "step" : undefined}
        className="flex min-w-[104px] flex-[1_0_104px] flex-col gap-1.5">
        <span className="flex h-6 items-center" aria-hidden="true">
          {k.kwota
            ? <span className="flex h-6 flex-none items-center rounded-full bg-ranga-ok px-2 text-xs font-bold tabular-nums text-white">
                {k.kwota}</span>
            : <span className={`flex h-6 w-6 flex-none items-center justify-center rounded-full ${KOLO[k.stan]}`}>
                <Ikona size={13} strokeWidth={2.5} /></span>}
          {!ostatni && <span className={LINIA(k.stan === "zrobiony")} />}
        </span>
        <span className="flex flex-col whitespace-nowrap pr-2">
          <span className={`text-sm ${NAPIS[k.stan]}`}>
            {k.etykieta}<span className="sr-only">{k.kwota ? ` opłacony: ${k.kwota}` : ""}, {STAN_SLOWEM[k.stan]}</span></span>
          {k.podpis && <span className="text-xs text-slate-600">{k.podpis}
            {/* Bez pytania o paczkę „sprawdź” staje w tej samej linii. */}
            {k.klucz === "doreczono" && szczegol.przesylka?.sprawdzonoAt === null && !pytanie.bladPrzesylki
              && pytanie.onSprawdzPrzesylke && <>{" · "}
                <SprawdzPaczke p={szczegol.przesylka} {...pytanie} /></>}</span>}
          <span className="text-xs text-slate-600 empty:hidden">{dopisek}</span>
        </span>
      </li>;
    })}
  </ol>;
}
