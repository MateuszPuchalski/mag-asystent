import React, { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { EtykietaWartosci, NaglowekSekcji } from "../ui";
import type { CenaPoziomu } from "../api/typy";
import { zlote } from "../api/zwroty";
import { ODNOSNIK_CICHY } from "./odnosniki";
import { zapamietaj, zapamietane } from "./Zwijka";
import {
  GEOMETRIA as G, brakBrutto, grupujCeny, kwota, nazwaGrupy, poKolejnosciOsi, polozenieOferty, trafienie,
  ulozOsCen, wspolneMiejsce, type Mierz, type PunktOsi, type UkladNaOsi,
} from "./cenyNaOsi";

/* ── CENY KARTOTEKI NA JEDNEJ OSI ───────────────────────────────────────────
   Zgłoszenie właściciela: blok „Ceny" zajmuje za dużo miejsca. Lista
   poziomów, oś z kropkami i zdanie mówiły trzy razy to samo, a blok sześciu
   poziomów miał prawie dwieście pikseli. Zostaje jedna oś z podpisami.

   POŁOŻENIE NA WSPÓLNEJ SKALI. To zadanie, które oko rozwiązuje najdokładniej
   (Cleveland i McGill), więc oferta stoi na tej samej osi co poziomy. Skala
   nie zaczyna się od zera, bo zero nic tu nie mówi; prawdziwą proporcję mówi
   zdanie pod osią.

   BEZ BIBLIOTEKI WYKRESÓW. Skala to jedna linijka, a rozkład etykiet to nasza
   reguła (`cenyNaOsi.ts`): żadna biblioteka nie wie, że podpis nie może
   zasłonić cudzej kropki. Rysunek to czyste SVG i HTML.

   OFERTA BEZ KWOTY. Kwota oferty ma dom w karcie zakupu (§10.2g,
   `JedenDom.test.tsx`). Tu niesie ją dymek pierścienia i nazwa figury dla
   czytnika ekranu, a etykieta mówi samo „oferta".

   OGONEK WSKAZUJE STRONĘ WŁASNEJ ETYKIETY. Krótka kreska od kropki do podpisu
   rozstrzyga, czyj jest napis, gdy cudza kropka stoi pod nim. Detaliczna stoi
   tuż pod osią, bo to kwota czytana najczęściej, a agent uczy się miejsca.

   KOLEJNOŚĆ WEDŁUG CENY, bo tak działa skala. Kolejność Subiekta trzyma
   tabela pod „pokaż tabelę z netto", każdy poziom osobno. Panel pamięta ten
   wybór na stanowisku, jak zwinięcie w `Zwijka`: to nawyk agenta, nie
   decyzja na jedną rozmowę.

   BEZ OFERTY LISTA. Reklamacje i rozmowa bez pobranej oferty dostają
   dotychczasową listę, bo oś bez oferty nie ma o co pytać.

   PIERŚCIEŃ W AMBER-600, bo obiekt graficzny potrzebuje 3:1 na bieli
   (WCAG 1.4.11), a amber-500 daje 2,15:1. Bursztyn zostaje znacznikiem,
   nie tłem.

   DYMEK. Ma `aria-hidden`, bo powtarza tekst, który czytnik dostał już
   w etykiecie. Zasłania zdanie, więc musi dać się na niego najechać
   i zamknąć Escape z dowolnego miejsca (WCAG 1.4.13). Fokus z kliknięcia
   go nie pokazuje: klik w kwotę to zaznaczanie do przepisania, a dymek
   przypięty kliknięciem zasłaniałby zdanie, aż agent kliknie gdzie indziej.

   MIARA. Etykiety mierzy kanwa krojem panelu, ale dopiero po załadowaniu
   kroju; wcześniej zmierzyłaby krój zastępczy. jsdom kanwy nie ma, więc
   testy dostają szacunek i sprawdzają niezmienniki, nie piksele. Gdy napis
   i tak wyjdzie poza policzone miejsce (większe pismo przeglądarki), blok
   staje listą: lista, nie nachodzące napisy.                              */

type Oferta = { grosze: number; waluta: string };

/**
 * Ceny z kartoteki Subiekta.
 *
 * Zgłoszenie właściciela: „nie widzę cen z Subiekta przy towarach". Kolumna
 * mówiła CZY MAMY i GDZIE, a na pytanie „ile to kosztuje" — padające w tej
 * samej rozmowie — agent musiał otwierać Subiekta. To dokładnie ta czynność,
 * której §25 zabrania.
 *
 * Rozjazd jest jeden: z ceną oferty blok staje osią, bez niej zostaje listą.
 * O trybie decyduje to, czy jest z czym porównać, a nie szerokość kolumny.
 */
export function CenyKartoteki({ ceny, ramka = true, oferta = null }: {
  ceny: CenaPoziomu[];
  /* `false` w skrzynce: tam ceny stoją W sekcji „Subiekt GT", więc ramka
     i drugi podpis źródła byłyby pudełkiem w pudełku. Reklamacje stawiają
     blok samodzielnie i ramkę zostawiają. */
  ramka?: boolean;
  /** Cena oferty rozmowy — wtedy blok staje osią. Reklamacje jej nie podają. */
  oferta?: Oferta | null;
}) {
  /* PUSTY BLOK NIE RYSUJE SIĘ WCALE: brak danych nie jest informacją
     wartą kolumny. Na produkcji blok milczy,
     dopóki import nie dostanie nazw cennika i nowego GRANT-u
     (`tools/sonda-cen.sql`). */
  if (ceny.length === 0) return null;
  const naOsi = oferta !== null && polozenieOferty(ceny, oferta) !== null;
  /* W skrzynce bez klasy: odstęp od bloku wyżej daje rodzic, a kreski
     wewnątrz bloku kolumna nie ma. Reklamacje zostawiają ramkę. */
  return <div className={ramka ? "rounded-lg border border-slate-200 p-3" : undefined}>
    {naOsi && oferta
      ? <OsCenKartoteki ceny={ceny} oferta={oferta} ramka={ramka} />
      : <>
          <NaglowekCen ramka={ramka} tresc="Ceny" />
          <ListaCen ceny={ceny} />
        </>}
  </div>;
}

/** Nagłówek bloku. Z ramką podpisuje też źródło, bo blok stoi poza sekcją „Subiekt GT". */
function NaglowekCen({ ramka, tresc }: { ramka: boolean; tresc: string }) {
  return ramka
    ? <EtykietaWartosci className="block">{`${tresc} · Subiekt GT`}</EtykietaWartosci>
    : <NaglowekSekcji jako="p">{tresc}</NaglowekSekcji>;
}

/**
 * Lista poziomów: bez oferty i wtedy, gdy etykiet nie da się ułożyć na osi.
 *
 * WSZYSTKIE POZIOMY, w kolejności Subiekta — decyzja właściciela. Sortowanie
 * po kwocie przestawiałoby wiersze przy każdej przecenie, a agent uczy się
 * miejsca, nie liczby.
 *
 * BRUTTO GRUBE, NETTO SZARE OBOK. Klient detaliczny pyta o brutto i tę kwotę
 * agent przepisuje; netto potrzebne jest firmie proszącej o fakturę i wtedy
 * ma być pod ręką, a nie do policzenia w głowie.
 */
function ListaCen({ ceny }: { ceny: CenaPoziomu[] }) {
  return <ul className="mt-1 space-y-0.5">
    {grupujCeny(ceny).map(({ cena: c, nazwy }) => <li key={c.poziom}
      className="flex items-baseline gap-2 text-xs">
      {/* Nazwa poziomu, a gdy baza jej nie trzyma — sam numer. Wymyślona
          nazwa byłaby gorsza od numeru: agent uwierzyłby, że to detaliczna.
          Grupa kilku poziomów mówi liczbę, a nazwy stoją w dymku. */}
      <span className="min-w-0 flex-1 truncate text-slate-600" title={nazwy.join(", ")}>
        {nazwaGrupy(nazwy)}</span>
      {/* ── ZERO TO BRAK, NIE CENA ─────────────────────────────────────────
          Poziom zakupu (numer 0) nie ma u nas ceny brutto — Subiekt trzyma
          tam parę „netto 18,64 / brutto 0,00". Wiersz z `0,00 PLN` grubym
          drukiem wyciszałby jedyną prawdziwą liczbę jako „netto", a przy
          triażu reklamacji właśnie ta liczba rozstrzyga.

          Bez ceny brutto GŁÓWNĄ liczbą zostaje netto, a podpis mówi wprost,
          czego Subiekt nie prowadzi. `rozwinCeny` poziomu z dwoma zerami
          nie wpuszcza wcale, więc ten przypadek to zawsze jedna strona
          pary — czyli dane do obejrzenia przez człowieka. */}
      {brakBrutto(c)
        ? <>
            <b className="shrink-0 tabular-nums text-slate-900">
              {zlote(c.nettoGrosze, c.waluta)}</b>
            <span className="shrink-0 text-slate-500">netto · bez ceny brutto</span>
          </>
        : <>
            <b className="shrink-0 tabular-nums text-slate-900">
              {zlote(c.bruttoGrosze, c.waluta)}</b>
            <span className="shrink-0 tabular-nums text-slate-500">
              netto {zlote(c.nettoGrosze, c.waluta)}</span>
          </>}
    </li>)}
  </ul>;
}

/* Treść najczęstszej kolumny: 384 px minus dwie kreski ramy i dwa wcięcia
   po 16 px. Bierzemy ją, gdy element nie ma jeszcze szerokości: jsdom albo
   ukryty rodzic. Prawdziwą szerokość dowiezie obserwator, gdy rodzic się
   pokaże; z paskiem przewijania kolumny wyjdzie jeszcze około 15 px mniej. */
const ZAPASOWA_SZEROKOSC = 350;

/* Pamięć przełącznika tabeli: nawyk stanowiska, jak `Zwijka pamietajJako`.
   Agent od faktur otwiera tabelę raz. To pamięć przeglądarki, nie zapis na
   serwerze, więc „zero zapisu przy patrzeniu" zostaje. */
const KLUCZ_TABELI = "wertis.skrzynka.ceny.tabela";

/** Szerokość treści przed malowaniem i po każdej zmianie kolumny (256, 384, 448 px). */
function useSzerokosc(ref: React.RefObject<HTMLDivElement | null>): number | null {
  const [szerokosc, setSzerokosc] = useState<number | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const zmierz = () => setSzerokosc(el.clientWidth > 0 ? el.clientWidth : ZAPASOWA_SZEROKOSC);
    zmierz();
    if (typeof ResizeObserver === "undefined") return;
    const obserwator = new ResizeObserver(zmierz);
    obserwator.observe(el);
    return () => obserwator.disconnect();
  }, [ref]);
  return szerokosc;
}

/* Licznik załadowań kroju. Kanwa mierzy Barlow dopiero, gdy krój dojechał;
   wcześniej zmierzyłaby krój zastępczy i etykiety dostałyby złe szerokości.
   `loadingdone` łapie też grubą odmianę, która ładuje się dopiero, gdy
   pierwsza kwota stanie na ekranie. Gdy krój już jest, `ready` i tak się
   rozwiązuje, a drugie liczenie wiązki niczego by nie zmieniło. */
function useWersjaKroju(): number {
  const [wersja, setWersja] = useState(0);
  useEffect(() => {
    const fonty = typeof document === "undefined" ? undefined : document.fonts;
    if (!fonty) return;
    let zywy = true;
    const przelicz = () => { if (zywy) setWersja((n) => n + 1); };
    if (fonty.status !== "loaded") fonty.ready.then(przelicz, () => {});
    fonty.addEventListener?.("loadingdone", przelicz);
    return () => {
      zywy = false;
      fonty.removeEventListener?.("loadingdone", przelicz);
    };
  }, []);
  return wersja;
}

/* Kanwa leniwa i jedna na moduł. W jsdom jej nie tworzymy: jsdom kanwy nie
   ma, a każde `getContext` pisze błąd do konsoli testu. */
let kanwa: CanvasRenderingContext2D | null | undefined;
function kontekstKanwy(): CanvasRenderingContext2D | null {
  if (kanwa !== undefined) return kanwa;
  if (typeof document === "undefined" || /jsdom/i.test(navigator.userAgent)) return (kanwa = null);
  try { kanwa = document.createElement("canvas").getContext("2d"); } catch { kanwa = null; }
  return kanwa;
}

/** Szerokość napisu w pikselach; bez kanwy szacunek, który testy przyjmują jako atrapę. */
function mierzTekst(tekst: string, waga: 400 | 700, rozmiar: 11 | 12, kroj: string): number {
  const k = kontekstKanwy();
  if (!k || !kroj) return tekst.length * rozmiar * (waga === 700 ? 0.6 : 0.55);
  k.font = `${waga} ${rozmiar}px ${kroj}`;
  return k.measureText(tekst).width;
}

function OsCenKartoteki({ ceny, oferta, ramka }: { ceny: CenaPoziomu[]; oferta: Oferta; ramka: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const W = useSzerokosc(ref);
  const kroj = useWersjaKroju();
  const { grosze, waluta } = oferta;
  /* Zależność od kwoty i waluty, nie od obiektu oferty: skrzynka składa ten
     obiekt przy każdym renderze, a układ liczy się wiązką stanów. `kroj`
     tylko wyzwala przeliczenie po załadowaniu kroju. */
  const u = useMemo(() => {
    if (W === null) return null;
    const krojPisma = ref.current ? getComputedStyle(ref.current).fontFamily : "";
    const mierz: Mierz = (t, w, r) => mierzTekst(t, w, r, krojPisma);
    return ulozOsCen(ceny, { grosze, waluta }, W, mierz);
  }, [ceny, grosze, waluta, W, kroj]);
  const [otwarta, setOtwarta] = useState(() => zapamietane(KLUCZ_TABELI) ?? false);
  const idTabeli = useId();
  /* Układ, którego etykiety przeglądarka narysowała szerzej, niż je
     policzono. Pamiętamy sam układ, więc nowa szerokość albo krój dostaje
     świeżą próbę na osi. */
  const [przelany, setPrzelany] = useState<UkladNaOsi | null>(null);

  /* Pierwszy render nie ma jeszcze szerokości. Pomiar staje w efekcie
     układu, przed malowaniem, więc ten pusty element nigdy nie mignie. */
  if (u === null) return <div ref={ref} />;
  const naOsi = u.tryb === "os" && u !== przelany ? u : null;

  const przelacz = () => {
    const nowe = !otwarta;
    setOtwarta(nowe);
    zapamietaj(KLUCZ_TABELI, nowe);
  };
  /* Ten sam tekst co przy dawnej osi: kwotę oferty czytnik słyszy w nazwie
     figury, bo etykieta oferty jej nie powtarza. */
  const nazwaFigury = `Cena oferty ${zlote(grosze, waluta)} na tle poziomów kartoteki`;

  return <div ref={ref}>
    <div className="flex flex-wrap items-baseline gap-x-2">
      <NaglowekCen ramka={ramka} tresc={naOsi ? `Ceny brutto · ${naOsi.waluta}` : "Ceny"} />
      {/* Przełącznik w idiomie „pokaż cały opis": cichy, w linii nagłówka,
          więc nie dokłada wysokości. W trybie listy go nie ma, bo lista
          niesie netto sama. */}
      {naOsi && <button type="button" aria-expanded={otwarta} aria-controls={idTabeli} onClick={przelacz}
        className={`ml-auto -my-1 py-1 text-xs ${ODNOSNIK_CICHY}`}>
        {otwarta ? "zwiń tabelę" : "pokaż tabelę z netto"}</button>}
    </div>
    {!naOsi
      ? <figure aria-label={nazwaFigury}>
          <ListaCen ceny={ceny} />
          <figcaption className="mt-1 text-xs text-slate-700">{u.polozenie?.zdanie}</figcaption>
        </figure>
      : <>
          <WykresOsi u={naOsi} nazwaFigury={nazwaFigury} onPrzelew={() => setPrzelany(naOsi)} />
          {/* Poziom bez ceny brutto nie wchodzi na oś brutto. Stoi wierszem
              z netto pogrubionym, bo to jedyna prawdziwa liczba, i na końcu,
              bo poziom zakupu to nie cena dla klienta. */}
          {naOsi.pozaOsia.map(({ cena: c, nazwy }) => <p key={c.poziom} className="mt-0.5 text-podpis text-slate-600">
            {nazwaGrupy(nazwy)} · {brakBrutto(c)
              ? <><b className="text-xs text-slate-900">{zlote(c.nettoGrosze, c.waluta)}</b> netto · bez ceny brutto</>
              : <><b className="text-xs text-slate-900">{zlote(c.bruttoGrosze, c.waluta)}</b> brutto · inna waluta niż oferta</>}
          </p>)}
          <TabelaCen ceny={ceny} id={idTabeli} otwarta={otwarta} waluta={naOsi.waluta} />
        </>}
  </div>;
}

/* Poziom bliżej oferty niż promień jej otoczki plus własna kropka. Jego
   kropka i ogonek rysują się NAD pierścieniem: inaczej biała otoczka oferty
   zjadłaby je, a etykieta tego poziomu wisiałaby pod pustym pierścieniem,
   jakby to on był jej znacznikiem. */
const PROG_PIERSCIENIA = G.R_OFERTA + G.GRUBOSC_OFERTY / 2 + 2 + G.R_POZIOM;

function WykresOsi({ u, nazwaFigury, onPrzelew }: { u: UkladNaOsi; nazwaFigury: string; onPrzelew: () => void }) {
  const [kursor, setKursor] = useState<string | null>(null);
  const [fokus, setFokus] = useState<string | null>(null);
  const [zamkniety, setZamkniety] = useState(false);
  /* Wędrujący tabindex: cały wykres to jeden przystanek tabulatora, a po
     etykietach chodzą strzałki. Pełny dostęp bez strzałek daje tabela. */
  const [przystanek, setPrzystanek] = useState("oferta");
  const etykiety = useRef(new Map<string, HTMLLIElement>());
  const wykres = useRef<HTMLDivElement>(null);
  /* Fokus z kliknięcia. Etykieta z tabindeksem bierze fokus także od myszy,
     a klik w kwotę to zaznaczanie do przepisania, nie wejście w wykres.
     Taki fokus nie pokazuje dymka i nie zabiera strzałek kolejce. Gaśnie,
     gdy fokus wyjdzie z wykresu, więc powrót tabulatorem znów jest z klawiatury. */
  const zMyszy = useRef(false);

  const porzadek = poKolejnosciOsi(u.etykiety);
  const aktywne = zamkniety ? null : (kursor ?? fokus);
  /* Oferta i poziom w jej pierścieniu to jedno miejsce, więc świecą razem. */
  const miejsce = wspolneMiejsce(u, aktywne);
  const wMiejscu = new Set(miejsce.map((p) => p.id));
  const stoi = porzadek.some((e) => e.punkt.id === przystanek) ? przystanek : "oferta";
  const punktAktywny = u.punkty.find((p) => p.id === aktywne);
  const dymekWidac = punktAktywny !== undefined && miejsce.length > 0;

  /* Napis szerszy od policzonego miejsca (większe pismo przeglądarki, inny
     krój niż ten, który zmierzyła kanwa) wchodziłby na sąsiada. Wtedy blok
     staje listą, zanim cokolwiek się namaluje. */
  useLayoutEffect(() => {
    for (const li of etykiety.current.values()) {
      if (li.scrollWidth > li.clientWidth || li.scrollHeight > li.clientHeight) { onPrzelew(); return; }
    }
  }, [u]); // raz na układ: `onPrzelew` rodzic składa przy każdym renderze

  /* Dymek zasłania zdanie, więc Escape chowa go z każdego miejsca, także
     z pola odpowiedzi (WCAG 1.4.13). Zatrzymujemy klawisz tylko wtedy, gdy
     coś schował. Fokus, który wychodzi poza wykres, też chowa dymek: inaczej
     mógłby zasłonić element, na który agent właśnie przeszedł. */
  useEffect(() => {
    if (!dymekWidac) return;
    const klawisz = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      e.preventDefault();
      e.stopPropagation();
      setZamkniety(true);
    };
    const fokusGdzieIndziej = (e: FocusEvent) => {
      if (!wykres.current?.contains(e.target as Node)) setZamkniety(true);
    };
    document.addEventListener("keydown", klawisz);
    document.addEventListener("focusin", fokusGdzieIndziej);
    return () => {
      document.removeEventListener("keydown", klawisz);
      document.removeEventListener("focusin", fokusGdzieIndziej);
    };
  }, [dymekWidac]);

  const oferta = u.punkty.find((p) => p.rodzaj === "oferta") as PunktOsi;
  const osY = u.osY;
  const xs = u.punkty.map((p) => p.x);
  const xPoziomu = (g: number) => u.punkty.find((p) => p.grosze === g)?.x ?? 0;
  const zx0 = xPoziomu(u.zakres.od), zx1 = xPoziomu(u.zakres.do);
  const R_PIERSCIEN = G.R_OFERTA + G.GRUBOSC_OFERTY / 2;
  const odOferty = (p: PunktOsi) => Math.abs(p.x - oferta.x);
  /* Poziom o cenie oferty siedzi w pierścieniu jak tarcza, więc jego ogonek
     zaczyna się od brzegu pierścienia, nie od kropki. */
  const wPierscieniu = (p: PunktOsi) => p.rodzaj === "poziom" && odOferty(p) < 1.5;
  const promien = (p: PunktOsi) => (p.rodzaj === "oferta" || wPierscieniu(p) ? R_PIERSCIEN : G.R_POZIOM);
  const poziomy = u.punkty.filter((p) => p.rodzaj === "poziom");
  const daleko = poziomy.filter((p) => odOferty(p) >= PROG_PIERSCIENIA);
  const blisko = poziomy.filter((p) => odOferty(p) < PROG_PIERSCIENIA);
  const otoczka = (p: PunktOsi) => <circle key={`otoczka-${p.id}`} cx={p.x} cy={osY} r={G.R_POZIOM + 2}
    className="fill-white" />;
  const kropka = (p: PunktOsi) => <circle key={`kropka-${p.id}`} data-znacznik={p.id} cx={p.x} cy={osY}
    r={wMiejscu.has(p.id) ? G.R_POZIOM + 1 : G.R_POZIOM}
    className={wMiejscu.has(p.id) ? "fill-slate-700" : "fill-slate-500"} />;

  const tekstDlaCzytnika = (p: PunktOsi) => (p.rodzaj === "oferta"
    ? `, ${u.polozenie.krotko}`
    : ` ${u.waluta} brutto, netto ${zlote(p.netto, u.waluta)}${p.nazwy.length > 1 ? ` (${p.nazwy.join(", ")})` : ""}`);

  /* Klawisze obsłużone tutaj nie idą dalej. Kolejka skrzynki słucha strzałek
     na `window` i bez tego strzałka w wykresie przerzucałaby rozmowę spod
     ręki agenta. Po kliknięciu myszą strzałki zostają kolejki, jak przy
     zwykłym tekście. Escape obsługuje nasłuch dymka wyżej. */
  const naKlawisz = (e: React.KeyboardEvent<HTMLUListElement>) => {
    if (zMyszy.current) return;
    const ids = porzadek.map((x) => x.punkt.id);
    const i = ids.indexOf((e.target as HTMLElement).dataset.id ?? "");
    let n: number;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") n = Math.min(i + 1, ids.length - 1);
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") n = Math.max(i - 1, 0);
    else if (e.key === "Home") n = 0;
    else if (e.key === "End") n = ids.length - 1;
    else return;
    e.preventDefault();
    e.stopPropagation();
    etykiety.current.get(ids[n])?.focus();
  };

  return <figure aria-label={nazwaFigury}>
    {/* Celem wskaźnika jest CAŁY pas wykresu, nie kropka 8 px. Dymek siedzi
        w tym samym elemencie, więc kursor przesunięty na dymek go nie gasi.
        Nad dymkiem treść stoi w miejscu, a nowy cel pokazuje go po Escape. */}
    <div ref={wykres} className="relative mt-0.5" style={{ height: u.wysokosc }}
      onPointerMove={(e) => {
        if ((e.target as Element).closest("[data-dymek]")) return;
        const r = e.currentTarget.getBoundingClientRect();
        const cel = trafienie(u, e.clientX - r.left, e.clientY - r.top);
        if (cel === kursor) return;
        setKursor(cel);
        setZamkniety(false);
      }}
      onPointerLeave={() => setKursor(null)}>
      {/* Kolejność malowania jest częścią rysunku. Białe otoczki leżą pod
          znacznikami i ogonkami, bo inaczej zjadają je sąsiadom. Kropka
          poziomu tuż przy ofercie leży nad pierścieniem, a ogonki na samym
          wierzchu, więc żaden nie ginie pod cudzą bielą. */}
      <svg aria-hidden="true" width={u.szerokosc} height={u.wysokosc} className="absolute left-0 top-0 overflow-visible">
        <line x1={Math.min(...xs)} x2={Math.max(...xs)} y1={osY} y2={osY} className="stroke-slate-300"
          strokeWidth={1} shapeRendering="crispEdges" />
        {/* Pasek zakresu kartoteki: oferta poza cennikiem siedzi na gołej
            osi za jego końcem, więc rozjazd widać bez czytania liczb. */}
        {zx1 - zx0 > 0.5 && <line x1={zx0} x2={zx1} y1={osY} y2={osY} className="stroke-slate-300"
          strokeWidth={4} strokeLinecap="round" />}
        <circle cx={oferta.x} cy={osY} r={R_PIERSCIEN + 2} className="fill-white" />
        {/* Daleko od oferty otoczka i kropka idą parami. Otoczka następnej
            wcina się w poprzednią kropkę, więc dwie bliskie ceny to dwie
            kropki, a nie jedna plama. */}
        {daleko.map((p) => [otoczka(p), kropka(p)])}
        {blisko.filter((p) => !wPierscieniu(p)).map(otoczka)}
        <circle data-znacznik="oferta" cx={oferta.x} cy={osY} r={G.R_OFERTA} className="fill-white stroke-amber-600"
          strokeWidth={wMiejscu.has(oferta.id) ? G.GRUBOSC_OFERTY + 1 : G.GRUBOSC_OFERTY} />
        {blisko.map(kropka)}
        {/* Ogonek: od brzegu znacznika do etykiety, w barwie znacznika.
            Wskazuje stronę, po której stoi JEGO etykieta, więc cudzy znacznik
            pod etykietą nie myli — jego ogonek idzie w drugą stronę. */}
        {u.etykiety.map((e) => {
          const x = Math.round(e.punkt.x) + 0.5;
          const r = promien(e.punkt);
          const [y1, y2] = e.strona < 0 ? [e.gora + e.wys, osY - r] : [osY + r, e.gora];
          return <line key={`ogonek-${e.punkt.id}`} data-ogonek={e.punkt.id} x1={x} x2={x} y1={y1} y2={y2}
            strokeWidth={1} className={e.punkt.rodzaj === "oferta" ? "stroke-amber-600" : "stroke-slate-500"} />;
        })}
      </svg>
      <ul aria-label="Ceny brutto na osi, od najniższej" onKeyDown={naKlawisz}
        onPointerDown={() => { zMyszy.current = true; setFokus(null); }}
        onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) zMyszy.current = false; }}>
        {porzadek.map((e) => {
          const p = e.punkt;
          /* Tło `slate-100`, nie `slate-50` (Gramatyka), a nazwa `slate-600`,
             nie `slate-500`, bo ta para na `slate-100` nie ma 4,5:1. */
          return <li key={p.id} data-id={p.id} tabIndex={p.id === stoi ? 0 : -1}
            ref={(el) => { if (el) etykiety.current.set(p.id, el); else etykiety.current.delete(p.id); }}
            onFocus={() => {
              setPrzystanek(p.id);
              if (zMyszy.current) return;
              setFokus(p.id);
              setZamkniety(false);
            }}
            onBlur={() => setFokus(null)}
            style={{ left: e.lewo, top: e.gora, width: e.szer, height: e.wys }}
            className={`absolute flex whitespace-nowrap rounded px-0.5 text-podpis leading-none text-slate-600 ${
              u.linie === 2 ? "h-7 flex-col items-center justify-center gap-0.5" : "h-3.5 items-center"} ${
              wMiejscu.has(p.id) ? "bg-slate-100" : ""}`}>
            <span>{p.nazwa}</span>
            {p.kwota && <span className={`text-xs font-bold leading-none text-slate-900 ${u.linie === 1 ? "ml-1" : ""}`}>
              {p.kwota}</span>}
            <span className="sr-only">{tekstDlaCzytnika(p)}</span>
          </li>;
        })}
      </ul>
      {dymekWidac && punktAktywny && <DymekOsi punkty={miejsce} x={punktAktywny.x} szerokosc={u.szerokosc}
        wysokosc={u.wysokosc} waluta={u.waluta} krotko={u.polozenie.krotko} onZamknij={() => setZamkniety(true)} />}
    </div>
    <figcaption className="mt-1 text-xs text-slate-700">{u.polozenie.zdanie}</figcaption>
  </figure>;
}

/** Pionowy pas, który widać: okno przycięte przez każdego przodka, który przycina treść (przewijak kolumny). */
function widocznyPas(el: HTMLElement): { gora: number; dol: number } {
  let gora = 0, dol = window.innerHeight;
  for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
    if (getComputedStyle(p).overflowY === "visible") continue;
    const r = p.getBoundingClientRect();
    if (r.height === 0) continue;
    gora = Math.max(gora, r.top);
    dol = Math.min(dol, r.bottom);
  }
  return { gora, dol };
}

/**
 * Dymek stoi NA zdaniu pod osią: zdanie na chwilę jest zbędne, a etykieta
 * i znacznik zostają widoczne. Gdy pod wykresem nie ma miejsca (dół
 * przewijanej kolumny), staje nad nim, na nagłówku bloku, zamiast dać się
 * przyciąć. Wartość prowadzi, podpis idzie za nią. Treść idzie przez JSX,
 * więc nazwy z Subiekta są tekstem, nie HTML-em.
 */
function DymekOsi({ punkty, x, szerokosc, wysokosc, waluta, krotko, onZamknij }: {
  punkty: PunktOsi[]; x: number; szerokosc: number; wysokosc: number; waluta: string; krotko: string;
  onZamknij: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [polozenie, setPolozenie] = useState({ lewo: 0, nad: false });
  const tresc = punkty.map((p) => p.id).join("|");
  /* Rozmiar dymka zna dopiero przeglądarka, więc miejsce dociskamy po
     pomiarze, przed malowaniem: wyśrodkowany na znaczniku, ale w bloku.
     Szerokość nie zależy od położenia (`w-max` do szerokości bloku), więc
     jeden pomiar wystarcza. */
  useLayoutEffect(() => {
    const el = ref.current;
    const kotwica = el?.parentElement;
    if (!el || !kotwica) return;
    const { width: w, height: h } = el.getBoundingClientRect();
    const k = kotwica.getBoundingClientRect();
    const { gora, dol } = widocznyPas(kotwica);
    const miesciPod = k.top + wysokosc + h <= dol + 0.5;
    const miesciNad = k.top - h >= gora - 0.5;
    const nad = !miesciPod && (miesciNad || k.top - gora > dol - (k.top + wysokosc));
    setPolozenie({ lewo: Math.max(0, Math.min(szerokosc - w, x - w / 2)), nad });
  }, [tresc, x, szerokosc, wysokosc]);
  /* Pas 4 px między wykresem a dymkiem należy do dymka (`pt-1`/`pb-1`), żeby
     kursor w drodze na dymek nie wychodził z wykresu. Klik w dymek go
     chowa: pod nim bywa przycisk, do którego agent właśnie jechał. */
  return <div ref={ref} aria-hidden="true" data-dymek="" onClick={onZamknij}
    style={{ left: polozenie.lewo, maxWidth: szerokosc, ...(polozenie.nad ? { bottom: wysokosc } : { top: wysokosc }) }}
    className={`absolute z-10 w-max ${polozenie.nad ? "pb-1" : "pt-1"}`}>
    <div className="space-y-1 rounded-md bg-white px-2 py-1 text-podpis text-slate-600 shadow-lg ring-1 ring-slate-200">
      {punkty.map((q) => q.rodzaj === "oferta"
        ? <div key={q.id}>
            <div className="whitespace-nowrap"><span className="mr-1 inline-block h-2.5 w-2.5 rounded-full border-2 border-amber-600" />
              <b className="text-xs text-slate-900">{zlote(q.grosze, waluta)}</b> oferta Allegro</div>
            <div>{krotko}</div>
          </div>
        : <div key={q.id}>
            <div className="whitespace-nowrap"><span className="mr-1 inline-block h-2 w-2 rounded-full bg-slate-500" />
              <b className="text-xs text-slate-900">{zlote(q.grosze, waluta)}</b> brutto</div>
            <div>netto {zlote(q.netto, waluta)} · {q.nazwy.join(", ")}</div>
          </div>)}
    </div>
  </div>;
}

/**
 * Tabela: bliźniak wykresu. Każdy poziom osobno, w kolejności Subiekta,
 * bo tu agent szuka konkretnego poziomu, a nie porównuje. Bez wiersza
 * oferty — jej kwota ma dom w karcie zakupu. Poziom bez brutto ma „brak"
 * i pogrubione netto: zero to brak, nie cena.
 */
function TabelaCen({ ceny, id, otwarta, waluta }: { ceny: CenaPoziomu[]; id: string; otwarta: boolean; waluta: string }) {
  /* Walutę mówi nagłówek bloku. Poziom w innej walucie dostaje ją przy
     kwocie, bo goła liczba pod „Ceny brutto · PLN" czytałaby się jak złote. */
  const wKolumnie = (g: number, w: string) => (w === waluta ? kwota(g) : `${kwota(g)} ${w}`);
  return <table id={id} hidden={!otwarta} className="mt-1.5 w-full text-xs">
    <caption className="sr-only">Ceny kartoteki w kolejności Subiekta</caption>
    <thead><tr>{["Poziom", "Brutto", "Netto"].map((t, i) => <th key={t} scope="col"
      className={`pb-0.5 text-podpis font-normal text-slate-500 ${i ? "text-right" : "text-left"}`}>{t}</th>)}</tr></thead>
    <tbody>{ceny.map((c) => <tr key={c.poziom}>
      <th scope="row" className="py-px text-left font-normal text-slate-600">{c.nazwa || `poziom ${c.poziom}`}</th>
      <td className={`pl-3 text-right tabular-nums ${brakBrutto(c) ? "text-slate-500" : "font-bold text-slate-900"}`}>
        {brakBrutto(c) ? "brak" : wKolumnie(c.bruttoGrosze as number, c.waluta)}</td>
      <td className={`pl-3 text-right tabular-nums ${brakBrutto(c) ? "font-bold text-slate-900" : "text-slate-600"}`}>
        {c.nettoGrosze == null ? "—" : wKolumnie(c.nettoGrosze, c.waluta)}</td>
    </tr>)}</tbody>
  </table>;
}
