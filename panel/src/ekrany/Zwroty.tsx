import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { List, Undo2 } from "lucide-react";
import { useDociagnijPoSkanie, useSkanZwrotu, useSynchronizujZwroty, useZwroty, useSprawdzWszystkiePlatnosci, type WynikSkanu, type WynikSprawdzeniaWszystkich } from "../api/zwroty";
import { Konflikt } from "../api/klient";
import type { BilansKartotek, Kubelek, Ocena, StanZwrotow, WynikDosylki, Zwrot } from "../api/typy";
import { Decyzje } from "../zwroty/Decyzje";
import { Pieniadze } from "../zwroty/Pieniadze";
import { ZamkniecieReczne } from "../zwroty/ZamkniecieReczne";
import { Pozycje } from "../zwroty/Pozycje";
import { DolozTowar } from "../zwroty/DolozTowar";
import {
  useCofnijKorekte, useCofnijKwote, useCofnijWerdykt, useDopiszPozycje,
  useIloscZwrocona, useFaktura, useKorekta, useKwota,
  usePaczkiKlienta, useZamowieniaZAllegro, usePrzyjmijNieodebrana, wygladaNaLogin, useOcena, usePotracenie, useWerdykt, useZdejmijPozycje,
  useZglosRabat, useZwrot, useZwrocPieniadze, useOdmowPlatnosci, useSledzDosylkeZwrotu, useSprawdzPlatnosci,
  useZapiszPrzelew, useCofnijPrzelew, useZamknijRecznie, useOtworzPonownie,
  useNotatkaZwrotu, useCofnijNotatkeZwrotu, useRozjazdyZwrotow,
  useDolozTowar, szukajTowaruDoKosza, type TowarDoKosza, useKosz, usePotwierdzKartoteke,
} from "../api/zwroty";
import { wygladaNaEan } from "../zwroty/rodzajKodu";
import { Blad, FiltrSegmentowy, Karta, Pusto, SIATKA_TRZECH_KOLUMN } from "../ui";
import { PrzelacznikZwrotow } from "../zwroty/Przelacznik";
import { Naglowek } from "../zwroty/Naglowek";
import { DrogaKlienta } from "../sprawy/DrogaKlienta";
import { ZlaPaczka } from "../pomylki/ZlaPaczka";
import { Etapy, IKONA_KUBELKA } from "../zwroty/Etapy";
import { KUBELKI, Kolejka } from "../zwroty/Kolejka";
import { Dowody } from "../zwroty/Dowody";
import { polecanyKandydat } from "../zwroty/Dokument";
import { SzybkiZwrot } from "../zwroty/SzybkiZwrot";
import { NieOdeslany, POWOD_NIE_ODESLAL } from "../zwroty/NieOdeslany";
import { pewnaPropozycja, szybkaSciezka } from "../zwroty/regulaSzybkiej";
import { SITA_DECYZJI, sitoDecyzji, type SitoDecyzji } from "../zwroty/sita";
import { Szukanie } from "../zwroty/Szukanie";
import { SprawdzWszystkie } from "../zwroty/SprawdzWszystkie";
import { PasekPorzadku, posortuj, usePorzadek } from "../sprawy/Porzadek";
import { Koszyk, NowyKoszyk } from "../zwroty/Koszyk";
import { NaOutlet } from "../zwroty/NaOutlet";
import { Wiadomosc } from "../zwroty/Wiadomosc";
import type { RozjazdZwrotu } from "../api/zwroty";
import { useSkaner } from "../skaner";
import { SkrotyKlawiszy } from "../sprawy/Skroty";
import type { AkcjeKlawiszy } from "../zwroty/klawisze";
import { pasujeDoFrazy, rozbij } from "../sprawy/szukanie";
import { useKursorListy } from "../nawigacja/kursor";

/* ── Ekran zwrotów ───────────────────────────────────────────────────────────
   Trzy kolumny, jak skrzynka — dwa ekrany obsługi mają mieć jeden nawyk,
   nie dwa.

   Ekran nie wystawia korekty — robi to człowiek w Subiekcie — więc mówi to
   wprost przy polu numeru. Pieniądze oddaje przycisk ODDAJ PIENIĄDZE.

   Klawiatura działa także w części, która niczego nie zapisuje: strzałki
   chodzą po kolejce, cyfry przełączają kubełek.                            */

/**
 * Co robi klawisz w danym kubełku — jedna tabela dla paska i dla doktryny.
 *
 * Stoi TUTAJ, a nie przy `KUBELKI`: to jest wiedza EKRANU o jego własnym
 * nasłuchu, a `KUBELKI` opisują kolejkę, którą czyta także `Kolejka.tsx`.
 * Zmiana klawisza ma się rozjechać z paskiem najwyżej o jedną linijkę.
 */
export const KLAWISZE_KUBELKA: Record<string, ReadonlyArray<readonly [string, string]>> = {
  decyzja: [["P", "przyjmij"], ["S", "przyjmij i na stan"], ["U", "przyjmij i utylizacja"],
    ["O", "odrzuć"]],
  ocena: [["S", "na stan"], ["U", "utylizacja"], ["O", "na outlet"],
    ["Shift+S", "wszystkie na stan"], ["-", "wróciło mniej"]],
  zwrot: [["Enter", "zapisz kwotę"], ["D", "potrącenie"], ["-", "wróciło mniej"]],
  korekta: [["Enter", "wpisz numer korekty"]],
  /* `R` doklejany ze stanu — zamknięty bez korekty go nie ma. */
  zamkniety: [],
};

/* Krótkie etykiety do LICZNIKA. Pełne zdania pisze serwer i stoją przy
   pozycji (`Dowody`); tutaj muszą się zmieścić w jednym pasku, więc panel ma
   własne, skrócone. To jedyne miejsce, gdzie kod powodu zamienia się na tekst
   po naszej stronie — i dlatego nieznany kod pokazuje się SUROWY zamiast
   zniknąć. Licznik, który cicho gubi część liczb, jest gorszy od jego braku. */
const POWODY_SKROT: Record<string, string> = {
  /* DWA RÓŻNE CZEKANIA. „Czeka na automat" znaczy, że sygnatura
     trafia w jedną kartotekę — takiej pozycji nikt nie musi klikać, wiąże ją
     przebieg po synchronizacji. Liczba, która nie spada, mówi więc o USTERCE,
     nie o pracy do zrobienia. */
  do_zwiazania: "czeka na automat",
  do_zatwierdzenia: "czeka na zatwierdzenie",
  brak_zamowienia_w_zwrocie: "zwrot bez zamówienia",
  zamowienie_niepobrane: "zamówienie niepobrane",
  oferty_nie_ma_w_zamowieniu: "oferty nie ma w zamówieniu",
  oferta_bez_sku: "oferta bez SKU",
  sku_nie_trafia: "SKU nie trafia w kartotekę",
  symbol_zdublowany: "symbol zdublowany",
};

/* Statusy synchronizacji po polsku. Słownik z §7 mówi je po angielsku, bo
   dzieli je ze skrzynką — a pasek czyta człowiek przy biurku. */
const STANY_SYNCHRONIZACJI: Record<StanZwrotow["status"], string> = {
  current: "działa",
  delayed: "opóźniona",
  rate_limited: "wstrzymana limitem Allegro",
  authentication_error: "odmowa logowania do Allegro",
  failed: "nie działa",
};

/**
 * Rozjazdy rekoncyliacji, które dotyczą zwrotów.
 *
 * Cztery kontrole: termin, zwrot bez śladu po przelewie, koszyk czekający
 * na korektę i kosz bez powrotu z regału. Stoją tu, bo obsługa klienta
 * pracuje na tym ekranie.
 *
 * MILCZY PRZY ZERZE. Pas szarości z napisem „wszystko w porządku" uczy
 * przewijać wzrokiem to miejsce — a wtedy nie zauważa się go w dniu, w którym
 * naprawdę coś mówi. Ta sama zasada co w `services/reconcile.ts`: zerowy wynik
 * to zero raportu.
 */
/** Nazwa rodzaju po ludzku — w zdaniu zbiorczym, nie w wierszu. */
const NAZWA_ROZJAZDU: Record<string, string> = {
  /* TERMIN OBSŁUGI, nie ustawowy — siedem dni od doręczenia, regulamin Allegro. */
  zwrot_po_terminie: "po terminie obsługi (7 dni od doręczenia)",
  zwrot_bez_przelewu: "bez śladu po przelewie",
  kosz_czeka_na_korekte: "koszyk czeka na korektę",
  kosz_bez_powrotu: "kosz bez powrotu z regału",
  /* Allegro oddało pieniądze, a u nas nie ma korekty albo oceny. */
  zwrot_rozliczony_bez_korekty: "rozliczony w Allegro bez korekty",
};

/* Rodzaje, które dotyczą ZWROTU — ich klucz to numer zwrotu, więc zawężają
   listę. Pozostałe mówią o koszach i prowadzą do ekranu koszy. */
const ROZJAZDY_ZWROTOW = new Set(["zwrot_po_terminie", "zwrot_bez_przelewu", "zwrot_rozliczony_bez_korekty"]);

function PasekRozjazdow({ rozjazdy, filtr, onFiltr }: {
  rozjazdy: RozjazdZwrotu[];
  /** Rodzaj, po którym lista jest teraz zawężona. */
  filtr?: string | null;
  onFiltr?: (rodzaj: string | null) => void;
}) {
  /* ZWINIĘTY DOMYŚLNIE. Na żywej bazie wierszy bywa kilkaset, a rozwinięty
     pasek zjada cały ekran i zasłania kolejkę.

     Czterysta wierszy to nie informacja, tylko szum. Dekalog p. 2: pokazuj to,
     co rozstrzyga bieżącą czynność — a tu rozstrzyga LICZBA i RODZAJ, nie
     czterysta razy to samo zdanie. Klucze zostają o jedno kliknięcie dalej. */
  const [rozwiniete, setRozwiniete] = useState(false);
  if (!rozjazdy.length) return null;

  const wgRodzaju = new Map<string, number>();
  for (const r of rozjazdy) wgRodzaju.set(r.rodzaj, (wgRodzaju.get(r.rodzaj) ?? 0) + 1);

  return <section aria-label="Rozjazdy zwrotów"
    className="shrink-0 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2">
    {/* ── GRUPA ZAWĘŻA LISTĘ ──────────────────────────────────────────────
        Liczba bez drogi do spraw kazałaby rozwijać setki numerów i szukać ich
        w kolejce ręką. Kliknięcie zostawia na liście tylko te
        zwroty, ze wszystkich kubełków; grupy koszy prowadzą do koszy. */}
    <div className="flex w-full flex-wrap items-center gap-x-3 gap-y-1">
      <span className="text-xs font-bold uppercase text-amber-900">
        Do sprawdzenia ({rozjazdy.length})
      </span>
      {[...wgRodzaju].map(([rodzaj, ile]) => {
        const tresc = <><b className="font-semibold tabular-nums">{ile}</b>{" "}
          {NAZWA_ROZJAZDU[rodzaj] ?? rodzaj}</>;
        const klasa = "rounded px-1 text-sm text-amber-900 underline-offset-2 hover:underline";
        if (ROZJAZDY_ZWROTOW.has(rodzaj) && onFiltr) {
          return <button key={rodzaj} type="button" aria-pressed={filtr === rodzaj}
            title="Pokaż na liście tylko te zwroty"
            onClick={() => onFiltr(filtr === rodzaj ? null : rodzaj)}
            className={`${klasa} ${filtr === rodzaj ? "bg-amber-200 font-semibold" : ""}`}>{tresc}</button>;
        }
        return rodzaj.startsWith("kosz_")
          ? <a key={rodzaj} href="/obsluga/zwroty/kosze" title="Otwórz kosze" className={klasa}>{tresc}</a>
          : <span key={rodzaj} className="text-sm text-amber-900">{tresc}</span>;
      })}
      <button type="button" onClick={() => setRozwiniete((r) => !r)}
        className="ml-auto text-xs text-amber-900 underline">
        {rozwiniete ? "zwiń" : "pokaż numery"}
      </button>
    </div>
    {/* Rozwinięta lista ma WŁASNY scroller i sufit wysokości. Bez niego
        czterysta wierszy znowu wypchnęłoby kolejkę poza okno — tym razem
        na życzenie, ale z tym samym skutkiem. */}
    {rozwiniete && <ul className="mt-1 max-h-48 space-y-0.5 overflow-y-auto text-sm text-amber-900">
      {rozjazdy.map((r) => <li key={`${r.rodzaj}:${r.klucz}`}>
        <b className="font-semibold">{r.klucz}</b> · {r.opis}
      </li>)}
    </ul>}
  </section>;
}

/**
 * Ile pozycji czeka na kartotekę i DLACZEGO.
 *
 * Bez tych liczb nie da się odpowiedzieć na pytanie właściciela — czy problem
 * jest w kodzie, czy w danych Allegro. Jedna pozycja bez kartoteki to zwykle
 * brak SKU u sprzedawcy; czterdzieści z tym samym powodem to usterka.
 *
 * Stany końcowe do licznika nie wchodzą (liczy je `bilansKartotek`): zamknięty
 * zwrot nie jest pracą do zrobienia i zawyżałby liczbę, która ma mówić „ile
 * jeszcze przede mną".
 */
function PasekKartotek({ bilans, stan }: { bilans: BilansKartotek; stan?: StanZwrotow }) {
  if (!bilans.bez) return null;
  const powody = Object.entries(bilans.powody).sort((a, b) => b[1] - a[1]);
  /* Zdanie o synchronizacji pada TYLKO przy pozycjach czekających na automat
     i tylko wtedy, gdy synchronizacja naprawdę stoi. Wiązanie jedzie jej
     taktem, więc to jest pierwsze miejsce do sprawdzenia — a zdanie
     wypisywane zawsze przestaje być czytane po tygodniu. */
  const automat = bilans.powody.do_zwiazania ?? 0;
  const stoi = stan && stan.status !== "current";
  return <div className="flex flex-wrap items-center gap-x-3 gap-y-1 shrink-0 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
    <b>Bez kartoteki: {bilans.bez} z {bilans.wszystkie} pozycji w pracy</b>
    {powody.map(([kod, ile]) => <span key={kod} className="text-amber-800">
      {POWODY_SKROT[kod] ?? kod} <b className="tabular-nums">{ile}</b>
    </span>)}
    {automat > 0 && stoi && <span className="w-full text-amber-800">
      Wiązanie idzie taktem synchronizacji, a ta stoi ({STANY_SYNCHRONIZACJI[stan!.status]}
      {stan!.kodOstatniegoBledu ? `, kod ${stan!.kodOstatniegoBledu}` : ""}).
      Dopóki nie ruszy, te pozycje same się nie powiążą.
    </span>}
  </div>;
}

/**
 * Ile zwrotów NIE WESZŁO do tej kolejki.
 *
 * Synchronizacja chodzi z bezpiecznikiem dziesięciu stron. Kolejka ustawia
 * się według terminu, więc brakujące wiersze są w większości tymi najbardziej
 * spóźnionymi — czyli dokładnie tymi, dla których ten ekran istnieje.
 *
 * Zero i `null` MILCZĄ. Zero znaczy „lista skończyła się sama", `null` — że
 * Allegro nie podało liczby; o żadnym z tych stanów pasek nie ma co powiedzieć,
 * a pasek stojący nad kolejką zawsze przestaje być czytany po tygodniu.
 */
function PasekOgona({ stan }: { stan: StanZwrotow }) {
  if (!stan.pozostaloDoPobrania) return null;
  return <div className="shrink-0 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-900">
    <b>Ta kolejka nie jest kompletna: {stan.pozostaloDoPobrania} zwrotów czeka
      po stronie Allegro.</b>{" "}
    Ostatni przebieg stanął na bezpieczniku stron. Dociągną się kolejnymi
    przebiegami — ale dopóki liczba tu stoi, najstarszych zwrotów może w tej
    liście nie być.
  </div>;
}

/**
 * Kartoteki i rozjazdy ZWINIĘTE W JEDEN WIERSZ.
 *
 * W codziennej pracy pasy mówią to samo co wczoraj — dekalog p. 2: na ekranie
 * to, co rozstrzyga bieżącą czynność. Liczby zostają widoczne, zdania są
 * o jedno kliknięcie dalej.
 *
 * SAMO SIĘ OTWIERA, gdy stoi synchronizacja przy pozycjach czekających na
 * automat. To jedyne zdanie tych pasów, które wymaga działania dziś, a nie
 * kiedyś — schowane kazałoby zatwierdzać ręką to, co naprawia jedna rzecz.
 * Czerwony pasek niekompletnej kolejki stoi osobno i nie chowa się nigdy.
 */
function PasekUwag({ bilans, stan, rozjazdy, filtr = null, onFiltr }: {
  bilans?: BilansKartotek; stan?: StanZwrotow; rozjazdy: RozjazdZwrotu[];
  filtr?: string | null; onFiltr?: (rodzaj: string | null) => void;
}) {
  const [rozwiniete, setRozwiniete] = useState(false);
  const bez = bilans?.bez ?? 0;
  if (!bez && !rozjazdy.length) return null;
  const alarm = Boolean(stan && stan.status !== "current" && (bilans?.powody.do_zwiazania ?? 0) > 0);
  /* Otwarty filtr trzyma pasek otwarty: zwinięty chowałby przycisk, którym
     się go zdejmuje. */
  const otwarte = rozwiniete || alarm || filtr !== null;
  return <section aria-label="Uwagi do kolejki" className="shrink-0 space-y-1">
    <button type="button" onClick={() => setRozwiniete((r) => !r)}
      className="flex w-full flex-wrap items-center gap-x-3 rounded-lg border border-amber-200
        bg-amber-50 px-3 py-1 text-left text-xs text-amber-900">
      {bez > 0 && <span>Bez kartoteki <b className="tabular-nums">{bez}</b></span>}
      {rozjazdy.length > 0 && <span>Do sprawdzenia <b className="tabular-nums">{rozjazdy.length}</b></span>}
      <span className="ml-auto underline">{otwarte ? "zwiń szczegóły" : "pokaż szczegóły"}</span>
    </button>
    {otwarte && <>
      {bilans && <PasekKartotek bilans={bilans} stan={stan} />}
      <PasekRozjazdow rozjazdy={rozjazdy} filtr={filtr} onFiltr={onFiltr} />
    </>}
  </section>;
}

/**
 * Kody, po których człowiek szuka zwrotu — wszystkie, jakie zwrot niesie.
 *
 * Numer zwrotu bywa doklejony na paczce, identyfikator z Allegro wpada
 * z odnośnika, numer zamówienia z rozmowy z klientem, numer korekty z Subiekta.
 * Numer listu też, bo szuka się po naklejce. Enter dalej pyta serwer — tamta
 * droga zna też numery paczek, których w modelu pracy nie ma.
 *
 * LOGIN KUPUJĄCEGO odpowiada na inne pytanie niż numery: nie „gdzie jest TA
 * paczka", tylko „co jeszcze mam od TEGO klienta". To pytanie pada przy
 * rozmowie, w której klient mówi o dwóch przesyłkach naraz.
 *
 * NAZWA ODBIORCY I PRZEWOŹNIK, bo paczki nakleja klient albo kurier, więc
 * numeru listu z WRACAJĄCEGO kartonu nasz system nie zna. Zostaje to, co na
 * naklejce widać: kto na niej stoi i czyim samochodem przyjechała.
 *
 * Przewoźnik ma też własną listę rozwijaną i to NIE jest dublowanie: lista
 * odpowiada na „pokaż wszystko od InPostu", a człon frazy zawęża trafienia po
 * kimś innym. Aliasy niżej biorą się stąd, że na naklejce stoi „Paczkomat",
 * a w danych `INPOST`.
 */
const kody = (z: Zwrot) =>
  /* NOTATKA WCHODZI DO SZUKANIA. Numer sprawy z Allegro o zaginionej paczce
     nie ma własnego pola i ląduje w notatce biura. Notatka jest też jedynym
     miejscem, gdzie biuro pisze WŁASNYMI słowami; bez niej im lepiej ktoś
     opisał sprawę, tym trudniej ją znaleźć. */
  /* TOWAR WCHODZI DO SZUKANIA. Pytanie „gdzie jest zwrot z tym
     gaźnikiem" pada przy kartonie bez etykiety i przy telefonie od klienta.
     Nazwa, symbol kartoteki, SKU sprzedawcy i EAN — te same kody, które stoją
     przy pozycji na ekranie. Każde słowo trafia w KTÓREŚ pole, więc
     „kowalski gaźnik" zawęża do zwrotu tego klienta z tym towarem. */
  [z.numer, z.externalId, z.orderId, z.korektaNumer, z.kupujacyLogin, z.waybill,
    z.odbiorcaNazwa, z.przewoznik, z.notatka, ...aliasy(z.przewoznik),
    ...z.pozycje.flatMap((p) => [p.nazwa, p.twSymbol, p.sku, p.ean])]
    .filter((k): k is string => Boolean(k)).map((k) => k.toLowerCase());

/**
 * Jak operator NAZYWA przewoźnika, gdy patrzy na naklejkę.
 *
 * Kod z Allegro jest jeden, a słowo na pudle bywa inne — „paczkomat" to
 * InPost, „pocztex" to Poczta. Bez tego człon frazy przepisany z naklejki
 * wyglądałby na brak danych, a nie na inną nazwę tej samej firmy.
 */
const ALIASY: Record<string, string[]> = {
  INPOST: ["paczkomat", "inpost"],
  POCZTA: ["poczta", "pocztex"],
  DPD: ["dpd"],
  DHL: ["dhl"],
  UPS: ["ups"],
  GLS: ["gls"],
  FEDEX: ["fedex"],
};
const aliasy = (kod: string | null) => (kod ? ALIASY[kod.toUpperCase()] ?? [] : []);

/**
 * Uchwyty, które NAZYWAJĄ JEDEN ZWROT — i tylko po nich ekran otwiera sam.
 *
 * `kody` wyżej służy do zawężania listy i celowo bierze też rzeczy opisowe:
 * login, nazwę odbiorcy, przewoźnika. Żadna z nich nie jest identyfikatorem
 * paczki — login mówi, CZYJA to paczka, a nie KTÓRA, nazwa odbiorcy tak samo,
 * a przewoźnik opisuje setki naraz.
 *
 * Wpisanie „dpd" przy jednym zwrocie tej firmy nie może go OTWORZYĆ, jakby
 * ktoś podał numer. Otwarcie stawia na ekranie cudze pieniądze, więc lista
 * do otwierania musi być węższa niż lista do szukania.
 */
const identyfikatory = (z: Zwrot) =>
  [z.numer, z.externalId, z.orderId, z.korektaNumer, z.waybill]
    .filter((k): k is string => Boolean(k)).map((k) => k.toLowerCase());

export function Zwroty() {
  const { id } = useParams();
  const nawiguj = useNavigate();
  const [kubelek, setKubelek] = useState<Kubelek | null>("decyzja");
  /* Sito DO DECYZJI; `null` = cały kubełek. Powód w `zwroty/sita.ts`. */
  const [sito, setSito] = useState<SitoDecyzji | null>(null);
  const werdykt = useWerdykt();
  const ocena2 = useOcena();
  const kwota = useKwota();
  const korekta = useKorekta();
  const cofnijKorekte = useCofnijKorekte();
  const cofnijKwote = useCofnijKwote();
  const cofnijWerdykt = useCofnijWerdykt();
  const ilosc = useIloscZwrocona();
  const rabat = useZglosRabat();
  const pieniadze = useZwrocPieniadze();
  const odmowaPlatnosci = useOdmowPlatnosci();
  const sledzDosylke = useSledzDosylkeZwrotu();
  const sprawdzPlatnosci = useSprawdzPlatnosci();
  /* Wynik sprawdzenia niesie numer zwrotu z tego samego powodu co błąd wyżej:
     odpowiedź może przyjść, gdy agent stoi już przy następnym zwrocie. */
  const [wynikSprawdzenia, setWynikSprawdzenia] = useState<
    { zwrotId: number; znaleziono: number; wyplacone: boolean; udane: number;
      powodBraku: string | null } | null>(null);
  const potracenie = usePotracenie();
  const faktura = useFaktura();
  const dopisz = useDopiszPozycje();
  const zdejmij = useZdejmijPozycje();
  const [bladDopisania, setBladDopisania] = useState("");
  const [bladRabatu, setBladRabatu] = useState("");
  /* ZDANIA SEKCJI PIENIĘDZY NIOSĄ NUMER ZWROTU — błąd i wynik
     założenia dosyłki. Odpowiedź przychodzi po chwili, a operator bywa już
     przy następnym zwrocie. Bez numeru błąd odmowy zwrotu A stanąłby pod
     pieniędzmi zwrotu B. Klucz sekcji tego nie załatwi: te zdania mieszkają
     tutaj, poza nią, bo pisze je odpowiedź mutacji.

     Przejście na inny zwrot ich NIE KASUJE. Odpowiedź, która przyszła po
     odejściu, czeka przy swoim zwrocie: odmowa jest nieodwracalna, więc jej
     wynik nie może przepaść bez słowa. Następny zapis przy tym zwrocie
     zaczyna od czystej sekcji. */
  const [bladPieniedzy, setBladPieniedzy] = useState<{ zwrotId: number; tekst: string } | null>(null);
  const [wynikDosylki, setWynikDosylki] = useState<{ zwrotId: number; wynik: WynikDosylki } | null>(null);
  const bladPieniedzyDla = (zwrotId: number, przedrostek = "") => (e: unknown) =>
    setBladPieniedzy({ zwrotId, tekst: `${przedrostek}${(e as Error).message}` });
  const [bladFaktury, setBladFaktury] = useState("");
  const trwa = werdykt.isPending || ocena2.isPending || kwota.isPending
    || korekta.isPending || cofnijKorekte.isPending || cofnijKwote.isPending
    || cofnijWerdykt.isPending || ilosc.isPending
    || potracenie.isPending;
  /* Konflikt wersji ma brzmieć jak zdanie, nie jak kod. Serwer przysyła je
     gotowe przy 409 — panel go nie układa od nowa. */
  const bledy = [werdykt.error, ocena2.error, kwota.error, korekta.error, cofnijKorekte.error,
    cofnijKwote.error, cofnijWerdykt.error, ilosc.error,
    potracenie.error];
  const bladDecyzji = bledy.find(Boolean) instanceof Error
    ? String((bledy.find(Boolean) as Error).message) : "";
  const { data, isLoading, error } = useZwroty();

  /* WSZYSTKIE to siódma zakładka, nie siódmy kubełek. Kubełki dalej
     są silnikiem pracy — każdy niesie jedno pytanie — a ta zakładka jest do
     SZUKANIA: „gdzie stoi ten zwrot", nie „co mam zrobić". */
  const [bladSync, setBladSync] = useState("");

  /* Ekran nie czyta tożsamości: zwroty prowadzi całe biuro, więc sita
     Moje/Niczyje tu nie ma. `zMoje={false}` w pasku klawiszy mówi to
     wprost: klawisze `m` i `n` nie istnieją. Filtry przewoźnika i dat
     wchłonęło szukanie, bo fraza zna przewoźnika i nazwy z naklejki. */
  const wKubelku = useMemo(() => kubelek === null
    ? (data?.zwroty ?? [])
    : (data?.zwroty ?? []).filter((z) => z.kubelek === kubelek
      && (kubelek !== "decyzja" || sito === null || sitoDecyzji(z) === sito)),
  [data, kubelek, sito]);
  /* Liczniki sit z CAŁEGO kubełka, nie z listy po sicie — inaczej wybór
     jednego sita zerowałby liczby pozostałych. */
  const ileWSicie = useMemo(() => {
    const ile: Record<SitoDecyzji, number> = { doreczone: 0, w_drodze: 0, bez_skanu: 0, nie_odeslal: 0 };
    for (const z of data?.zwroty ?? []) if (z.kubelek === "decyzja") ile[sitoDecyzji(z)]++;
    return ile;
  }, [data]);

  const skan = useSkanZwrotu();
  const dociagnij = useDociagnijPoSkanie();
  const synchronizuj = useSynchronizujZwroty();
  /* Wynik hurtowego sprawdzenia żyje TU, nie w pasku szukania: przełączenie
     kubełka nie może go zgasić, bo agent czyta go, przeglądając kolejkę. */
  const sprawdzWszystkie = useSprawdzWszystkiePlatnosci();
  const [wynikWszystkich, setWynikWszystkich] = useState<WynikSprawdzeniaWszystkich | null>(null);
  const [bladWszystkich, setBladWszystkich] = useState("");
  const przelew = useZapiszPrzelew();
  const cofnijPrzelew = useCofnijPrzelew();
  const zamknijRecznie = useZamknijRecznie();
  const otworzPonownie = useOtworzPonownie();
  /* Błąd zamknięcia niesie numer zwrotu z tego samego powodu co `bladPieniedzy`:
     odpowiedź bywa spóźniona, a operator stoi już przy następnym zwrocie. */
  const [bladZamkniecia, setBladZamkniecia] = useState<{ zwrotId: number; tekst: string } | null>(null);
  const notatka = useNotatkaZwrotu();
  const cofnijNotatke = useCofnijNotatkeZwrotu();
  const [bladNotatki, setBladNotatki] = useState("");
  const rozjazdy = useRozjazdyZwrotow();
  const [kod, setKod] = useState("");
  const [fraza, setFraza] = useState("");
  /* Grupa z paska „Do sprawdzenia", po której zawężona jest lista. */
  const [filtrRozjazdu, setFiltrRozjazdu] = useState<string | null>(null);
  /* Login, o którego PACZKI pytamy — osobno od tego, co operator
     wpisuje, bo pytanie idzie po Enterze i po wyjściu z pola, a nie po każdym
     znaku. Pusty nie pyta wcale. */
  const [loginPaczek, setLoginPaczek] = useState("");
  const paczkiKlienta = usePaczkiKlienta(loginPaczek);
  /* Uchwyt, o który Allegro JUŻ zapytaliśmy. Enter i wyjście
     z pola wołają `onLogin` oba, a drugi strzał do Allegro o ten sam login
     niczego by nie dodał — kosztowałby tylko żądanie. */
  const zAllegro = useZamowieniaZAllegro();
  const przyjmijNieodebrana = usePrzyjmijNieodebrana();
  const pytanyLogin = useRef("");
  const [wynikSkanu, setWynikSkanu] = useState<WynikSkanu | null>(null);
  const [bladSkanu, setBladSkanu] = useState("");

  /* Filtr liczy się TUTAJ, w pamięci ekranu — tą samą drogą co filtr kubełka
     i z tego samego powodu: lista przyjeżdża w całości, bo zwrotów w pracy są
     dziesiątki, nie tysiące. Szukanie po fragmencie na serwerze musiałoby albo
     rozluźnić `znajdzZwrotPoKodzie` (a ono ma być DOKŁADNE, bo samo otwiera
     zwrot), albo dołożyć trasę z dziennikiem — czyli zapisać, czego ktoś
     szukał. Enter zostaje, bo `POST /skan` zna też numery paczek, których
     w modelu pracy nie ma.

     Fraza dzieli się po spacjach (`pasujeDoFrazy`): człowiek
     z kartonem w ręku ma kilka drobnych uchwytów naraz, a żaden sam nie
     zawęża. */
  const { porzadek, ustaw: ustawPorzadek } = usePorzadek(
    "wertis.zwroty.porzadek", ["termin", "otwarto", "kwota"], "termin");

  const pasujace = useMemo(() => {
    /* Grupa rozjazdów zawęża jak szukanie — przez wszystkie kubełki, bo
       „rozliczony bez korekty" stoi w ZAMKNIĘTYCH, a „po terminie" w kilku
       naraz. Klucz rozjazdu to numer zwrotu albo jego identyfikator. */
    if (filtrRozjazdu) {
      const klucze = new Set((rozjazdy.data?.rozjazdy ?? [])
        .filter((r) => r.rodzaj === filtrRozjazdu).map((r) => r.klucz));
      return (data?.zwroty ?? []).filter((z) => klucze.has(z.numer ?? z.externalId));
    }
    if (!rozbij(fraza).length) return null;
    return (data?.zwroty ?? []).filter((z) => pasujeDoFrazy(kody(z), fraza));
  }, [data, fraza, filtrRozjazdu, rozjazdy.data]);

  /* Szukanie PRZEBIJA kubełek. Bez tego operator wpisuje numer, widzi „ten
     kubełek jest pusty" i nie ma jak się dowiedzieć, że zwrot stoi w
     ZAMKNIĘTYCH. Kod jest mocniejszy niż zakładka, na którą ktoś przed chwilą
     kliknął — tak samo jak adres w pasku przeglądarki. */
  /* ── PORZĄDEK: DOMYŚLNIE TERMIN ──────────────────────────────────────────
     Pracę prowadzi pytanie „co się najbardziej pali", więc domyślny jest
     termin. Inny porządek wybiera agent sam.

     TRZY OSIE, nie cztery: zwrot nie ma „ostatniego ruchu" — nie prowadzi
     rozmowy, więc nie ma czego pytać. Kwotą jest suma pozycji, bo ona stoi
     przy KAŻDYM zwrocie; `kwotaGrosze` bywa pusta do czasu decyzji, a dwie
     różne kwoty pod jedną etykietą wprowadzałyby w błąd. */
  /* ── PACZKA W DRODZE NA KOŃCU ───────────────────────────────────────────
     DO DECYZJI nie miesza zwrotów, przy których
     jest co zrobić, z paczkami, które jeszcze nie przyszły. Porządek po
     terminie spycha je w dół sam, ale porządek po dacie albo kwocie wplatałby
     je między pracę. Podział stoi PO sortowaniu i go nie łamie: w obu
     częściach zostaje kolejność, którą wybrał człowiek. */
  const widoczne = useMemo(() => {
    const posortowane = posortuj(pasujace ?? wKubelku, porzadek, {
      otwarto: (z) => z.utworzono,
      termin: (z) => z.terminAt,
      kwota: (z) => z.sumaPozycjiGrosze,
    });
    const wDrodze = (z: Zwrot) => z.dniDoTerminu === null
      && z.kubelek !== "zamkniety" && z.kubelek !== "odrzucony";
    return [...posortowane.filter((z) => !wDrodze(z)), ...posortowane.filter(wDrodze)];
  }, [pasujace, wKubelku, porzadek]);

  /* Trafienie otwiera zwrot od razu — po to jest ten skan. Adres jest tu
     źródłem prawdy i sam dociąga kubełek, więc zwrot otwiera się także wtedy,
     gdy stoi w innym kubełku niż oglądany. */
  const przyjmij = (w: WynikSkanu) => {
    setWynikSkanu(w);
    setBladSkanu("");
    if (!w.zwrotId) return;
    /* TRAFIENIE ZDEJMUJE KURSOR Z POLA. Czytnik pisze w pole, gdy ono ma
       kursor, a skróty w polu milkną. Po otwarciu zwrotu następnym ruchem
       jest `P` albo `S`, nie dopisanie znaku. */
    (document.activeElement as HTMLElement | null)?.blur();
    nawiguj(`/obsluga/zwroty/${w.zwrotId}`);
  };
  const szukaj = (v: string) => {
    setKod(v);
    setFraza(v);
    skan.mutate(v, { onSuccess: przyjmij, onError: (e) => setBladSkanu((e as Error).message) });
  };

  /* ── SKAN: ETYKIETA ALBO TOWAR ───────────────────────────────────────────
     Zakładka cały czas nasłuchuje skanu etykiety zwrotowej i odróżnia ją od
     EAN-u towaru. EAN idzie DO KOSZYKA — tak jak pole „Skanuj towar" przy
     pudle, tylko bez klikania w nie.

     Kształt EAN-u to podejrzenie, rozstrzyga kartoteka. Jedno dokładne
     trafienie idzie do koszyka. Brak trafienia albo odmowa serwera wraca do
     szukania zwrotu, bo cyfrowa etykieta bywa przypadkiem podobna do EAN-u.
     Skan towaru NIE rusza frazy: lista kolejki zostaje taka, jaka była. */
  const dolozTowar = useDolozTowar();
  const [skanTowaru, setSkanTowaru] = useState<{ tekst: string; blad: boolean } | null>(null);
  /* Kod, który przyszedł Z CZYTNIKA. Pole szukania woła tę samą
     drogę Enterem, więc wpisane „kowalski" też chybia i otwiera szukanie
     klienta. Bez tego rozróżnienia przycisk „Przyjmij jako nieodebraną"
     zapisałby nazwisko jako numer listu, a potem wpisane nazwisko otwierałoby
     ten zwrot jak skan naklejki. */
  const kodZCzytnika = useRef("");
  const naSkan = async (v: string) => {
    kodZCzytnika.current = v;
    setSkanTowaru(null);
    if (wygladaNaEan(v)) {
      let towar: TowarDoKosza | null = null;
      try {
        const w = await szukajTowaruDoKosza(v);
        if (w.dokladne && w.towary.length === 1) towar = w.towary[0];
      } catch {
        /* Kartoteka nie odpowiedziała — kod idzie do szukania zwrotu, które
           powie „nie znam", zamiast zgubić skan w ciszy. */
      }
      if (towar) {
        const t = towar;
        dolozTowar.mutate({ twId: t.twId, ilosc: 1, rodzaj: "zwroty" }, {
          onSuccess: (w) => {
            setSkanTowaru({ tekst: `${t.symbol} → koszyk ${w.kod}: ${w.ilosc} szt.`, blad: false });
            /* EAN zeskanowany w polu szukania stoi w nim po podmianie serii.
               Zostawiony filtrowałby kolejkę po kodzie towaru do zera. */
            setFraza((f) => (f === v ? "" : f));
          },
          onError: (e) => setSkanTowaru({ tekst: (e as Error).message, blad: true }),
        });
        return;
      }
    }
    szukaj(v);
  };

  const wybrany = id ? Number(id) : null;
  const zwrot = data?.zwroty.find((z) => z.id === wybrany) ?? null;
  /* Kandydatów na dokument sprzedaży niesie DOPIERO szczegół zwrotu, nie
     kolejka: liczą się z okna sześćdziesięciu dni sprzedaży, a kolejka ma
     dziesiątki wierszy. Jeden otwarty zwrot to jedno takie liczenie. */
  const szczegol = useZwrot(wybrany);
  /* Dokument sprzedaży, który Enter w DO KOREKTY przyjmuje.
     Automat ZW bez dokumentu nie ruszy (`wiazania.ts`), więc w tym kubełku
     brak dokumentu jest PIERWSZĄ rzeczą do zrobienia — pierwszy Enter
     przyjmuje podsuniętego kandydata, następny stawia kursor w numerze
     korekty. Szczegół musi być TEGO zwrotu: przy przełączaniu kandydaci
     poprzedniego stoją w pamięci podręcznej jeszcze chwilę. */
  const polecany = zwrot?.kubelek === "korekta" && zwrot.faktura.dokId === null
    && szczegol.data?.zwrot?.id === zwrot.id
    ? polecanyKandydat(szczegol.data.kandydaciFaktury ?? []) : null;

  /* Wejście z paska adresu na zwrot z innego kubełka ma pokazać ten zwrot,
     a nie pustą listę. Adres jest tu źródłem prawdy, kubełek za nim idzie. */
  useEffect(() => {
    if (zwrot && kubelek !== null && zwrot.kubelek !== kubelek) setKubelek(zwrot.kubelek);
    /* Ta sama zasada dla sita: zwrot z adresu ma stać na liście, którą widać. */
    if (zwrot?.kubelek === "decyzja" && sito !== null && sitoDecyzji(zwrot) !== sito) setSito(null);
  }, [zwrot?.id]);

  /**
   * CAŁY kod otwiera zwrot, fragment tylko zawęża listę.
   *
   * Ekran sam otwiera przy jednym wyniku, więc dopasowanie przybliżone
   * prowadziłoby do CUDZEJ sprawy — a przy zwrocie znaczy to cudzego klienta
   * i cudze pieniądze. Ta sama zasada stoi przy skanie.
   *
   * Otwarcie w pół pisania nie jest wpadką: otwarty zwrot niczego nie mutuje
   * (zero zapisu przy patrzeniu), pole zostaje z tekstem, a dopisanie znaku
   * przenosi ekran dalej. Dwa zwroty o tym samym kodzie — na przykład dwa
   * zwroty z jednego zamówienia — nie otwierają żadnego; wybiera człowiek.
   */
  useEffect(() => {
    const czlony = rozbij(fraza);
    /* JEDEN CZŁON I DOKŁADNIE. Fraza wieloczłonowa zawęża listę,
       ale nigdy nie otwiera sama: dopasowanie po fragmentach jest z natury
       przybliżone, a to jest ekran, z którego wychodzi się z czyimś zwrotem
       i czyimiś pieniędzmi. Ta sama zasada trzyma `znajdzZwrotPoKodzie`. */
    if (czlony.length !== 1) return;
    const f = czlony[0];
    const trafienia = (data?.zwroty ?? []).filter((z) => identyfikatory(z).includes(f));
    if (trafienia.length === 1 && trafienia[0].id !== wybrany) {
      nawiguj(`/obsluga/zwroty/${trafienia[0].id}`);
    }
  }, [fraza, data]);

  /**
   * Przełączenie kubełka PRZESTAWIA TEŻ KURSOR.
   *
   * Bez tego jeden klawisz zmieniał listę, a zaznaczenie zostawało na zwrocie
   * z poprzedniego kubełka — środkowa kolumna pokazywała wtedy pytanie nowego
   * kubełka nad klawiszami starego. Operator musiał dokliknąć wiersz, czyli
   * dokładnie to jedno kliknięcie, którego ten ekran miał nie mieć.
   */
  const przelacz = (k: Kubelek | null) => {
    setKubelek(k);
    /* Kubełek zaczyna się bez sita — sito wybrane tydzień temu chowałoby
       część kubełka bez widocznego powodu. */
    setSito(null);
    /* Kliknięcie w kubełek jest prośbą o TEN kubełek, więc zdejmuje filtr.
       Inaczej przełącznik wyglądałby na zepsuty: lista zostawałaby ta sama. */
    setFraza("");
    setWynikSkanu(null);
    const pierwszy = (data?.zwroty ?? []).find((z) => k === null || z.kubelek === k);
    nawiguj(pierwszy ? `/obsluga/zwroty/${pierwszy.id}` : "/obsluga/zwroty");
  };

  /* Po `P` przyjęty zwrot schodzi z kubełka, a `j` ma otworzyć ten, który
     stanął na jego miejscu. Powód przy `nawigacja/kursor.ts`. */
  const idz = useKursorListy(widoczne, wybrany, (z) => nawiguj(`/obsluga/zwroty/${z.id}`));

  /* Rejestr akcji dla klawiszy, które sięgają do stanu kolumny środkowej
     (powód odmowy, zaznaczenie pozycji) — powód w `zwroty/klawisze.ts`. */
  const akcje = useRef<AkcjeKlawiszy>({});

  /**
   * Wszystkie nieocenione pozycje „na stan" — jednym ruchem.
   *
   * PO KOLEI, NIE RÓWNOLEGLE, i z wersją oddaną przez poprzedni zapis: każda
   * ocena podnosi wersję zwrotu, więc pięć żądań wysłanych naraz odbiłoby się
   * od blokady optymistycznej i zostawiło zwrot oceniony w połowie. Błąd
   * zatrzymuje pętlę i pokazuje się tą samą drogą co przy ocenie pojedynczej.
   */
  const wszystkieNaStan = async () => {
    if (!zwrot) return;
    let wersja = zwrot.wersja;
    const koszId = pudloTegoZwrotu("stan");
    for (const p of zwrot.pozycje.filter((x) => !x.ocena)) {
      const w = await ocena2.mutateAsync({ pozycjaId: p.id, ocena: "stan", wersja, koszId });
      wersja = w.wersja;
    }
  };

  /* ── PUDŁO TEGO ZWROTU PRZY KILKU OTWARTYCH ─────────────────────────────
     Pudła NIE zgadujemy. Wybieramy wyłącznie to, do którego człowiek sam
     włożył już towar TEGO zwrotu — to ten sam karton, który ma przed sobą.
     Dzięki temu klawisz `S` działa przy dwóch otwartych pudłach.

     Bez takiego pudła albo przy dwóch naraz serwer pyta, a przyciski
     z kodami pudeł stoją przy pozycji. */
  const pudla = useKosz().data?.kosze ?? [];
  const pudloTegoZwrotu = (ocena: Ocena): number | undefined => {
    if (!zwrot || ocena === "outlet") return undefined;
    const rodzaj = ocena === "utylizacja" ? "odpad" : "zwroty";
    const tegoRodzaju = pudla.filter((k) => k.rodzaj === rodzaj);
    if (tegoRodzaju.length < 2) return undefined;
    const zTymZwrotem = tegoRodzaju.filter((k) => k.pozycje.some((p) => p.zwrotId === zwrot.id));
    return zTymZwrotem.length === 1 ? zTymZwrotem[0].id : undefined;
  };

  /* ── SZYBKA ŚCIEŻKA — reguła w `zwroty/regulaSzybkiej.ts` ─────────────────
     Cały ciąg typowego zwrotu jednym ruchem: przyjęcie, pewne kartoteki,
     ocena „na stan", pełna kwota, a na końcu zwrot w Allegro do wypłaty.

     PO KOLEI, z wersją oddaną przez poprzedni zapis — ta sama zasada co przy
     ocenie hurtem. Pierwszy błąd zatrzymuje ciąg; to, co już się zapisało,
     zostaje i widać to na osi, a reszta czeka na zwykłe przyciski.

     KARTA ALLEGRO OTWIERA SIĘ OD RAZU, PUSTA. Przeglądarka pozwala otworzyć
     okno tylko w chwili kliknięcia — po czterech żądaniach blokada okienek
     już by je zdjęła. Adres dostaje dopiero po udanym zapisie kwoty, a przy
     błędzie karta się zamyka: wypłata nie może wyprzedzić zapisu u nas. */
  const stanSzybkiej = zwrot ? szybkaSciezka(zwrot, pudla) : { pokaz: false as const };
  const potwierdzKartoteke = usePotwierdzKartoteke();
  const [szybka, setSzybka] = useState<{ trwa: boolean; blad: string }>({ trwa: false, blad: "" });
  const szybkiZwrot = () => {
    if (!zwrot || !stanSzybkiej.pokaz || stanSzybkiej.przeszkoda || szybka.trwa) return;
    const z = zwrot;
    const okno = window.open("", "_blank");
    setSzybka({ trwa: true, blad: "" });
    void (async () => {
      let wersja = z.wersja;
      if (z.werdykt !== "przyjety") {
        wersja = (await werdykt.mutateAsync(
          { id: z.id, decyzja: "przyjety", powod: null, wersja })).wersja;
      }
      for (const p of z.pozycje.filter((x) => x.twId === null && pewnaPropozycja(x))) {
        await potwierdzKartoteke.mutateAsync(
          { pozycjaId: p.id, twId: p.propozycja!.twId, zrodlo: "sku" });
      }
      const koszId = pudloTegoZwrotu("stan");
      for (const p of z.pozycje.filter((x) => x.ocena === null)) {
        const w = await ocena2.mutateAsync({ pozycjaId: p.id, ocena: "stan", wersja, koszId });
        wersja = w.wersja;
        /* POZYCJA POZA PUDŁEM ZATRZYMUJE CIĄG. Serwer zapisuje
           ocenę także wtedy, gdy do pudła jej nie dołożył, i mówi to
           `koszyk: null`. Iść dalej znaczyłoby oddać pieniądze za towar,
           którego nie ma na MM — a zakładka Allegro zasłoniłaby napis przy
           pozycji. Kwota zostaje niezapisana, więc zwrot czeka w DO ZWROTU. */
        if (w.koszyk === null) {
          throw new Error(`„${p.nazwa}” nie weszła do pudła — powód stoi przy pozycji. Kwoty nie zapisałem.`);
        }
      }
      /* BEZ KOSZTU DOSTAWY — decyzja właściciela. Ekran ręczny ma swój
         haczyk i tam człowiek decyduje; szybka ścieżka nie pyta, więc nie
         dokłada pieniędzy, o które nikt nie zdecydował. */
      await kwota.mutateAsync({ id: z.id, pozycjeIds: z.pozycje.map((p) => p.id),
        dostawa: false, wersja });
    })().then(() => {
      setSzybka({ trwa: false, blad: "" });
      if (okno) { okno.opener = null; okno.location.href = z.linkZwrotu!; }
    }, (e: Error) => {
      okno?.close();
      setSzybka({ trwa: false, blad: `Zatrzymałem się: ${e.message}` });
    });
  };

  /* ── KLIENT NIE ODESŁAŁ: ODMOWA JEDNYM RUCHEM ───────────────────────
     Najpierw odmowa w Allegro, potem werdykt u nas. Odwrotnie zwrot stałby
     u nas jako odrzucony, a w Allegro dalej czekałby na wypłatę — i nic by
     o tym nie przypominało. Odmowa, która nie przejdzie, nie zmienia niczego. */
  const [nieOdeslany, setNieOdeslany] = useState<{ trwa: boolean; blad: string }>({ trwa: false, blad: "" });
  const odmowNieOdeslanemu = () => {
    if (!zwrot || !zwrot.sygnaly.includes("nie_odeslany") || nieOdeslany.trwa) return;
    const z = zwrot;
    setNieOdeslany({ trwa: true, blad: "" });
    let odmowionoWAllegro = false;
    void (async () => {
      const o = await odmowaPlatnosci.mutateAsync(
        { id: z.id, kod: "REFUND_REJECTED", powod: POWOD_NIE_ODESLAL, wersja: z.wersja });
      odmowionoWAllegro = true;
      await werdykt.mutateAsync(
        { id: z.id, decyzja: "odrzucony", powod: POWOD_NIE_ODESLAL, wersja: o.wersja });
    })().then(() => setNieOdeslany({ trwa: false, blad: "" }), (e: Error) => setNieOdeslany({
      trwa: false,
      blad: odmowionoWAllegro
        ? `Odmowa poszła do Allegro, ale werdykt się nie zapisał: ${e.message} Odrzuć ręcznie (O).`
        : `Allegro nie przyjęło odmowy: ${e.message}`,
    }));
  };

  /**
   * Klawisze KUBEŁKA — tabela §25a.2. Typowy zwrot to jeden klawisz (§25a.3).
   *
   * Klawisz NIE JEST skrótem do wszystkiego: `O` otwiera pole powodu zamiast
   * zapisywać odmowę, bo odmowa jest nieodwracalna (§25a.5). Utylizacja nie ma
   * wariantu hurtowego z tego samego powodu.
   */
  const klawiszKubelka = (e: KeyboardEvent) => {
    if (!zwrot || trwa) return;
    const wersja = zwrot.wersja;
    /* PIENIĄDZE STOJĄ PRZED KUBEŁKAMI, bo należność nie siedzi w jednym.
       Przycisk ODDAJ PIENIĄDZE bywa na ekranie w DO ZWROTU, w DO KOREKTY
       i na zwrocie ZAMKNIĘTYM — bramka serwera nie patrzy na zamknięcie
       (`zwrot-pieniedzy.ts`). Gałąź w każdym kubełku z osobna rozjechałaby
       się z tą bramką przy pierwszej zmianie drabiny. */
    if (e.key === "z" || e.key === "Z") {
      e.preventDefault();
      akcje.current.oddajPieniadze?.();
      return;
    }
    /* `W` — szybka ścieżka, w każdym kubełku, w którym przycisk stoi.
       Klawisz jest gestem użytkownika, więc karta Allegro się otworzy. */
    if ((e.key === "w" || e.key === "W") && stanSzybkiej.pokaz) {
      e.preventDefault();
      szybkiZwrot();
      return;
    }
    /* WYJĄTKI Z KLAWIATURY: `-` otwiera „wróciło mniej", `D`
       potrącenie. Gdzie formularza nie ma, akcja w `Pozycje.tsx` milczy. */
    if (e.key === "-" && (zwrot.kubelek === "ocena" || zwrot.kubelek === "zwrot")) {
      e.preventDefault();
      akcje.current.ilosc?.();
      return;
    }
    if ((e.key === "d" || e.key === "D") && zwrot.kubelek === "zwrot") {
      e.preventDefault();
      akcje.current.potracenie?.();
      return;
    }
    if (zwrot.kubelek === "decyzja") {
      /* `N` — gotowa odmowa, tylko przy sygnale „nie odesłał". */
      if ((e.key === "n" || e.key === "N") && zwrot.sygnaly.includes("nie_odeslany")) {
        e.preventDefault();
        odmowNieOdeslanemu();
        return;
      }
      if (e.key === "p" || e.key === "P") {
        e.preventDefault();
        werdykt.mutate({ id: zwrot.id, decyzja: "przyjety", powod: null, wersja });
      } else if (e.key === "s" || e.key === "S" || e.key === "u" || e.key === "U") {
        /* ── OCENA JEST PRZYJĘCIEM ──────────────────────────────────────
           `P` i zaraz `S` to byłyby dwa klawisze na
           jedną decyzję. Kto ocenia towar „na stan", ten zwrot przyjął — więc
           klawisz oceny w DO DECYZJI robi jedno i drugie. Odmowa zostaje
           osobną, świadomą drogą pod `O`, bo idzie do klienta.

           PO KOLEI, z wersją oddaną przez przyjęcie — ta sama zasada co przy
           ocenie hurtem. `Shift+S` przyjmuje i ocenia wszystko na stan. */
        e.preventDefault();
        const ocena: Ocena = e.key === "s" || e.key === "S" ? "stan" : "utylizacja";
        const hurt = e.key === "S";
        const pozycje = zwrot.pozycje.filter((x) => !x.ocena);
        const koszId = pudloTegoZwrotu(ocena);
        void (async () => {
          const w = await werdykt.mutateAsync(
            { id: zwrot.id, decyzja: "przyjety", powod: null, wersja });
          let v = w.wersja;
          for (const p of hurt ? pozycje : pozycje.slice(0, 1)) {
            v = (await ocena2.mutateAsync({ pozycjaId: p.id, ocena, wersja: v, koszId })).wersja;
          }
        })().catch(() => {});
      } else if (e.key === "o" || e.key === "O") {
        e.preventDefault();
        akcje.current.odmow?.();
      }
      return;
    }
    if (zwrot.kubelek === "ocena") {
      /* WIELKA LITERA TO HURT — czyli `Shift+S`. Osobnego sprawdzania modyfikatora
         nie ma po co pisać: przeglądarka oddaje tu gotowy znak. */
      if (e.key === "S") { e.preventDefault(); void wszystkieNaStan().catch(() => {}); return; }
      /* `o` to OUTLET, i nie zderza się z „odmów" z kubełka DO DECYZJI: tamta
         gałąź kończy się `return` nad tym miejscem, więc w kubełku DO OCENY
         klawisz jest wolny. Litera bierze się z nazwy, a nie z kolejności. */
      const ocena: Ocena | null = e.key === "s" ? "stan"
        : e.key === "u" || e.key === "U" ? "utylizacja"
          : e.key === "o" || e.key === "O" ? "outlet" : null;
      if (!ocena) return;
      /* PIERWSZA NIEOCENIONA, potem następna — kolejność z ekranu, więc klawisz
         idzie tą samą drogą, którą wędruje wzrok. Przy zwrocie jednopozycyjnym
         to dokładnie jeden klawisz, tak jak mówi §25a.3. */
      const pozycja = zwrot.pozycje.find((x) => !x.ocena);
      if (!pozycja) return;
      e.preventDefault();
      ocena2.mutate({ pozycjaId: pozycja.id, ocena, wersja, koszId: pudloTegoZwrotu(ocena) });
      return;
    }
    /* Enter zapisuje kwotę tylko wtedy, gdy jej jeszcze nie ma.
       Zwrot czekający na pieniądze stoi w tym kubełku z kwotą i korektą. */
    if (zwrot.kubelek === "zwrot" && zwrot.kwotaGrosze === null && e.key === "Enter") {
      e.preventDefault();
      akcje.current.zapiszKwote?.();
      return;
    }
    if (zwrot.kubelek === "korekta" && e.key === "Enter") {
      /* Numer korekty wpisuje człowiek, więc ten Enter niczego nie zapisuje —
         stawia kursor w polu. Drugi Enter, już w polu, zapisuje numer. */
      e.preventDefault();
      if (polecany) {
        setBladFaktury("");
        faktura.mutate({ id: zwrot.id, dokId: polecany.dokId },
          { onError: (err) => setBladFaktury((err as Error).message) });
        return;
      }
      akcje.current.korekta?.();
      return;
    }
    /* `R` stoi przy numerze korekty, czyli na zwrocie ZAMKNIĘTYM
       (`Decyzje.tsx`). */
    if (zwrot.korektaNumer && (e.key === "r" || e.key === "R")) {
      e.preventDefault();
      cofnijKorekte.mutate({ id: zwrot.id, wersja });
    }
  };

  /* Skróty idą TĄ SAMĄ drogą co czytnik. Dwa niezależne nasłuchy
     nie umiałyby się dogadać, który klawisz jest czyj — a numer listu
     `600000367616070023174201` zawiera wszystkie cyfry kubełków. */
  /* `wPolach`: skan działa także przy kursorze w notatce, kwocie
     czy loginie. Seria czytnika nie zostaje w polu — zakładka słucha
     etykiety CAŁY CZAS. */
  useSkaner(
    (kod) => { void naSkan(kod); },
    (e) => {
      if (e.key === "ArrowDown" || e.key === "j") { e.preventDefault(); idz(1); }
      else if (e.key === "ArrowUp" || e.key === "k") { e.preventDefault(); idz(-1); }
      else if (/^[1-6]$/.test(e.key)) przelacz(KUBELKI[Number(e.key) - 1].id);
      else if (e.key === "7") przelacz(null);
      /* Bez klawiszy `m` i `n`, bo sita tu nie ma. Martwy klawisz
         w nasłuchu jest gorszy niż jego brak: milczy i uczy, że nie działa. */
      else klawiszKubelka(e);
    },
    { wPolach: true },
  );

  /* Zapytanie padło i nie ma danych: błąd zamiast listy, a kafle bez liczb.
     Pusta lista albo „0” przy awarii czytałyby się jako „nic nie czeka”.
     Nieudane odświeżenie przy danych w pamięci nie zdejmuje ekranu, bo
     serwer znika przy każdej aktualizacji, a operator jest w środku zwrotu. */
  const bezDanych = Boolean(error && !data);

  const opis = KUBELKI.find((k) => k.id === kubelek);

  /* Czy przy tym zwrocie zostało coś do zrobienia z pieniędzmi.
     Czytane z RENDERU, nie z `onSuccess`: korekta nie rusza żadnej z tych
     dwóch bramek (`zwrot-pieniedzy.ts`), więc wartość sprzed zapisu jest ta
     sama co po nim — a nie ściga się z odświeżeniem zapytania. */
  const stanPieniedzy = szczegol.data?.pieniadze;
  /* ── KLAWISZE, KTÓRE NAPRAWDĘ DZIAŁAJĄ ─────────────────────────────────
     Tabela kubełków mówi, co klawisz robi w typowym zwrocie; stan zwrotu
     potrafi to wyłączyć. Z kwotą w DO ZWROTU (czeka na pieniądze) Enter, `D`
     i `-` milczą, bo wycena się skończyła. `-` milczy też bez pozycji
     z kilkoma sztukami do przeliczenia. Pasek bez tych wyjątków obiecywałby
     martwe klawisze. */
  const klawiszeTeraz = (KLAWISZE_KUBELKA[zwrot?.kubelek ?? kubelek ?? "wszystkie"] ?? [])
    .filter(([k]) => {
      if (!zwrot) return true;
      if (zwrot.kubelek === "zwrot" && zwrot.kwotaGrosze !== null) return false;
      if (k === "-") return zwrot.pozycje.some((p) => p.ilosc > 1 && p.iloscZwrocona == null);
      return true;
    })
    /* `N` doklejany przy sygnale „nie odesłał" — tak jak `R`. */
    .concat(zwrot?.kubelek === "decyzja" && zwrot.sygnaly.includes("nie_odeslany")
      ? [["N", "nie odesłał — odmów"] as const] : []);
  const pieniadzeCzekaja =
    Boolean(stanPieniedzy?.moznaZwrocic || stanPieniedzy?.moznaZapisacPrzelew);

  /* Ekran trzyma się okna, a przewijają się KOLUMNY. Pion strony byłby
     drogą do zgubienia kolejki: żeby dojść do dołu dowodów, operator
     zjeżdżałby z oczu liście, po której chodzi klawiszami.

     Pasek kartotek stoi POZA gridem, w zewnętrznej kolumnie. Jako warunkowy
     wiersz `auto` byłby pułapką: bez paska pierwsza karta wpadałaby w ten
     wiersz i cała blokada znikała. Kolumna flexa nie ma tego problemu — nie
     ma dziecka, nie ma wiersza, nie ma odstępu.

     `lg:grid-rows-[minmax(0,1fr)]` nie jest ozdobą: pojedynczy wiersz `auto`
     mierzy się do `max-content`, więc przy treści wyższej niż okno grid
     wylewałby się poza kontener zamiast przyciąć ścieżkę. */
  return <div className="flex flex-col gap-4 lg:h-full lg:min-h-0">
    {/* ── JEDEN RZĄD NAGŁÓWKA ───────────────────────────────────────────
        Przełącznik, pasek kartotek i przycisk nowego koszyka stoją w jednym
        rzędzie, żeby oszczędzić wysokość. Pasek kartotek bierze resztę
        szerokości, a na wąskim ekranie rząd się zawija.
        Zwroty i kosze pod jedną zakładką — powód w `Przelacznik.tsx`. */}
    <div className="flex shrink-0 flex-wrap items-start gap-2">
      <PrzelacznikZwrotow teraz="zwroty" />
      <NowyKoszyk />
      <div className="min-w-0 flex-1">
        <PasekUwag bilans={data?.kartoteki} stan={data?.stan} rozjazdy={rozjazdy.data?.rozjazdy ?? []}
          filtr={filtrRozjazdu}
          /* Grupa zdejmuje frazę: dwa filtry naraz dawałyby pustą listę
             bez widocznego powodu. */
          onFiltr={(r) => { setFiltrRozjazdu(r); if (r) setFraza(""); }} />
      </div>
    </div>
    {data?.stan && <PasekOgona stan={data.stan} />}
    <Koszyk />
    {/* Obok koszyka, bo to ta sama praca: co wyjęte z pudła, gdzie idzie.
        Outlet nie ma pudła ani dokumentu — ma listę i czyjeś ręce. */}
    <NaOutlet />
    <div className={SIATKA_TRZECH_KOLUMN}>
    <Karta className="flex min-h-0 flex-col overflow-hidden">
      {/* `shrink-0` na blokach nad listą nie jest kosmetyką: lista ma bazę 0,
          więc przy ciasnym oknie kurczyłyby się WYŁĄCZNIE one. */}
      {/* ── KAFLE ZAMIAST PIGUŁEK ───────────────────────────────────────────
          Ikony zamiast tekstu. Siatka trzech kolumn układa kubełki w równe
          rzędy, a kolejność i pomoc stają w ostatnim, obok „Wszystkie" — tam,
          gdzie zostaje miejsce, zamiast przed kubełkami, które czyta się
          pierwsze. */}
      <nav className="grid shrink-0 grid-cols-3 gap-1 border-b border-slate-200 p-2">
        {/* ── JEDEN KSZTAŁT WYBORU ───────────────────────────────────────────
            Kształt jest jeden dla całego panelu — powód stoi przy
            `FiltrSegmentowy`.

            „Wszystkie" WCHODZI DO TABLICY, zamiast wisieć osobnym przyciskiem
            pod pętlą: to jest ten sam wybór, co każdy kubełek, tylko bez
            zawężenia. Numer klawisza liczy się z długości listy, więc dopisanie
            kubełka nie zostawia w podpowiedzi nieaktualnej cyfry. */}
        {/* Kolejność i pomoc w RZĘDZIE KUBEŁKÓW. Tu, inaczej niż
            w reklamacjach, nie ma osobnego wiersza narzędzi: szukanie zwrotów
            to skaner z własnym rzędem (`zwroty/Szukanie.tsx`), więc dokładanie
            mu sąsiadów zrobiłoby z niego to, czym nie jest. */}
        <FiltrSegmentowy<Kubelek | null> kafle wybrany={kubelek} onWybierz={przelacz}
          pozycje={[
            ...KUBELKI.map((k, i) => ({ klucz: k.id, etykieta: k.etykieta,
              ile: data ? data.liczniki?.[k.id] ?? 0 : undefined,
              /* Ta sama ikona co na osi etapów nad zwrotem — słownik ikon
                 ma jedną wagę na jedno znaczenie. */
              ikona: React.createElement(IKONA_KUBELKA[k.id], { size: 18 }),
              podpowiedz: `${k.pytanie} (klawisz ${i + 1})` })),
            { klucz: null, etykieta: "Wszystkie", ile: data?.zwroty.length,
              ikona: <List size={18} />,
              podpowiedz: `Wszystkie zwroty (klawisz ${KUBELKI.length + 1})` },
          ]} />
        <div className="flex items-center justify-center">
          <PasekPorzadku porzadek={porzadek} dozwolone={["termin", "otwarto", "kwota"]}
            onZmien={ustawPorzadek} />
        </div>
      {/* Pomoc w swojej komórce siatki — obok kolejności, na końcu rzędu. */}
      <div className="flex items-center justify-center">
      {/* `sita={false}`: sita „Niczyje" tu nie ma, więc pomoc nie obiecuje
          klawisza `n`. */}
      <SkrotyKlawiszy zMoje={false} sita={false} kubelkow={KUBELKI.length}
          /* Klawisze OTWARTEGO zwrotu, gdy jest. Po `P` zwrot stoi już
             w DO OCENY, a lista dalej w DO DECYZJI — pasek kubełka pokazywałby
             P/O, choć działają S/U. */
          /* `Z` DOPISUJE SIĘ ZE STANU, nie z tabeli kubełków: należność
             przechodzi przez trzy kubełki i gaśnie w środku każdego z nich.
             Wpisany do `KLAWISZE_KUBELKA` stałby w pasku także po wypłacie —
             czyli byłby dokładnie tym martwym klawiszem, przeciw któremu
             powstał `SkrotyKlawiszy`. */
          dodatkowe={[
            /* Pasek mówi, co Enter zrobi TERAZ — przy podsuniętym dokumencie
               przyjmie go, a nie postawi kursora w numerze korekty. */
            ...(polecany ? [["Enter", "przyjmij dokument sprzedaży"] as const]
              : klawiszeTeraz),
            ...(stanPieniedzy?.moznaZwrocic
              ? [["Z", "oddaj pieniądze"] as const] : []),
            /* `W` tylko wtedy, gdy przycisk naprawdę puści ciąg — przy
               przeszkodzie klawisz milczałby, a pasek kłamał. */
            ...(stanSzybkiej.pokaz && !stanSzybkiej.przeszkoda
              ? [["W", "wszystko OK — na półkę i wypłata"] as const] : []),
            /* `R` ZE STANU, nie z kubełka: klawisz działa przy
               każdym zwrocie z numerem korekty — także w DO ZWROTU, gdzie
               czeka na pieniądze — a w ZAMKNIĘTYCH bez korekty (rozliczonych
               przez Allegro) milczy. */
            ...(zwrot?.korektaNumer ? [["R", "cofnij korektę"] as const] : []),
          ]} />
      </div>
      </nav>

      <Szukanie
        wynik={wynikSkanu} kod={kod} fraza={fraza} ile={pasujace?.length ?? null}
        szuka={skan.isPending} dociaga={dociagnij.isPending} blad={bladSkanu}
        onFraza={(v) => { setFraza(v); if (v) setFiltrRozjazdu(null); if (!v) setWynikSkanu(null); }}
        onSzukaj={(v) => { kodZCzytnika.current = ""; szukaj(v); }}
        onSkan={(v) => { void naSkan(v); }}
        towar={skanTowaru}
        pod={<SprawdzWszystkie
          trwa={sprawdzWszystkie.isPending} blad={bladWszystkich} wynik={wynikWszystkich}
          onZamknij={() => { setWynikWszystkich(null); setBladWszystkich(""); }}
          onSprawdz={() => {
            setWynikWszystkich(null); setBladWszystkich("");
            sprawdzWszystkie.mutate(undefined, {
              onSuccess: (w) => setWynikWszystkich(w),
              onError: (e) => setBladWszystkich((e as Error).message),
            });
          }} />}
        onDociagnij={(v) => dociagnij.mutate(v, {
          onSuccess: przyjmij, onError: (e) => setBladSkanu((e as Error).message) })}
        onWybierz={(x) => { setWynikSkanu(null); nawiguj(`/obsluga/zwroty/${x}`); }}
        paczki={loginPaczek ? paczkiKlienta.data?.paczki ?? null : null}
        szukaPaczek={paczkiKlienta.isFetching}
        /* LOGIN IDZIE TEŻ DO ALLEGRO. Lista wyżej czyta naszą
           bazę, a ta nie zna zamówienia paczki nieodebranej — nic do niego nie
           prowadzi. Bez tego biuro szukałoby takiej paczki na stronie Allegro.
           Pobrane zamówienia serwer zapisuje, a mutacja odświeża listę, więc
           wynik pokazuje ta sama lista, w tym samym miejscu. */
        onLogin={(v) => {
          setLoginPaczek(v);
          const klucz = v.trim().toLowerCase();
          if (!wygladaNaLogin(v) || pytanyLogin.current === klucz) return;
          pytanyLogin.current = klucz;
          zAllegro.reset();
          zAllegro.mutate(v, {
            /* Odmowa nie zapamiętuje uchwytu: następny Enter ma prawo spytać
               jeszcze raz, bo przerwa Allegro mija, a login zostaje ten sam. */
            onError: () => { pytanyLogin.current = ""; },
          });
        }}
        /* PRZYJĘCIE PACZKI NIEODEBRANEJ. Numer z naklejki idzie
           tylko po skanie, który CHYBIŁ — to numer tego kartonu. Trafiony skan
           albo EAN towaru nie mają z tą paczką nic wspólnego, a fraza wpisana
           ręką numerem listu nie jest. Po sukcesie
           otwiera się nowy zwrot, bo następnym ruchem jest ocena pozycji.
           Odmowa „ma już zwrot" niesie jego numer i też go otwiera. */
        onPrzyjmij={(orderId) => {
          przyjmijNieodebrana.mutate(
            { orderId, waybill: wynikSkanu?.trafienie === null && kod
                && kod === kodZCzytnika.current ? kod : null },
            {
              onSuccess: (w) => { setWynikSkanu(null); nawiguj(`/obsluga/zwroty/${w.zwrotId}`); },
              onError: (e) => {
                const juz = e instanceof Konflikt ? Number(e.szczegoly.zwrotId) : NaN;
                if (Number.isInteger(juz) && juz > 0) nawiguj(`/obsluga/zwroty/${juz}`);
              },
            });
        }}
        przyjmuje={przyjmijNieodebrana.isPending
          ? przyjmijNieodebrana.variables?.orderId ?? null : null}
        bladPrzyjecia={przyjmijNieodebrana.error ? (przyjmijNieodebrana.error as Error).message : ""}
        pytaAllegro={zAllegro.isPending}
        bladAllegro={zAllegro.error ? (zAllegro.error as Error).message : ""}
        /* SYNCHRONIZACJA W RZĘDZIE POLA: osobne pasmo kosztowałoby całą
           wysokość wiersza na jeden przycisk. */
        synchronizuje={synchronizuj.isPending}
        bladSync={bladSync}
        onSynchronizuj={() => { setBladSync(""); synchronizuj.mutate(undefined,
          { onError: (e) => setBladSync((e as Error).message) }); }}
        /* Rejestracji paczki nie ma — biuro tylko wyszukuje ją w Allegro.
           Uzasadnienie stoi w `Szukanie`. */
      />

      {/* PYTANIE KUBEŁKA. Pasmo niesie jedno zdanie i milczy przy szukaniu
          oraz w zakładce WSZYSTKIE, gdzie pytania nie ma. */}
      {!pasujace && kubelek !== null &&
        <div className="flex shrink-0 flex-wrap items-center gap-1 border-b border-slate-200 bg-slate-50 px-2 py-1">
          <span className="mr-1 text-xs font-semibold text-slate-600">{opis?.pytanie}</span>
          {/* SITA W PAŚMIE PYTANIA, nie w rzędzie kubełków: dzielą
              jeden kubełek, więc stoją tam, gdzie widać, który. Kliknięcie
              przestawia kursor na pierwszy zwrot sita — powód przy `przelacz`. */}
          {kubelek === "decyzja" &&
            <FiltrSegmentowy<SitoDecyzji | null> wybrany={sito}
              onWybierz={(s) => {
                setSito(s);
                const pierwszy = (data?.zwroty ?? []).find((z) => z.kubelek === "decyzja"
                  && (s === null || sitoDecyzji(z) === s));
                nawiguj(pierwszy ? `/obsluga/zwroty/${pierwszy.id}` : "/obsluga/zwroty");
              }}
              pozycje={[
                /* Suma sit, nie licznik serwera: cztery liczby obok mają się
                   do niej dodawać co do sztuki. */
                { klucz: null, etykieta: "wszystkie",
                  ile: Object.values(ileWSicie).reduce((a, b) => a + b, 0) },
                ...SITA_DECYZJI.map((s) => ({ klucz: s.id, etykieta: s.etykieta,
                  ile: ileWSicie[s.id], podpowiedz: s.podpowiedz })),
              ]} />}
        </div>}
      {/* Aktywna grupa rozjazdów w miejscu pytania kubełka — lista
          mówi, dlaczego jest krótsza, i ma wyjście jednym kliknięciem. */}
      {filtrRozjazdu &&
        <div className="flex shrink-0 items-center gap-2 border-b border-amber-200 bg-amber-50 px-2 py-1">
          <span className="text-xs font-semibold text-amber-900">
            Tylko: {NAZWA_ROZJAZDU[filtrRozjazdu] ?? filtrRozjazdu} ({pasujace?.length ?? 0})</span>
          <button type="button" onClick={() => setFiltrRozjazdu(null)}
            className="ml-auto text-xs text-amber-900 underline">wyczyść</button>
        </div>}

      {/* Klawisze NA EKRANIE, wzorem reklamacji. Dekalog p. 2:
          rozpoznanie jest tańsze od pamiętania. Pasek pokazuje klawisze
          OGLĄDANEGO kubełka, bo tylko one coś tam robią — lista wszystkich
          uczyłaby przebiegać wzrokiem obok tego jednego, który jest do rzeczy.
          Sit „moje"/„niczyje" tu nie ma: zwrot nie nosi prowadzącego. */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {bezDanych
          ? <div className="p-3"><Blad>{(error as Error).message}</Blad></div>
          : isLoading
          ? <Pusto waga="lista">Wczytuję kolejkę…</Pusto>
          : <Kolejka zwroty={widoczne} wybrany={wybrany}
              zKubelkiem={Boolean(pasujace) || kubelek === null}
              onWybierz={(z) => nawiguj(`/obsluga/zwroty/${z}`)} />}
      </div>
    </Karta>

    <Karta className="flex min-h-0 flex-col overflow-hidden">
      {/* Bez kolejki nie ma czego wybrać, więc środek milczy. */}
      {!zwrot
        ? bezDanych ? null : <Pusto ikona={Undo2}>
            Wybierz zwrot z kolejki — strzałkami albo kliknięciem.</Pusto>
        : <>
            <Naglowek zwrot={zwrot} />
            {/* Droga klienta pod nagłówkiem: gdzie ten zakup jest i jakie inne
                sprawy już miał. Ten zwrot stoi na niej jako „tu jesteś”, nie
                jako łącze do siebie. Poza `Naglowek`, bo jego testy nie mają
                klienta zapytań, a pasek pyta serwer.
                „Zła paczka" stoi przy drodze, bo dotyczy tego samego zakupu:
                zły towar w zwrocie zakłada pomyłkę z tym zamówieniem. */}
            <div className="flex shrink-0 items-start gap-3 border-b border-slate-200 bg-wertis-paper px-4 py-3 empty:hidden">
              <DrogaKlienta plaska orderId={zwrot.orderId} biezaca={{ rodzaj: "zwrot", id: zwrot.id }} />
              <ZlaPaczka className="ml-auto shrink-0" login={zwrot.kupujacyLogin} zamowienie={zwrot.orderId}
                konto={zwrot.konto} />
            </div>
            {/* Oś etapów: gdzie jest sprawa i co jeszcze przed nią —
                zamiast zdań rozsianych po sekcjach. */}
            <Etapy kubelek={zwrot.kubelek} poKorekcie={Boolean(zwrot.korektaNumer)} />
            {/* Pasek stoi NAD produktami i nie przewija się razem z nimi:
                decyzja o całym zwrocie ma być pod ręką także wtedy, gdy
                operator zjechał na dziewiątą pozycję. */}
            <SzybkiZwrot zwrot={zwrot} stan={stanSzybkiej} trwa={szybka.trwa || trwa}
              blad={szybka.blad} onStart={szybkiZwrot} />
            <NieOdeslany zwrot={zwrot} trwa={nieOdeslany.trwa || trwa}
              blad={nieOdeslany.blad} onOdmow={odmowNieOdeslanemu} />
            <Decyzje zwrot={zwrot} trwa={trwa} blad={bladDecyzji} akcje={akcje}
              /* KURSOR SCHODZI PO TYCH DWÓCH DECYZJACH, i tylko po nich
                 (§25a.2). Odmowa i zapisany numer korekty WYPROWADZAJĄ zwrot
                 z drabiny — nie ma przy nim następnego pytania, więc trzymanie
                 go na ekranie kazałoby odklikać się z gotowej sprawy. Werdykt
                 „przyjmij" i ocena zostawiają zwrot w pracy: kolumna środkowa
                 pokazuje wtedy pytanie następnego kubełka i to jest cała
                 droga, której operator ma nie szukać. */
              onWerdykt={(decyzja, powod) =>
                werdykt.mutate({ id: zwrot.id, decyzja, powod, wersja: zwrot.wersja },
                  { onSuccess: () => { if (decyzja === "odrzucony") idz(1); } })}
              /* KOREKTA PRZESUWA KURSOR TYLKO WTEDY, GDY PIENIĄDZE SĄ
                 ZAŁATWIONE. Biuro wystawia korektę zwykle PRZED wypłatą, więc
                 przejście na następny zwrot uciekałoby dokładnie przed
                 pieniędzmi. Dwie drogi do wypłaty, dwie bramki: przez Allegro
                 (`moznaZwrocic`) i przelewem poza nim (`moznaZapisacPrzelew`,
                 przy pobraniu jedyna). Obie zamknięte znaczą, że przy tym
                 zwrocie nie ma już czego kliknąć — dopiero wtedy wolno zabrać
                 go z oczu. */
              onKorekta={(numer) =>
                korekta.mutate({ id: zwrot.id, numer, wersja: zwrot.wersja },
                  { onSuccess: () => { if (!pieniadzeCzekaja) idz(1); } })}
              onCofnijKorekte={() =>
                cofnijKorekte.mutate({ id: zwrot.id, wersja: zwrot.wersja })}
              onCofnijKwote={() =>
                cofnijKwote.mutate({ id: zwrot.id, wersja: zwrot.wersja })}
              onCofnijWerdykt={() =>
                cofnijWerdykt.mutate({ id: zwrot.id, wersja: zwrot.wersja })} />
            {/* `key` na zwrocie: otwarte okno i wpisany powód nie przechodzą
                na następny zwrot. */}
            <ZamkniecieReczne key={`zamkniecie-${zwrot.id}`} zwrot={zwrot}
              pieniadzeCzekaja={pieniadzeCzekaja}
              trwa={zamknijRecznie.isPending || otworzPonownie.isPending}
              blad={bladZamkniecia?.zwrotId === zwrot.id ? bladZamkniecia.tekst : ""}
              onZamknij={(powod, poSukcesie) => {
                setBladZamkniecia(null);
                const zwrotId = zwrot.id;
                zamknijRecznie.mutate({ id: zwrotId, wersja: zwrot.wersja, powod }, {
                  /* Jak po korekcie: zamknięty zwrot schodzi z kubełka, więc
                     kursor idzie na następny, a nie zostaje na pustym miejscu. */
                  onSuccess: () => { poSukcesie(); idz(1); },
                  onError: (e) => setBladZamkniecia({ zwrotId, tekst: (e as Error).message }),
                });
              }}
              onOtworz={() => {
                setBladZamkniecia(null);
                const zwrotId = zwrot.id;
                otworzPonownie.mutate({ id: zwrotId, wersja: zwrot.wersja },
                  { onError: (e) => setBladZamkniecia({ zwrotId, tekst: (e as Error).message }) });
              }} />
            {/* Pieniądze STOJĄ POD DECYZJAMI, nie w kolumnie dowodów: to jest
                ostatni krok tej pracy i ma być tam, gdzie operator właśnie
                patrzy, a nie o kolumnę dalej. */}
            {/* `key` na ZWROCIE, jak przy `Pozycje` niżej. Bez niego
                sekcja zostałaby zamontowana przy przejściu na zwrot z pamięci
                podręcznej, a z nią otwarty formularz odmowy z kodem i powodem
                poprzedniego zwrotu — gotowy do wysłania pod cudzym numerem. */}
            {szczegol.data?.pieniadze && <Pieniadze key={`pieniadze-${zwrot.id}`}
              stan={szczegol.data.pieniadze}
              przedWerdyktem={zwrot.kubelek === "decyzja"}
              kodAllegro={zwrot.rejectionCode}
              nazwyPozycji={Object.fromEntries(zwrot.pozycje.flatMap((p) =>
                p.rabat.lineItemId ? [[p.rabat.lineItemId, p.nazwa]] : []))}
              akcje={akcje}
              trwa={pieniadze.isPending || odmowaPlatnosci.isPending
                || przelew.isPending || cofnijPrzelew.isPending || sledzDosylke.isPending
                || sprawdzPlatnosci.isPending}
              sprawdzam={sprawdzPlatnosci.isPending && sprawdzPlatnosci.variables?.id === zwrot.id}
              wynikSprawdzenia={wynikSprawdzenia?.zwrotId === zwrot.id ? wynikSprawdzenia : null}
              onSprawdz={() => {
                setBladPieniedzy(null);
                setWynikSprawdzenia(null);
                const zwrotId = zwrot.id;
                sprawdzPlatnosci.mutate({ id: zwrotId }, {
                  onSuccess: (w) => setWynikSprawdzenia({ zwrotId, znaleziono: w.znaleziono,
                    wyplacone: w.wyplacone, powodBraku: w.powodBraku ?? null,
                    udane: (w.platnosci ?? []).filter((p) => p.status === "SUCCESS").length }),
                  onError: bladPieniedzyDla(zwrotId),
                });
              }}
              blad={bladPieniedzy?.zwrotId === zwrot.id ? bladPieniedzy.tekst : ""}
              wynikDosylki={wynikDosylki?.zwrotId === zwrot.id ? wynikDosylki.wynik : null}
              onZwroc={() => {
                setBladPieniedzy(null);
                setWynikDosylki(null);
                pieniadze.mutate({ id: zwrot.id, wersja: zwrot.wersja },
                  { onError: bladPieniedzyDla(zwrot.id) });
              }}
              onPrzelew={(referencja) => {
                setBladPieniedzy(null);
                setWynikDosylki(null);
                przelew.mutate({ id: zwrot.id, wersja: zwrot.wersja, referencja },
                  { onError: bladPieniedzyDla(zwrot.id) });
              }}
              onCofnijPrzelew={() => {
                setBladPieniedzy(null);
                setWynikDosylki(null);
                cofnijPrzelew.mutate({ id: zwrot.id, wersja: zwrot.wersja },
                  { onError: bladPieniedzyDla(zwrot.id) });
              }}
              onOdmow={(kod, powod) => {
                setBladPieniedzy(null);
                setWynikDosylki(null);
                const zwrotId = zwrot.id;
                odmowaPlatnosci.mutate({ id: zwrotId, kod, powod, wersja: zwrot.wersja }, {
                  onSuccess: (w) => { if (w.dosylka) setWynikDosylki({ zwrotId, wynik: w.dosylka }); },
                  onError: bladPieniedzyDla(zwrotId),
                });
              }}
              onSledzDosylke={() => {
                setBladPieniedzy(null);
                setWynikDosylki(null);
                const zwrotId = zwrot.id;
                sledzDosylke.mutate({ id: zwrotId }, {
                  onSuccess: (w) => setWynikDosylki({ zwrotId, wynik: w }),
                  /* Porażkę ta trasa mówi błędem 400 ze stałym zdaniem serwera.
                     Zdanie „Odmowa wysłana; …” byłoby tu nieprawdą, bo ta trasa
                     odmowy nie wysyła — więc przedrostek mówi tylko o śledzeniu. */
                  onError: bladPieniedzyDla(zwrotId, "Śledzenia dosyłki nie założono — "),
                });
              }} />}
            <div className="min-h-0 flex-1 overflow-y-auto">
              {/* `key` na ZWROCIE: przełączenie zwrotu w kolejce ma montować
                  listę od nowa. Bez tego zostawał w niej stan poprzedniego —
                  zaznaczenie pozycji i haczyk przy koszcie dostawy — a zapis
                  kwoty szedł z cudzymi identyfikatorami. */}
              {/* KLUCZ Z PRZEDROSTKIEM. `Wiadomosc` niżej też kluczy
                  się zwrotem, a dwa rodzeństwa z jednym kluczem React myli:
                  po skanie kolejnego zwrotu zostawałaby lista poprzedniego. */}
              <Pozycje key={`pozycje-${zwrot.id}`} zwrot={zwrot} trwa={trwa} blad={bladDecyzji}
                akcje={akcje} onWszystkieNaStan={() => void wszystkieNaStan().catch(() => {})}
                trwaRabat={rabat.isPending} bladRabatu={bladRabatu}
                onOcena={(pozycjaId, ocena, koszId) =>
                  ocena2.mutate({ pozycjaId, ocena, wersja: zwrot.wersja, koszId })}
                onKwota={(pozycjeIds, dostawa) =>
                  kwota.mutate({ id: zwrot.id, pozycjeIds, dostawa, wersja: zwrot.wersja })}
                onPotracenie={(pozycjaId, grosze, powod) =>
                  potracenie.mutate({ pozycjaId, grosze, powod, wersja: zwrot.wersja })}
                onIlosc={(pozycjaId, ile) =>
                  ilosc.mutate({ pozycjaId, ilosc: ile, wersja: zwrot.wersja })}
                onZglosRabat={(pozycjaId) => {
                  setBladRabatu("");
                  rabat.mutate({ pozycjaId },
                    { onError: (e) => setBladRabatu((e as Error).message) });
                }}
                doDopisania={szczegol.data?.doDopisania ?? []}
                sklady={szczegol.data?.sklady ?? {}}
                wierszeDokumentu={szczegol.data?.wierszeDokumentu ?? []}
                bladDopisania={bladDopisania}
                onDopisz={(zamPozycjaId) => {
                  setBladDopisania("");
                  dopisz.mutate({ id: zwrot.id, zamPozycjaId, wersja: zwrot.wersja },
                    { onError: (e) => setBladDopisania((e as Error).message) });
                }}
                onZdejmij={(pozycjaId) => {
                  setBladDopisania("");
                  zdejmij.mutate({ id: zwrot.id, pozycjaId, wersja: zwrot.wersja },
                    { onError: (e) => setBladDopisania((e as Error).message) });
                }} />
              {/* DOŁOŻENIE TOWARU DO KOSZYKA stoi POD pozycjami,
                  bo to ostatnia rzecz przy otwartym kartonie: najpierw oceniam
                  to, co klient zgłosił, potem dokładam to, czego w zgłoszeniu
                  nie ma. Pasek koszyka pokazuje się dopiero z zawartością, więc
                  pierwszej sztuki nie dałoby się tam zeskanować.

                  TYLKO PRZY ZWROCIE, KTÓRY JESZCZE ŻYJE. Skaner przy sprawie,
                  której nie ma jak zmienić, obiecuje ruch, po którym serwer
                  odmówi. */}
              {zwrot.kubelek !== "zamkniety" && zwrot.kubelek !== "odrzucony" &&
                <DolozTowar />}
              {/* Gotowa wiadomość do klienta — `key`, bo edytowana
                  treść jednego zwrotu nie ma prawa przejść na następny. */}
              <Wiadomosc key={`wiadomosc-${zwrot.id}`} zwrot={zwrot} />
            </div>
          </>}
    </Karta>

    {/* Cała ta kolumna jest do czytania, więc cała jedzie do scrollera —
        `Dowody` nie muszą o tym wiedzieć. */}
    <Karta className="flex min-h-0 flex-col overflow-hidden">
      <div className="min-h-0 flex-1 overflow-y-auto">
      {zwrot
        ? <Dowody zwrot={zwrot} os={szczegol.data?.os ?? []}
            kosze={szczegol.data?.kosze ?? []}
            trwaNotatka={notatka.isPending || cofnijNotatke.isPending}
            bladNotatki={bladNotatki}
            onNotatka={(tekst) => {
              setBladNotatki("");
              notatka.mutate({ id: zwrot.id, notatka: tekst.trim() || null, wersja: zwrot.wersja },
                { onError: (e) => setBladNotatki((e as Error).message) });
            }}
            onCofnijNotatke={() => {
              setBladNotatki("");
              cofnijNotatke.mutate({ id: zwrot.id, wersja: zwrot.wersja },
                { onError: (e) => setBladNotatki((e as Error).message) });
            }}
            kandydaciFaktury={szczegol.data?.kandydaciFaktury ?? []}
            fakturaTrwa={faktura.isPending} fakturaBlad={bladFaktury}
            onFaktura={(dokId) => {
              setBladFaktury("");
              faktura.mutate({ id: zwrot.id, dokId },
                { onError: (e) => setBladFaktury((e as Error).message) });
            }} />
        : <Pusto waga="lista">
            Dowody pokażą się po wybraniu zwrotu.</Pusto>}
      </div>
    </Karta>
    </div>
  </div>;
}
