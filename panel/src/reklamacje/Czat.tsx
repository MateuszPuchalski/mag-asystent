import React, { useEffect, useRef, useState } from "react";
import {
  ArrowDownLeft, ArrowUpRight, Bot, Check, ChevronRight, Clock, Copy,
  Package, PackageCheck, Ticket, type LucideIcon,
} from "lucide-react";
import type { WiadomoscReklamacji, ZalacznikReklamacji } from "../api/typy";
import { pobierzZalacznik } from "../api/reklamacje";
import { useZdjecieZalacznikaReklamacji } from "../towar/useZdjecie";
import { KafelZalacznika } from "../towar/Zalacznik";
import { dniSlowo, dzienMiesiac, godzina, ile, odmien, Pusto } from "../ui";
import { kopiujDoSchowka } from "../ui/kopiuj";
import { PLAKIETKA_PRZESYLKI, type ZdarzeniePrzesylki } from "./przesylki";
import { rozbierzFormularz, Tresc, zawieraOpis } from "./tresc";

/* ── Czat sprawy Allegro: reklamacji i dyskusji ──────────────────────────────
   Treść zgłoszenia i rozmowa są tym, po co agent otwiera ten ekran, więc stoją
   w GŁÓWNYM oknie. Kolumna obok niesie fakty o sprawie, nie jej treść.

   DYMKI JAK W KOMUNIKATORZE, z makiety właściciela. Klient po lewej na szarym
   tle, sklep po prawej na błękicie. Strona mówi „czyje”, a barwa to tylko
   wzmacnia, więc barwa nigdy nie stoi sama (WCAG 1.4.1). Nad dymkiem stoi
   linia „kto · kiedy”, bo rozmowa bywa trójstronna: `BUYER`, `SELLER`
   i `ADMIN`, czyli doradca Allegro. Bez podpisu agent odpowiadałby doradcy
   tak jak klientowi.

   ZE STARYCH KART ZESZŁO TO, CO DUBLOWAŁO STRONĘ I PODPIS: ikony i słowa ról,
   bursztyn ostatniej wiadomości i zwijanie długich treści. Zdanie klienta albo
   doradcy jest tym, po co agent przyszedł, więc stoi w całości. */

/** Chwila w podpisie i w wierszu zdarzenia — „05.10, 09:00”, jak na makiecie. */
const chwila = (v: string | null | undefined) => (v ? `${dzienMiesiac(v)}, ${godzina(v)}` : "");

/**
 * Załącznik sprawy jako kafel w dymku, tą samą powłoką co reszta panelu.
 *
 * `podglad` to podpowiedź z NAZWY pliku, więc bywa nieprawdziwa: plik, który
 * obrazem nie jest, dostaje z trasy 415 i zostaje kaflem z nazwą do pobrania.
 * Awaria drogi (502, 503) mówi zdaniem pod kaflem i daje ponowienie.
 *
 * Opakowanie per źródło, bo obraz wisi na haku REKLAMACJI, a haka nie wolno
 * wołać w pętli ani warunkowo.
 */
export function ZalacznikSprawy({ reklamacjaId, z }: {
  reklamacjaId: number; z: ZalacznikReklamacji;
}) {
  const obraz = useZdjecieZalacznikaReklamacji(reklamacjaId, z.podglad ? z.id : null);
  /* Zawsze do pobrania: `PostPurchaseIssueAttachment` nie niesie stanu
     `SAFE`/`UNSAFE`, więc nie mamy podstaw, żeby pobranie zablokować. */
  return <KafelZalacznika nazwa={z.nazwa || "załącznik"} podglad={z.podglad} obraz={obraz}
    pobierz={() => pobierzZalacznik(reklamacjaId, z.id, z.nazwa)} />;
}

function Kafle({ reklamacjaId, lista }: { reklamacjaId: number; lista: ZalacznikReklamacji[] }) {
  if (!lista.length) return null;
  return <ul className="flex flex-wrap items-start gap-2">
    {lista.map((z) => <ZalacznikSprawy key={z.id} reklamacjaId={reklamacjaId} z={z} />)}
  </ul>;
}

/**
 * Tyle o sprawie, ile ten komponent naprawdę czyta.
 *
 * KSZTAŁT STRUKTURALNY, nie `Reklamacja`, bo ten sam czat rysuje dyskusję,
 * a dyskusja nie ma ani powodu, ani oferty, ani terminu.
 *
 * `opisZgloszenia` i `powod` skleja WOŁAJĄCY: przy reklamacji opis to
 * `powodOpis` z zejściem na `opis`, przy dyskusji sam `opis`. Rozstrzyganie
 * tego tutaj wymagałoby z powrotem wiedzy o rodzaju sprawy.
 */
export interface SprawaCzatu {
  id: number;
  /** Zgłoszenie własnymi słowami klienta; `null`, gdy nic nie napisał. */
  opisZgloszenia: string | null;
  /** Czy Allegro przyjmie jeszcze wiadomość — mówi o tym nagłówek czatu. */
  czatAktywny: boolean;
  /** Login kupującego: podpis dymka zgłoszenia, gdy rozmowa go nie niesie. */
  login?: string | null;
  /** Kiedy klient zgłosił sprawę — chwila dymka zgłoszenia spoza rozmowy. */
  zgloszonoAt?: string | null;
  /** Linia „Powód: … · chce …” nad zdaniem klienta; dyskusja jej nie ma. */
  powod?: string | null;
}

/* ── KTO MÓWI: STRONA, TŁO I PODPIS ──────────────────────────────────────────
   Pięć ról Allegro i jeden wygląd na rolę. Doradca to człowiek, ale nie nasz
   klient, więc dostaje biel z ramką po stronie klienta. Magazyn Allegro jest
   maszyną, więc ramkę ma przerywaną. Rola spoza zbioru mówi swoją nazwą
   i kropkowaną ramką, zamiast udawać klienta: schemat Allegro może dołożyć
   wartość, a wtedy ekran ma powiedzieć „nie wiem, kto to”. */
interface Wyglad { prawa: boolean; tlo: string; kto: string | null }
const WYGLAD: Record<string, Wyglad> = {
  /* Promień 4 px w rogu przy osi to „ogonek” dymka, jak w komunikatorze. */
  BUYER: { prawa: false, tlo: "rounded-bl bg-slate-100", kto: null },
  SELLER: { prawa: true, tlo: "rounded-br bg-blue-50", kto: "Sklep" },
  ADMIN: { prawa: false, tlo: "rounded-bl border border-slate-200 bg-white", kto: "Doradca Allegro" },
  FULFILLMENT: { prawa: false, tlo: "rounded-bl border border-dashed border-slate-300 bg-white", kto: "Magazyn Allegro" },
};
const wygladWiadomosci = (w: WiadomoscReklamacji): Wyglad => WYGLAD[w.autorRola ?? ""] ?? {
  prawa: false, tlo: "rounded-bl border border-dotted border-slate-400 bg-white",
  kto: w.autorRola ?? "Nieznany autor",
};

function Dymek({ prawa, tlo, kto, kiedy, zgloszenie = false, children }: {
  prawa: boolean; tlo: string; kto: string; kiedy: string | null;
  zgloszenie?: boolean; children: React.ReactNode;
}) {
  return <li className={`flex min-w-0 max-w-[86%] flex-col gap-1 ${prawa ? "items-end self-end" : "items-start self-start"}`}>
    <span className="text-xs text-slate-600">
      <b className="font-semibold text-wertis-ink">{kto}</b>
      {kiedy && ` · ${chwila(kiedy)}`}{zgloszenie && " · zgłoszenie"}</span>
    <div className={`flex min-w-0 max-w-full flex-col gap-2 rounded-xl px-3.5 py-3 ${tlo}`}>{children}</div>
  </li>;
}

/* ── AUTOMAT ALLEGRO TO ZDARZENIE, NIE WYPOWIEDŹ ─────────────────────────────
   Makieta właściciela: wiadomość automatu stoi cienkim wierszem z ikoną
   w kółku, krótką nazwą i czasem po prawej, bez dymka. Automat nie jest
   rozmówcą, więc dymek udawałby trzecią osobę w rozmowie i zabierał jej
   wysokość.

   NAZWA Z TREŚCI, PEŁNA TREŚĆ POD ROZWINIĘCIEM. Rozpoznajemy po słowach,
   bo Allegro nie nadaje automatom rodzaju. Wzorców nie sprawdzono na żywych
   treściach, więc pomyłka kosztuje najwyżej ogólną nazwę: pełne zdanie,
   z odnośnikiem do formularza, stoi zawsze jedno kliknięcie dalej.

   KOLEJNE AUTOMATY POD RZĄD TO JEDEN WIERSZ. Etykieta i nadanie tej samej
   paczki to jedna historia, a dwa wiersze to dwa miejsca do przeczytania.
   Przypomnienie o terminie stoi osobno i bez rozwinięcia, bo niesie barwę
   uwagi, a całą jego treść mówi już wyciągnięta liczba dni. */

export type RodzajAutomatu = "termin" | "etykieta" | "nadanie" | "doreczenie" | "inny";

export interface Automat {
  rodzaj: RodzajAutomatu;
  nazwa: string;
  /** Fakt wyciągnięty z treści, gdy jest; inaczej `null`. */
  fakt: string | null;
  /** Numer przesyłki: pierwszy ciąg co najmniej dziesięciu cyfr. */
  numer: string | null;
}

/* Dziesięć cyfr to najkrótszy numer listu przewoźników w Polsce. Krótszy
   ciąg bywa kwotą, kodem pocztowym albo numerem sprawy. */
const NUMER = /(?<!\d)\d{10,}(?!\d)/;
const DNI = /(\d+)\s*(?:dni|dzień|dnia)\b/i;

/** Co mówi wiadomość automatu: rodzaj, krótka nazwa, wyciągnięty fakt i numer paczki. */
export function rozpoznajAutomat(tresc: string): Automat {
  const t = tresc.toLowerCase();
  const numer = tresc.match(NUMER)?.[0] ?? null;
  if (/etykiet/.test(t)) return { rodzaj: "etykieta", nazwa: "Etykieta wygenerowana", fakt: null, numer };
  if (/nadan|nadał/.test(t)) return { rodzaj: "nadanie", nazwa: "Paczka nadana", fakt: null, numer };
  const dni = tresc.match(DNI);
  if (dni && /decyzj|rozpatrz|odpowied|termin/.test(t)) {
    const n = Number(dni[1]);
    return { rodzaj: "termin", nazwa: "Przypomnienie Allegro", numer,
      fakt: `do decyzji ${odmien(n, "został", "zostały", "zostało")} ${dniSlowo(n)}` };
  }
  if (/doręcz|dostarcz/.test(t)) return { rodzaj: "doreczenie", nazwa: "Paczka doręczona", fakt: null, numer };
  /* Pierwsze zdanie jako fakt: tyle mieści się w wierszu, a resztę ucina
     klasa `truncate`, nie nożyczki na napisie. */
  const zdanie = tresc.trim().split(/(?<=[.!?])\s/)[0] ?? "";
  return { rodzaj: "inny", nazwa: "Automat Allegro", fakt: zdanie || null, numer };
}

const IKONA_AUTOMATU: Record<RodzajAutomatu, LucideIcon> = {
  termin: Clock, etykieta: Ticket, nadanie: Package, doreczenie: PackageCheck, inny: Bot,
};

/* Krótkie słowo kroku w wierszu przesyłki: „etykieta → nadana”. */
const KROK_AUTOMATU: Record<RodzajAutomatu, string> = {
  termin: "przypomnienie", etykieta: "etykieta", nadanie: "nadana", doreczenie: "doręczona", inny: "automat",
};

/* Grupa w jednym dniu mówi dzień raz: „30.09, 13:39–14:16”. */
function zakresChwil(od: string | null, doo: string | null): string {
  if (!od || !doo || od === doo) return chwila(od ?? doo);
  return dzienMiesiac(od) === dzienMiesiac(doo)
    ? `${dzienMiesiac(od)}, ${godzina(od)}–${godzina(doo)}` : `${chwila(od)} – ${chwila(doo)}`;
}

/**
 * Numer przesyłki jako chip do skopiowania.
 *
 * Skrócony W ŚRODKU, bo numer listu rozpoznaje się po początku (przewoźnik)
 * i po końcu (to, co dyktuje klient). Pełny numer stoi w nazwie i w dymku.
 * Kopiuje `kopiujDoSchowka`, bo biuro pracuje po zwykłym HTTP.
 */
export function NumerPrzesylki({ numer }: { numer: string }) {
  const [stan, setStan] = useState<"gotowe" | "zrobione" | "blad">("gotowe");
  const kopiuj = () => {
    void kopiujDoSchowka(numer).then((udalo) => {
      setStan(udalo ? "zrobione" : "blad");
      setTimeout(() => setStan("gotowe"), udalo ? 1500 : 3000);
    });
  };
  const skrot = numer.length > 16 ? `${numer.slice(0, 10)}…${numer.slice(-6)}` : numer;
  return <>
    <button type="button" onClick={kopiuj} title={numer} aria-label={`Kopiuj numer przesyłki ${numer}`}
      className={`inline-flex min-h-6 items-center gap-1.5 rounded-md border px-2 font-mono text-xs text-wertis-ink ${
        stan === "zrobione" ? "border-ranga-ok bg-emerald-50"
          : stan === "blad" ? "border-ranga-zle bg-white" : "border-slate-200 bg-white"}`}>
      <span>{skrot}</span>
      {stan === "zrobione" ? <Check size={13} aria-hidden="true" /> : <Copy size={13} aria-hidden="true" />}
    </button>
    {/* Skutek kliknięcia mówi się poza przyciskiem: nazwa przycisku z
        `aria-label` zasłoniłaby zmianę w jego środku. */}
    <span className="sr-only" aria-live="polite">
      {stan === "zrobione" ? "Numer skopiowany" : stan === "blad" ? "Nie udało się skopiować numeru" : ""}</span>
  </>;
}

/** Rozwinięta lista automatów — wspólna dla wiersza automatów i wiersza przesyłki. */
function ListaAutomatow({ lista, dodatki }: {
  lista: WiadomoscReklamacji[]; dodatki: (w: WiadomoscReklamacji) => React.ReactNode;
}) {
  return <ol className="ml-[17px] mt-1 flex flex-col gap-2 border-l-2 border-slate-200 pl-6">
    {lista.map((w) => {
      const a = rozpoznajAutomat(w.tresc);
      const IkonaWpisu = IKONA_AUTOMATU[a.rodzaj];
      return <li key={w.id} className="flex flex-col gap-1 text-sm">
        <div className="flex min-h-7 items-center gap-2">
          <IkonaWpisu size={14} aria-hidden="true" className="flex-none text-slate-500" />
          <span className="font-semibold text-wertis-ink">{a.nazwa}</span>
          <span className="flex-1" />
          <span className="whitespace-nowrap text-xs text-slate-600">{chwila(w.utworzonoAt)}</span>
        </div>
        <Tresc tekst={w.tresc} className="text-sm text-slate-700" />
        {dodatki(w)}
      </li>;
    })}
  </ol>;
}

function Kolko({ Ikona, uwaga = false }: { Ikona: LucideIcon; uwaga?: boolean }) {
  return <span aria-hidden="true" className={`flex h-7 w-7 flex-none items-center justify-center rounded-full border ${
    uwaga ? "border-amber-200 bg-amber-50 text-ranga-uwaga" : "border-slate-200 bg-white text-slate-600"}`}>
    <Ikona size={15} />
  </span>;
}

/* Przypomnienie o terminie: wiersz bez rozwinięcia, bo nie ma czego dodać. */
function WierszTerminu({ w, dodatki }: {
  w: WiadomoscReklamacji; dodatki: (w: WiadomoscReklamacji) => React.ReactNode;
}) {
  const a = rozpoznajAutomat(w.tresc);
  return <li className="flex flex-col gap-1">
    <div className="flex min-h-9 items-center gap-2.5 px-1 py-0.5">
      <Kolko Ikona={Clock} uwaga />
      <span className="min-w-0 truncate text-sm text-ranga-uwaga">
        <b className="font-semibold">{a.nazwa}</b>{a.fakt && <> · {a.fakt}</>}</span>
      <span className="flex-1" />
      <span className="whitespace-nowrap text-xs text-slate-600">{chwila(w.utworzonoAt)}</span>
    </div>
    {dodatki(w)}
  </li>;
}

function WierszAutomatow({ lista, dodatki }: {
  lista: WiadomoscReklamacji[];
  /** Załączniki automatu rysuje rozmowa, bo zna numer sprawy. */
  dodatki: (w: WiadomoscReklamacji) => React.ReactNode;
}) {
  const [otwarty, setOtwarty] = useState(false);
  const rozpoznane = lista.map((w) => rozpoznajAutomat(w.tresc));
  const pierwszy = rozpoznane[0];
  const nazwa = rozpoznane.map((a, i) => (i ? a.nazwa.toLowerCase() : a.nazwa)).join(" → ");
  const fakt = lista.length === 1 ? pierwszy.fakt : null;
  const numer = rozpoznane.find((a) => a.numer)?.numer ?? null;
  return <li className="flex flex-col gap-0.5">
    <button type="button" aria-expanded={otwarty} onClick={() => setOtwarty((o) => !o)}
      className="flex min-h-9 w-full items-center gap-2.5 rounded-lg px-1 py-0.5 text-left hover:bg-slate-50">
      <Kolko Ikona={IKONA_AUTOMATU[pierwszy.rodzaj]} />
      <span className="min-w-0 truncate text-sm text-slate-600">
        <b className="font-semibold text-wertis-ink">{nazwa}</b>
        {fakt && <> · {fakt}</>}
      </span>
      <span className="flex-1" />
      <span className="whitespace-nowrap text-xs text-slate-600">
        {zakresChwil(lista[0].utworzonoAt, lista[lista.length - 1].utworzonoAt)}</span>
      <ChevronRight size={16} aria-hidden="true"
        className={`flex-none text-slate-500 transition-transform ${otwarty ? "rotate-90" : ""}`} />
    </button>
    {numer && <div className="flex items-center gap-2 pl-[42px] text-xs text-slate-600">
      <span>Nr przesyłki</span><NumerPrzesylki numer={numer} />
    </div>}
    {otwarty && <ListaAutomatow lista={lista} dodatki={dodatki} />}
  </li>;
}

/* ── PRZESYŁKI NA OSI (makieta „Przesyłki”) ─────────────────────────────────
   Od nas: pełne niebieskie koło ze strzałką na zewnątrz, po prawej, po
   stronie sklepu. Od klienta: puste szare koło ze strzałką do środka, po
   lewej. Kierunek niosą strona, kształt i słowo, więc barwa nie stoi sama. */

const TLO_RANGI = {
  nic: "bg-slate-100 text-slate-700",
  uwaga: "bg-amber-50 text-ranga-uwaga",
  ok: "bg-emerald-50 text-ranga-ok",
  zle: "bg-red-50 text-ranga-zle",
} as const;

function napisPlakietki(z: ZdarzeniePrzesylki): string | null {
  if (!z.plakietka) return null;
  const { etykieta } = PLAKIETKA_PRZESYLKI[z.plakietka];
  if (z.plakietka !== "doreczona") return etykieta;
  /* Czas stanu znamy tylko przy doręczeniu. Inne plakietki zostają bez
     godziny, bo godzina nadania pod nimi opisywałaby inny stan. */
  const komu = z.kierunek === "od_nas" ? "klientowi" : "do nas";
  return `${etykieta} ${komu}${z.stanAt ? ` ${chwila(z.stanAt)}` : ""}`;
}

function Plakietka({ z }: { z: ZdarzeniePrzesylki }) {
  const napis = napisPlakietki(z);
  if (!napis) return null;
  const ranga = z.plakietka ? PLAKIETKA_PRZESYLKI[z.plakietka].ranga : "nic";
  return <span className={`whitespace-nowrap rounded-full px-2 py-px text-xs font-bold ${TLO_RANGI[ranga]}`}>
    {napis}</span>;
}

function KoloKierunku({ odNas }: { odNas: boolean }) {
  return odNas
    ? <span aria-hidden="true" title="Przesyłka od nas do klienta"
        className="flex h-7 w-7 flex-none items-center justify-center rounded-full bg-blue-700 text-white">
        <ArrowUpRight size={14} strokeWidth={2.6} /></span>
    : <span aria-hidden="true" title="Przesyłka od klienta do nas"
        className="flex h-7 w-7 flex-none items-center justify-center rounded-full border-2 border-slate-400 bg-white text-slate-700">
        <ArrowDownLeft size={14} strokeWidth={2.6} /></span>;
}

const nazwaKierunku = (z: ZdarzeniePrzesylki) =>
  z.kierunek === "od_nas" ? "Przesyłka od nas do klienta" : "Przesyłka od klienta do nas";

function WierszPrzesylki({ z }: { z: ZdarzeniePrzesylki }) {
  const odNas = z.kierunek === "od_nas";
  const plakietka = <Plakietka z={z} />;
  const kolo = <KoloKierunku odNas={odNas} />;
  const opis = <span className={`text-sm text-slate-600 ${odNas ? "text-right" : ""}`}>
    <b className="font-semibold text-wertis-ink">{odNas ? "Od nas" : "Od klienta"}</b>
    {` · ${z.opis}`}{z.przewoznik && ` · ${z.przewoznik}`}</span>;
  const dopiski = [z.nadanoAt && `nadana ${chwila(z.nadanoAt)}`, z.uwaga].filter(Boolean).join(" · ");
  return <li aria-label={nazwaKierunku(z)}
    className={`flex max-w-[86%] flex-col gap-1 ${odNas ? "items-end self-end" : "items-start self-start"}`}>
    <div className="flex min-h-8 flex-wrap items-center gap-2.5">
      {odNas ? <>{plakietka}{opis}{kolo}</> : <>{kolo}{opis}{plakietka}</>}
    </div>
    {(z.waybill || dopiski) && <div className={`flex flex-wrap items-center gap-2 text-xs text-slate-600 ${
      odNas ? "pr-[38px]" : "pl-[38px]"}`}>
      {z.waybill && <><span>Nr</span><NumerPrzesylki numer={z.waybill} /></>}
      {dopiski && <span>{z.waybill ? `· ${dopiski}` : dopiski}</span>}
    </div>}
  </li>;
}

/* ── AUTOMATY TEJ SAMEJ PACZKI TO WIERSZ PRZESYŁKI ──────────────────────────
   Makieta właściciela: etykieta i nadanie zwrotu stoją jednym wierszem
   przesyłki. Bez tego oś mówiła o jednej paczce dwa razy, raz słowami
   automatu, raz plakietką z trackingu. Wiążemy po numerze listu, bo tylko
   on jest wspólny dla treści automatu i dla zwrotu. */
function WierszPrzesylkiZAutomatami({ z, lista, dodatki }: {
  z: ZdarzeniePrzesylki; lista: WiadomoscReklamacji[];
  dodatki: (w: WiadomoscReklamacji) => React.ReactNode;
}) {
  const [otwarty, setOtwarty] = useState(false);
  const odNas = z.kierunek === "od_nas";
  const kroki = lista.map((w) => KROK_AUTOMATU[rozpoznajAutomat(w.tresc).rodzaj]).join(" → ");
  const numer = z.waybill ?? rozpoznajAutomat(lista[0].tresc).numer;
  return <li aria-label={nazwaKierunku(z)} className="flex flex-col gap-0.5">
    <button type="button" aria-expanded={otwarty} onClick={() => setOtwarty((o) => !o)}
      className="flex min-h-9 w-full items-center gap-2.5 rounded-lg px-1 py-0.5 text-left hover:bg-slate-50">
      <KoloKierunku odNas={odNas} />
      <span className="min-w-0 truncate text-sm text-slate-600">
        <b className="font-semibold text-wertis-ink">{odNas ? "Od nas" : "Od klienta"}</b>
        {` · ${z.opis} · ${kroki}`}{z.przewoznik && ` · ${z.przewoznik}`}</span>
      <Plakietka z={z} />
      <span className="flex-1" />
      <span className="whitespace-nowrap text-xs text-slate-600">
        {zakresChwil(lista[0].utworzonoAt, lista[lista.length - 1].utworzonoAt)}</span>
      <ChevronRight size={16} aria-hidden="true"
        className={`flex-none text-slate-500 transition-transform ${otwarty ? "rotate-90" : ""}`} />
    </button>
    {(numer || z.uwaga) && <div className="flex flex-wrap items-center gap-2 pl-[42px] text-xs text-slate-600">
      {numer && <><span>Nr przesyłki</span><NumerPrzesylki numer={numer} /></>}
      {z.uwaga && <span>{numer ? `· ${z.uwaga}` : z.uwaga}</span>}
    </div>}
    {otwarty && <ListaAutomatow lista={lista} dodatki={dodatki} />}
  </li>;
}

/* Wpis osi: wiadomość, złożony wiersz automatów, przesyłka albo oba naraz. */
type WpisOsi =
  | { typ: "wiadomosc"; w: WiadomoscReklamacji }
  | { typ: "automaty"; lista: WiadomoscReklamacji[] }
  | { typ: "przesylka"; z: ZdarzeniePrzesylki }
  | { typ: "przesylka_automaty"; z: ZdarzeniePrzesylki; lista: WiadomoscReklamacji[] };

const msOd = (v: string | null) => (v ? Date.parse(v) : NaN);
const cyfry = (v: string) => v.replace(/\D/g, "");

/**
 * Oś po czasie: wiadomości w kolejności rozmowy, przesyłki wstawione między
 * nie według chwili, automaty pod rząd złożone w jeden wiersz.
 *
 * Przesyłka bez chwili stoi na końcu, bo to stan bieżący. Grupa automatów
 * z numerem znanej przesyłki wchłania jej wiersz i stoi w miejscu automatów,
 * bo tam zaczęła się historia tej paczki.
 */
export function ulozOs(wiadomosci: WiadomoscReklamacji[], zdarzenia: ZdarzeniePrzesylki[]): WpisOsi[] {
  const zDatą = zdarzenia.filter((z) => z.moment !== null).sort((a, b) => msOd(a.moment) - msOd(b.moment));
  const bezDaty = zdarzenia.filter((z) => z.moment === null);
  const os: WpisOsi[] = [];
  let k = 0;
  for (const w of wiadomosci) {
    const t = msOd(w.utworzonoAt);
    /* Równa chwila zostawia wiadomość pierwszą: to ona zwykle ogłasza paczkę. */
    while (k < zDatą.length && msOd(zDatą[k].moment) < t) os.push({ typ: "przesylka", z: zDatą[k++] });
    const poprzedni = os[os.length - 1];
    const automat = w.autorRola === "SYSTEM";
    if (automat && poprzedni?.typ === "automaty"
      && rozpoznajAutomat(poprzedni.lista[0].tresc).rodzaj !== "termin"
      && rozpoznajAutomat(w.tresc).rodzaj !== "termin") {
      poprzedni.lista.push(w);
    } else {
      os.push(automat ? { typ: "automaty", lista: [w] } : { typ: "wiadomosc", w });
    }
  }
  for (; k < zDatą.length; k++) os.push({ typ: "przesylka", z: zDatą[k] });
  for (const z of bezDaty) os.push({ typ: "przesylka", z });

  /* Pierwsza grupa z numerem paczki bierze jej wiersz. Następna grupa tej
     samej paczki zostaje wierszem automatów, bo paczka stoi już na osi. */
  for (let i = 0; i < os.length; i++) {
    const wpis = os[i];
    if (wpis.typ !== "automaty") continue;
    const numer = wpis.lista.map((w) => rozpoznajAutomat(w.tresc).numer).find(Boolean);
    if (!numer) continue;
    const j = os.findIndex((x) => x.typ === "przesylka" && x.z.waybill !== null && cyfry(x.z.waybill) === numer);
    if (j === -1) continue;
    const paczka = os[j] as Extract<WpisOsi, { typ: "przesylka" }>;
    os[i] = { typ: "przesylka_automaty", z: paczka.z, lista: wpis.lista };
    os.splice(j, 1);
    if (j < i) i--;
  }
  return os;
}

/* ── ZGŁOSZENIE TO PIERWSZY DYMEK KLIENTA ────────────────────────────────────
   Makieta właściciela: zgłoszenie nie stoi przypiętą kartą nad rozmową, tylko
   jest jej pierwszą wypowiedzią. Ma autora, chwilę i miejsce w wątku, a nad
   zdaniem klienta linię „Powód: … · chce …”, bo bez niej zdanie bywa niejasne.

   Allegro przy części spraw wpisuje ten sam tekst w opis zgłoszenia i w
   pierwszą wiadomość kupującego, często we własnym formularzu. Dublem jest
   więc ZAWARCIE, nie równość (`zawieraOpis`). Wtedy dymkiem zgłoszenia jest
   ta wiadomość. Bez opisu też ona, bo to pierwsze słowo klienta w sprawie.
   Inny opis staje osobnym dymkiem na górze osi, bo to druga treść.

   Z FORMULARZA ALLEGRO STOI SAMO ZDANIE KLIENTA. Powód i oczekiwanie mówi
   linia nad nim, więc reszta formularza byłaby powtórzeniem.

   ZAŁĄCZNIKI SPRAWY wiszą na sprawie, nie na wiadomości, więc stają kaflami
   w dymku zgłoszenia, gdziekolwiek ten dymek stoi. */
function TrescZgloszenia({ powod, tekst, reklamacjaId, zalaczniki }: {
  powod: string | null | undefined; tekst: React.ReactNode;
  reklamacjaId: number; zalaczniki: ZalacznikReklamacji[];
}) {
  return <>
    {powod && <span className="text-sm font-semibold text-slate-700">{powod}</span>}
    {tekst}
    <Kafle reklamacjaId={reklamacjaId} lista={zalaczniki} />
  </>;
}

export function Czat({ sprawa, czat, zalaczniki, edytor, zdarzenia = [], tytul = "Czat" }: {
  sprawa: SprawaCzatu;
  czat: WiadomoscReklamacji[];
  /** Nagłówek rozmowy: „Czat reklamacji” albo „Czat dyskusji”. */
  tytul?: string;
  /** Przesyłki sprawy (`zdarzeniaPrzesylek`) — staną na osi według chwili. */
  zdarzenia?: ZdarzeniePrzesylki[];
  /** Załączniki SAMEJ sprawy — te spoza rozmowy. */
  zalaczniki: ZalacznikReklamacji[];
  /* Edytor wstrzykiwany, nie wołany stąd: cały katalog `reklamacje/` trzyma
     komponenty czyste, a mutacje mieszkają w ekranie (wzorzec `skrzynka/`). */
  edytor?: React.ReactNode;
}) {
  /* ── KOTWICA PRZY NAJNOWSZEJ ─────────────────────────────────────────────
     Rozmowę czyta się od KOŃCA: pierwsze pytanie agenta brzmi „co on napisał
     ostatnio”. RAZ NA SPRAWĘ, NIE PRZY KAŻDYM RENDERZE: wejście w reklamację
     odświeża ją z Allegro, więc oś potrafi się przerysować sekundę po
     otwarciu. Przewijanie przy każdej zmianie wyrywałoby agentowi miejsce
     czytania spod oka. Kotwica stoi ZA edytorem, bo zwinięty edytor
     przykleja się do dolnej krawędzi i zakryłby ostatnie linie. */
  const koniec = useRef<HTMLDivElement | null>(null);
  const zakotwiczona = useRef<number | null>(null);
  useEffect(() => {
    if (czat.length === 0 || zakotwiczona.current === sprawa.id) return;
    zakotwiczona.current = sprawa.id;
    /* `jsdom` tej metody nie ma, a i przeglądarka bywa starsza od niej. */
    koniec.current?.scrollIntoView?.({ block: "nearest" });
  }, [sprawa.id, czat.length]);

  const pierwszaKlienta = czat.find((w) => w.autorRola === "BUYER") ?? null;
  const opis = sprawa.opisZgloszenia;
  const wiadomoscZgloszenia = pierwszaKlienta
    && (opis === null || zawieraOpis(pierwszaKlienta.tresc, opis)) ? pierwszaKlienta : null;
  /* Osobny dymek, gdy rozmowa zgłoszenia nie niesie, a jest co pokazać. */
  const osobneZgloszenie = !wiadomoscZgloszenia
    && (opis !== null || zalaczniki.length > 0 || Boolean(sprawa.powod));
  const kupujacy = (w: WiadomoscReklamacji | null) => w?.autorLogin ?? sprawa.login ?? "Klient";

  const dodatki = (w: WiadomoscReklamacji) => <Kafle reklamacjaId={sprawa.id} lista={w.zalaczniki} />;
  const tresc = (t: string) => <Tresc tekst={t} className="text-tresc text-wertis-ink" />;

  const wpisy = ulozOs(czat, zdarzenia).map((wpis) => {
    if (wpis.typ === "przesylka") return <WierszPrzesylki key={wpis.z.klucz} z={wpis.z} />;
    if (wpis.typ === "przesylka_automaty") return <WierszPrzesylkiZAutomatami key={wpis.z.klucz}
      z={wpis.z} lista={wpis.lista} dodatki={dodatki} />;
    if (wpis.typ === "automaty") {
      return rozpoznajAutomat(wpis.lista[0].tresc).rodzaj === "termin"
        ? <WierszTerminu key={`a-${wpis.lista[0].id}`} w={wpis.lista[0]} dodatki={dodatki} />
        : <WierszAutomatow key={`a-${wpis.lista[0].id}`} lista={wpis.lista} dodatki={dodatki} />;
    }
    const { w } = wpis;
    const wyglad = wygladWiadomosci(w);
    /* Login bywa PUSTY i to jest udokumentowane: schemat mówi „not present
       if role is ADMIN, SYSTEM or FULFILLMENT”. */
    const kto = wyglad.kto ?? kupujacy(w);
    if (w.id === wiadomoscZgloszenia?.id) {
      const formularz = rozbierzFormularz(w.tresc);
      return <Dymek key={w.id} {...wyglad} kto={kto} kiedy={w.utworzonoAt} zgloszenie>
        <TrescZgloszenia powod={sprawa.powod} reklamacjaId={sprawa.id}
          tekst={tresc(formularz?.opis ?? w.tresc)} zalaczniki={[...zalaczniki, ...w.zalaczniki]} />
      </Dymek>;
    }
    return <Dymek key={w.id} {...wyglad} kto={kto} kiedy={w.utworzonoAt}>
      {tresc(w.tresc)}
      {dodatki(w)}
    </Dymek>;
  });

  return <div className="flex min-h-0 flex-1 flex-col">
    {/* Nagłówek stoi poza przewijaniem: mówi, czym jest pas pod nim, i czy
        Allegro przyjmie jeszcze wiadomość, zanim agent zacznie pisać. */}
    <div className="flex shrink-0 flex-wrap items-center justify-between gap-x-3 gap-y-1 px-5 py-3.5">
      <h3 className="text-naglowek font-bold text-wertis-ink">{tytul}</h3>
      <span className="text-sm text-slate-600">
        {ile(czat.length, "wiadomość", "wiadomości", "wiadomości")}
        {" · "}{sprawa.czatAktywny ? "czat otwarty" : "czat zamknięty"}</span>
    </div>
    {/* ── ROZMOWA PRZEWIJA SIĘ SAMA ─────────────────────────────────────────
        Przewija się wyłącznie rozmowa z odpowiedzią. Wszystko, co ma stać
        w miejscu, jak werdykt reklamacji czy pasek zakończenia dyskusji,
        rysuje ekran poza tym komponentem. */}
    <div className="flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto px-5 pb-5 pt-1">
      {(osobneZgloszenie || wpisy.length > 0) && <ol aria-label="Wiadomości" className="flex flex-col gap-3.5">
        {osobneZgloszenie && <Dymek {...WYGLAD.BUYER} kto={kupujacy(null)} kiedy={sprawa.zgloszonoAt ?? null} zgloszenie>
          <TrescZgloszenia powod={sprawa.powod} reklamacjaId={sprawa.id} zalaczniki={zalaczniki}
            tekst={opis !== null ? tresc(opis)
              : <p className="text-tresc text-slate-700">Klient nie opisał sprawy własnymi słowami.</p>} />
        </Dymek>}
        {wpisy}
      </ol>}
      {czat.length === 0 && <Pusto waga="lista">Rozmowy jeszcze nie pobrano.</Pusto>}

      {/* ── ODPOWIEDŹ JEST OSTATNIĄ WYPOWIEDZIĄ WĄTKU ───────────────────────
          Ten sam układ co w skrzynce. Pole stoi w pasie przewijania, bo pod
          ręką trzyma je sam edytor: pusty jest jednym rzędem przyklejonym do
          dolnej krawędzi. Werdykt stoi poza rozmową (`Werdykt.tsx`), bo
          nieodwracalne ma stać w jednym miejscu. */}
      {edytor}
      <div ref={koniec} aria-hidden="true" />
    </div>
  </div>;
}
