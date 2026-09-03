import { DRABINA, oczysc, segmentyPoEtykiecie } from "./opis-sekcje.js";

/* ── Zamienniki wyczytane z opisu kartoteki ─────────────────────────────────
   Opis (`tw_Opis`) to pole swobodne, wypełniane ręcznie przez lata. Symbol
   zamiennika stoi po „Zamiennik:", „Zamiennie:", „Zastępuje:", „ZAM:",
   rozdzielony `//`, przecinkiem albo ukośnikiem — i sąsiaduje z sekcjami
   `OEM:`, `Modele:`, `Nr. oryg.:`, `STIHL:`, które używają DOKŁADNIE tych
   samych separatorów.

   Regułę ma serwer, nie klient — tak samo jak klasyfikację skanu (`scan.ts`)
   i rozpoznawanie adresu regału. Kolektor tylko renderuje wynik.

   Filtrem „czy to nasz towar" jest KARTOTEKA, nie wzorzec. Regexa na symbol
   towaru nie da się napisać: obok siebie stoją `W32-0203`, `50-111`, `FTC201`,
   `M8810018`, `LS51-139-HSD-LI-068` i `OLEJ-MIX-0,5L` — od zera do pięciu
   myślników, z przecinkiem włącznie. Z 2304 tokenów wyciętych z sekcji
   zamienników tylko 478 okazało się naszymi kartotekami; reszta to numery OEM
   i katalogi obcych producentów. Wzorzec przepuściłby jedno i drugie.

   Kierunek jest tylko jeden: czytamy TEN opis. Jeśli kartoteka B wymienia A,
   a A nie wymienia B, to na karcie A nie pokazujemy nic — sekcja ma być
   odczytem opisu, nie wnioskiem serwera o tym, co się z czym zamienia.

   LISTA BEZ ETYKIETY (0.61.0). Część kartotek nie ma żadnego nagłówka, tylko
   sam ciąg `S11100 // G74050 // MF381350`. Do 0.61.0 dawało to PUSTĄ sekcję,
   bo bez etykiety parser nie miał od czego zacząć. Teraz `//` samo w sobie
   jest sygnałem: w prozie się nie zdarza, a postawił je człowiek, który
   wypisywał listę. Tryb bez etykiety jest jednak WĘŻSZY od zwykłego i opisuje
   go `TRYB_DOMYSLNY` niżej.                                                  */

/**
 * Etykiety otwierające listę.
 *
 * `zamienni…` jedną gałęzią łapie całą rodzinę razem z literówkami z danych
 * (`Zamienni:`, `ZamiennikL`) — lista literówek to lista, która rośnie.
 * `ZAM` MUSI mieć dwukropek: bez tego wymogu symbol `PRO-491588-ZAM` czytałby
 * się jako etykieta. `ZAM wstępny:` celowo NIE jest tu etykietą — to zamiennik
 * filtra wstępnego, czyli innej części niż ta kartoteka; ogólna reguła końca
 * sekcji i tak go traktuje jako granicę.
 */

/* Granica sekcji (`KONIEC_SEKCJI`) i drabina separatorów mieszkają od E3
   w `opis-sekcje.ts` — parser identyfikatorów dzieli te same opisy tymi
   samymi regułami. */

const ETYKIETA =
  /\b(?:zamienni[a-ząćęłńóśźż]*|zamienne\s+na|zast[ęe]puje|odpowiednik[a-ząćęłńóśźż]*)\s*:?\s*|\bZAM\s*:\s*/gi;

/**
 * Kształt numeru katalogowego — filtr WYŁĄCZNIE dla listy obcych.
 * `+` dozwolony, żeby zestaw (`FTC242+92-009`) trafił do szarego tekstu
 * zamiast zniknąć.
 */
const NUMER = /^[A-Za-z0-9][A-Za-z0-9.\-*+/,]{2,23}$/;

/** Zapora na patologiczny opis — nie budujemy zapytania z setką symboli. */
const LIMIT_KANDYDATOW = 60;

/* ── TRYB_DOMYSLNY: lista bez etykiety ───────────────────────────────────────
   Włącza się WYŁĄCZNIE wtedy, gdy etykiet nie ma w opisie ani jednej. Opis
   z etykietą zachowuje się dokładnie jak dotąd — nie ma tu zmiany zachowania
   dla danych, które już działały.

   Trzy zawężenia, każde z powodu:

   1. Wymagany `//`. Przecinek i ukośnik dzielą prozę i numery katalogowe,
      więc na nich lista bez nagłówka byłaby zgadywaniem. Podwójny ukośnik
      jest znakiem świadomej decyzji piszącego.
   2. Kandydatem jest tylko token WYGLĄDAJĄCY na numer — z cyfrą i bez spacji.
      Bez tego cały opis idzie do zapytania słowo po słowie i limit zjadają
      wyrazy prozy, zanim dojdzie do symboli. Ceną jest symbol ze spacją
      (`LT 4S3`), którego ten tryb nie znajdzie; z etykietą znajduje go dalej.
   3. Potrzebne są co najmniej DWA trafienia w kartotece i nie powstają żadne
      numery obce. Bez nagłówka nie wiadomo, czy to lista zamienników, czy
      modeli — pojedyncze trafienie bywa przypadkiem, a szary tekst obcych
      byłby zgadywaniem podanym jako fakt. */
const MIN_TRAFIEN_BEZ_ETYKIETY = 2;

/** Kandydat w trybie bez etykiety: kształt numeru i przynajmniej jedna cyfra. */
const NUMEROWY = /^(?=[^]*\d)[A-Za-z0-9][A-Za-z0-9.\-*+/,]{2,23}$/;

/**
 * Segmenty do rozbioru wraz z trybem, w jakim powstały.
 *
 * `zEtykiety === false` znaczy „cały opis, bo ktoś wypisał listę po `//`
 * i nie podpisał jej" — wtedy obowiązują zawężenia z `TRYB_DOMYSLNY`.
 */
function segmentyZTrybem(desc: string): { segmenty: string[]; zEtykiety: boolean } {
  const zEtykiet = segmentyPoEtykiecie(desc, ETYKIETA);
  if (zEtykiet.length > 0) return { segmenty: zEtykiet, zEtykiety: true };
  if (!desc.includes("//")) return { segmenty: [], zEtykiety: false };
  return { segmenty: [desc], zEtykiety: false };
}

/** Wszystkie fragmenty ze wszystkich szczebli drabiny — bez rozstrzygania. */
function fragmenty(seg: string, poziom: number, out: string[]): void {
  const caly = oczysc(seg);
  if (caly.length >= 2) out.push(caly);
  if (poziom >= DRABINA.length) return;
  const czesci = seg.split(DRABINA[poziom]);
  if (czesci.length === 1) {
    fragmenty(seg, poziom + 1, out);
    return;
  }
  for (const c of czesci) fragmenty(c, poziom + 1, out);
}

/**
 * Cache kandydatów. Rozbiór opisu jest czystą funkcją pary (opis, symbol),
 * a karta towaru odświeża się co 2 s na każdym kolektorze — bez cache'a ta
 * sama drabina regexów mieli ten sam opis w kółko. LRU przez porządek
 * wstawiania Mapy: trafienie przestawia klucz na koniec, nadmiar wypada
 * z początku. `podzielZamienniki` celowo BEZ cache'a — jego wynik zależy
 * od kartoteki (`wKartotece`), nie tylko od argumentów.
 */
const KANDYDACI_CACHE_MAX = 512;
const kandydaciCache = new Map<string, string[]>();

export function kandydaciZamiennikow(desc: string, wlasnySymbol: string): string[] {
  const klucz = wlasnySymbol + "\u0000" + desc;
  const trafienie = kandydaciCache.get(klucz);
  if (trafienie) {
    kandydaciCache.delete(klucz);
    kandydaciCache.set(klucz, trafienie);
    return trafienie;
  }
  const wynik = obliczKandydatow(desc, wlasnySymbol);
  kandydaciCache.set(klucz, wynik);
  if (kandydaciCache.size > KANDYDACI_CACHE_MAX) {
    kandydaciCache.delete(kandydaciCache.keys().next().value as string);
  }
  return wynik;
}

/**
 * Kandydaci do sprawdzenia w kartotece — wszystkie fragmenty z każdego
 * szczebla podziału. Rozstrzygnięcie należy do bazy, nie do wzorca, więc
 * pytamy o komplet i dopiero potem składamy wynik (`podzielZamienniki`).
 */
function obliczKandydatow(desc: string, wlasnySymbol: string): string[] {
  const wlasny = wlasnySymbol.trim().toUpperCase();
  const out: string[] = [];
  const widziane = new Set<string>();
  const { segmenty: czesci, zEtykiety } = segmentyZTrybem(desc);
  for (const seg of czesci) {
    const surowe: string[] = [];
    fragmenty(seg, 0, surowe);
    for (const t of surowe) {
      const klucz = t.toUpperCase();
      if (!zEtykiety && !NUMEROWY.test(t)) continue;
      if (klucz === wlasny || widziane.has(klucz)) continue;
      widziane.add(klucz);
      out.push(t);
      if (out.length >= LIMIT_KANDYDATOW) return out;
    }
  }
  return out;
}

type Wynik = "kartoteka" | "wlasny" | "brak";

/** Wynik rozbioru kawałka: czy coś rozpoznano i co zostało nierozpoznane. */
interface Rozbior {
  wynik: Wynik;
  /** Największe fragmenty, których nie ma w kartotece — kandydaci na obce. */
  obce: string[];
}

/** Ostatni szczebel drabiny (spacja) — patrz komentarz w `rozbierz`. */
const POZIOM_SPACJI = DRABINA.length - 1;

/**
 * Maximal munch po drabinie separatorów: najpierw cały kawałek, potem dopiero
 * jego części.
 *
 * `+` nie dzieli NIGDY. W opisach łączy części zestawu, a nie alternatywy —
 * karta `W08-1302` wymienia `04-01005+04-01020` ORAZ osobno `04-01005`, więc
 * autor sam rozróżnia parę od pojedynczej sztuki. Podział po `+` podałby
 * `04-01005` jako pełnoprawny zamiennik, czyli błędną odpowiedź udzieloną
 * z przekonaniem — a to w hali kosztuje wysłanie klientowi złej części.
 * Zestaw nie rozwiązuje się jako całość i ląduje w numerach obcych, gdzie
 * człowiek go przeczyta i sam zdecyduje.
 */
function rozbierz(
  fragment: string,
  poziom: number,
  wlasny: string,
  wKartotece: (symbol: string) => boolean,
  przyjmij: (symbol: string) => void
): Rozbior {
  const caly = oczysc(fragment);
  if (caly.length >= 2) {
    if (caly.toUpperCase() === wlasny) return { wynik: "wlasny", obce: [] };
    if (wKartotece(caly)) {
      przyjmij(caly);
      return { wynik: "kartoteka", obce: [] };
    }
  }
  if (poziom >= DRABINA.length) return { wynik: "brak", obce: caly ? [caly] : [] };

  const czesci = fragment.split(DRABINA[poziom]);
  if (czesci.length === 1) {
    return rozbierz(fragment, poziom + 1, wlasny, wKartotece, przyjmij);
  }

  const dzieci = czesci.map((c) => rozbierz(c, poziom + 1, wlasny, wKartotece, przyjmij));
  const trafienie = dzieci.some((d) => d.wynik === "kartoteka");
  const wynik: Wynik = trafienie
    ? "kartoteka"
    : dzieci.some((d) => d.wynik === "wlasny")
      ? "wlasny"
      : "brak";

  /* Podział po SPACJI służy wyłącznie dopasowaniu do kartoteki — nigdy budowie
     listy obcych. Rozbity na słowa opis daje sieczkę (`503`, `00-01`, `59-17`
     z karty `W25-0801`, a z `99-016` całe zdanie „Silnikach o mocy…"), więc
     nierozpoznana fraza wraca w całości i odpada na wzorcu `NUMER`, bo zawiera
     spacje. Wyżej, gdzie separator jest jednoznaczny, części zachowujemy —
     inaczej `FTC212 / EX1095 / M06973` traciłoby dwa numery obce przez to,
     że środkowy akurat mamy u siebie. */
  const obce = poziom === POZIOM_SPACJI ? (trafienie ? [] : caly ? [caly] : []) : dzieci.flatMap((d) => d.obce);
  return { wynik, obce };
}

/**
 * Rozdział na zamienniki z kartoteki (klikalne) i numery obce (szary tekst).
 *
 * Kawałek rozdzielony `//`, z którego nic się nie rozwiązało, idzie w całości
 * do numerów obcych — tam siedzą numery OEM i katalogi innych producentów,
 * przydatne w rozmowie z dostawcą, ale nie do kliknięcia, bo nie mamy ich
 * u siebie.
 */
export function podzielZamienniki(
  desc: string,
  wlasnySymbol: string,
  wKartotece: (symbol: string) => boolean
): { znane: string[]; obce: string[] } {
  const wlasny = wlasnySymbol.trim().toUpperCase();
  const znane: string[] = [];
  const obce: string[] = [];
  const widzianeZnane = new Set<string>();
  const widzianeObce = new Set<string>();

  const { segmenty: czesci, zEtykiety } = segmentyZTrybem(desc);
  for (const seg of czesci) {
    for (const kawalek of seg.split(DRABINA[0])) {
      if (!kawalek.trim()) continue;
      const rozbior = rozbierz(kawalek, 1, wlasny, wKartotece, (s) => {
        const klucz = s.toUpperCase();
        if (widzianeZnane.has(klucz)) return;
        widzianeZnane.add(klucz);
        znane.push(s);
      });
      // bez etykiety numery obce nie powstają — patrz `TRYB_DOMYSLNY`
      for (const kandydat of zEtykiety ? rozbior.obce : []) {
        if (!NUMER.test(kandydat) || !/\d/.test(kandydat)) continue;
        const klucz = kandydat.toUpperCase();
        if (klucz === wlasny || widzianeObce.has(klucz) || widzianeZnane.has(klucz)) continue;
        widzianeObce.add(klucz);
        obce.push(kandydat);
      }
    }
  }
  /* Jedno trafienie w liście bez nagłówka bywa zbiegiem okoliczności: numer
     modelu potrafi wyglądać jak nasz symbol. Dwa to już wypisana lista. */
  if (!zEtykiety && znane.length < MIN_TRAFIEN_BEZ_ETYKIETY) return { znane: [], obce: [] };
  return { znane, obce };
}
