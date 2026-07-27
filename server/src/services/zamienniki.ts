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
   odczytem opisu, nie wnioskiem serwera o tym, co się z czym zamienia.       */

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
const ETYKIETA =
  /\b(?:zamienni[a-ząćęłńóśźż]*|zamienne\s+na|zast[ęe]puje|odpowiednik[a-ząćęłńóśźż]*)\s*:?\s*|\bZAM\s*:\s*/gi;

/**
 * Koniec listy = pierwsze generyczne „Słowo:", a NIE lista znanych etykiet.
 *
 * Whitelista (`OEM:`, `Modele:`, `W zestawie:`) wyglądała rozsądnie i wpuszczała
 * prozę: `Nr. oryg.: GND-33`, `STIHL: 017`, `HUSQVARNA: 40`, `Odpowiednik
 * oryginału o numerze: 597338`. Na karcie `W24-0807` dawała 19 śmieci zamiast
 * zera. Reguła ogólna ucina je wszystkie naraz i nie wymaga dopisywania każdej
 * nowej marki, którą ktoś kiedyś wklepie w opis.
 */
const KONIEC_SEKCJI =
  /(?<=^|\s)[A-Za-z0-9ĄĆĘŁŃÓŚŹŻąćęłńóśźż.][A-Za-z0-9ĄĆĘŁŃÓŚŹŻąćęłńóśźż. ]{0,24}:/;

/**
 * Drabina podziału — od separatora najpewniejszego do najbardziej wątpliwego.
 * Na każdym szczeblu najpierw próbujemy CAŁEGO kawałka, dopiero potem dzielimy
 * (maximal munch), bo separatory występują WEWNĄTRZ prawdziwych symboli:
 * `FTC199/FTC206`, `10680/1` (ukośnik), `OLEJ-MIX-0,5L` (przecinek),
 * `DBR A-7540444`, `LT 4S3` (spacja). Naiwny `split` mieli je na sieczkę.
 *
 * `+` nie ma tu wcale i to jest decyzja, nie przeoczenie — patrz `rozbierz`.
 */
const DRABINA = [/\s*\/\/\s*/, /\s*[,;|\\]\s*/, /\s*\/\s*/, /\s+/];

/**
 * Kształt numeru katalogowego — filtr WYŁĄCZNIE dla listy obcych.
 * `+` dozwolony, żeby zestaw (`FTC242+92-009`) trafił do szarego tekstu
 * zamiast zniknąć.
 */
const NUMER = /^[A-Za-z0-9][A-Za-z0-9.\-*+/,]{2,23}$/;

/** Zapora na patologiczny opis — nie budujemy zapytania z setką symboli. */
const LIMIT_KANDYDATOW = 60;

/** Obcina przyklejoną interpunkcję, zostawiając znaki obecne w symbolach. */
function oczysc(token: string): string {
  return token.trim().replace(/^[^A-Za-z0-9]+/, "").replace(/[^A-Za-z0-9*+]+$/, "");
}

/**
 * Kawałki opisu będące listą zamienników — po etykiecie, do najbliższego
 * „Słowo:" albo do końca opisu.
 */
function segmenty(desc: string): string[] {
  const out: string[] = [];
  // regex z flagą /g jest stanowy — własna kopia na każde wywołanie
  const etykieta = new RegExp(ETYKIETA.source, ETYKIETA.flags);
  let m: RegExpExecArray | null;
  while ((m = etykieta.exec(desc)) !== null) {
    if (m[0].length === 0) {
      etykieta.lastIndex++;
      continue;
    }
    const reszta = desc.slice(m.index + m[0].length);
    const koniec = KONIEC_SEKCJI.exec(reszta);
    const seg = koniec ? reszta.slice(0, koniec.index) : reszta;
    if (seg.trim()) out.push(seg);
  }
  return out;
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
 * Kandydaci do sprawdzenia w kartotece — wszystkie fragmenty z każdego
 * szczebla podziału. Rozstrzygnięcie należy do bazy, nie do wzorca, więc
 * pytamy o komplet i dopiero potem składamy wynik (`podzielZamienniki`).
 */
export function kandydaciZamiennikow(desc: string, wlasnySymbol: string): string[] {
  const wlasny = wlasnySymbol.trim().toUpperCase();
  const out: string[] = [];
  const widziane = new Set<string>();
  for (const seg of segmenty(desc)) {
    const surowe: string[] = [];
    fragmenty(seg, 0, surowe);
    for (const t of surowe) {
      const klucz = t.toUpperCase();
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

  for (const seg of segmenty(desc)) {
    for (const kawalek of seg.split(DRABINA[0])) {
      if (!kawalek.trim()) continue;
      const rozbior = rozbierz(kawalek, 1, wlasny, wKartotece, (s) => {
        const klucz = s.toUpperCase();
        if (widzianeZnane.has(klucz)) return;
        widzianeZnane.add(klucz);
        znane.push(s);
      });
      for (const kandydat of rozbior.obce) {
        if (!NUMER.test(kandydat) || !/\d/.test(kandydat)) continue;
        const klucz = kandydat.toUpperCase();
        if (klucz === wlasny || widzianeObce.has(klucz) || widzianeZnane.has(klucz)) continue;
        widzianeObce.add(klucz);
        obce.push(kandydat);
      }
    }
  }
  return { znane, obce };
}
