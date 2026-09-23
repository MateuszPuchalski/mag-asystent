import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { RefreshCw, Undo2 } from "lucide-react";
import { useDociagnijPoSkanie, useSkanZwrotu, useSynchronizujZwroty, useZwroty, type WynikSkanu } from "../api/zwroty";
import type { BilansKartotek, Kubelek, Ocena, StanZwrotow, Zwrot } from "../api/typy";
import { Decyzje } from "../zwroty/Decyzje";
import { Pieniadze } from "../zwroty/Pieniadze";
import { Pozycje } from "../zwroty/Pozycje";
import { DolozTowar } from "../zwroty/DolozTowar";
import {
  useCofnijKorekte, useCofnijKwote, useCofnijWerdykt, useDopiszPozycje,
  useIloscZwrocona, useFaktura, useKorekta, useKwota,
  usePaczkiKlienta, useZamowieniaZAllegro, wygladaNaLogin, useOcena, usePotracenie, useWerdykt, useZdejmijPozycje,
  useZglosRabat, useZwrot, useZwrocPieniadze, useOdmowPlatnosci,
  useZapiszPrzelew, useCofnijPrzelew,
  useNotatkaZwrotu, useCofnijNotatkeZwrotu, useRozjazdyZwrotow,
} from "../api/zwroty";
import { Blad, FiltrSegmentowy, Karta, Pusto, SIATKA_TRZECH_KOLUMN } from "../ui";
import { PrzelacznikZwrotow } from "../zwroty/Przelacznik";
import { Naglowek } from "../zwroty/Naglowek";
import { KUBELKI, Kolejka } from "../zwroty/Kolejka";
import { Dowody } from "../zwroty/Dowody";
import { Szukanie } from "../zwroty/Szukanie";
import { PasekPorzadku, posortuj, usePorzadek } from "../sprawy/Porzadek";
import { Koszyk } from "../zwroty/Koszyk";
import { NaOutlet } from "../zwroty/NaOutlet";
import type { RozjazdZwrotu } from "../api/zwroty";
import { useSkaner } from "../skaner";
import { SkrotyKlawiszy } from "../sprawy/Skroty";
import type { AkcjeKlawiszy } from "../zwroty/klawisze";
import { pasujeDoFrazy, rozbij } from "../sprawy/szukanie";

/* ── Ekran zwrotów (0.150.0) ─────────────────────────────────────────────────
   Trzy kolumny, jak skrzynka — dwa ekrany obsługi mają mieć jeden nawyk,
   nie dwa.

   PIĘĆ KUBEŁKÓW MA DZIAŁANIE: werdykt, ocena i kwota od 0.156.0, korekta od
   0.162.0. Ekran nie wystawia korekty — robi to człowiek w Subiekcie — więc
   mówi to wprost przy polu numeru. Pieniądze oddaje od 0.190.0 przycisk ODDAJ
   PIENIĄDZE; zdanie „oddajesz w panelu Allegro" przetrwało przy korekcie do
   audytu z 15 września 2026 i odsyłało biuro do Sales Center.

   Klawiatura DZIAŁA JUŻ TERAZ w tej części, która niczego nie zapisuje:
   strzałki chodzą po kolejce, cyfry przełączają kubełek. Odruch buduje się
   od pierwszego wydania, a nie po dołożeniu zapisu.                        */

/**
 * Co robi klawisz w danym kubełku — jedna tabela dla paska i dla doktryny.
 *
 * Stoi TUTAJ, a nie przy `KUBELKI`: to jest wiedza EKRANU o jego własnym
 * nasłuchu, a `KUBELKI` opisują kolejkę, którą czyta także `Kolejka.tsx`.
 * Zmiana klawisza ma się rozjechać z paskiem najwyżej o jedną linijkę.
 */
const KLAWISZE_KUBELKA: Record<string, ReadonlyArray<readonly [string, string]>> = {
  decyzja: [["P", "przyjmij"], ["O", "odrzuć"]],
  ocena: [["S", "na stan"], ["U", "utylizacja"], ["O", "na outlet"],
    ["Shift+S", "wszystkie na stan"]],
  zwrot: [["Enter", "zapisz kwotę"]],
  korekta: [["Enter", "wpisz numer korekty"]],
  zamkniety: [["R", "cofnij korektę"]],
};

/* Krótkie etykiety do LICZNIKA. Pełne zdania pisze serwer i stoją przy
   pozycji (`Dowody`); tutaj muszą się zmieścić w jednym pasku, więc panel ma
   własne, skrócone. To jedyne miejsce, gdzie kod powodu zamienia się na tekst
   po naszej stronie — i dlatego nieznany kod pokazuje się SUROWY zamiast
   zniknąć. Licznik, który cicho gubi część liczb, jest gorszy od jego braku. */
const POWODY_SKROT: Record<string, string> = {
  /* DWA RÓŻNE CZEKANIA (0.220.0). „Czeka na automat" znaczy, że sygnatura
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
 * Rozjazdy rekoncyliacji, które dotyczą zwrotów (0.313.0).
 *
 * Cztery kontrole — termin ustawowy, zwrot bez śladu po przelewie, koszyk
 * czekający na korektę i kosz bez powrotu z regału — liczyły się od dawna
 * i rysowały WYŁĄCZNIE w `/biuro`. Obsługa klienta pracuje na innym ekranie,
 * więc raport chroniący jej pracę wisiał tam, gdzie ona nie zagląda.
 *
 * MILCZY PRZY ZERZE. Pas szarości z napisem „wszystko w porządku" uczy
 * przewijać wzrokiem to miejsce — a wtedy nie zauważa się go w dniu, w którym
 * naprawdę coś mówi. Ta sama zasada co w `services/reconcile.ts`: zerowy wynik
 * to zero raportu.
 */
/** Nazwa rodzaju po ludzku — w zdaniu zbiorczym, nie w wierszu. */
const NAZWA_ROZJAZDU: Record<string, string> = {
  zwrot_po_terminie: "po terminie ustawowym",
  zwrot_bez_przelewu: "bez śladu po przelewie",
  kosz_czeka_na_korekte: "koszyk czeka na korektę",
  kosz_bez_powrotu: "kosz bez powrotu z regału",
};

function PasekRozjazdow({ rozjazdy }: { rozjazdy: RozjazdZwrotu[] }) {
  /* ZWINIĘTY DOMYŚLNIE — i to jest NAPRAWA, nie upodobanie (0.319.0).
     Pierwsza wersja rysowała każdy wiersz z osobna. Na żywej bazie wyszło ich
     czterysta trzydzieści trzy, więc pasek zjadł cały ekran: kolejki i kolumn
     nie było widać wcale, a ekran zwrotów przestał być ekranem pracy.

     Czterysta wierszy to nie informacja, tylko szum. Dekalog p. 2: pokazuj to,
     co rozstrzyga bieżącą czynność — a tu rozstrzyga LICZBA i RODZAJ, nie
     czterysta razy to samo zdanie. Klucze zostają o jedno kliknięcie dalej. */
  const [rozwiniete, setRozwiniete] = useState(false);
  if (!rozjazdy.length) return null;

  const wgRodzaju = new Map<string, number>();
  for (const r of rozjazdy) wgRodzaju.set(r.rodzaj, (wgRodzaju.get(r.rodzaj) ?? 0) + 1);

  return <section aria-label="Rozjazdy zwrotów"
    className="shrink-0 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2">
    <button type="button" onClick={() => setRozwiniete((r) => !r)}
      className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 text-left">
      <span className="text-xs font-bold uppercase text-amber-900">
        Do sprawdzenia ({rozjazdy.length})
      </span>
      {[...wgRodzaju].map(([rodzaj, ile]) => <span key={rodzaj} className="text-sm text-amber-900">
        <b className="font-semibold tabular-nums">{ile}</b>{" "}
        {NAZWA_ROZJAZDU[rodzaj] ?? rodzaj}
      </span>)}
      <span className="ml-auto text-xs underline text-amber-900">
        {rozwiniete ? "zwiń" : "pokaż numery"}
      </span>
    </button>
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
 * Ile zwrotów NIE WESZŁO do tej kolejki (0.209.0).
 *
 * Synchronizacja chodzi z bezpiecznikiem dziesięciu stron i do tego wydania
 * urywała się na nim CICHO: przebieg kończył się sukcesem, kursor szedł
 * naprzód, a reszta nie wracała już nigdy. Kolejka ustawia się według terminu
 * ustawowego, więc brakujące wiersze były w większości tymi najbardziej
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
 * Kartoteki i rozjazdy ZWINIĘTE W JEDEN WIERSZ (15 września 2026).
 *
 * Zgłoszenie właściciela: „schowaj to gdzieś". Dwa bursztynowe pasy zajmowały
 * nad kolejką tyle, co trzy zwroty, a w codziennej pracy mówiły to samo co
 * wczoraj — dekalog p. 2: na ekranie to, co rozstrzyga bieżącą czynność.
 * Liczby zostają widoczne, zdania są o jedno kliknięcie dalej.
 *
 * SAMO SIĘ OTWIERA, gdy stoi synchronizacja przy pozycjach czekających na
 * automat. To jedyne zdanie tych pasów, które wymaga działania dziś, a nie
 * kiedyś — schowane kazałoby zatwierdzać ręką to, co naprawia jedna rzecz.
 * Czerwony pasek niekompletnej kolejki stoi osobno i nie chowa się nigdy.
 */
function PasekUwag({ bilans, stan, rozjazdy }: {
  bilans?: BilansKartotek; stan?: StanZwrotow; rozjazdy: RozjazdZwrotu[];
}) {
  const [rozwiniete, setRozwiniete] = useState(false);
  const bez = bilans?.bez ?? 0;
  if (!bez && !rozjazdy.length) return null;
  const alarm = Boolean(stan && stan.status !== "current" && (bilans?.powody.do_zwiazania ?? 0) > 0);
  const otwarte = rozwiniete || alarm;
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
      <PasekRozjazdow rozjazdy={rozjazdy} />
    </>}
  </section>;
}

/**
 * Kody, po których człowiek szuka zwrotu — wszystkie, jakie zwrot niesie.
 *
 * Numer zwrotu bywa doklejony na paczce, identyfikator z Allegro wpada
 * z odnośnika, numer zamówienia z rozmowy z klientem, numer korekty z Subiekta.
 *
 * NUMER LISTU DOSZEDŁ W 0.344.0 i to jest zdjęcie polityki 0.163.0, nie
 * przeoczenie naprawione po latach. Do 0.343.0 numer żył wyłącznie w kopii
 * odpowiedzi Allegro, więc filtr go nie widział, a szukanie po naklejce
 * wymagało Entera i pytania serwera. Decyzja właściciela: „zapisuj numery
 * paczek". Enter dalej pyta serwer — tamta droga zna też numery paczek,
 * których w modelu pracy nie ma, bo zwrot bywa u nas szybciej niż w Allegro.
 *
 * LOGIN KUPUJĄCEGO doszedł w 0.337.0 na zgłoszenie właściciela. Odpowiada na
 * inne pytanie niż numery: nie „gdzie jest TA paczka", tylko „co jeszcze mam
 * od TEGO klienta" — a to pytanie pada przy każdej rozmowie, w której klient
 * mówi o dwóch przesyłkach naraz. Jedyny uchwyt, jaki wtedy jest pod ręką.
 *
 * NAZWA ODBIORCY I PRZEWOŹNIK DOSZLI W 0.367.0 i to jest odpowiedź na pytanie,
 * którego wcześniej nie zadano dość dokładnie. Właściciel: paczki nakleja
 * klient albo kurier, więc numeru listu z WRACAJĄCEGO kartonu nasz system nie
 * widział nigdy — pierwszy skan takiej paczki musi chybić z definicji. Zostaje
 * to, co na naklejce widać: kto na niej stoi i czyim samochodem przyjechała.
 *
 * Przewoźnik ma też własną listę rozwijaną i to NIE jest dublowanie: lista
 * odpowiada na „pokaż wszystko od InPostu", a człon frazy zawęża trafienia po
 * kimś innym. Aliasy niżej biorą się stąd, że na naklejce stoi „Paczkomat",
 * a w danych `INPOST`.
 */
const kody = (z: Zwrot) =>
  /* NOTATKA WCHODZI DO SZUKANIA (0.394.0). Zgłoszenie właściciela: gdy paczka
     nie dotarła, zgłaszamy to Allegro i dostajemy NUMER SPRAWY, który nie ma
     w naszych danych żadnego własnego pola — ląduje w notatce biura. Pole
     szukało po treści sprawy i po loginie, więc po tym numerze nie znajdowało
     NICZEGO, choć stał on na ekranie obok. Notatka jest zresztą jedynym
     miejscem, gdzie biuro pisze WŁASNYMI słowami; wykluczenie jej z szukania
     znaczyło, że im lepiej ktoś opisał sprawę, tym trudniej ją znaleźć. */
  [z.numer, z.externalId, z.orderId, z.korektaNumer, z.kupujacyLogin, z.waybill,
    z.odbiorcaNazwa, z.przewoznik, z.notatka, ...aliasy(z.przewoznik)]
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
 * paczki — login mówi, CZYJA to paczka, a nie KTÓRA (decyzja 0.365.0), nazwa
 * odbiorcy tak samo, a przewoźnik opisuje setki naraz.
 *
 * Do 0.366.0 jedna lista robiła oba zadania i przy loginie to jeszcze uchodziło.
 * Przy przewoźniku przestało od razu: wpisanie „dpd" przy jednym zwrocie tej
 * firmy OTWIERAŁO go, jakby ktoś podał numer. Otwarcie stawia na ekranie cudze
 * pieniądze, więc lista do otwierania musi być węższa niż lista do szukania.
 */
const identyfikatory = (z: Zwrot) =>
  [z.numer, z.externalId, z.orderId, z.korektaNumer, z.waybill]
    .filter((k): k is string => Boolean(k)).map((k) => k.toLowerCase());

export function Zwroty() {
  const { id } = useParams();
  const nawiguj = useNavigate();
  const [kubelek, setKubelek] = useState<Kubelek | null>("decyzja");
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
  const potracenie = usePotracenie();
  const faktura = useFaktura();
  const dopisz = useDopiszPozycje();
  const zdejmij = useZdejmijPozycje();
  const [bladDopisania, setBladDopisania] = useState("");
  const [bladRabatu, setBladRabatu] = useState("");
  const [bladPieniedzy, setBladPieniedzy] = useState("");
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

  /* WSZYSTKIE to siódma zakładka, nie siódmy kubełek (0.169.0). Kubełki dalej
     są silnikiem pracy — każdy niesie jedno pytanie — a ta zakładka jest do
     SZUKANIA: „gdzie stoi ten zwrot", nie „co mam zrobić". Rejestr skasowany
     w 0.140.0 mieszał te dwie rzeczy i to go pogrążyło. */
  const [bladSync, setBladSync] = useState("");

  /* TOŻSAMOŚCI TEN EKRAN JUŻ NIE POTRZEBUJE (0.370.0). Czytał ją po to, żeby
     odróżnić „moje" od „niczyjego" — a sito zeszło. `zMoje={false}` w pasku
     klawiszy mówi to wprost: klawisze `m` i `n` nie istnieją. */

  /* ── CO ZESZŁO Z TEJ KOLUMNY W 0.370.0 ──────────────────────────────────
     Zgłoszenie właściciela: „uprość panel zwrotów do wymaganego minimum",
     a po pytaniu o szczegóły wskazanie wprost: sito Moje/Niczyje, tagi spraw,
     filtry przewoźnika i dat, Pobierz CSV — i „usunąć zupełnie".

     SITO WRACA DO PIERWSZEJ DECYZJI, nie do nowej. 0.315.0 ustaliło najpierw,
     że przy zwrocie prowadzącego NIE MA, bo zwroty prowadzi całe biuro i sito
     „nie odpowiadałoby na żadne prawdziwe pytanie" — a tego samego dnia
     przywróciło go z powrotem. To jest powrót do tamtego zdania i dlatego
     stoi tu zapisane: bez niego następna sesja „naprawi" to trzeci raz.

     FILTRY ZESZŁY, BO SZUKANIE JE WCHŁONĘŁO. Od 0.367.0 fraza dzieli się po
     spacjach i zna przewoźnika razem z nazwami z naklejki, więc lista
     rozwijana odpowiadała na pytanie, na które odpowiada już pole wyżej.

     Sito i tagi ZOSTAJĄ przy reklamacjach i dyskusjach — `sprawy/Moje.tsx`
     i `sprawy/Tagi.tsx` stoją nietknięte. Zeszło UŻYCIE, nie komponent. */
  const wKubelku = useMemo(() => kubelek === null
    ? (data?.zwroty ?? [])
    : (data?.zwroty ?? []).filter((z) => z.kubelek === kubelek),
  [data, kubelek]);

  const skan = useSkanZwrotu();
  const dociagnij = useDociagnijPoSkanie();
  const synchronizuj = useSynchronizujZwroty();
  const przelew = useZapiszPrzelew();
  const cofnijPrzelew = useCofnijPrzelew();
  const notatka = useNotatkaZwrotu();
  const cofnijNotatke = useCofnijNotatkeZwrotu();
  const [bladNotatki, setBladNotatki] = useState("");
  const rozjazdy = useRozjazdyZwrotow();
  const [kod, setKod] = useState("");
  const [fraza, setFraza] = useState("");
  /* Login, o którego PACZKI pytamy (0.365.0) — osobno od tego, co operator
     wpisuje, bo pytanie idzie po Enterze i po wyjściu z pola, a nie po każdym
     znaku. Pusty nie pyta wcale. */
  const [loginPaczek, setLoginPaczek] = useState("");
  const paczkiKlienta = usePaczkiKlienta(loginPaczek);
  /* Uchwyt, o który Allegro JUŻ zapytaliśmy (0.450.0). Enter i wyjście
     z pola wołają `onLogin` oba, a drugi strzał do Allegro o ten sam login
     niczego by nie dodał — kosztowałby tylko żądanie. */
  const zAllegro = useZamowieniaZAllegro();
  const pytanyLogin = useRef("");
  const [wynikSkanu, setWynikSkanu] = useState<WynikSkanu | null>(null);
  const [bladSkanu, setBladSkanu] = useState("");

  /* Filtr liczy się TUTAJ, w pamięci ekranu — tą samą drogą co filtr kubełka
     i z tego samego powodu: lista przyjeżdża w całości, bo zwrotów w pracy są
     dziesiątki, nie tysiące. Szukanie po fragmencie na serwerze musiałoby albo
     rozluźnić `znajdzZwrotPoKodzie` (a ono ma być DOKŁADNE, bo samo otwiera
     zwrot), albo dołożyć trasę z dziennikiem — czyli zapisać, czego ktoś
     szukał. Numer listu ten filtr WIDZI od 0.344.0 — zdanie mówiące inaczej
     stało tu przez pięć wydań po tym, jak przestało być prawdą. Enter zostaje,
     bo `POST /skan` zna też numery paczek, których w modelu pracy nie ma.

     Od 0.367.0 fraza dzieli się po spacjach (`pasujeDoFrazy`): człowiek
     z kartonem w ręku ma kilka drobnych uchwytów naraz, a żaden sam nie
     zawęża. */
  const { porzadek, ustaw: ustawPorzadek } = usePorzadek(
    "wertis.zwroty.porzadek", ["termin", "otwarto", "kwota"], "termin");

  const pasujace = useMemo(() => {
    if (!rozbij(fraza).length) return null;
    return (data?.zwroty ?? []).filter((z) => pasujeDoFrazy(kody(z), fraza));
  }, [data, fraza]);

  /* Szukanie PRZEBIJA kubełek. Bez tego operator wpisuje numer, widzi „ten
     kubełek jest pusty" i nie ma jak się dowiedzieć, że zwrot stoi w
     ZAMKNIĘTYCH. Kod jest mocniejszy niż zakładka, na którą ktoś przed chwilą
     kliknął — tak samo jak adres w pasku przeglądarki. */
  /* ── PORZĄDEK WRACA, ALE INACZEJ (0.401.0) ────────────────────────────────
     Do 0.370.0 stał tu przełącznik „od daty nadania" i ZSZEDŁ ŚWIADOMIE razem
     z pasmem filtrów: odpowiadał na inne pytanie („co przyszło najdawniej")
     niż to, które prowadzi tę pracę („co się najbardziej pali").

     Wraca na wyraźne zgłoszenie właściciela — „dodaj sortowanie po dacie etc"
     — i z jedną różnicą, która tamten powód szanuje: DOMYŚLNY ZOSTAJE TERMIN.
     Zegar ustawowy dalej rządzi listą, dopóki agent sam nie powie inaczej,
     więc wydanie niczego nie przestawia pod ręką. Kolejność liczona po
     terminie to blizna 0.121.0 i ona zostaje nietknięta.

     TRZY OSIE, nie cztery: zwrot nie ma „ostatniego ruchu" — nie prowadzi
     rozmowy, więc nie ma czego pytać. Kwotą jest suma pozycji, bo ona stoi
     przy KAŻDYM zwrocie; `kwotaGrosze` bywa pusta do czasu decyzji, a dwie
     różne kwoty pod jedną etykietą to dokładnie blizna 0.121.0 w innym
     miejscu. */
  const widoczne = useMemo(
    () => posortuj(pasujace ?? wKubelku, porzadek, {
      otwarto: (z) => z.utworzono,
      termin: (z) => z.terminAt,
      kwota: (z) => z.sumaPozycjiGrosze,
    }),
    [pasujace, wKubelku, porzadek]);

  /* Trafienie otwiera zwrot od razu — po to jest ten skan. Adres jest tu
     źródłem prawdy i sam dociąga kubełek, więc zwrot otwiera się także wtedy,
     gdy stoi w innym kubełku niż oglądany. */
  const przyjmij = (w: WynikSkanu) => {
    setWynikSkanu(w);
    setBladSkanu("");
    if (!w.zwrotId) return;
    /* TRAFIENIE ZDEJMUJE KURSOR Z POLA (audyt zwrotów, 15 września 2026).
       Czytnik pisze w pole, gdy ono ma kursor, a skróty w polu milkną. Po
       otwarciu zwrotu następnym ruchem jest `P` albo `S`, nie dopisanie znaku —
       na nagraniu z biura zwrot przyjmowało przez to kliknięcie. */
    (document.activeElement as HTMLElement | null)?.blur();
    nawiguj(`/obsluga/zwroty/${w.zwrotId}`);
  };
  const szukaj = (v: string) => {
    setKod(v);
    setFraza(v);
    skan.mutate(v, { onSuccess: przyjmij, onError: (e) => setBladSkanu((e as Error).message) });
  };

  const wybrany = id ? Number(id) : null;
  const zwrot = data?.zwroty.find((z) => z.id === wybrany) ?? null;
  /* Kandydatów na dokument sprzedaży niesie DOPIERO szczegół zwrotu, nie
     kolejka: liczą się z okna sześćdziesięciu dni sprzedaży, a kolejka ma
     dziesiątki wierszy. Jeden otwarty zwrot to jedno takie liczenie. */
  const szczegol = useZwrot(wybrany);

  /* Wejście z paska adresu na zwrot z innego kubełka ma pokazać ten zwrot,
     a nie pustą listę. Adres jest tu źródłem prawdy, kubełek za nim idzie. */
  useEffect(() => {
    if (zwrot && kubelek !== null && zwrot.kubelek !== kubelek) setKubelek(zwrot.kubelek);
  }, [zwrot?.id]);

  /**
   * CAŁY kod otwiera zwrot, fragment tylko zawęża listę.
   *
   * Ekran sam otwiera przy jednym wyniku, więc dopasowanie przybliżone
   * prowadziłoby do CUDZEJ sprawy — a przy zwrocie znaczy to cudzego klienta
   * i cudze pieniądze. Ta sama zasada stoi przy skanie od 0.163.0.
   *
   * Otwarcie w pół pisania nie jest wpadką: otwarty zwrot niczego nie mutuje
   * (zero zapisu przy patrzeniu), pole zostaje z tekstem, a dopisanie znaku
   * przenosi ekran dalej. Dwa zwroty o tym samym kodzie — na przykład dwa
   * zwroty z jednego zamówienia — nie otwierają żadnego; wybiera człowiek.
   */
  useEffect(() => {
    const czlony = rozbij(fraza);
    /* JEDEN CZŁON I DOKŁADNIE (0.367.0). Fraza wieloczłonowa zawęża listę,
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
    /* Kliknięcie w kubełek jest prośbą o TEN kubełek, więc zdejmuje filtr.
       Inaczej przełącznik wyglądałby na zepsuty: lista zostawałaby ta sama. */
    setFraza("");
    setWynikSkanu(null);
    const pierwszy = (data?.zwroty ?? []).find((z) => k === null || z.kubelek === k);
    nawiguj(pierwszy ? `/obsluga/zwroty/${pierwszy.id}` : "/obsluga/zwroty");
  };

  /* MIEJSCE W LIŚCIE PRZEŻYWA WYJŚCIE ZWROTU Z KUBEŁKA (audyt, 15 września 2026).
     Po `P` przyjęty zwrot znika z listy DO DECYZJI, a kursor zostaje na nim.
     `idz` liczyło wtedy od pozycji zero plus jeden, więc `j` przeskakiwało
     zwrot, który właśnie wskoczył na zwolnione miejsce — praca kubełkiem
     gubiła co drugi zwrot. Zapamiętujemy więc ostatnią pozycję widzianą. */
  const ostatnieMiejsce = useRef(0);
  const miejsce = widoczne.findIndex((z) => z.id === wybrany);
  if (miejsce >= 0) ostatnieMiejsce.current = miejsce;

  /* Kursor chodzi po liście WIDOCZNEJ, nie po kubełku: przy włączonym filtrze
     `j` ma iść do następnego wyniku, a nie do zwrotu schowanego przed oczami. */
  const idz = (o: number) => {
    if (!widoczne.length) return;
    const i = widoczne.findIndex((z) => z.id === wybrany);
    /* Zwrotu nie ma już na liście: następny STOI na jego miejscu, poprzedni
       o jedno wyżej. */
    const cel = i >= 0 ? i + o : (o > 0 ? ostatnieMiejsce.current : ostatnieMiejsce.current - 1);
    const nast = widoczne[Math.min(widoczne.length - 1, Math.max(0, cel))];
    if (nast) nawiguj(`/obsluga/zwroty/${nast.id}`);
  };

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
    for (const p of zwrot.pozycje.filter((x) => !x.ocena)) {
      const w = await ocena2.mutateAsync({ pozycjaId: p.id, ocena: "stan", wersja });
      wersja = w.wersja;
    }
  };

  /**
   * Klawisze KUBEŁKA — tabela §25a.2 wreszcie z nasłuchem (0.284.0).
   *
   * Do 0.283.0 ekran rysował te litery przy przyciskach jako `<kbd>`, a żadna
   * z nich nic nie robiła. Doktryna obiecywała przy tym, że „typowy zwrot to
   * jeden klawisz" (§25a.3) — więc obietnicę składał i ekran, i dokument,
   * a dotrzymywała jej wyłącznie mysz.
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
    if (zwrot.kubelek === "decyzja") {
      if (e.key === "p" || e.key === "P") {
        e.preventDefault();
        werdykt.mutate({ id: zwrot.id, decyzja: "przyjety", powod: null, wersja });
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
      ocena2.mutate({ pozycjaId: pozycja.id, ocena, wersja });
      return;
    }
    if (zwrot.kubelek === "zwrot" && e.key === "Enter") {
      e.preventDefault();
      akcje.current.zapiszKwote?.();
      return;
    }
    if (zwrot.kubelek === "korekta" && e.key === "Enter") {
      /* Numer korekty wpisuje człowiek, więc ten Enter niczego nie zapisuje —
         stawia kursor w polu. Drugi Enter, już w polu, zapisuje numer. Do
         audytu z 15 września 2026 pasek obiecywał tu Enter, a klawisz milczał. */
      e.preventDefault();
      akcje.current.korekta?.();
      return;
    }
    /* `R` stoi przy numerze korekty, czyli na zwrocie ZAMKNIĘTYM — tam, gdzie
       ekran rysuje ten klawisz od 0.162.0 (`Decyzje.tsx`). */
    if (zwrot.korektaNumer && (e.key === "r" || e.key === "R")) {
      e.preventDefault();
      cofnijKorekte.mutate({ id: zwrot.id, wersja });
    }
  };

  /* Skróty idą TĄ SAMĄ drogą co czytnik (0.163.0). Dwa niezależne nasłuchy
     nie umiałyby się dogadać, który klawisz jest czyj — a numer listu
     `600000367616070023174201` zawiera wszystkie cyfry kubełków. */
  useSkaner(
    (kod) => szukaj(kod),
    (e) => {
      if (e.key === "ArrowDown" || e.key === "j") { e.preventDefault(); idz(1); }
      else if (e.key === "ArrowUp" || e.key === "k") { e.preventDefault(); idz(-1); }
      else if (/^[1-6]$/.test(e.key)) przelacz(KUBELKI[Number(e.key) - 1].id);
      else if (e.key === "7") przelacz(null);
      /* Klawisze `m` i `n` zeszły razem z sitem (0.370.0). Martwy klawisz
         w nasłuchu jest gorszy niż jego brak: milczy i uczy, że nie działa. */
      else klawiszKubelka(e);
    },
  );

  if (error) return <Blad>{(error as Error).message}</Blad>;

  const opis = KUBELKI.find((k) => k.id === kubelek);

  /* Czy przy tym zwrocie zostało coś do zrobienia z pieniędzmi.
     Czytane z RENDERU, nie z `onSuccess`: korekta nie rusza żadnej z tych
     dwóch bramek (`zwrot-pieniedzy.ts`), więc wartość sprzed zapisu jest ta
     sama co po nim — a nie ściga się z odświeżeniem zapytania. */
  const stanPieniedzy = szczegol.data?.pieniadze;
  const pieniadzeCzekaja =
    Boolean(stanPieniedzy?.moznaZwrocic || stanPieniedzy?.moznaZapisacPrzelew);

  /* Ekran trzyma się okna, a przewijają się KOLUMNY (0.165.0). Pion strony był
     tu drogą do zgubienia kolejki: żeby dojść do dołu dowodów, operator
     zjeżdżał z oczu liście, po której chodzi klawiszami.

     Pasek kartotek stoi POZA gridem, w zewnętrznej kolumnie. Jako warunkowy
     wiersz `auto` byłby pułapką: bez paska pierwsza karta wpadałaby w ten
     wiersz i cała blokada znikała. Kolumna flexa nie ma tego problemu — nie
     ma dziecka, nie ma wiersza, nie ma odstępu.

     `lg:grid-rows-[minmax(0,1fr)]` nie jest ozdobą: pojedynczy wiersz `auto`
     mierzy się do `max-content`, więc przy treści wyższej niż okno grid
     wylewałby się poza kontener zamiast przyciąć ścieżkę. */
  return <div className="flex flex-col gap-4 lg:h-full lg:min-h-0">
    {/* Zwroty i kosze pod jedną zakładką (0.438.0) — powód w `Przelacznik.tsx`. */}
    <PrzelacznikZwrotow teraz="zwroty" />
    {data?.stan && <PasekOgona stan={data.stan} />}
    <PasekUwag bilans={data?.kartoteki} stan={data?.stan} rozjazdy={rozjazdy.data?.rozjazdy ?? []} />
    <Koszyk />
    {/* Obok koszyka, bo to ta sama praca: co wyjęte z pudła, gdzie idzie.
        Outlet nie ma pudła ani dokumentu — ma listę i czyjeś ręce. */}
    <NaOutlet />
    <div className={SIATKA_TRZECH_KOLUMN}>
    <Karta className="flex min-h-0 flex-col overflow-hidden">
      {/* `shrink-0` na blokach nad listą nie jest kosmetyką: lista ma bazę 0,
          więc przy ciasnym oknie kurczyłyby się WYŁĄCZNIE one. */}
      <nav className="flex shrink-0 flex-wrap gap-1 border-b border-slate-200 p-2">
        {/* ── JEDEN KSZTAŁT WYBORU (0.262.0) ─────────────────────────────────
            Ten rząd stał w trzech ekranach przepisany znak w znak, w bursztynie,
            bez tła pigułki niewybranej i bez `aria-pressed`. Kształt jest teraz
            jeden dla całego panelu — powód stoi przy `FiltrSegmentowy`.

            „Wszystkie" WCHODZI DO TABLICY, zamiast wisieć osobnym przyciskiem
            pod pętlą: to jest ten sam wybór, co każdy kubełek, tylko bez
            zawężenia. Numer klawisza liczy się z długości listy, więc dopisanie
            kubełka nie zostawia w podpowiedzi nieaktualnej cyfry. */}
        {/* Kolejność i pomoc w RZĘDZIE KUBEŁKÓW (0.402.0). Tu, inaczej niż
            w reklamacjach, nie ma osobnego wiersza narzędzi: szukanie zwrotów
            to skaner z własnym rzędem (`zwroty/Szukanie.tsx`), więc dokładanie
            mu sąsiadów zrobiłoby z niego to, czym nie jest. */}
        <PasekPorzadku porzadek={porzadek} dozwolone={["termin", "otwarto", "kwota"]}
          onZmien={ustawPorzadek} />
        <FiltrSegmentowy<Kubelek | null> wybrany={kubelek} onWybierz={przelacz}
          pozycje={[
            ...KUBELKI.map((k, i) => ({ klucz: k.id, etykieta: k.etykieta,
              ile: data?.liczniki?.[k.id] ?? 0,
              podpowiedz: `${k.pytanie} (klawisz ${i + 1})` })),
            { klucz: null, etykieta: "Wszystkie", ile: data?.zwroty?.length ?? 0,
              podpowiedz: `Wszystkie zwroty (klawisz ${KUBELKI.length + 1})` },
          ]} />
      <SkrotyKlawiszy zMoje={false} kubelkow={KUBELKI.length}
          /* Klawisze OTWARTEGO zwrotu, gdy jest (audyt, 15 września 2026). Po `P`
             zwrot stoi już w DO OCENY, a lista dalej w DO DECYZJI — pasek kubełka
             pokazywał wtedy P/O, choć działały S/U. */
          /* `Z` DOPISUJE SIĘ ZE STANU, nie z tabeli kubełków: należność
             przechodzi przez trzy kubełki i gaśnie w środku każdego z nich.
             Wpisany do `KLAWISZE_KUBELKA` stałby w pasku także po wypłacie —
             czyli byłby dokładnie tym martwym klawiszem, przeciw któremu
             powstał `SkrotyKlawiszy`. */
          dodatkowe={[
            ...KLAWISZE_KUBELKA[zwrot?.kubelek ?? kubelek ?? "wszystkie"] ?? [],
            ...(stanPieniedzy?.moznaZwrocic
              ? [["Z", "oddaj pieniądze"] as const] : []),
          ]} />
      </nav>

      <Szukanie
        wynik={wynikSkanu} kod={kod} fraza={fraza} ile={pasujace?.length ?? null}
        szuka={skan.isPending} dociaga={dociagnij.isPending} blad={bladSkanu}
        onFraza={(v) => { setFraza(v); if (!v) setWynikSkanu(null); }}
        onSzukaj={szukaj}
        onDociagnij={(v) => dociagnij.mutate(v, {
          onSuccess: przyjmij, onError: (e) => setBladSkanu((e as Error).message) })}
        onWybierz={(x) => { setWynikSkanu(null); nawiguj(`/obsluga/zwroty/${x}`); }}
        paczki={loginPaczek ? paczkiKlienta.data?.paczki ?? null : null}
        szukaPaczek={paczkiKlienta.isFetching}
        /* LOGIN IDZIE TEŻ DO ALLEGRO (0.450.0). Lista wyżej czyta naszą
           bazę, a ta nie zna zamówienia paczki nieodebranej — nic do niego nie
           prowadzi. Bez tego biuro szukało takiej paczki na stronie Allegro.
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
        pytaAllegro={zAllegro.isPending}
        bladAllegro={zAllegro.error ? (zAllegro.error as Error).message : ""}
        /* SYNCHRONIZACJA WCHODZI DO RZĘDU POLA (0.370.0). Stała we własnym
           paśmie razem z filtrami; po ich zdjęciu zostałaby sama i kosztowała
           całe pasmo na jeden przycisk. Ta sama droga, którą w audycie
           15 września przeszedł przycisk NIEODEBRANA. */
        synchronizuje={synchronizuj.isPending}
        bladSync={bladSync}
        onSynchronizuj={() => { setBladSync(""); synchronizuj.mutate(undefined,
          { onError: (e) => setBladSync((e as Error).message) }); }}
        /* REJESTRACJI PACZKI NIE MA od 0.451.0 — decyzja właściciela,
           „ja tylko wyszukuję ją w Allegro". Uzasadnienie stoi w `Szukanie`. */
      />

      {/* ── PYTANIE KUBEŁKA I SITO W JEDNYM PAŚMIE (audyt, 15 września 2026) ──
          Stały w dwóch, po 33 i 37 px, i mówiły o TEJ SAMEJ liście: kubełek
          „na jakim to etapie", sito „czyje to", tag „o czym to" (0.315.0).
          Trzy pytania o jedną rzecz mieszczą się w jednym rzędzie, a kolejka
          odzyskuje wiersz.

          Oba warunki zostają osobne, bo każdy milczy z innego powodu: pytanie
          przy włączonym filtrze mówiłoby nieprawdę o tym, co widać, a sita nie
          ma bez tożsamości. Pasmo znika dopiero, gdy milczą oba. */}
      {/* PYTANIE KUBEŁKA, samo (0.370.0). Stało tu z sitem i filtrem tagów;
          po ich zdjęciu pasmo niesie jedno zdanie i milczy przy szukaniu
          oraz w zakładce WSZYSTKIE, gdzie pytania nie ma. */}
      {!pasujace && kubelek !== null &&
        <div className="shrink-0 border-b border-slate-200 bg-slate-50 px-2 py-1">
          <span className="text-xs font-semibold text-slate-600">{opis?.pytanie}</span>
        </div>}

      {/* Klawisze NA EKRANIE, wzorem reklamacji (0.281.0). Dekalog p. 2:
          rozpoznanie jest tańsze od pamiętania. Pasek pokazuje klawisze
          OGLĄDANEGO kubełka, bo tylko one coś tam robią — lista wszystkich
          uczyłaby przebiegać wzrokiem obok tego jednego, który jest do rzeczy.
          Sit „moje"/„niczyje" tu nie ma: zwrot nie nosi prowadzącego. */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {isLoading
          ? <Pusto waga="lista">Wczytuję kolejkę…</Pusto>
          : <Kolejka zwroty={widoczne} wybrany={wybrany}
              zKubelkiem={Boolean(pasujace) || kubelek === null}
              onWybierz={(z) => nawiguj(`/obsluga/zwroty/${z}`)} />}
      </div>
    </Karta>

    <Karta className="flex min-h-0 flex-col overflow-hidden">
      {!zwrot
        ? <Pusto ikona={Undo2}>
            Wybierz zwrot z kolejki — strzałkami albo kliknięciem.</Pusto>
        : <>
            <Naglowek zwrot={zwrot} />
            {/* Pasek stoi NAD produktami i nie przewija się razem z nimi:
                decyzja o całym zwrocie ma być pod ręką także wtedy, gdy
                operator zjechał na dziewiątą pozycję. */}
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
              /* KOREKTA PRZESUWA KURSOR TYLKO WTEDY, GDY PIENIĄDZE SĄ ZAŁATWIONE
                 (audyt, 15 września 2026). Dwa zdania na tym samym ekranie
                 przeczyły sobie: `Decyzje.tsx` obiecywało „pieniądze oddajesz
                 przyciskiem niżej — także po zapisaniu korekty", a zapis numeru
                 natychmiast wyprowadzał z tego zwrotu na następny. Biuro
                 wystawia korektę zwykle PRZED wypłatą, więc kursor uciekał
                 dokładnie przed pieniędzmi — i dlatego szły w Sales Center.
                 Dwie drogi do wypłaty, dwie bramki: przez Allegro
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
            {/* Pieniądze STOJĄ POD DECYZJAMI, nie w kolumnie dowodów: to jest
                ostatni krok tej pracy i ma być tam, gdzie operator właśnie
                patrzy, a nie o kolumnę dalej. */}
            {szczegol.data?.pieniadze && <Pieniadze
              stan={szczegol.data.pieniadze}
              akcje={akcje}
              trwa={pieniadze.isPending || odmowaPlatnosci.isPending
                || przelew.isPending || cofnijPrzelew.isPending}
              blad={bladPieniedzy}
              onZwroc={() => {
                setBladPieniedzy("");
                pieniadze.mutate({ id: zwrot.id, wersja: zwrot.wersja },
                  { onError: (e) => setBladPieniedzy((e as Error).message) });
              }}
              onPrzelew={(referencja) => {
                setBladPieniedzy("");
                przelew.mutate({ id: zwrot.id, wersja: zwrot.wersja, referencja },
                  { onError: (e) => setBladPieniedzy((e as Error).message) });
              }}
              onCofnijPrzelew={() => {
                setBladPieniedzy("");
                cofnijPrzelew.mutate({ id: zwrot.id, wersja: zwrot.wersja },
                  { onError: (e) => setBladPieniedzy((e as Error).message) });
              }}
              onOdmow={(kod, powod) => {
                setBladPieniedzy("");
                odmowaPlatnosci.mutate({ id: zwrot.id, kod, powod, wersja: zwrot.wersja },
                  { onError: (e) => setBladPieniedzy((e as Error).message) });
              }} />}
            <div className="min-h-0 flex-1 overflow-y-auto">
              {/* `key` na ZWROCIE: przełączenie zwrotu w kolejce ma montować
                  listę od nowa. Bez tego zostawał w niej stan poprzedniego —
                  zaznaczenie pozycji i haczyk przy koszcie dostawy — a zapis
                  kwoty szedł z cudzymi identyfikatorami. */}
              <Pozycje key={zwrot.id} zwrot={zwrot} trwa={trwa} blad={bladDecyzji}
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
              {/* DOŁOŻENIE TOWARU DO KOSZYKA (0.365.0) stoi POD pozycjami,
                  bo to ostatnia rzecz przy otwartym kartonie: najpierw oceniam
                  to, co klient zgłosił, potem dokładam to, czego w zgłoszeniu
                  nie ma. Pasek koszyka pokazuje się dopiero z zawartością, więc
                  pierwszej sztuki nie dałoby się tam zeskanować.

                  TYLKO PRZY ZWROCIE, KTÓRY JESZCZE ŻYJE (0.370.0). Granicę
                  postawił właściciel razem ze zgłoszeniem: „tylko z poziomu
                  obsługi zwrotów, jak jeszcze nie jest zamknięty" — a pole
                  rysowało się bezwarunkowo, także przy zwrocie zamkniętym
                  i odrzuconym. Skaner przy sprawie, której nie ma jak zmienić,
                  obiecuje ruch, po którym serwer odmówi. */}
              {zwrot.kubelek !== "zamkniety" && zwrot.kubelek !== "odrzucony" &&
                <DolozTowar />}
            </div>
          </>}
    </Karta>

    {/* Cała ta kolumna jest do czytania, więc cała jedzie do scrollera —
        `Dowody` nie muszą o tym wiedzieć. */}
    <Karta className="flex min-h-0 flex-col overflow-hidden">
      <div className="min-h-0 flex-1 overflow-y-auto">
      {zwrot
        ? <Dowody zwrot={zwrot} os={szczegol.data?.os ?? []}
            sprawy={szczegol.data?.sprawy ?? []} droga={szczegol.data?.droga ?? []}
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
