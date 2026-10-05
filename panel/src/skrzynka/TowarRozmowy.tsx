import React, { useLayoutEffect, useRef, useState } from "react";
import { Check, Database, PackageSearch, X as Krzyzyk } from "lucide-react";
import { NaglowekSekcji } from "../ui";
import type { DopasowanieKartoteki, KartaTowaru, OfertaRozmowy } from "../api/typy";
import { useKartaTowaru, useWskazKartoteke } from "../api/rozmowy";
import { BrakPolaczenia } from "../api/klient";
import { Wyszukiwarka, type Towar as TowarZWyszukiwarki } from "../wyszukiwarka";
import { Kafel } from "../towar/Kafel";
import { PrzyciskTowaru } from "../towar/Szuflada";
import { dlugi } from "./DlugiTekst";
import { ODNOSNIK_CICHY } from "./odnosniki";
import { CenyKartoteki } from "./OsCenKartoteki";

/* Ceny kartoteki mieszkają w `OsCenKartoteki.tsx` i `cenyNaOsi.ts`. Stąd idą
   dalej pod starymi nazwami, bo reklamacje (`reklamacje/Dowody.tsx`) i testy
   tego pliku importują je właśnie stąd. */
export { CenyKartoteki } from "./OsCenKartoteki";
export { grupujCeny, polozenieOferty } from "./cenyNaOsi";

/**
 * Towar z Subiekta przy rozmowie (0.179.0).
 *
 * SKU sprzedawcy leżało w `offer_snapshot` od 0.178.0 i nie prowadziło
 * donikąd: żeby sprawdzić stan i półkę, agent otwierał Subiekta — czyli robił
 * to, czego §25 zabrania („agent obsłuży typowe pytanie bez otwierania panelu
 * Allegro" ma ten sam sens co „bez otwierania Subiekta").
 *
 * Blok ma trzy stany i każdy każe co innego zrobić: powiązana kartoteka
 * (widać stan i półkę), propozycja z automatu (jedno kliknięcie), brak
 * z POWODEM (wiadomo, które ogniwo pękło i czy naprawi się samo).
 *
 * ── JEDNO TRAFIENIE PO SYGNATURZE TO POWIĄZANIE (0.219.0) ──────────────────
 * Do 0.218.0 kartoteka z SKU była propozycją i czekała na „Zatwierdź", choć
 * ten sam wynik zwroty wiązały same od 0.169.0. Właściciel zapytał, po co klikać, skoro sygnatura trafia
 * jeden do jednego — i zdecydował: łączyć automatycznie. Kliknięcie było
 * zapisem pamięci wskazań; patrzenie na stan i półkę niczego nie zapisuje,
 * więc nie ma za co brać opłaty w kliknięciach. Pamięć zostaje dla wskazań
 * ręcznych i obowiązuje, dopóki sprzedawca nie przepnie sygnatury
 * (`pamiecAktualna` na serwerze).
 *
 * ŹRÓDŁA SIĘ NIE MIESZAJĄ (§4.3). Wszystko pod nagłówkiem „Subiekt GT" jest
 * z Subiekta, a podpis przy kartotece mówi, czy stoi za nią SKU z Allegro,
 * czy decyzja człowieka.
 */
export function TowarRozmowy({ oferta, rozmowaId, skuPozycji = null }: {
  oferta: OfertaRozmowy;
  rozmowaId: number;
  /** SKU pozycji zamówienia tej oferty. Serwer bez treści oferty dopasowuje
   *  kartotekę właśnie po nim i pisze to samo zdanie „SKU oferty „X"". */
  skuPozycji?: string | null;
}) {
  const [szukam, setSzukam] = useState(false);
  const zapisz = useWskazKartoteke();
  const k = oferta.kartoteka;
  /* Powiązana: człowiek (pamięć wskazań) albo JEDNO trafienie po sygnaturze
     (0.219.0). Pozostałe stopnie pewności zostają propozycją z przyciskiem. */
  const potwierdzona = k.pewnosc === "pamiec" || k.pewnosc === "sku" ? k.twId : null;
  const karta = useKartaTowaru(potwierdzona);

  const ustaw = (twId: number | null) => zapisz.mutate(
    { id: rozmowaId, ofertaId: oferta.externalId, twId },
    { onSuccess: () => setSzukam(false) });

  /* ── JEDEN RAZ KAŻDY FAKT (23 września 2026) ──────────────────────────────
     Zrzut właściciela: „prawa kolumna jest wciąż chaotyczna". Nazwa towaru
     stała na ekranie trzy razy, symbol cztery, stan i półka dwa. Pasmo
     odpowiedzi nad kolumną (`PasmoOdpowiedzi.tsx`) mówi już „to jest",
     „mamy" i półkę — pod tym samym warunkiem, pod którym rysuje się ta sekcja:
     kartoteka potwierdzona i odczytana. Tu zostaje więc to, czego pasmo NIE
     mówi: zdjęcie z półki, proporcja wolne–zarezerwowane, identyfikatory,
     ceny i opis.

     ŹRÓDŁO I RUCH W NAGŁÓWKU. „SKU oferty…" i „wskaż inną kartotekę" stały
     każde w osobnym wierszu pod nazwą. Stoją teraz w linii nagłówka: źródło
     jest podpisem sekcji (§4.3), a zmiana kartoteki — jej jedynym ruchem.

     BEZ WŁASNEGO WCIĘCIA. Oddech daje treść wiersza „Oferta i towar", więc
     tekst stoi na tej samej osi co cała kolumna. Własne `p-4` dokładało drugie
     szesnaście pikseli i treść stała prawie dwa razy dalej od krawędzi. */
  return <div className="space-y-3">
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
      {/* Ten sam kształt, co „Oferta" i „Zamówienie" wyżej (0.249.0): trzy
          sekcje tej samej rangi miały trzy różne kształty, więc nie było jak
          odczytać, że stoją na jednym poziomie. */}
      <NaglowekSekcji ikona={<Database size={13} />}>Subiekt GT</NaglowekSekcji>
      {/* Puste `sku` w pamięci znaczy „wskazał człowiek". Zdanie pisze serwer,
          a panel skraca je tylko przy powiązaniu po SKU (`zrodloKartoteki`). */}
      {potwierdzona !== null && <span className="text-podpis text-slate-500" title={k.zrodlo}>
        {zrodloKartoteki(k, oferta.pobrana?.sku ?? skuPozycji)}</span>}
      {/* Powiązanie po sygnaturze nie ma czego zdjąć — wróciłoby przy
          następnym odczycie; właściwym ruchem jest wskazanie INNEJ kartoteki.
          Zdjąć da się WSKAZANIE człowieka (kasuje pamięć). */}
      {potwierdzona !== null && k.pewnosc === "sku" && !szukam && <button type="button"
        onClick={() => setSzukam(true)}
        className={`ml-auto text-podpis ${ODNOSNIK_CICHY}`}>
        wskaż inną kartotekę</button>}
      {potwierdzona !== null && k.pewnosc === "pamiec" && <button type="button" title="Zdejmij powiązanie"
        disabled={zapisz.isPending} onClick={() => ustaw(null)}
        className="ml-auto h-6 shrink-0 rounded p-0.5 text-slate-400 hover:bg-slate-200 hover:text-slate-700">
        <Krzyzyk size={14} />
      </button>}
    </div>

    {potwierdzona !== null
      ? <>
          {k.pewnosc === "sku" && szukam && <Wyszukiwarka wybrany={null} etykieta="Wskazana przez Ciebie"
            onWybierz={(t: TowarZWyszukiwarki | null) => t && ustaw(t.id)} />}
          <div className="flex items-start gap-3">
            <Kafel twId={potwierdzona} rozmiar={56} nazwa={karta.data?.name ?? k.symbol ?? ""}
              symbol={k.symbol} />
            <div className="min-w-0 flex-1">
              {karta.isLoading && <p className="text-xs text-slate-500">Wczytuję stan z Subiekta…</p>}
              {/* Brak połączenia ogłasza raz pasek pod nagłówkiem (`Polaczenie.tsx`),
                  a pasmo nad kolumną mówi przy nim „nie wiemy". Trzeci, czerwony
                  zapis tej samej awarii tutaj byłby sprzeczny z nimi. */}
              {karta.error && !(karta.error instanceof BrakPolaczenia)
                && <p className="text-xs text-ranga-zle">{(karta.error as Error).message}</p>}
              {/* Wejście do przekroju towaru — `towar/Szuflada.tsx`. Błękit, bo to
                  praca w panelu, jak każdy taki ruch w kolumnie (`odnosniki.tsx`). */}
              {karta.data && <PrzyciskTowaru twId={potwierdzona} className="text-xs font-semibold text-sky-700 hover:text-sky-900">
                przekrój towaru</PrzyciskTowaru>}
              {karta.data && <StanTowaru karta={karta.data} />}
            </div>
          </div>
          {karta.data && <>
            {/* OPIS PRZED CENAMI: w opisie stoją wymiary i gwinty, czyli
                odpowiedzi na najczęstsze pytania. Przy 1366 px wchodzi wtedy
                do pierwszego kadru, a ceny i tak mają swoją oś niżej. */}
            <OpisKartoteki desc={karta.data.desc} />
            <CenyKartoteki ceny={karta.data.ceny ?? []} ramka={false}
              oferta={oferta.pobrana?.cenaGrosze != null
                ? { grosze: oferta.pobrana.cenaGrosze, waluta: oferta.pobrana.waluta ?? "PLN" } : null} />
            {/* Wstawki do szkicu tu NIE MA — stoi w paśmie odpowiedzi nad
                kolumną. Dwoje drzwi do jednego pola to usterka. */}
          </>}
        </>
      : <div className="text-xs">
          {k.twId !== null
            /* Propozycja nie udaje faktu — mówi, skąd się wzięła, i czeka na
               zatwierdzenie (§4.3, §11.3).

               Zdjęcie przy PROPOZYCJI (0.203.0). Do 0.202.0 kafel dostawała
               wyłącznie kartoteka potwierdzona — czyli ta, przy której nikt
               już niczego nie rozstrzyga. Propozycja automatu jest dokładnie
               tym miejscem, gdzie człowiek decyduje, i decydował po samym
               symbolu: „FTC272" nie mówi, czy to podkładka, czy szarpak.
               Zdjęcie zamienia zatwierdzenie w spojrzenie. */
            ? <div className="flex gap-3 rounded-lg border border-amber-300 bg-amber-50 p-2">
                <Kafel twId={k.twId} rozmiar={56} nazwa={k.symbol ?? "Propozycja kartoteki"}
                  symbol={k.symbol} />
                <div className="min-w-0 flex-1 text-amber-900">
                  <p>Propozycja: <b className="font-mono text-sm">{k.symbol}</b></p>
                  <p className="mt-0.5 text-slate-500">{k.zrodlo}</p>
                  <button type="button" disabled={zapisz.isPending} onClick={() => ustaw(k.twId)}
                    className="mt-1.5 inline-flex items-center gap-1 rounded bg-emerald-700 px-2 py-0.5 font-bold text-white hover:bg-emerald-800 disabled:opacity-50">
                    <Check size={12} />Zatwierdź</button>
                </div>
              </div>
            /* POWÓD, nie samo „bez kartoteki": „oferty jeszcze nie pobrano"
               naprawi się samo w kilka minut, a „oferta bez SKU" nigdy. */
            : <p className="flex items-start gap-2 text-slate-500">
                <PackageSearch size={14} className="mt-0.5 shrink-0" />
                <span>Bez kartoteki · <span className="text-slate-600">{k.zrodlo}</span></span>
              </p>}

          {szukam
            ? <div className="mt-2">
                <Wyszukiwarka wybrany={null} etykieta="Wskazana przez Ciebie"
                  onWybierz={(t: TowarZWyszukiwarki | null) => t && ustaw(t.id)} />
              </div>
            : <button type="button" onClick={() => setSzukam(true)}
                className={`mt-2 block ${ODNOSNIK_CICHY}`}>
                wskaż kartotekę</button>}
        </div>}

    {zapisz.error && <p className="text-xs text-ranga-zle">{(zapisz.error as Error).message}</p>}
  </div>;
}

/**
 * Podpis źródła kartoteki (§4.3).
 *
 * BEZ DRUGIEGO SKU. Przy powiązaniu po sygnaturze serwer pisze „SKU oferty
 * „X"", a to samo X stoi w karcie zakupu, a przy zamówieniu także w paśmie
 * przy „Zamówił". Podpis
 * mówi wtedy samą regułę, a pełne zdanie zostaje w dymku. Zdanie z czymkolwiek
 * więcej, np. z dopiskiem o zmienionej sygnaturze, stoi w całości, bo dopisek
 * jest ostrzeżeniem, a nie powtórzeniem. Nieznany kształt zdania też.
 */
export function zrodloKartoteki(k: Pick<DopasowanieKartoteki, "pewnosc" | "zrodlo">,
  sku: string | null | undefined): string {
  const s = sku?.trim();
  if (k.pewnosc !== "sku" || !s) return k.zrodlo;
  const reszta = k.zrodlo.replace(s, "").replace(/[„”"]/g, "").trim();
  return reszta === "SKU oferty" ? "SKU oferty = symbol kartoteki" : k.zrodlo;
}

/**
 * Stan magazynowy. „Dostępny" stoi OSOBNO od stanu, bo to on odpowiada na
 * pytanie klienta — stan bez odjętych rezerwacji obiecuje towar, który jest
 * już czyjś.
 */
/**
 * Opis kartoteki z Subiekta (0.198.0).
 *
 * Pole `desc` jechało w odpowiedzi `/api/products/:twId` od dawna i panel NIE
 * pokazywał go nigdzie. A to w nim ta firma trzyma wymiary, gwinty, rozstawy
 * i sekcje „Modele:" — czyli odpowiedzi na pytania, które klienci zadają
 * najczęściej. Właściciel przysłał zrzut, na którym klient prosi o wymiar
 * gwintu korka; opis kartoteki stał wtedy w pobranych danych, niewidoczny.
 *
 * ZWINIĘTY DO SZEŚCIU LINII, bo opisy bywają na pół ekranu, a kolumna niesie
 * też stan i półkę. Rozwinięcie jest jednym kliknięciem i nie idzie po sieć.
 *
 * BEZ PRZYCISKU „wstaw do szkicu" i to jest decyzja: szkic idzie DO KLIENTA,
 * a opis to wolny tekst, w którym bywa notatka dla magazynu. Agent może
 * skopiować zdanie, które przeczytał — ale nie wyśle całości jednym kliknięciem,
 * nie wiedząc, co w niej stoi.
 */
function OpisKartoteki({ desc }: { desc?: string }) {
  const [calosc, setCalosc] = useState(false);
  /* `null` znaczy „nie zmierzono": element bez wysokości (jsdom, ukryty
     rodzic) nie mówi nic o obcięciu. */
  const [przyciete, setPrzyciete] = useState<boolean | null>(null);
  const ref = useRef<HTMLParagraphElement>(null);
  const tresc = (desc ?? "").trim();
  /* OBCIĘCIE MIERZY PRZEGLĄDARKA. Sam próg znaków przepuszczał opis krótszy
     od progu, który i tak nie mieścił się w sześciu liniach: zawinięta
     pierwsza linia zjadała szóstą, a wielokropek urywał moment dokręcenia
     śruby bez niczego do kliknięcia. W wąskiej kolumnie to częsty przypadek,
     a szerokość kolumny zmienia się z oknem, więc pomiar idzie też po niej. */
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || calosc) return;
    const zmierz = () => {
      if (el.clientHeight > 0) setPrzyciete(el.scrollHeight > el.clientHeight + 1);
    };
    zmierz();
    if (typeof ResizeObserver === "undefined") return;
    const obserwator = new ResizeObserver(zmierz);
    obserwator.observe(el);
    return () => obserwator.disconnect();
  }, [tresc, calosc]);
  if (!tresc) return null;

  /* Przełącznik stoi tylko wtedy, gdy jest co rozwijać. Bez pomiaru
     rozstrzyga próg znaków i linii wspólny z osią rozmowy (`dlugi`).
     Przełącznik stoi w linii nagłówka, więc nie dokłada wysokości bloku. */
  const pokazPrzelacznik = calosc || (przyciete ?? dlugi(tresc));
  /* Pismo nie większe od tytułu wiersza: opis jest treścią bloku, a nie
     nagłówkiem nad nim, więc stoi w tym samym rozmiarze co reszta kolumny.
     Sześć linii, a nie osiem, bo domyślna skala Tailwinda kończy się na
     sześciu, a `line-clamp-8` nie powstałoby w arkuszu i opis jechałby CAŁY. */
  return <div>
    <div className="mb-1 flex items-baseline gap-2">
      <NaglowekSekcji jako="p">Opis kartoteki</NaglowekSekcji>
      {pokazPrzelacznik && <button type="button" aria-expanded={calosc} onClick={() => setCalosc((c) => !c)}
        className={`ml-auto text-xs ${ODNOSNIK_CICHY}`}>
        {calosc ? "zwiń opis" : "pokaż cały opis"}</button>}
    </div>
    <p ref={ref} className={`whitespace-pre-wrap text-sm text-slate-700 ${calosc ? "" : "line-clamp-6"}`}>
      {tresc}</p>
  </div>;
}

function StanTowaru({ karta }: { karta: KartaTowaru }) {
  /* Stan, rezerwacje, dostępny i lokalizacja wyszły z tej listy do nagłówka
     bloku — zostają fakty do WYSZUKANIA, nie do decyzji. */
  const pozostale: Array<[string, string]> = [
    ["EAN", karta.ean || "brak"],
    /* Identyfikatory z opisu (E3): to, po czym klient pyta, gdy nie zna naszego symbolu. */
    ["Identyfikatory", karta.identyfikatory?.length ? karta.identyfikatory.map((i) => i.wartosc).join(" · ") : "brak"],
    /* Zamienniki z opisu odpowiadają na „czy macie coś zamiast”, więc stoją
       naszymi symbolami. Obce tylko jako licznik — to szary tekst dla
       rozmowy z dostawcą, nie klikalna lista. */
    ["Zamienniki", karta.zamienniki?.znane.length
      ? karta.zamienniki.znane.map((z) => z.sym).join(" · ")
        + (karta.zamienniki.obce.length ? ` (+${karta.zamienniki.obce.length} numery obce w opisie)` : "")
      : karta.zamienniki?.obce.length ? `brak naszych; ${karta.zamienniki.obce.length} numery obce w opisie` : "brak"],
  ];
  const braki = pozostale.filter(([, w]) => w === "brak").map(([nazwa]) => (nazwa === "EAN" ? nazwa : nazwa.toLowerCase()));
  /* ── ODPOWIEDŹ WYCHODZI PRZED DANE (0.249.0) ────────────────────────────────
     Osiem wierszy stało w jednej wadze 12 px, a dwa z nich są odpowiedzią na
     pytanie, po które agent w ogóle otwiera tę kolumnę: CZY MAMY i GDZIE.
     „Identyfikatory brak" ważyło tyle samo co „Dostępny 1 szt." — a jedno jest
     decyzją, drugie zapasową ścieżką wyszukiwania.

     `Dostępny` staje się liczbą, którą widać z drugiego końca biurka, bo to
     ona rozstrzyga, czy odpowiedź brzmi „wysyłamy dziś". Lokalizacja stoi
     obok, bo pytanie „gdzie" pada zaraz po „czy". `Stan` i `Rezerwacje`
     schodzą pod spód drobnym drukiem: one tę liczbę TŁUMACZĄ, nie zastępują.

     Reszta zostaje w całości — §4.3 nie pozwala chować faktów — ale wartości
     „brak" gasną. Brak identyfikatorów jest normą, a norma nie ma prawa
     wyglądać jak ustalenie. */
  /* ── LICZBA I PÓŁKA STOJĄ W PAŚMIE (23 września 2026) ──────────────────────
     Od 0.249.0 „Dostępny" był tu liczbą widoczną z drugiego końca biurka,
     a od 0.404.0 ta sama liczba i ta sama półka stoją w paśmie odpowiedzi nad
     zakładkami. Dwa razy to samo w jednej kolumnie to był chaos ze zrzutu
     właściciela. Zostaje pasek: pasmo mówi „ile", pasek — ile z tego jest
     już czyjeś. */
  return <div>
    {/* ── STAN JAKO PASEK (23 września 2026, „za dużo tekstu") ─────────────
        „stan 342 · rezerwacje 6" było drugim zdaniem o tej samej liczbie.
        Pasek pokazuje proporcję jednym spojrzeniem: zieleń to wolne, bursztyn
        to zarezerwowane. Obie liczby stoją w dymku i dla czytnika ekranu,
        bo §4.3 nie pozwala chować faktów — wolno je wyciszyć. */}
    <PasekStanu stan={karta.mag.stan} wolne={karta.mag.avail} rezerwacje={karta.mag.rez} />

    <div className="mt-2 space-y-1">
      {pozostale.filter(([, w]) => w !== "brak").map(([nazwa, wartosc]) =>
        <div key={nazwa} className="flex items-baseline gap-2 text-xs">
          <span className="w-24 shrink-0 text-slate-500">{nazwa}</span>
          {/* `min-w-0` i łamanie słów: przy kolumnie 256 px EAN wychodził
              poza krawędź i kolumna przewijała się w bok. */}
          <span className="min-w-0 break-words font-semibold text-slate-900">{wartosc}</span>
        </div>)}
      {/* BRAK JEDNĄ LINIĄ, NIE WIERSZAMI. Trzy wiersze „brak" zajmowały tyle
          miejsca co wartości. Fakt „tego nie mamy" zostaje, znika obrys, który
          ważył jak ustalenie. Nazwy małą literą, bo to ciąg zdania, a „EAN"
          jest skrótem i zostaje wersalikami. */}
      {braki.length > 0 && <p className="pt-0.5 text-podpis text-slate-500">brak: {braki.join(" · ")}</p>}
      {karta.magazyny.length > 0 && <p className="pt-0.5 text-podpis text-slate-500">
        Inne magazyny: {karta.magazyny.map((m) => `${m.kod} ${m.stan}`).join(" · ")}
      </p>}
    </div>
  </div>;
}

/**
 * Wolne i zarezerwowane jako jeden pasek (23 września 2026).
 *
 * Szerokości liczą się od STANU, nie od sumy wolnych i rezerwacji: Subiekt
 * bywa niespójny (rezerwacje ponad stan), a pasek dłuższy niż sto procent
 * kłamałby geometrią. Stan zero rysuje pusty tor — „nie ma" też jest odpowiedzią.
 */
export function PasekStanu({ stan, wolne, rezerwacje }: { stan: number; wolne: number; rezerwacje: number }) {
  const baza = Math.max(stan, wolne + rezerwacje, 0);
  const proc = (x: number) => (baza > 0 ? Math.max(0, Math.min(100, (x / baza) * 100)) : 0);
  const zdanie = `stan ${stan}: ${Math.max(0, wolne)} wolnych, ${rezerwacje} w rezerwacji`;
  return <div title={zdanie} className="mt-1">
    <div aria-hidden="true" className="flex h-2 overflow-hidden rounded-full bg-slate-200">
      <span className="bg-emerald-600" style={{ width: `${proc(wolne)}%` }} />
      <span className="bg-amber-500" style={{ width: `${proc(rezerwacje)}%` }} />
    </div>
    <span className="sr-only">{zdanie}</span>
  </div>;
}
