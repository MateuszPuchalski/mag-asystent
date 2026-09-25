import React, { useMemo, useState, type MutableRefObject } from "react";
import { Barcode, Check, CircleHelp, ExternalLink, Layers, Link2, Tag, X as Krzyzyk } from "lucide-react";
import type { DoDopisania, Ocena, PozycjaZwrotu, SkladPozycji, WierszDokumentu, Zwrot } from "../api/typy";
import {
  useKosz, usePotwierdzKartoteke, useWskazSklad, useZaznaczSkladnik, zlote,
} from "../api/zwroty";
import { Wyszukiwarka, type Towar } from "../wyszukiwarka";
import { Blad, Przycisk, Pusto } from "../ui";
import { Kafel, KafelOferty } from "../towar/Kafel";
import { Rabat } from "./Rabat";
import { Link } from "./Link";
import { Potracenie } from "./Potracenie";
import { IloscZwrocona } from "./IloscZwrocona";
import { Dopisz } from "./Dopisz";

/* ── Produkty ze zwrotu (0.167.0) ────────────────────────────────────────────
   Do 0.165.0 pozycje stały w PRAWEJ kolumnie, szerokiej na 340 px: nazwy
   ucinały się w połowie („Podkaszarka elektry…"), zdjęcia miały 56 px, a
   środek ekranu — najszerszy — świecił pustką pod paskiem decyzji. Decyzja
   właściciela: produkty idą do głównego okna.

   Razem z nimi przeniosła się AKCJA. Do 0.165.0 kubełki DO OCENY i DO ZWROTU
   wypisywały te same pozycje drugi raz, jako gołe nazwy z przyciskami — bez
   zdjęcia, bez powodu zwrotu, bez kartoteki. Operator oceniał towar, patrząc
   na listę, która towaru nie pokazywała. Teraz jest jeden wiersz produktu,
   a przycisk oceny albo pole zaznaczenia stoją na nim.

   Prawa kolumna zostaje kolumną DOWODÓW: zegar ustawowy, numery, zamówienie,
   paczka. To rzeczy o zwrocie, nie o towarze.                               */

/* Siedemnaście powodów, bo tyle wymienia SCHEMAT Allegro (0.169.0). Do
   0.167.0 stało tu jedenaście — te zaobserwowane przez sondę — a sześć
   pozostałych pokazywało się operatorowi surowym kodem. `reason.type` nie ma
   w specyfikacji enuma, więc lista i tak nie jest zamknięta: nieznany kod
   nadal przechodzi surowy, zamiast zniknąć. */
const POWODY: Record<string, string> = {
  NONE: "bez powodu", MISTAKE: "pomyłka klienta", TRANSPORT: "uszkodzenie w transporcie",
  DAMAGED: "towar uszkodzony", NOT_AS_DESCRIBED: "niezgodny z opisem",
  DONT_LIKE_IT: "nie spodobał się", OVERDUE_DELIVERY: "dostawa po terminie",
  INCOMPLETE: "niekompletny", HIDDEN_FLAW: "wada ukryta", OTHER_FLAW: "inna wada",
  DIFFERENT: "inny towar", COUNTERFEIT: "podróbka", NOT_NEW: "towar nienowy",
  TOO_LARGE: "za duży", TOO_SMALL: "za mały", NOT_AS_EXPECTED: "inny niż oczekiwany",
  ORDERED_FOR_COMPARISON: "zamówiony na przymiarkę",
};

import { useAkcjaKlawisza, type AkcjeKlawiszy } from "./klawisze";
import { calaDostawa, pewnaPropozycja } from "./regulaSzybkiej";
import { PrzyciskTowaru } from "../towar/Szuflada";

/* TRZY PRZYCISKI OD 0.375.0, i trzeci ma warunek. „Na przecenę" zeszła stąd
   w 0.209.0, bo nie prowadziła donikąd: nie dokładała do koszyka, nie ruszała
   stanu, nie zakładała zadania. Przycisk, który wygląda jak decyzja, a nie
   jest żadną, kosztuje namysł przy każdej pozycji — a ocena jest tu naciskana
   najczęściej ze wszystkiego.

   „Na outlet" wolno tu stać, bo kończy się LISTĄ ROBOCZĄ (`NaOutlet`): ktoś
   niesie używkę na regał i odklikuje ją po wystawieniu MM w Subiekcie. Bez
   tamtej listy byłby to ten sam ślepy zaułek drugi raz.

   Czego broni: bez tej oceny towar używany dostawał „na stan", jechał na halę
   i wracał na półkę pickingową obok fabrycznych. Kompletujący brał ten, który
   stał bliżej. */
const OCENY: Array<[Ocena, string, string]> = [
  ["stan", "S", "Na stan"],
  ["utylizacja", "U", "Utylizacja"],
  ["outlet", "O", "Na outlet"],
];

/**
 * Kartoteka pozycji: propozycja automatu, potwierdzenie człowieka.
 *
 * Wskazanie ręczne otwiera się dopiero na żądanie: wyszukiwarka pod każdą
 * pozycją byłaby ścianą pól tam, gdzie w większości przypadków wystarczy
 * potwierdzić to, co automat już policzył.
 */
function Kartoteka({ p }: { p: PozycjaZwrotu }) {
  const [szukam, setSzukam] = useState(false);
  const zapisz = usePotwierdzKartoteke();

  const ustaw = (twId: number | null, zrodlo: "sku" | "reczne") =>
    zapisz.mutate({ pozycjaId: p.id, twId, zrodlo }, { onSuccess: () => setSzukam(false) });

  if (p.twId !== null) {
    /* ── ZNACZNIK ZAMIAST ZDANIA (0.455.0) ─────────────────────────────────
       Zgłoszenie właściciela: „ulżyj przeładowaniu tekstem". Powiązana
       kartoteka to stan DOBRY i najczęstszy, a zdanie „Kartoteka X ·
       zatwierdzona propozycja" stało przy każdej pozycji każdego zwrotu.
       Zielony znacznik z ikoną ogniwa mówi „powiązane" na pierwszy rzut oka;
       źródło zostaje w podpowiedzi. „Zatwierdzona propozycja", a nie
       „z SKU oferty": od 0.154.0 automat proponuje z czterech źródeł, a
       wszystkie zapisują się tym samym `sku`. */
    const skad = p.twZrodlo === "sku" ? "zatwierdzona propozycja" : "wskazana ręcznie";
    return <span title={`Kartoteka Subiekta — ${skad}`}
      className="inline-flex h-6 items-center gap-1 rounded-full bg-emerald-50 pl-2 pr-1 text-xs font-semibold text-emerald-800">
      <Link2 size={12} aria-hidden="true" />
      <span className="sr-only">Kartoteka </span>
      <PrzyciskTowaru twId={p.twId}><span className="font-mono">{p.twSymbol}</span></PrzyciskTowaru>
      <span className="sr-only"> — {skad}</span>
      <button type="button" aria-label="Zdejmij powiązanie" title="Zdejmij powiązanie"
        disabled={zapisz.isPending} onClick={() => ustaw(null, "reczne")}
        className="rounded-full p-0.5 text-emerald-800 hover:bg-emerald-100">
        <Krzyzyk size={12} aria-hidden="true" />
      </button>
    </span>;
  }

  const prop = p.propozycja;
  /* `w-full`: propozycja i brak kartoteki to BLOKI z treścią do przeczytania
     i przyciskiem — w rzędzie znaczników zawijają się pod nie, zamiast
     ściskać znacznik rabatu obok. */
  return <div className="w-full text-xs">
    {prop?.twId != null
      /* Propozycja nie udaje faktu: mówi, skąd się wzięła, i czeka na
         zatwierdzenie. Projekt panelu §4.3 i §11.3. Warunek stoi na `twId`,
         a nie na jednej wartości pewności — inaczej propozycja z pamięci
         wskazań (ta najpewniejsza, bo za nią stoi człowiek) nie dostałaby
         przycisku i wymagałaby ręcznego wskazania po raz drugi. */
      /* Zdjęcie przy PROPOZYCJI (0.203.0). Kafel na początku wiersza pokazuje
         kartotekę POTWIERDZONĄ, więc pozycja czekająca na zatwierdzenie stała
         przy pustym kwadracie — a to właśnie przy niej zapada decyzja.
         Obraz siedzi WEWNĄTRZ bloku propozycji, w jego barwie: wyniesiony na
         wiersz udawałby fakt, a §4.3 nie pozwala, żeby wybór automatu wyglądał
         jak dana z Allegro. Mniejszy niż kafel wiersza z tego samego powodu. */
      ? <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-2 text-amber-900">
          <Kafel twId={prop.twId} rozmiar={40} nazwa={prop.symbol ?? p.nazwa} symbol={prop.symbol} />
          <div className="min-w-0 flex-1">
            <p>Propozycja: <b className="font-mono">{prop.symbol}</b></p>
            <p className="text-slate-500">{prop.zrodlo}</p>
            <button type="button" disabled={zapisz.isPending}
              onClick={() => ustaw(prop.twId, "sku")}
              className="mt-1 inline-flex items-center gap-1 rounded bg-emerald-600 px-2 py-0.5 font-bold text-white hover:bg-emerald-700 disabled:opacity-50">
              <Check size={12} />Zatwierdź</button>
          </div>
        </div>
      /* POWÓD, nie samo „Bez kartoteki". Do 0.153.1 sześć różnych zerwań
         łańcucha wyglądało tu identycznie i operator nie miał jak odróżnić
         „sprzedawca nie wypełnił SKU" od „kod ma błąd". Zdanie pisze SERWER
         (`dopasowanie-sku.ts`) — druga kopia tej reguły w panelu rozjechałaby
         się przy pierwszej poprawce jednej z nich. */
      : <p className="text-slate-500">
          Bez kartoteki{prop?.zrodlo ? <> · <span className="text-slate-600">{prop.zrodlo}</span></> : null}</p>}

    {szukam
      ? <div className="mt-1">
          <Wyszukiwarka wybrany={null} etykieta="Wskazana przez Ciebie"
            onWybierz={(t: Towar | null) => t && ustaw(t.id, "reczne")} />
        </div>
      /* Własny wiersz, nie doklejka do zdania o powodzie: „…jeszcze nie
         pobranowskaż kartotekę" czytało się jak jedno słowo. */
      : <button type="button" onClick={() => setSzukam(true)}
          className="mt-1 block text-slate-500 underline underline-offset-2 hover:text-slate-800">
          wskaż kartotekę</button>}
    {zapisz.error && <p className="mt-1 text-red-700">{(zapisz.error as Error).message}</p>}
  </div>;
}

/**
 * Ręczne wskazanie składu kompletu (0.336.0).
 *
 * Zgłoszenie właściciela: „rozwiąż «nie weszła do koszyka» — nie wiem, gdzie
 * to wskazać". Automat sam odsyłał do tej drogi zdaniem „wskaż skład ręcznie",
 * a drogi nie było.
 *
 * MATERIAŁEM SĄ WIERSZE PARAGONU, nie wyszukiwarka kartotek. Dowolna kartoteka
 * znaczyłaby drogę, którą na dokument MM trafia towar nieobecny na żadnej
 * sprzedaży — czyli dokładnie to, przed czym broni reguła „kartoteka
 * z paragonu". Człowiek patrzy na paragon i w pięć sekund wie, co wchodziło
 * w skład; automat nie wie, bo pozostałe oferty zamówienia nie mają kartotek.
 *
 * ILOŚĆ JEST NA JEDEN KOMPLET — tak myśli człowiek patrzący na zestaw („w
 * środku są dwie sztuki tego") i tak stoi w tabeli. Podpowiadamy sztuki
 * z dokumentu, bo przy jednym kupionym komplecie to ta sama liczba.
 */
function WskazSklad({ p, wiersze, zwrotId, onKoniec }: {
  p: PozycjaZwrotu; wiersze: WierszDokumentu[]; zwrotId: number; onKoniec: () => void;
}) {
  const zapisz = useWskazSklad();
  const [wybrane, setWybrane] = useState<Record<number, string>>({});

  const przelacz = (w: WierszDokumentu) => setWybrane((s) => {
    const kopia = { ...s };
    if (w.twId in kopia) delete kopia[w.twId];
    else kopia[w.twId] = String(w.naDokumencie);
    return kopia;
  });

  const skladniki = Object.entries(wybrane)
    .map(([twId, ile]) => ({ twId: Number(twId), naKomplet: Number(ile.replace(",", ".")) }));
  const gotowe = skladniki.length > 0 && skladniki.every((x) => x.naKomplet > 0);

  return <div className="mt-1 rounded-lg border border-amber-300 bg-amber-50 p-2 text-xs">
    <p className="text-amber-900">
      Zaznacz wiersze paragonu, które wchodzą w skład tej oferty, i podaj
      sztuki <b>na jeden komplet</b>.</p>
    {wiersze.length === 0
      /* Bez dokumentu nie ma z czego składać — i to jest INNA usterka, ze swoją
         własną drogą: wskazanie paragonu w kolumnie dowodów. */
      ? <p className="mt-1 text-slate-600">
          Ten zwrot nie ma wskazanego dokumentu sprzedaży, więc nie ma z czego
          składać. Dokument wskazujesz w kolumnie dowodów — o ile stoją tam
          kandydaci.</p>
      : <ul className="mt-1 space-y-0.5">
          {wiersze.map((w) => (
            <li key={w.twId} className="flex items-center gap-2">
              <label className="flex min-w-0 flex-1 items-center gap-2 rounded px-1 py-0.5
                hover:bg-amber-100">
                <input type="checkbox" className="h-4 w-4 accent-emerald-600"
                  checked={w.twId in wybrane} onChange={() => przelacz(w)} />
                <b className="font-mono">{w.symbol}</b>
                <span className="min-w-0 flex-1 truncate text-slate-600">{w.nazwa}</span>
                <span className="text-slate-500">na paragonie: {w.naDokumencie}</span>
              </label>
              {w.twId in wybrane && <input className="field h-6 w-16 text-xs"
                aria-label={`Sztuk na komplet — ${w.symbol}`} value={wybrane[w.twId]}
                onChange={(e) => setWybrane((s) => ({ ...s, [w.twId]: e.target.value }))} />}
            </li>))}
        </ul>}
    <div className="mt-2 flex gap-2">
      <button type="button" className="btn-primary text-xs"
        disabled={!gotowe || zapisz.isPending}
        onClick={() => zapisz.mutate({ pozycjaId: p.id, zwrotId, skladniki },
          { onSuccess: onKoniec })}>
        {zapisz.isPending ? "Zapisuję…" : "Zapisz skład"}</button>
      <button type="button" className="btn-secondary text-xs" onClick={onKoniec}>Wróć</button>
    </div>
    {zapisz.error && <p className="mt-1 text-red-700">{(zapisz.error as Error).message}</p>}
  </div>;
}

/**
 * Składniki kompletu z ptaszkami (0.335.0).
 *
 * Zgłoszenie właściciela: „powinno rozbijać na komponenty do zaznaczania,
 * które idą do MM". Z kompletu wracają nieraz same części — reszta zostaje
 * u klienta albo nadaje się wyłącznie na odpad.
 *
 * PTASZKI STOJĄ ZAZNACZONE i to nie jest domyślność z lenistwa: typowy zwrot
 * kompletu jest kompletny, a ekran ma pytać wyłącznie o wyjątek (dekalog §1 —
 * mniej decyzji). Odznaczenie zdejmuje wiersz z dokumentu MM od razu, bo to
 * `kosz_pozycja` jest prawdą o tym, co pojedzie na papier.
 *
 * Pokazujemy je DOPIERO, gdy pozycja leży w koszyku. Wcześniej skład jest
 * planem, a ptaszek obiecywałby wiersz, którego nie ma czego zdjąć.
 */
function Skladniki({ p, sklad, zwrotId }: {
  p: PozycjaZwrotu; sklad: SkladPozycji; zwrotId: number;
}) {
  const zaznacz = useZaznaczSkladnik();
  return <div className="mt-1 text-xs">
    <p className="text-slate-500">Z paragonu — odznacz, co NIE jedzie na MM:</p>
    <ul className="mt-1 space-y-0.5">
      {sklad.skladniki.map((s) => (
        <li key={s.twId}>
          {/* Cała etykieta jest celem kliknięcia, nie sam kwadracik. */}
          <label className="flex items-center gap-2 rounded px-1 py-0.5 hover:bg-slate-100">
            <input type="checkbox" checked={s.wKoszyku} disabled={zaznacz.isPending}
              className="h-4 w-4 accent-emerald-600"
              onChange={(e) => zaznacz.mutate({
                pozycjaId: p.id, twId: s.twId, wKoszyku: e.target.checked, zwrotId,
              })} />
            <b className="font-mono">{s.symbol}</b>
            <span className="text-slate-500">× {s.ilosc}</span>
            <span className="min-w-0 flex-1 truncate text-slate-500">{s.nazwa}</span>
          </label>
        </li>))}
    </ul>
    {/* ODMOWA SERWERA JEST ZDANIEM („to ostatni składnik — zdejmuje się ją
        cofnięciem oceny"), więc pokazujemy ją wprost, przy ptaszkach. */}
    {zaznacz.error && <p className="mt-1 text-red-700">{(zaznacz.error as Error).message}</p>}
  </div>;
}

export function Pozycje({ zwrot, trwa, blad, trwaRabat = false, bladRabatu = "",
  doDopisania = [], bladDopisania = "", sklady = {}, wierszeDokumentu = [],
  onOcena, onKwota, onZglosRabat, onPotracenie, onIlosc, onDopisz, onZdejmij,
  onWszystkieNaStan, akcje }: {
  zwrot: Zwrot;
  trwa: boolean;
  blad: string;
  trwaRabat?: boolean;
  bladRabatu?: string;
  /** Pozycje zamówienia, których w zwrocie jeszcze nie ma (0.184.0). */
  doDopisania?: DoDopisania[];
  bladDopisania?: string;
  /** Co wejdzie do koszyka za każdą pozycję (0.328.0), po identyfikatorze. */
  sklady?: Record<number, SkladPozycji>;
  /** Wiersze paragonu — materiał do ręcznego składu kompletu (0.336.0). */
  wierszeDokumentu?: WierszDokumentu[];
  onOcena: (pozycjaId: number, ocena: Ocena | null, koszId?: number) => void;
  onKwota: (pozycjeIds: number[], dostawa: boolean) => void;
  onZglosRabat?: (pozycjaId: number) => void;
  onPotracenie?: (pozycjaId: number, grosze: number | null, powod: string) => void;
  /** Ile sztuk naprawdę wróciło; `null` czyści zapis (0.212.0). */
  onIlosc?: (pozycjaId: number, ilosc: number | null) => void;
  onDopisz?: (zamPozycjaId: number) => void;
  onZdejmij?: (pozycjaId: number) => void;
  /** Ocena WSZYSTKICH nieocenionych naraz (0.284.0) — patrz `onOcena`. */
  onWszystkieNaStan?: () => void;
  /** Rejestr akcji dla klawiszy kubełka (`zwroty/klawisze.ts`). */
  akcje?: MutableRefObject<AkcjeKlawiszy>;
}) {
  /* Pozycje startują ZAZNACZONE — to one wracają do nas. Dostawa zależy od
     tego, czy klient odstępuje od całego zamówienia, czy oddaje jedną rzecz
     z pięciu — od 0.476.0 rozstrzyga to zamówienie, niżej przy `dostawa`.

     STAN TRZYMA ODZNACZONE, nie zaznaczone — i to jest naprawa błędu, nie
     upodobanie. Lista zaznaczonych była KOPIĄ listy pozycji, więc rozjeżdżała
     się z nią przy każdej zmianie: pozycja zdjęta ze zwrotu zostawiała martwy
     identyfikator (serwer odbijał zapis: „Pozycje 3742 nie należą do tego
     zwrotu"), a pozycja DOPISANA przez biuro wchodziła odznaczona i po cichu
     wypadała z kwoty — bo serwer odrzuca nadmiar, nigdy braku. Wyprowadzenie
     zaznaczenia z `zwrot.pozycje` znosi obie te drogi naraz. */
  /* Która pozycja ma otwarty formularz składu (0.336.0). Jedna naraz: dwa
     otwarte pytałyby o to samo w dwóch miejscach ekranu. */
  /* Otwarte pudła z TEGO SAMEGO zapytania co pasek koszyka — react-query
     oddaje je z pamięci, więc przycisk oceny nie kosztuje strzału do serwera. */
  const pudla = useKosz().data?.kosze ?? [];
  const [skladamy, setSkladamy] = useState<number | null>(null);
  const [odznaczone, setOdznaczone] = useState<ReadonlySet<number>>(() => new Set());
  const wybrane = useMemo(
    () => zwrot.pozycje.filter((p) => !odznaczone.has(p.id)).map((p) => p.id),
    [zwrot.pozycje, odznaczone]);
  /* ── DOSTAWA ZAZNACZONA, GDY WRACA CAŁE ZAMÓWIENIE (0.476.0) ──────────
     Przegląd zwrotów z 23 września: pole zaczynało puste zawsze, choć
     zamówienie mówi samo, czy klient oddaje wszystko. Przy odstąpieniu od
     całej umowy koszt dostawy się oddaje — więc to jest odpowiedź, którą ekran
     zna, a nie decyzja, którą ma zadać człowiekowi.

     Przy zwrocie części pole dalej zaczyna puste i decyduje człowiek. Brak
     zamówienia to „nie wiem", a nie „wszystko wraca". */
  const [dostawa, setDostawa] = useState(() => calaDostawa(zwrot));

  /* Wycena tylko PRZED kwotą (0.476.0). Od tego wydania zwrot wraca do DO
     ZWROTU także po korekcie, gdy pieniądze jeszcze nie wyszły — a wtedy
     kwota stoi i drugi raz jej się nie zaznacza. */
  const wycena = zwrot.kubelek === "zwrot" && zwrot.kwotaGrosze === null;
  const ocenianie = zwrot.kubelek === "ocena";
  /* Ocenę cofa się wszędzie, gdzie zwrot jest jeszcze w pracy — pomyłkę widać
     równie dobrze przy wycenie, co przy ocenianiu. Zamknięty i odrzucony
     odpadają, bo `podKlucz` po stronie serwera i tak ich nie wpuści. */
  const cofalne = zwrot.kubelek !== "zamkniety" && zwrot.kubelek !== "odrzucony";
  /* KOREKTA ZAMYKA EDYCJĘ (0.484.7). Zapis korekty stawia `zamkniety_at`,
     a `podKlucz` odmawia wtedy każdej zmiany — także w kubełku DO ZWROTU, gdzie
     zwrot z korektą czeka na pieniądze od 0.476.0. Przyciski cofania, liczby
     sztuk, potrącenia, zdjęcia i dopisania obiecywały tam ruch, którego serwer
     nie przyjmie. Wyjściem jest cofnięcie korekty (`R`), więc to ono otwiera
     edycję z powrotem. */
  const edytowalny = cofalne && !zwrot.korektaNumer;
  const dostawaGrosze = zwrot.zamowienie?.dostawaGrosze ?? null;

  /* Podgląd odejmuje potrącenia tak samo jak serwer — inaczej operator
     widziałby jedną liczbę, a klient dostawał inną. Liczy je jednak SERWER;
     to nadal tylko podgląd zaznaczenia. */
  const suma = useMemo(() => {
    const pozycje = zwrot.pozycje
      .filter((p) => wybrane.includes(p.id))
      .reduce((s, p) => s + Math.round(p.cenaGrosze * p.ilosc) - (p.potracenieGrosze ?? 0), 0);
    return pozycje + (dostawa ? dostawaGrosze ?? 0 : 0);
  }, [zwrot.pozycje, wybrane, dostawa, dostawaGrosze]);

  const przelacz = (id: number) => setOdznaczone((w) => {
    const n = new Set(w);
    if (!n.delete(id)) n.add(id);
    return n;
  });

  /* Klawisz `Enter` w kubełku DO ZWROTU zapisuje TO zaznaczenie — rejestr
     opisuje `zwroty/klawisze.ts`. Rejestrujemy zawsze, a nie tylko przy
     wycenie: ekran woła akcję wyłącznie we właściwym kubełku, a warunek tutaj
     byłby drugą kopią tej samej reguły. */
  useAkcjaKlawisza(akcje, "zapiszKwote", () => { if (!trwa && wycena) onKwota(wybrane, dostawa); });

  /* ── `-` i `D` OTWIERAJĄ WYJĄTKI (0.479.0) ─────────────────────────────
     Przegląd zwrotów z 23 września: „wróciło mniej" i potrącenie były
     wyłącznie dla myszy, więc każdy wyjątek zrywał pracę z klawiatury.
     PIERWSZA PASUJĄCA POZYCJA, jak przy ocenie `S` — klawisz idzie tą samą
     drogą, którą wędruje wzrok. Znacznik rośnie przy każdym naciśnięciu,
     więc drugi klawisz po „Wróć" otwiera pole jeszcze raz. */
  const [otworzIlosc, setOtworzIlosc] = useState<{ id: number; n: number } | null>(null);
  const [otworzPotracenie, setOtworzPotracenie] = useState<{ id: number; n: number } | null>(null);
  useAkcjaKlawisza(akcje, "ilosc", () => {
    if (!(ocenianie || wycena)) return;
    const p = zwrot.pozycje.find((x) => x.ilosc > 1 && x.iloscZwrocona == null);
    if (p) setOtworzIlosc((o) => ({ id: p.id, n: (o?.n ?? 0) + 1 }));
  });
  useAkcjaKlawisza(akcje, "potracenie", () => {
    if (!wycena) return;
    const p = zwrot.pozycje.find((x) => x.potracenieGrosze == null && !odznaczone.has(x.id));
    if (p) setOtworzPotracenie((o) => ({ id: p.id, n: (o?.n ?? 0) + 1 }));
  });

  const nieocenione = zwrot.pozycje.filter((p) => !p.ocena);

  /* Pewne propozycje kartoteki — patrz przycisk nad listą. Po jednej, po
     kolei: trasa zapisu jest na pozycję, a pierwsza odmowa zatrzymuje
     resztę, żeby ekran nie zostawił połowy powiązań bez słowa. */
  const pewne = zwrot.pozycje.filter((p) => p.twId === null && pewnaPropozycja(p));
  const potwierdz = usePotwierdzKartoteke();
  const [hurt, setHurt] = useState<{ trwa: boolean; blad: string }>({ trwa: false, blad: "" });
  const zatwierdzPewne = async () => {
    setHurt({ trwa: true, blad: "" });
    try {
      for (const p of pewne) {
        await potwierdz.mutateAsync({ pozycjaId: p.id, twId: p.propozycja!.twId, zrodlo: "sku" });
      }
      setHurt({ trwa: false, blad: "" });
    } catch (e) {
      setHurt({ trwa: false, blad: (e as Error).message });
    }
  };

  if (!zwrot.pozycje.length) {
    /* PUSTKA TEŻ MÓWI, CO ZROBIĆ (audyt, 15 września 2026). Zwrot bez pozycji
       ma dwie przyczyny i obie mają wyjście: zamówienia jeszcze nie pobrano
       (kolumna dowodów, „Dociągnij teraz") albo to paczka nieodebrana, której
       klient nie zgłosił — wtedy pozycje dopisuje biuro. */
    /* Obie drogi MUSZĄ stać obok zdania (0.484.7). Do tego wydania pusty
       zwrot odsyłał do dopisania, a listy dopisania tu nie było — wczesne
       wyjście pomijało ją razem z resztą. „Dociągnij" pada tylko przy numerze
       zamówienia, bo bez niego przycisku w dowodach nie ma. */
    return <div className="p-4">
      <Pusto waga="lista">
        Zwrot bez pozycji — nie ma czego wycenić.
        {zwrot.orderId ? " Dociągnij zamówienie w kolumnie obok albo dopisz to, co przyszło w kartonie."
          : " Zwrot nie ma numeru zamówienia, więc nie ma skąd dopisać pozycji."}</Pusto>
      {onDopisz && edytowalny && <Dopisz kandydaci={doDopisania} trwa={trwa}
        blad={bladDopisania} onDopisz={onDopisz} />}
    </div>;
  }

  return <div className="p-4">
    {pewne.length > 1 &&
      /* ── PEWNE KARTOTEKI JEDNYM RUCHEM (0.479.0) ────────────────────
         Przegląd zwrotów z 23 września: przy zwrocie wielopozycyjnym
         „Zatwierdź" klikało się po kolei przy każdej pozycji, choć żadna nie
         wymagała namysłu. Hurtem idą WYŁĄCZNIE `sku` i `pamiec` — trafienie
         sygnatury i decyzja człowieka z innego zwrotu. `jedyna_pozycja`
         i `nazwa_w_zamowieniu` to zgadywanie (`services/sygnatury.ts`),
         a pomyłka kartoteki wraca towarem na złej półce, więc te zostają
         przy pozycji, pod okiem. Próg „więcej niż jedna" z tego samego
         powodu co ocena hurtem niżej: przy jednej to drugi przycisk
         o tym samym znaczeniu. */
      <div className="mb-2 flex items-center gap-2">
        <Przycisk className="text-xs" disabled={hurt.trwa}
          title="Zatwierdza propozycje z SKU oferty i z pamięci wskazań. Zgadywane zostają przy pozycjach."
          onClick={zatwierdzPewne}>
          <Check size={12} aria-hidden="true" />
          {hurt.trwa ? " Zatwierdzam…" : ` Zatwierdź pewne kartoteki (${pewne.length})`}
        </Przycisk>
        {hurt.blad && <span className="text-xs text-red-700">{hurt.blad}</span>}
      </div>}
    {/* OCENA HURTEM (0.284.0). Zwrot bywa wielopozycyjny, a ocena jest tu
        naciskana najczęściej ze wszystkiego — przy pięciu pozycjach to pięć
        kliknięć w to samo. Przycisk staje TYLKO przy więcej niż jednej
        nieocenionej pozycji: przy jednej byłby drugim przyciskiem o tym samym
        znaczeniu, a Dekalog p. 5 każe ograniczać decyzje, nie mnożyć drogi.

        Wyłącznie „na stan". Utylizacja hurtem to jeden ruch, który wysyła cały
        zwrot na złom — a tej pomyłki nie widać na ekranie, dopóki koszyk nie
        pojedzie. Cofnięcie stoi przy pozycji i tam ma zostać. */}
    {ocenianie && nieocenione.length > 1 && onWszystkieNaStan &&
      <div className="mb-2 flex items-center gap-2">
        <Przycisk className="text-xs" disabled={trwa} onClick={onWszystkieNaStan}>
          <kbd className="rounded border border-slate-300 px-1">Shift+S</kbd>
          {" "}Wszystkie na stan ({nieocenione.length})
        </Przycisk>
      </div>}
    <ul className="space-y-2">
      {zwrot.pozycje.map((p) => <li key={p.id} className="flex items-start gap-3 rounded-lg bg-slate-50 p-3">
        {/* Pole zaznaczenia stoi PRZED zdjęciem, w jednej kolumnie dla całej
            listy: odhaczanie idzie wtedy w dół jednym ruchem oka. */}
        {wycena && <input type="checkbox" className="mt-1 h-4 w-4 shrink-0"
          aria-label={`Oddaj: ${p.nazwa}`}
          checked={wybrane.includes(p.id)} onChange={() => przelacz(p.id)} />}
        {/* ── DWA ZDJĘCIA, DWA PYTANIA (0.213.0) ──────────────────────────
            Kafel kartoteki odpowiada „co mamy na półce", kafel oferty — „co
            klient widział, kupując". To nie jest powtórzenie: różnica między
            nimi bywa właśnie tym, o co poszedł spór („na zdjęciu było inaczej").

            Zdjęcie oferty stoi DRUGIE i jest mniejsze, bo pierwsze pytanie
            przy zwrocie brzmi „czym to jest u nas".

            KAFEL STOI ZAWSZE, także pusty, i to jest ta sama reguła, dla której
            kafel kartoteki nie znika: wiersze mają zaczynać się w JEDNEJ linii,
            bo wzrok jedzie po nich w dół. Pusty niesie zresztą własną
            informację — pozycja, która nie związała się z żadną linią
            zamówienia, to wiersz, o którym wiemy mniej niż o sąsiednich.

            Numer bierzemy z pozycji ZAMÓWIENIA (`ofertaZamowienia`), nie
            z `offerId` pozycji zwrotu: tamten należy do przestrzeni, której
            nie znamy — patrz `services/zwroty.ts`. */}
        <Kafel twId={p.twId} rozmiar={72} nazwa={p.nazwa} symbol={p.twSymbol} />
        <KafelOferty externalId={p.ofertaZamowienia} stan={p.ofertaZdjecie} rozmiar={48}
          nazwa={`${p.nazwa} — zdjęcie oferty`} symbol={p.sku} />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            {/* Bez `truncate`: w środkowej kolumnie nazwa się MIEŚCI, a gdy
                nie mieści — łamie się, zamiast gubić końcówkę. Ucinanie było
                ceną za 340 px po prawej i tej ceny już nie płacimy. */}
            <span className="font-semibold">{p.nazwa}</span>
            {/* Zapis człowieka nie udaje faktu z Allegro (§4.3). Plakietka
                stoi przy nazwie, bo tam pada pytanie „skąd to się tu wzięło". */}
            {p.zrodlo === "biuro" && <span
              className="shrink-0 rounded bg-sky-100 px-1.5 py-0.5 text-xs font-semibold text-sky-800">
              dopisane przez biuro</span>}
            <span className="ml-auto shrink-0 tabular-nums">
              {zlote(Math.round(p.cenaGrosze * p.ilosc), p.waluta)}</span>
          </div>
          {/* ── SZCZEGÓŁY Z IKONAMI, JEDEN RZĄD (0.455.0) ─────────────────────
              Do 0.454.0 trzy linijki: „2 szt. · powód", „EAN … SKU …"
              i „Zobacz ofertę". Ikona zastępuje etykietę, a pełna nazwa stoi
              w podpowiedzi i w nazwie dostępnej. Kody zostają pismem stałej
              szerokości, bo po nich szuka się na półce i w Subiekcie.

              EAN wisi przy KARTOTECE, więc pojawia się dopiero po jej
              potwierdzeniu; SKU jest sprzedawcy i idzie z pozycji ZAMÓWIENIA,
              bo pozycja zwrotu własnego SKU w specyfikacji nie ma. Pustych
              etykiet nie ma: brak kodu to brak znacznika. */}
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-600">
            <span title="Ilość w zwrocie" className="inline-flex items-center gap-1">
              <Layers size={13} aria-hidden="true" />{p.ilosc} szt</span>
            {p.powod && <span title="Powód zwrotu" className="inline-flex items-center gap-1">
              <CircleHelp size={13} aria-hidden="true" />{POWODY[p.powod] ?? p.powod}</span>}
            {p.ean && <span title="EAN" className="inline-flex items-center gap-1">
              <Barcode size={13} aria-hidden="true" /><span className="sr-only">EAN </span>
              <b className="font-mono font-normal text-slate-800">{p.ean}</b></span>}
            {p.sku && <span title="SKU oferty" className="inline-flex items-center gap-1">
              <Tag size={13} aria-hidden="true" /><span className="sr-only">SKU </span>
              <b className="font-mono font-normal text-slate-800">{p.sku}</b></span>}
            {/* Odnośnik JAWNY (0.153.0): ikona wyjścia i słowo „oferta", pełna
                nazwa w `aria-label`. Gdy adresu nie ma, ekran dalej to mówi —
                krótko, a całe zdanie w podpowiedzi. Milczenie wyglądałoby jak
                usterka panelu, a jest brakiem danych po stronie Allegro. */}
            {p.url
              ? <a href={p.url} target="_blank" rel="noopener noreferrer"
                  aria-label="Zobacz ofertę w Allegro" title="Zobacz ofertę w Allegro"
                  className="inline-flex items-center gap-1 font-semibold text-sky-700 underline underline-offset-2 hover:text-sky-900">
                  <ExternalLink size={13} aria-hidden="true" />oferta</a>
              : <span title="Allegro nie podało adresu oferty" className="text-slate-500">bez adresu oferty</span>}
          </div>
          {p.powodKomentarz && <p className="mt-1 text-xs italic text-slate-600">
            „{p.powodKomentarz}"</p>}
          {/* Kartoteka i rabat W JEDNYM RZĘDZIE znaczników (0.455.0). Rabat
              stoi przy POZYCJI, nie przy zwrocie: wniosek składa się na pozycję
              zamówienia, więc zwrot z dwiema pozycjami ma dwa osobne rabaty. */}
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <Kartoteka p={p} />
            <Rabat rabat={p.rabat} trwa={trwaRabat} blad={bladRabatu}
              onZglos={() => onZglosRabat?.(p.id)} />
          </div>

          {/* Ocena towaru: pytanie kubełka DO OCENY, zadane przy towarze,
              którego dotyczy. Zapisana ocena zostaje widoczna w każdym
              kubełku — to fakt o tej pozycji, nie stan ekranu. */}
          {ocenianie && !p.ocena && <div className="mt-2 flex flex-wrap gap-2">
            {OCENY.map(([klucz, klawisz, etykieta]) => {
              /* ── WYBÓR PUDŁA PRZY OCENIE (0.379.0) ─────────────────────
                 Decyzja właściciela, razem z odwróceniem zasady „jeden koszyk
                 na operatora": przy kilku otwartych pudłach ocena PYTA, do
                 którego. Zgadywanie „do najnowszego" byłoby tanie w kodzie
                 i drogie na hali — towar trafiałby do cudzego kartonu bez
                 jednego słowa na ekranie.

                 Pytamy JEDNYM klikiem, nie dwoma: przycisk rozwija się na tyle
                 przycisków, ile jest pudeł, z kodem na każdym. Osobne okienko
                 „do którego?" po naciśnięciu byłoby pytaniem po czynności —
                 tego zabrania dekalog.

                 Ocena „outlet" nie ma pudła i nie rozwija się nigdy. */
              const doPudla = klucz === "outlet" ? []
                : pudla.filter((k) => k.rodzaj === (klucz === "utylizacja" ? "odpad" : "zwroty"));
              if (doPudla.length > 1) {
                return doPudla.map((k) => (
                  <Przycisk key={`${klucz}-${k.id}`} className="text-xs" disabled={trwa}
                    onClick={() => onOcena(p.id, klucz, k.id)}>
                    {etykieta} → {k.kod}
                  </Przycisk>));
              }
              return (
                <Przycisk key={klucz} className="text-xs" disabled={trwa}
                  onClick={() => onOcena(p.id, klucz)}>
                  <kbd className="rounded border border-slate-300 px-1">{klawisz}</kbd> {etykieta}
                </Przycisk>);
            })}
          </div>}
          {p.ocena && <p className="mt-2 flex flex-wrap items-center gap-2 text-xs font-bold text-ranga-ok">
            <span>Ocena: {OCENY.find(([k]) => k === p.ocena)?.[2] ?? p.ocena}
              {p.ocena === "stan" && p.wKoszyku && <span className="ml-1 font-normal text-slate-500">
                · w koszyku zwrotów</span>}</span>
            {/* COFNIĘCIE ZAMIAST POTWIERDZENIA (§25a.5). Do 0.202.0 przyciski
                oceny znikały po pierwszym kliknięciu, więc pomyłkowa
                „Utylizacja" na złym wierszu była z ekranu nie do odkręcenia.
                Nie pokazujemy go tam, gdzie serwer i tak odmówi: zwrot
                zamknięty i odrzucony są poza pracą, a pozycja z zamkniętego
                koszyka dostanie zdanie z nazwą kosza dopiero po kliknięciu —
                bo tego panel z listy pozycji nie wie. */}
            {edytowalny && <button type="button" disabled={trwa}
              className="font-normal text-slate-500 underline underline-offset-2
                disabled:opacity-50"
              onClick={() => onOcena(p.id, null)}>cofnij ocenę</button>}</p>}
          {/* CICHA STRATA JEST TU NAJGORSZYM WYJŚCIEM (0.192.0). Ocena „na
              stan" dokłada pozycję do koszyka, czyli na dokument MM — ale MM
              przesuwa stany KARTOTEK, więc pozycja bez kartoteki wejść nie
              może. Ocena zapisuje się mimo to, bo jest faktem o towarze.
              Bez tego zdania karton pojechałby na halę z towarem, którego nie
              ma na żadnym papierze, a magazynier zobaczyłby to dopiero przy
              rozkładaniu. */}
          {p.ocena === "stan" && !p.wKoszyku && <p className="mt-1 text-xs font-semibold text-ranga-uwaga">
            {/* POWÓD PISZE SERWER (0.328.0). Do tego wydania stało tu jedno
                zdanie o braku kartoteki — jedyna wtedy przyczyna. Odkąd skład
                bierze się z paragonu, przyczyny są trzy i prowadzą w różne
                miejsca: brak kartoteki, brak dokumentu, dwie oferty bez
                kartoteki na jednym paragonie. */}
            Nie weszła do koszyka — {sklady[p.id]?.powod
              ?? "bez kartoteki nie ma czego wpisać na MM"}.</p>}
          {/* DROGA WYJŚCIA, nie samo zdanie o kłopocie (0.336.0). Zgłoszenie
              właściciela: „nie wiem, gdzie to wskazać". Automat odsyłał do
              ręcznej drogi, której nie było — teraz stoi tuż pod powodem,
              czyli tam, gdzie człowiek właśnie czyta. */}
          {p.ocena === "stan" && !p.wKoszyku && p.offerId && (skladamy === p.id
            ? <WskazSklad p={p} wiersze={wierszeDokumentu} zwrotId={zwrot.id}
                onKoniec={() => setSkladamy(null)} />
            : <button type="button" onClick={() => setSkladamy(p.id)}
                className="mt-1 text-xs text-slate-600 underline underline-offset-2
                  hover:text-slate-900">wskaż skład ręcznie</button>)}
          {/* KOMPLET ROZBITY NA PARAGONIE. Pokazujemy go tylko wtedy, gdy
              kartotek jest więcej niż jedna: przy zwykłym towarze wiersz
              powtarzałby nazwę stojącą linijkę wyżej. */}
          {(sklady[p.id]?.skladniki.length ?? 0) > 1 && (p.wKoszyku
            ? <Skladniki p={p} sklad={sklady[p.id]!} zwrotId={zwrot.id} />
            /* Zanim pozycja trafi do koszyka, skład jest PLANEM: mówimy, co
               wejdzie, ale nie dajemy ptaszka, bo nie ma czego zdjąć. */
            : <p className="mt-1 text-xs text-slate-500">
                Do koszyka z paragonu: {sklady[p.id]!.skladniki
                  .map((s) => `${s.symbol} × ${s.ilosc}`).join(", ")}
              </p>)}

          {/* Liczba sztuk pada PRZY ROZPAKOWANIU, czyli w kubełku DO OCENY —
              i tam ją proponujemy. Zapisaną widać wszędzie, bo po zamknięciu
              zwrotu to ona tłumaczy, czemu wypłata była niższa. */}
          {onIlosc && (ocenianie || wycena || p.iloscZwrocona != null) &&
            <IloscZwrocona p={p} trwa={trwa} blad={blad} tylkoOdczyt={!edytowalny}
              otworz={otworzIlosc?.id === p.id ? otworzIlosc.n : 0}
              onZapisz={(ile) => onIlosc(p.id, ile)} />}

          {/* Potrącenie proponuje się TAM, gdzie zapada decyzja o pieniądzach,
              czyli przy wycenie. Zapisane widać wszędzie, bo to fakt o pozycji
              — jak ocena hali. */}
          {onPotracenie && (wycena || p.potracenieGrosze != null) &&
            <Potracenie p={p} trwa={trwa} blad={blad} tylkoOdczyt={!edytowalny}
              otworz={otworzPotracenie?.id === p.id ? otworzPotracenie.n : 0}
              onZapisz={(g, powod) => onPotracenie(p.id, g, powod)} />}

          {/* Cofnięcie zamiast potwierdzenia (§25a.5). Tylko przy pozycji
              biura: zgłoszona przez klienta wróciłaby przy najbliższym
              takcie, więc przycisk obiecywałby skutek, którego nie ma. */}
          {onZdejmij && edytowalny && p.zrodlo === "biuro" && <button type="button" disabled={trwa}
            onClick={() => onZdejmij(p.id)}
            className="mt-1 text-xs text-slate-500 underline underline-offset-2
              hover:text-slate-800">zdejmij ze zwrotu</button>}
        </div>
      </li>)}
    </ul>

    {/* Pod listą, bo TAM operator zauważa różnicę: przelicza karton, patrzy
        na ekran i widzi o jedną pozycję mniej (dekalog ergonomii, punkt 1). */}
    {onDopisz && edytowalny && <Dopisz kandydaci={doDopisania} trwa={trwa} blad={bladDopisania}
      onDopisz={onDopisz} />}

    {wycena
      /* ZAZNACZENIE, nie wybór wariantu. Operator odhacza to, co oddaje,
         a suma rośnie na oczach. Wariant („pełna", „bez wysyłki") wylicza
         sobie z tego serwer — jest etykietą, a nie pozycją w menu.

         W tym kubełku podsumowanie NIE pokazuje sumy pozycji obok kwoty do
         oddania: dwie liczby o pieniądzach jedna nad drugą czytałoby się
         jako jedna, a myli się tę, która idzie do klienta. */
      ? <div className="mt-3 rounded-lg border border-slate-300 bg-white p-3">
          {dostawaGrosze != null && <label className="flex items-center gap-2 pb-2 text-sm">
            <input type="checkbox" className="h-4 w-4" checked={dostawa}
              onChange={() => setDostawa((d) => !d)} />
            <span className="mr-auto">Koszt dostawy</span>
            <span className="tabular-nums text-slate-600">
              {zlote(dostawaGrosze, zwrot.waluta)}</span>
          </label>}
          <div className="flex items-center gap-3 border-t border-slate-200 pt-2">
            <span className="text-xs font-bold uppercase text-slate-500">Do oddania</span>
            {/* Podgląd jest PODGLĄDEM. Do serwera idzie zaznaczenie, a sumę
                składa on sam (§25a.3) — inaczej dałoby się zapisać dowolną
                kwotę żądaniem z pominięciem tego ekranu. Od @wydanie mówi to
                podpowiedź przy sumie: zdanie pod nią było głosem programisty. */}
            <b data-testid="suma" className="mr-auto tabular-nums text-lg"
              title="Kwotę przelicza serwer z zaznaczenia; to podgląd.">
              {zlote(suma, zwrot.waluta)}</b>
            <Przycisk wariant="glowny" disabled={trwa}
              onClick={() => onKwota(wybrane, dostawa)}>
              <kbd className="rounded border border-black/20 px-1 text-xs">Enter</kbd> Zapisz kwotę
            </Przycisk>
          </div>
        </div>
      /* STOPKA ZNIKA, GDY KWOTA JEST USTALONA (@wydanie, §26d). Wtedy liczba,
         która idzie do klienta, stoi w „Pieniądzach" — dwie sumy obok niej
         czytało się jak trzecią wersję tej samej kwoty. */
      : zwrot.kwotaGrosze !== null ? null
      : <div className="mt-3 space-y-1 border-t border-slate-200 pt-2 text-sm">
          <div className="flex items-baseline justify-between">
            <span className="text-slate-500">Suma pozycji</span>
            <span className="tabular-nums">{zlote(zwrot.sumaPozycjiGrosze, zwrot.waluta)}</span>
          </div>
          {zwrot.kwotaPelnaGrosze === null
            /* Ekran mówi, czego NIE wie: koszt dostawy stoi przy zamówieniu,
               a tego jeszcze nie pobrano. */
            ? <p className="text-xs text-slate-500">
                Kwoty pełnej nie znamy bez zamówienia — koszt dostawy stoi przy nim.
                {/* Tylko z numerem: bez niego przycisku w dowodach nie ma (0.484.7). */}
                {zwrot.orderId && " Dociągnij je w kolumnie obok."}</p>
            : <div className="flex items-baseline justify-between">
                <span className="font-bold">Z dostawą</span>
                <span className="text-lg font-bold tabular-nums">
                  {zlote(zwrot.kwotaPelnaGrosze, zwrot.waluta)}</span>
              </div>}
        </div>}

    {/* Błąd oceny i kwoty ląduje TU, bo tu stoją ich przyciski. */}
    {(wycena || ocenianie) && blad && <div className="mt-3"><Blad>{blad}</Blad></div>}

  </div>;
}
