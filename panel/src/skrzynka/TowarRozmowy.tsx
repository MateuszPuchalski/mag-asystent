import React, { useState } from "react";
import { Check, Database, PackageSearch, X as Krzyzyk } from "lucide-react";
import { EtykietaWartosci, NaglowekSekcji, odmien } from "../ui";
import type { CenaPoziomu, KartaTowaru, OfertaRozmowy, PasowaniaTowaru } from "../api/typy";
import { zlote } from "../api/zwroty";
import { useKartaTowaru, useWskazKartoteke } from "../api/rozmowy";
import { useWiedzaTowaru } from "../api/wiedza";
import { Wyszukiwarka, type Towar as TowarZWyszukiwarki } from "../wyszukiwarka";
import { Kafel } from "../towar/Kafel";
import { PrzyciskTowaru } from "../towar/Szuflada";

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
 * ten sam wynik dobór brał za kandydata bez klikania, a zwroty wiązały go
 * same od 0.169.0. Właściciel zapytał, po co klikać, skoro sygnatura trafia
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
export function TowarRozmowy({ oferta, rozmowaId }: {
  oferta: OfertaRozmowy;
  rozmowaId: number;
}) {
  const [szukam, setSzukam] = useState(false);
  const zapisz = useWskazKartoteke();
  const k = oferta.kartoteka;
  /* Powiązana: człowiek (pamięć wskazań) albo JEDNO trafienie po sygnaturze
     (0.219.0). Pozostałe stopnie pewności zostają propozycją z przyciskiem. */
  const potwierdzona = k.pewnosc === "pamiec" || k.pewnosc === "sku" ? k.twId : null;
  const karta = useKartaTowaru(potwierdzona);
  /* Wiedza pyta o KAŻDĄ znaną kartotekę, także propozycję: „3 potwierdzone,
     1 negatywne" to argument za kliknięciem albo przeciw niemu. */
  const wiedza = useWiedzaTowaru(k.twId);

  const ustaw = (twId: number | null) => zapisz.mutate(
    { id: rozmowaId, ofertaId: oferta.externalId, twId },
    { onSuccess: () => setSzukam(false) });

  /* ── JEDEN RAZ KAŻDY FAKT (23 września 2026) ──────────────────────────────
     Zrzut właściciela: „prawa kolumna jest wciąż chaotyczna". Nazwa towaru
     stała na ekranie trzy razy, symbol cztery, stan i półka dwa. Pasmo
     odpowiedzi nad zakładkami (`PasmoOdpowiedzi.tsx`) mówi już „to jest",
     „mamy" i półkę — pod tym samym warunkiem, pod którym rysuje się ta sekcja:
     kartoteka potwierdzona i odczytana. Tu zostaje więc to, czego pasmo NIE
     mówi: zdjęcie z półki, proporcja wolne–zarezerwowane, identyfikatory,
     ceny i opis.

     ŹRÓDŁO I RUCH W NAGŁÓWKU. „SKU oferty…" i „wskaż inną kartotekę" stały
     każde w osobnym wierszu pod nazwą. Stoją teraz w linii nagłówka: źródło
     jest podpisem sekcji (§4.3), a zmiana kartoteki — jej jedynym ruchem. */
  return <div className="space-y-3 p-4">
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
      {/* Ten sam kształt, co „Oferta" i „Zamówienie" wyżej (0.249.0): trzy
          sekcje tej samej rangi miały trzy różne kształty, więc nie było jak
          odczytać, że stoją na jednym poziomie. */}
      <NaglowekSekcji ikona={<Database size={13} />}>Subiekt GT</NaglowekSekcji>
      {/* Puste `sku` w pamięci znaczy „wskazał człowiek". Serwer pisze to
          zdanie; panel go nie układa drugi raz. */}
      {potwierdzona !== null && <span className="text-podpis text-slate-500">{k.zrodlo}</span>}
      {/* OSOBNA plakietka: §4.3 nie miesza źródeł, a to jest nasza baza
          wiedzy, nie dane z ERP. */}
      {wiedza.data && (wiedza.data.potwierdzone.length > 0 || wiedza.data.negatywne.length > 0) &&
        <span className="rounded border border-emerald-300 bg-emerald-50 px-1.5 py-0.5 text-podpis font-bold uppercase tracking-wide text-emerald-800">
          Wiedza: {wiedza.data.potwierdzone.length} potwierdzonych · {wiedza.data.negatywne.length} negatywnych
        </span>}
      {/* Powiązanie po sygnaturze nie ma czego zdjąć — wróciłoby przy
          następnym odczycie; właściwym ruchem jest wskazanie INNEJ kartoteki.
          Zdjąć da się WSKAZANIE człowieka (kasuje pamięć). */}
      {potwierdzona !== null && k.pewnosc === "sku" && !szukam && <button type="button"
        onClick={() => setSzukam(true)}
        className="ml-auto text-podpis text-slate-500 underline underline-offset-2 hover:text-slate-800">
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
              {karta.error && <p className="text-xs text-red-700">{(karta.error as Error).message}</p>}
              {/* Wejście do przekroju towaru (@wydanie) — `towar/Szuflada.tsx`. */}
              {karta.data && <PrzyciskTowaru twId={potwierdzona} className="text-xs font-semibold text-sky-800">
                przekrój towaru</PrzyciskTowaru>}
              {karta.data && <StanTowaru karta={karta.data} />}
            </div>
          </div>
          {karta.data && <>
            <CenyKartoteki ceny={karta.data.ceny ?? []} ramka={false}
              oferta={oferta.pobrana?.cenaGrosze != null
                ? { grosze: oferta.pobrana.cenaGrosze, waluta: oferta.pobrana.waluta ?? "PLN" } : null} />
            {/* WYŁĄCZNIE ODCZYT — sekcja jest „Źródło: Subiekt GT" (§4.3 nie
                miesza źródeł), a wiedza stoi tu jako osobna plakietka.
                Dopisuje się w Doborze albo w Wiedza → Sprawdź kartotekę. */}
            {wiedza.data?.pasowania && <PasowaniaKartoteki dane={wiedza.data.pasowania} />}
            <OpisKartoteki desc={karta.data.desc} />
            {/* Wstawki do szkicu tu NIE MA od 0.404.0 — stoi w paśmie
                odpowiedzi nad zakładkami. Dwoje drzwi do jednego pola to
                usterka, którą tamto wydanie naprawiło. */}
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
                    className="mt-1.5 inline-flex items-center gap-1 rounded bg-emerald-600 px-2 py-0.5 font-bold text-white hover:bg-emerald-700 disabled:opacity-50">
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
                className="mt-2 block text-slate-500 underline underline-offset-2 hover:text-slate-800">
                wskaż kartotekę</button>}
        </div>}

    {zapisz.error && <p className="text-xs text-red-700">{(zapisz.error as Error).message}</p>}
  </div>;
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
  const tresc = (desc ?? "").trim();
  if (!tresc) return null;

  return <div className="border-t border-slate-200 pt-3">
    <NaglowekSekcji jako="p" className="mb-1">Opis kartoteki</NaglowekSekcji>
    <p className={`whitespace-pre-wrap text-tresc text-slate-700 ${calosc ? "" : "line-clamp-6"}`}>
      {tresc}</p>
    {/* Przycisk tylko wtedy, gdy jest co rozwijać. Linii nie liczymy w kodzie
        — `line-clamp` robi to w przeglądarce. Sześć, a nie osiem, bo domyślna
        skala Tailwinda kończy się na sześciu, a `line-clamp-8` nie powstałoby
        w arkuszu i opis jechałby CAŁY. */}
    {tresc.length > 320 && <button type="button" onClick={() => setCalosc((c) => !c)}
      className="mt-1 text-xs text-slate-500 underline underline-offset-2 hover:text-slate-800">
      {calosc ? "zwiń opis" : "pokaż cały opis"}</button>}
  </div>;
}

function StanTowaru({ karta }: { karta: KartaTowaru }) {
  /* Stan, rezerwacje, dostępny i lokalizacja wyszły z tej listy do nagłówka
     bloku — zostają fakty do WYSZUKANIA, nie do decyzji. */
  const pozostale: Array<[string, string]> = [
    ["EAN", karta.ean || "brak"],
    /* Identyfikatory z opisu (E3): to, po czym klient pyta, gdy nie zna naszego symbolu. */
    ["Identyfikatory", karta.identyfikatory?.length ? karta.identyfikatory.map((i) => i.wartosc).join(" · ") : "brak"],
    /* Zamienniki JEDZIŁY w JSON-ie od dawna i rysował je tylko kolektor. Bez
       nich agent widzi kandydata „przez zamiennik EX055" i nie ma jak
       sprawdzić, skąd ten EX055. Obce tylko jako licznik — to szary tekst dla
       rozmowy z dostawcą, nie klikalna lista. */
    ["Zamienniki", karta.zamienniki?.znane.length
      ? karta.zamienniki.znane.map((z) => z.sym).join(" · ")
        + (karta.zamienniki.obce.length ? ` (+${karta.zamienniki.obce.length} numery obce w opisie)` : "")
      : karta.zamienniki?.obce.length ? `brak naszych; ${karta.zamienniki.obce.length} numery obce w opisie` : "brak"],
  ];
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
          <span className="font-semibold text-slate-900">{wartosc}</span>
        </div>)}
      {/* BRAK JAKO OBRYS, NIE WIERSZ (23 września 2026). Trzy wiersze „brak"
          zajmowały tyle miejsca co wartości. Zostają przerywane plakietki
          z nazwą — fakt „tego nie mamy" widać, ale nie waży jak ustalenie. */}
      {pozostale.some(([, w]) => w === "brak") && <div className="flex flex-wrap gap-1.5 pt-0.5">
        {pozostale.filter(([, w]) => w === "brak").map(([nazwa]) =>
          <span key={nazwa} title={`${nazwa}: brak`}
            className="rounded-full border border-dashed border-slate-300 px-2 py-0.5 text-podpis text-slate-600">
            {nazwa}<span className="sr-only">: brak</span></span>)}
      </div>}
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

/**
 * Poziomy o TEJ SAMEJ parze brutto–netto sklejone w jeden wiersz (23 września 2026).
 *
 * Zrzut właściciela: sześć poziomów, pięć z nich co do grosza równych. Agent
 * czytał sześć wierszy, żeby dowiedzieć się jednej ceny. Kolejność grup to
 * kolejność Subiekta — decyzja z 0.396.0 zostaje: wiersz stoi tam, gdzie
 * pierwszy poziom tej ceny.
 */
export function grupujCeny(ceny: CenaPoziomu[]): Array<{ cena: CenaPoziomu; nazwy: string[] }> {
  const grupy = new Map<string, { cena: CenaPoziomu; nazwy: string[] }>();
  for (const c of ceny) {
    const klucz = `${c.bruttoGrosze ?? "-"}|${c.nettoGrosze ?? "-"}|${c.waluta}`;
    const nazwa = c.nazwa || `poziom ${c.poziom}`;
    const g = grupy.get(klucz);
    if (g) g.nazwy.push(nazwa); else grupy.set(klucz, { cena: c, nazwy: [nazwa] });
  }
  return [...grupy.values()];
}

/**
 * Ceny z kartoteki Subiekta (0.396.0).
 *
 * Zgłoszenie właściciela: „nie widzę cen z Subiekta przy towarach". Kolumna
 * mówiła CZY MAMY i GDZIE, a na pytanie „ile to kosztuje" — padające w tej
 * samej rozmowie — agent musiał otwierać Subiekta. To dokładnie ta czynność,
 * której §25 zabrania.
 *
 * WSZYSTKIE POZIOMY, w kolejności Subiekta — decyzja właściciela. Sortowanie
 * po kwocie przestawiałoby wiersze przy każdej przecenie, a agent uczy się
 * miejsca, nie liczby.
 *
 * BRUTTO GRUBE, NETTO SZARE OBOK. Klient detaliczny pyta o brutto i tę kwotę
 * agent przepisuje; netto potrzebne jest firmie proszącej o fakturę i wtedy
 * ma być pod ręką, a nie do policzenia w głowie.
 *
 * PUSTY BLOK NIE RYSUJE SIĘ WCALE — ta sama zasada, co przy pasowaniach:
 * brak wiedzy nie jest informacją wartą kolumny. Na produkcji blok milczy,
 * dopóki import nie dostanie nazw cennika i nowego GRANT-u (`tools/sonda-cen.sql`).
 */
/**
 * Czy ten poziom NIE MA ceny brutto — `null` albo zero (0.412.0).
 *
 * Zero jest tu brakiem, nie kwotą: cennik zakupowy Subiekta wypełnia wyłącznie
 * kolumnę netto, a druga strona pary zostaje zerem. Podanie tego zera jako
 * ceny znaczyłoby „za darmo".
 */
function brakBrutto(c: CenaPoziomu): boolean {
  return c.bruttoGrosze === null || c.bruttoGrosze === 0;
}

/* ── CENY NA JEDNEJ OSI (0.498.0, D z kanwy „prawa kolumna") ────────────────
   Nagranie właściciela: oferta sprzedawała nóż za 45,00 zł, a detaliczna
   w kartotece to 29,06 zł — o 55% mniej. Tabela sześciu cen tego nie mówiła,
   bo cena oferty stała trzy sekcje wyżej, a porównanie trzeba było zrobić
   w głowie. Położenie na wspólnej skali to zadanie, które oko rozwiązuje
   najdokładniej (Cleveland i McGill, 1984), więc oferta staje na tej samej
   osi co poziomy kartoteki.

   Która cena jest nieaktualna, oś NIE rozstrzyga — mówi tylko, że się
   rozjechały. Rozstrzyga człowiek w Allegro albo w Subiekcie. */

/** Gdzie cena oferty stoi wobec poziomów brutto kartoteki; `null`, gdy nie ma czego porównać. */
export function polozenieOferty(ceny: CenaPoziomu[], oferta: { grosze: number; waluta: string }):
  { min: number; max: number; zdanie: string } | null {
  const brutto = ceny.filter((c) => !brakBrutto(c) && c.waluta === oferta.waluta)
    .map((c) => ({ grosze: c.bruttoGrosze as number, nazwa: c.nazwa || `poziom ${c.poziom}` }));
  if (brutto.length === 0) return null;
  const najnizszy = brutto.reduce((a, b) => (b.grosze < a.grosze ? b : a));
  const najwyzszy = brutto.reduce((a, b) => (b.grosze > a.grosze ? b : a));
  const o = zlote(oferta.grosze, oferta.waluta);
  const zdanie = oferta.grosze > najwyzszy.grosze
    ? `Oferta ${o} stoi ${Math.round((oferta.grosze / najwyzszy.grosze - 1) * 100)}% nad najwyższym poziomem (${najwyzszy.nazwa} ${zlote(najwyzszy.grosze, oferta.waluta)}).`
    : oferta.grosze < najnizszy.grosze
      ? `Oferta ${o} stoi ${Math.round((1 - oferta.grosze / najnizszy.grosze) * 100)}% pod najniższym poziomem (${najnizszy.nazwa} ${zlote(najnizszy.grosze, oferta.waluta)}).`
      : `Oferta ${o} mieści się między poziomami kartoteki.`;
  return { min: Math.min(najnizszy.grosze, oferta.grosze), max: Math.max(najwyzszy.grosze, oferta.grosze), zdanie };
}

function OsCen({ ceny, oferta }: { ceny: CenaPoziomu[]; oferta: { grosze: number; waluta: string } }) {
  const p = polozenieOferty(ceny, oferta);
  if (!p) return null;
  const rozpietosc = Math.max(1, p.max - p.min);
  /* Margines 4% z obu stron, żeby skrajna kropka nie wisiała na krawędzi. */
  const x = (g: number) => `${4 + ((g - p.min) / rozpietosc) * 92}%`;
  const poziomy = grupujCeny(ceny).filter(({ cena: c }) => !brakBrutto(c) && c.waluta === oferta.waluta);
  return <figure className="mt-2" aria-label="Cena oferty na tle poziomów kartoteki">
    <div className="relative h-6" aria-hidden>
      <div className="absolute inset-x-0 top-1/2 h-px bg-slate-300" />
      {poziomy.map(({ cena: c, nazwy }) => <span key={c.poziom} title={`${nazwy.join(", ")} · ${zlote(c.bruttoGrosze, c.waluta)}`}
        className="absolute top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-slate-500"
        style={{ left: x(c.bruttoGrosze as number) }} />)}
      <span title={`oferta · ${zlote(oferta.grosze, oferta.waluta)}`}
        className="absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-amber-500"
        style={{ left: x(oferta.grosze) }} />
    </div>
    <div className="flex justify-between text-podpis tabular-nums text-slate-600" aria-hidden>
      <span>{zlote(p.min, oferta.waluta)}</span><span>{zlote(p.max, oferta.waluta)}</span>
    </div>
    <figcaption className="mt-1 text-xs text-slate-700">{p.zdanie}</figcaption>
  </figure>;
}

export function CenyKartoteki({ ceny, ramka = true, oferta = null }: {
  ceny: CenaPoziomu[];
  /* `false` w skrzynce (23 września 2026): tam ceny stoją W sekcji „Subiekt
     GT", więc ramka i drugi podpis źródła byłyby pudełkiem w pudełku.
     Reklamacje stawiają blok samodzielnie i ramkę zostawiają. */
  ramka?: boolean;
  /** Cena oferty rozmowy — wtedy pod listą staje oś (0.498.0). Reklamacje jej nie podają. */
  oferta?: { grosze: number; waluta: string } | null;
}) {
  if (ceny.length === 0) return null;
  return <div className={ramka ? "rounded-lg border border-slate-200 p-3" : "border-t border-slate-200 pt-3"}>
    {ramka
      ? <EtykietaWartosci className="block">Ceny · Subiekt GT</EtykietaWartosci>
      : <NaglowekSekcji jako="p">Ceny</NaglowekSekcji>}
    <ul className="mt-1 space-y-0.5">
      {grupujCeny(ceny).map(({ cena: c, nazwy }) => <li key={c.poziom}
        className="flex items-baseline gap-2 text-xs">
        {/* Nazwa poziomu, a gdy baza jej nie trzyma — sam numer. Wymyślona
            nazwa byłaby gorsza od numeru: agent uwierzyłby, że to detaliczna.
            Grupa kilku poziomów mówi liczbę, a nazwy stoją w dymku. */}
        <span className="min-w-0 flex-1 truncate text-slate-600" title={nazwy.join(", ")}>
          {nazwy.length > 1
            ? `${nazwy[0]} i ${nazwy.length - 1} ${odmien(nazwy.length - 1, "inny", "inne", "innych")}`
            : nazwy[0]}</span>
        {/* ── ZERO TO BRAK, NIE CENA (0.412.0) ────────────────────────────
            Poziom zakupu (numer 0) nie ma u nas ceny brutto — Subiekt trzyma
            tam parę „netto 18,64 / brutto 0,00". Do tego wydania wiersz
            krzyczał więc `0,00 PLN` grubym drukiem, a jedyną prawdziwą liczbę
            wyciszał jako „netto". Najgłośniejsza liczba bloku cen była
            nieprawdą, i to przy triażu reklamacji.

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
    </ul>
    {oferta && <OsCen ceny={ceny} oferta={oferta} />}
  </div>;
}

/**
 * Pasowania część↔część przy kartotece (§11.2): przy gaźniku „Pasujące do
 * niego", przy uszczelce „Pasuje do". Przechodnie przez zamiennik z dopiskiem
 * (nigdy „potwierdzone"), negatywy na czerwono. Pusty blok nie renderuje się
 * wcale — brak wiedzy to nie informacja, którą warto zajmować kolumnę.
 */
function PasowaniaKartoteki({ dane }: { dane: PasowaniaTowaru }) {
  if (dane.pasujeDo.length + dane.pasujace.length + dane.negatywne.length === 0) return null;
  const wiersz = (t: { czesc: { symbol: string; nazwa: string }; doCzego: { symbol: string; nazwa: string };
    pasowanie: { nazwaRoli: string; pozycja: string | null }; pewnosc: string; przezZamiennik: string | null; zdanie: string },
    strona: "czesc" | "doCzego") =>
    <li key={`${t.czesc.symbol}>${t.doCzego.symbol}`} className="text-xs">
      <b className="font-mono">{t[strona].symbol}</b> <span className="text-slate-600">{t[strona].nazwa}</span>
      <span className="ml-1 rounded bg-slate-100 px-1 py-0.5 text-podpis">{t.pasowanie.nazwaRoli}{t.pasowanie.pozycja ? ` · ${t.pasowanie.pozycja}` : ""}</span>
      <span className={`ml-1 rounded px-1 py-0.5 text-podpis font-bold ${t.pewnosc === "potwierdzone"
        ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}`}>{t.pewnosc}</span>
      {t.przezZamiennik && <span className="ml-1 text-podpis text-slate-500">przez zamiennik</span>}
      <p className="text-podpis text-slate-500">{t.zdanie}</p>
    </li>;
  return <div className="border-t border-slate-200 pt-3">
    <NaglowekSekcji jako="p" ton="text-emerald-800" className="mb-1">Wiedza: pasowania części</NaglowekSekcji>
    {dane.pasujace.length > 0 && <>
      <p className="text-podpis font-semibold text-slate-600">Do tej części pasują</p>
      <ul className="mb-1 space-y-1">{dane.pasujace.map((t) => wiersz(t, "czesc"))}</ul></>}
    {dane.pasujeDo.length > 0 && <>
      <p className="text-podpis font-semibold text-slate-600">Ta część pasuje do</p>
      <ul className="mb-1 space-y-1">{dane.pasujeDo.map((t) => wiersz(t, "doCzego"))}</ul></>}
    {dane.negatywne.length > 0 && <ul className="space-y-1">
      {dane.negatywne.map((p) => <li key={p.id} className="text-xs text-red-900">
        <b className="font-mono">{p.czesc.symbol}</b> ⇏ <b className="font-mono">{p.doCzego.symbol}</b>: {p.zdaniePowodu}
        <span className="block text-podpis text-slate-500">{p.zdanieZrodla}</span></li>)}
    </ul>}
  </div>;
}
