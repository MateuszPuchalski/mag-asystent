/* ── Składanie tekstu do porównywania ────────────────────────────────────────
   POWSTAŁO PO ZGŁOSZENIU Z MAGAZYNU: wpisany `gaznik` nie znajdował ani jednego
   `gaźnika`. Przyczyna jest głębsza, niż wyglądała — SQLite nie zna polskich
   liter w ŻADNEJ z funkcji, których używaliśmy:

     lower('GAŹNIK')                     → 'gaŹnik'
     'gaźnik' = 'GAŹNIK' COLLATE NOCASE  → 0

   Czyli zepsute były dwie rzeczy naraz. Diakrytyki nie były składane — i to
   było zgłoszenie. Ale wielkość liter też nie działała dla polskich znaków;
   nikt tego nie zauważył, bo szuka się małymi literami.

   MAPA JEST JAWNA I TO JEST DECYZJA, NIE LENISTWO. Kuszące
   `s.normalize("NFD").replace(/\p{M}/gu, "")` zawodzi tu podwójnie:

     1. `ł` i `Ł` NIE MAJĄ rozkładu kanonicznego — zostają jednym znakiem.
        Sprawdzone: `"ł".normalize("NFD").length === 1`. Czyli akurat `łożysko`
        i `łańcuch` przeszłyby przez sito nietknięte, a błąd zostałby uznany
        za naprawiony.
     2. NFD złożyłoby też `ü` → `u`, czego strona SQL nie robi. Zapytanie
        i kolumna składałyby się RÓŻNIE, więc `Müller` wpisany ręcznie nigdy
        nie trafiłby w kartotekę `Müller`.

   Symetria JS ↔ SQL jest tu jedynym prawdziwym niezmiennikiem: zapytanie
   składamy w JS, kolumnę w SQL, a rozjazd o jedną literę wyłącza wyszukiwanie
   dla tej litery po cichu. Dlatego obie strony wyprowadzamy z `LITERY`,
   a `tekst.test.ts` porównuje wynik obu przez prawdziwe SQLite.               */

/** Jedyne źródło prawdy dla obu stron. Dopisanie litery obejmuje JS, SQL i test. */
export const LITERY: ReadonlyArray<readonly [string, string]> = [
  ["ą", "a"], ["Ą", "a"],
  ["ć", "c"], ["Ć", "c"],
  ["ę", "e"], ["Ę", "e"],
  ["ł", "l"], ["Ł", "l"],
  ["ń", "n"], ["Ń", "n"],
  ["ó", "o"], ["Ó", "o"],
  ["ś", "s"], ["Ś", "s"],
  ["ź", "z"], ["Ź", "z"],
  ["ż", "z"], ["Ż", "z"],
];

/** Znaki, które w symbolach i kodach nic nie znaczą: `LS51-139` = `LS51 139`. */
const ODDZIELACZE = [" ", "-", ".", "/", ","] as const;

/**
 * Małe litery i polskie znaki na ASCII. Spacje i myślniki ZOSTAJĄ.
 *
 * To jest poziom „słowa dają się porównać". Drugi poziom (`zwin`) dokłada
 * usunięcie oddzielaczy — i te dwa poziomy muszą zostać osobne, bo furtka
 * literówkowa porównuje zapytanie ze SŁOWAMI nazwy. Na formie zwiniętej słów
 * już nie ma, a odległość edycyjna od `gaznikkompletnydokosy` przekroczy każdy
 * rozsądny próg.
 */
export function zloz(s: string): string {
  let out = s.toLowerCase();
  for (const [z, na] of LITERY) out = out.split(z).join(na);
  return out;
}

/**
 * `zloz` bez oddzielaczy — forma do porównywania symboli i kodów.
 *
 * Dzięki temu `LS51139`, `ls51-139` i `LS51 139` to jedno i to samo. Etykieta
 * bywa zdarta, a numer przepisywany z ręki, więc myślnik w środku jest
 * ozdobnikiem, nie treścią.
 */
export function zwin(s: string): string {
  let out = zloz(s);
  for (const z of ODDZIELACZE) out = out.split(z).join("");
  return out;
}

/** Ile znaków zapytania w ogóle bierzemy pod uwagę. */
const MAX_ZNAKOW = 100;
/** Ile słów. Wklejony opis to 30 tokenów × 3600 wierszy — już nie 15 ms. */
const MAX_TOKENOW = 6;

/**
 * Zapytanie rozbite na słowa, każde już złożone i zwinięte.
 *
 * PUSTA TABLICA JEST WYNIKIEM ISTOTNYM. Zapytanie `-`, `///` albo same spacje
 * nie ma ani jednego tokenu, a koniunkcja po pustym zbiorze jest prawdziwa —
 * czyli bez tego strażnika wyszukiwarka oddałaby CAŁĄ kartotekę. Wywołujący
 * musi to sprawdzić przed zbudowaniem zapytania.
 */
export function tokeny(q: string): string[] {
  return zloz(q.slice(0, MAX_ZNAKOW))
    .split(/[\s\-./,]+/)
    .map((t) => zwin(t))
    .filter((t) => t.length > 0)
    .slice(0, MAX_TOKENOW);
}

/** Wyrażenie SQL równoważne `zloz` dla podanego wyrażenia kolumnowego. */
export function sqlZloz(kolumna: string): string {
  let wyr = `lower(${kolumna})`;
  for (const [z, na] of LITERY) wyr = `replace(${wyr},'${z}','${na}')`;
  return wyr;
}

/** Wyrażenie SQL równoważne `zwin`. */
export function sqlZwin(kolumna: string): string {
  let wyr = sqlZloz(kolumna);
  for (const z of ODDZIELACZE) wyr = `replace(${wyr},'${z}','')`;
  return wyr;
}

/**
 * Warianty każdej litery ASCII: polskie odpowiedniki i obie wielkości.
 * Wyprowadzone z `LITERY`, żeby dopisanie litery objęło także wzorce GLOB.
 */
const WARIANTY: Map<string, string> = (() => {
  const m = new Map<string, string>();
  for (const [z, na] of LITERY) m.set(na, (m.get(na) ?? "") + z);
  return m;
})();

/**
 * Wzorzec `GLOB` dopasowujący tekst NIEZALEŻNIE od ogonków i wielkości liter.
 *
 * POWSTAŁO Z POMIARU, nie z upodobania. Składanie kolumny `nazwa` łańcuchem
 * osiemnastu `replace` kosztuje na prawdziwym katalogu (3415 kartotek, 78 %
 * z polskimi znakami) około 22 ms na zapytanie, a serwer jest jednowątkowy
 * i obsługuje w tym czasie także odpytywanie listy rozkładania. Ten sam wynik
 * przez `GLOB` z klasami znaków to około 3 ms, bo baza nie buduje ani jednego
 * łańcucha pośredniego — tylko porównuje.
 *
 * Litera `a` staje się `[aAąĄ]`, `z` staje się `[zZźŹżŻ]`. Znaki spoza
 * alfabetu opakowujemy w jednoelementową klasę `[x]`, co jest zarazem
 * escapowaniem: `GLOB` nie ma klauzuli ESCAPE, więc gwiazdka albo nawias
 * kwadratowy wpisany przez człowieka rozsypałby wzorzec.
 */
export function naGlob(s: string): string {
  const srodek = [...s]
    .map((z) => {
      const warianty = WARIANTY.get(z);
      if (warianty) return `[${z}${z.toUpperCase()}${warianty}]`;
      if (/[a-z]/.test(z)) return `[${z}${z.toUpperCase()}]`;
      // `]` i `^` mają w klasie znaczenie specjalne — te dwa lecą dosłownie
      if (z === "]" || z === "^") return z;
      return `[${z}]`;
    })
    .join("");
  return `*${srodek}*`;
}

/**
 * Wyrażenie SQL składające symbol — kosztowne TYLKO tam, gdzie trzeba.
 *
 * Symbole są w tej kartotece prawie zawsze czystym ASCII: na 3415 pozycji
 * polskie znaki ma **dwanaście**, a myślnik albo spację ponad dwa tysiące.
 * Pełny łańcuch osiemnastu `replace` liczymy więc wyłącznie dla wierszy,
 * które faktycznie mają znak spoza ASCII — test `GLOB '*[^ -~]*'` jest tani,
 * a `CASE` w SQLite oblicza tylko wybraną gałąź.
 */
export function sqlZwinSymbol(kolumna: string): string {
  let tanio = `lower(${kolumna})`;
  for (const z of ODDZIELACZE) tanio = `replace(${tanio},'${z}','')`;
  return `CASE WHEN ${kolumna} GLOB '*[^ -~]*' THEN ${sqlZwin(kolumna)} ELSE ${tanio} END`;
}

/**
 * Escapowanie pod `LIKE … ESCAPE '\'`.
 *
 * NAPRAWIA TAKŻE DZISIEJSZY BŁĄD, nie tylko chroni nowy kod: `%` wpisany
 * w wyszukiwarkę trafiał dotąd jako wieloznacznik, więc samo `%` zwracało całą
 * kartotekę, a `Filtr 100%` znajdował też `Filtr 1005`. Przy koniunkcji
 * tokenów byłoby gorzej — jeden `%` czyniłby cały warunek prawdziwym.
 *
 * Backslash musi lecieć w tym samym przebiegu co reszta, inaczej escapowałby
 * własne escapowanie.
 */
export function naLike(s: string): string {
  return s.replace(/[\\%_]/g, "\\$&");
}

/**
 * Odległość edycyjna liczona w PAŚMIE, z przerwaniem po przekroczeniu progu.
 *
 * Zwraca `max + 1`, gdy odległość jest większa niż `max` — nie prawdziwą
 * wartość, bo nikt jej nie potrzebuje, a policzenie kosztuje. Pasmo zwęża
 * macierz z `O(a·b)` do `O(a·(2·max+1))`: przy słowie 20-znakowym i progu 2
 * to 100 operacji zamiast 400, a robimy to dla każdego słowa każdej z 3600
 * kartotek.
 */
export function odlegloscOgraniczona(a: string, b: string, max: number): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;
  if (max <= 0) return 1;

  let poprzedni = new Array<number>(b.length + 1);
  let biezacy = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) poprzedni[j] = j;

  for (let i = 1; i <= a.length; i++) {
    biezacy[0] = i;
    const od = Math.max(1, i - max);
    const doJ = Math.min(b.length, i + max);
    // poza pasmem wstawiamy wartość zaporową, żeby sąsiad jej nie „pożyczył"
    if (od > 1) biezacy[od - 1] = max + 1;
    /* Minimum wiersza liczymy OD LEWEJ KRAWĘDZI PASMA, nie od jego wnętrza.
       Przy pustym `b` pasmo jest puste (od > doJ) i bez tego `najlepszy`
       zostawał zaporowy — funkcja meldowała „ponad progiem" dla odległości 1. */
    let najlepszy = biezacy[od - 1];
    for (let j = od; j <= doJ; j++) {
      const koszt = a[i - 1] === b[j - 1] ? 0 : 1;
      biezacy[j] = Math.min(
        poprzedni[j] + 1,
        biezacy[j - 1] + 1,
        poprzedni[j - 1] + koszt
      );
      if (biezacy[j] < najlepszy) najlepszy = biezacy[j];
    }
    for (let j = doJ + 1; j <= b.length; j++) biezacy[j] = max + 1;
    // cały wiersz ponad progiem — dalej może już tylko rosnąć
    if (najlepszy > max) return max + 1;
    const tmp = poprzedni;
    poprzedni = biezacy;
    biezacy = tmp;
  }
  return Math.min(poprzedni[b.length], max + 1);
}

/**
 * Ile błędów wolno wybaczyć słowu tej długości. `null` = żadnych.
 *
 * Próg DŁUGOŚCI jest tu ważniejszy od progu odległości. Jeden błąd na trzech
 * znakach dopasowuje pół kartoteki (`kos` = `kot` = `koc` = `kod`), więc krótkie
 * słowa nie mają prawa wejść do dopasowania przybliżonego wcale.
 */
export function progLiterowki(dlugosc: number): number | null {
  if (dlugosc <= 3) return null;
  return dlugosc <= 5 ? 1 : 2;
}

/* ── Encje HTML z Allegro ────────────────────────────────────────────────────
   Allegro potrafi oddać tekst z encjami (`zwr&oacute;cić`), a panel escape'uje
   wszystko przy renderowaniu — więc encja z bazy wyświetla się DOSŁOWNIE.
   Dekodujemy przy wjeździe (adapter) i raz w migracji dla zastanych wierszy.
   Moduł tekst.ts, nie adapter: migrację woła db/db.ts, a db → adapters
   odwracałoby warstwy.                                                       */

/** Słownik encji nazwanych. Nieznana ZOSTAJE dosłownie — zgadywanie zamieniłoby
 *  cudzy tekst po cichu, a widoczna encja jest przynajmniej widoczną usterką. */
const ENCJE: Readonly<Record<string, string>> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'",
  /* Zwykła spacja, nie U+00A0: niełamliwa w bazie psułaby porównania
     i zawijanie, a nikt jej tu świadomie nie użył. */
  nbsp: " ",
  /* ── Polskie znaki (0.152.0) ─────────────────────────────────────────────
     Zostają wypisane osobno, choć mieszczą się w bloku niżej: to one były
     powodem powstania tej tablicy (blizna 0.127.0) i pierwsze, czego się tu
     szuka. */
  aogon: "ą", Aogon: "Ą", cacute: "ć", Cacute: "Ć",
  eogon: "ę", Eogon: "Ę", lstrok: "ł", Lstrok: "Ł",
  nacute: "ń", Nacute: "Ń", oacute: "ó", Oacute: "Ó",
  sacute: "ś", Sacute: "Ś", zacute: "ź", Zacute: "Ź",
  zdot: "ż", Zdot: "Ż",
  ndash: "–", mdash: "—", hellip: "…", laquo: "«", raquo: "»",
  bdquo: "„", ldquo: "“", rdquo: "”",
  deg: "°", sect: "§", copy: "©", reg: "®", trade: "™", euro: "€",

  /* ── Reszta alfabetów łacińskich ─────────────────────────────────────────
     Do 0.249.1 tablica znała WYŁĄCZNIE polskie znaki, bo tylko po polsku do
     nas pisano. Zgłoszenie właściciela: „często piszą do nas Węgrzy, Słowacy
     i Czesi i dostajemy takie znaki `Z&aacute;silka nebyla doručena`".
     `&aacute;` nie było w tablicy, więc zostawało dosłownie — dokładnie tak,
     jak przewiduje komentarz wyżej. Zdanie z tego zgłoszenia jest przy okazji
     dowodem, że Allegro koduje NIEKONSEKWENTNIE: `á` przyszło jako encja,
     a `č` w tym samym zdaniu jako zwykły znak UTF-8.

     ZAKRES JEST ZAMKNIĘTY I DA SIĘ GO NAZWAĆ: każda encja nazwana, której
     rozwinięciem jest jeden znak z Latin-1 Supplement (U+00A0–U+00FF) albo
     Latin Extended-A (U+0100–U+017F). To pokrywa czeski, słowacki, węgierski,
     niemiecki, rumuński, litewski i resztę Europy Środkowej — bez wracania
     tu przy każdym nowym kraju.

     TABLICA JEST WYGENEROWANA, NIE PRZEPISANA Z PAMIĘCI. Kandydatów złożono
     systematycznie (litera × przyrostek akcentu, oba przypadki), a rozwinięcie
     każdego dał PARSER HTML przeglądarki — fałszywy kandydat po prostu się nie
     zdekodował. Sposób opisuje `docs/obsluga-klienta.md`; pilnuje go test
     pokrycia alfabetów w `tekst.test.ts`.

     `&shy;` (U+00AD, miękki dywiz) NIE WCHODZI świadomie. Jest niewidoczny,
     a w bazie psułby porównania i wyszukiwanie tak samo jak `&nbsp;` — ten
     sam powód, dla którego niełamliwa spacja jest wyżej zamieniana na zwykłą. */
  Aacute: "Á", aacute: "á", Abreve: "Ă", abreve: "ă", Acirc: "Â", acirc: "â",
  AElig: "Æ", aelig: "æ", Agrave: "À", agrave: "à", Amacr: "Ā", amacr: "ā",
  Aring: "Å", aring: "å", Atilde: "Ã", atilde: "ã", Auml: "Ä", auml: "ä",
  Ccaron: "Č", ccaron: "č", Ccedil: "Ç", ccedil: "ç", Ccirc: "Ĉ", ccirc: "ĉ",
  Cdot: "Ċ", cdot: "ċ", cent: "¢", curren: "¤", Dcaron: "Ď", dcaron: "ď",
  divide: "÷", Dstrok: "Đ", dstrok: "đ", Eacute: "É", eacute: "é",
  Ecaron: "Ě", ecaron: "ě", Ecirc: "Ê", ecirc: "ê", Edot: "Ė", edot: "ė",
  Egrave: "È", egrave: "è", Emacr: "Ē", emacr: "ē", ENG: "Ŋ", eng: "ŋ",
  ETH: "Ð", eth: "ð", Euml: "Ë", euml: "ë", frac12: "½", frac14: "¼",
  frac34: "¾", Gbreve: "Ğ", gbreve: "ğ", Gcedil: "Ģ", Gcirc: "Ĝ", gcirc: "ĝ",
  Gdot: "Ġ", gdot: "ġ", Hcirc: "Ĥ", hcirc: "ĥ", Hstrok: "Ħ", hstrok: "ħ",
  Iacute: "Í", iacute: "í", Icirc: "Î", icirc: "î", Idot: "İ", iexcl: "¡",
  Igrave: "Ì", igrave: "ì", IJlig: "Ĳ", ijlig: "ĳ", Imacr: "Ī", imacr: "ī",
  Iogon: "Į", iogon: "į", iquest: "¿", Itilde: "Ĩ", itilde: "ĩ", Iuml: "Ï",
  iuml: "ï", Jcirc: "Ĵ", jcirc: "ĵ", Kcedil: "Ķ", kcedil: "ķ", kgreen: "ĸ",
  Lacute: "Ĺ", lacute: "ĺ", Lcaron: "Ľ", lcaron: "ľ", Lcedil: "Ļ",
  lcedil: "ļ", Lmidot: "Ŀ", lmidot: "ŀ", macr: "¯", micro: "µ", middot: "·",
  napos: "ŉ", Ncaron: "Ň", ncaron: "ň", Ncedil: "Ņ", ncedil: "ņ", not: "¬",
  Ntilde: "Ñ", ntilde: "ñ", Ocirc: "Ô", ocirc: "ô", Odblac: "Ő", odblac: "ő",
  OElig: "Œ", oelig: "œ", Ograve: "Ò", ograve: "ò", Omacr: "Ō", omacr: "ō",
  ordf: "ª", ordm: "º", Oslash: "Ø", oslash: "ø", Otilde: "Õ", otilde: "õ",
  Ouml: "Ö", ouml: "ö", para: "¶", plusmn: "±", pound: "£", Racute: "Ŕ",
  racute: "ŕ", Rcaron: "Ř", rcaron: "ř", Rcedil: "Ŗ", rcedil: "ŗ",
  Scaron: "Š", scaron: "š", Scedil: "Ş", scedil: "ş", Scirc: "Ŝ", scirc: "ŝ",
  sup1: "¹", sup2: "²", sup3: "³", szlig: "ß", Tcaron: "Ť", tcaron: "ť",
  Tcedil: "Ţ", tcedil: "ţ", THORN: "Þ", thorn: "þ", times: "×", Tstrok: "Ŧ",
  tstrok: "ŧ", Uacute: "Ú", uacute: "ú", Ubreve: "Ŭ", ubreve: "ŭ",
  Ucirc: "Û", ucirc: "û", Udblac: "Ű", udblac: "ű", Ugrave: "Ù", ugrave: "ù",
  Umacr: "Ū", umacr: "ū", Uogon: "Ų", uogon: "ų", Uring: "Ů", uring: "ů",
  Utilde: "Ũ", utilde: "ũ", Uuml: "Ü", uuml: "ü", Wcirc: "Ŵ", wcirc: "ŵ",
  Yacute: "Ý", yacute: "ý", Ycirc: "Ŷ", ycirc: "ŷ", yen: "¥", Yuml: "Ÿ",
  yuml: "ÿ", Zcaron: "Ž", zcaron: "ž",
};

/**
 * Zamienia encje HTML na znaki. JEDEN przebieg regexu — `&amp;lt;` daje
 * `&lt;` i STOP, bo wynik podstawienia nie jest skanowany ponownie. To
 * celowe: podwójne kodowanie oznacza, że ktoś po drodze zakodował encję
 * jako tekst, i jeden poziom na przebieg jest jedynym bezpiecznym ruchem.
 *
 * OD 0.140.0 BEZ WOŁAJĄCEGO: jedynym był adapter rozmów Allegro, który odszedł
 * z obsługą klienta. Funkcja zostaje z testami, bo „&oacute; w treści pytania"
 * to blizna zapłacona wydaniem 0.127.0 i wpisana na listę w
 * `docs/obsluga-klienta.md` — nowa obsługa ma ją wziąć gotową, nie odkryć
 * drugi raz na produkcji.
 */
export function odkodujEncje(s: string): string {
  return s.replace(/&(#\d+|#x[0-9a-fA-F]+|[a-zA-Z]+);/g, (calosc, cialo: string) => {
    if (cialo[0] === "#") {
      const kod = cialo[1] === "x" || cialo[1] === "X"
        ? parseInt(cialo.slice(2), 16)
        : parseInt(cialo.slice(1), 10);
      /* Poza zakresem Unicode albo surrogat — zostawiamy dosłownie. */
      if (!Number.isFinite(kod) || kod < 0x20 && kod !== 0x09 && kod !== 0x0a
          || kod > 0x10ffff || (kod >= 0xd800 && kod <= 0xdfff)) return calosc;
      return String.fromCodePoint(kod);
    }
    return ENCJE[cialo] ?? calosc;
  });
}

/**
 * Podpis dowodu bez nazwiska pracownika: `— katalog dostawcy, 7.09.2026, Anna`
 * staje się `— katalog dostawcy, 7.09.2026`. Klient ma dostać źródło z datą,
 * nie nazwisko (§14.4); dostaje je z obu dróg — wstawki „ze źródłem" z Doboru
 * i szkicu Copilota — decyzja właściciela z 8 września 2026. Ekran biura
 * autora nadal pokazuje: tam jest potrzebny. Wzorzec jest DATĄ, po której
 * stoi autor — tak buduje podpis `zdanieZrodla()` w `wiedza.ts`,
 * `silniki.ts` i `pasowania.ts`. Leży tu, w module-liściu, bo czytają go
 * `dobor.ts` i `copilot-szkic.ts`, a ten drugi importuje pierwszy.
 */
export function bezPodpisu(zdanie: string): string {
  return zdanie.replace(
    /(\b\d{1,2}\.\d{2}\.\d{4}), (?:[^;).]|\.(?=\s?\p{Lu}))+(?=;|\)|\.(?:\s|$)|$)/gu, "$1");
}
