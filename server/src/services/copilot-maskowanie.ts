/* ── Maskowanie treści przed wyjściem do dostawcy (§14.4, etap F) ────────────

   §14.4 mówi: „Do dostawcy trafia minimalny zakres (…) Nie wolno przekazywać
   tokenów, haseł, pełnych danych dostawy, zbędnych danych osobowych ani całej
   historii klienta bez uzasadnienia."

   TO NIE JEST ROZSZERZENIE `allegro-oczyszczanie.ts`. Tamten czyści JSON PO
   NAZWACH PÓL i to jest jego siła — nazwa chroni też pole, które Allegro doda
   w przyszłości. Tutaj czyścimy WOLNY TEKST, w którym numer telefonu stoi
   w środku zdania i żadnej nazwy pola nad sobą nie ma.

   Doktryna zostaje ta sama, przeniesiona o piętro: WARTOŚĆ ZNIKA, ŚLAD
   ZOSTAJE. Model ma wiedzieć, ŻE klient podał telefon — bo to bywa treścią
   pytania („proszę o kontakt") — ale nie ma zobaczyć numeru.

   LOGIN MASKUJEMY PRZEZ PODMIANĘ ZNANEJ WARTOŚCI, nie przez wzorzec, i to jest
   sedno tego pliku. Nie da się napisać wyrażenia na „login Allegro":
   `jan_kowalski`, `NAC-serwis` i `mmm123` to zwykłe słowa. Ale login rozmówcy
   ZNAMY z bazy. Maskowanie znanej wartości jest pewne; zgadywanie klasy nie.

   GDZIE KOŃCZY SIĘ GWARANCJA. „Kowalskiego 5, Wrocław" bez markera `ul.`
   i bez kodu pocztowego przejdzie. Rozpoznawanie adresów w wolnym tekście
   wyrażeniami regularnymi nie jest zadaniem rozwiązywalnym — wycinamy markery
   pewne i zapisujemy granicę. Brak takiego zdania kosztował 0.151.0, gdzie
   dokumentacja mówiła „nie pobieramy", a pobieraliśmy.                       */

/**
 * Tekst, który wolno wysłać dostawcy.
 *
 * Typ OZDOBIONY: wyprodukować go umie wyłącznie `zamaskuj()`. Adapter przyjmuje
 * tylko taki tekst, więc „zapomniałem zamaskować" przestaje być pomyłką do
 * wyłapania w przeglądzie kodu i staje się BŁĘDEM KOMPILACJI. To jest tańszy
 * strażnik niż dyscyplina i jedyny, który działa o trzeciej w nocy.
 */
export type TrescBezpieczna = string & { readonly __zamaskowana: unique symbol };

/* Kolejność wzorców MA ZNACZENIE i dlatego stoją w tablicy, nie w rozsypce.

   Adres e-mail idzie pierwszy, bo zawiera kropki i cyfry, które łapałyby się
   niżej. Numer konta przed telefonem, bo dwadzieścia sześć cyfr zawiera w sobie
   dziewięć. Linia adresowa przed kodem pocztowym, bo zwykle go w sobie ma. */
const WZORCE: Array<{ nazwa: string; re: RegExp; znacznik: string }> = [
  { nazwa: "e-mail", znacznik: "[e-mail]",
    re: /[\w.+-]+@[\w-]+\.[\w.-]+/g },
  /* Linia adresowa: marker pewny plus reszta linii. Sam marker nie wystarczy —
     „ul." bez numeru i miasta nie jest daną osobową, a z nimi jest.
     „kod pocztowy" jest tu, a nie przy wzorcu cyfr — patrz akapit niżej. */
  { nazwa: "adres", znacznik: "[adres]",
    re: /\b(?:ul\.|ulica|al\.|aleja|os\.|osiedle|pl\.|kod\s+pocztow\p{L}*)\s*[^\n]{2,80}/giu },
  /* KOD POCZTOWY TYLKO Z MIASTEM — i to jest najtrudniejsza decyzja tego pliku.

     Polski kod pocztowy i numer modelu sprzętu ogrodniczego mają IDENTYCZNY
     kształt: `62-030` to Luboń, a `46-450` to kosiarka NAC LS. Wzorzec na samo
     `\d{2}-\d{3}` zjadał więc numer modelu z KAŻDEGO pytania o dobór — czyli
     dokładnie tę daną, dla której klasyfikacja istnieje.

     Doktryna „lepiej zamaskować za dużo" (z `allegro-oczyszczanie.ts`) tu się
     nie stosuje, bo fałszywe trafienie nie kosztuje jednego pola — kosztuje
     całą funkcję. Maskujemy więc kod POCZTOWY, czyli pięć cyfr z miastem po
     nich albo ze słowem „kod pocztowy" przed (wzorzec wyżej).

     Gołe `62-030` bez miasta i bez markera PRZECHODZI i to jest zapisana cena:
     sam kod pocztowy wskazuje miejscowość liczoną w tysiącach osób, a numer
     modelu wskazuje, o co klient pyta. */
  { nazwa: "adres", znacznik: "[adres]",
    re: /\b\d{2}-\d{3}\s+\p{Lu}[\p{L}.-]*/gu },
  /* Numer konta: co najmniej szesnaście cyfr w jednym ciągu, z separatorami
     albo bez, z opcjonalnym „PL" z przodu. */
  { nazwa: "konto", znacznik: "[konto]",
    re: /\b(?:PL\s*)?(?:\d[\s-]?){16,}\d?/gi },
  /* Telefon: dziewięć cyfr, z prefiksem kraju albo bez, ze spacjami
     i myślnikami. Granice po obu stronach, żeby nie wyjadać środka
     dłuższego ciągu — ten i tak zniknął wyżej jako konto. */
  { nazwa: "telefon", znacznik: "[telefon]",
    re: /(?<![\d-])(?:(?:\+|00)\s?48[\s-]?)?(?:\d[\s-]?){8}\d(?![\d-])/g },
];

/** Zamiana znanego loginu — osobno, bo to podmiana wartości, nie wzorca. */
function bezLoginu(tekst: string, login: string | null): string {
  const l = (login ?? "").trim();
  /* Login krótszy niż trzy znaki podmienialiśmy w każdym słowie — „ab" trafiało
     w środek „tabela". Krótkich loginów Allegro nie wydaje, więc próg nic nie
     kosztuje, a chroni przed zamaskowaniem całej wiadomości. */
  if (l.length < 3) return tekst;
  const wzor = new RegExp(l.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
  return tekst.replace(wzor, "[login]");
}

/**
 * Treść wiadomości bezpieczna do wysłania dostawcy.
 *
 * Funkcja jest IDEMPOTENTNA: drugi przebieg nie mnoży znaczników. To nie jest
 * ozdoba — serwis woła ją raz, ale asercja kontrolna niżej chodzi po tym samym
 * tekście i musi dostać ten sam wynik.
 */
export function zamaskuj(tresc: string, login: string | null): TrescBezpieczna {
  let out = tresc;
  for (const w of WZORCE) out = out.replace(w.re, w.znacznik);
  out = bezLoginu(out, login);
  return out as TrescBezpieczna;
}

/**
 * Czy w tekście ZOSTAŁY dane osobowe rozpoznawalne naszymi wzorcami.
 *
 * Drugi zamek, wołany PO maskowaniu i PRZED wyjściem w sieć. Fałszywy alarm
 * jest tu niemożliwy — to te same wzorce, które właśnie maskowały — więc
 * asercja jest darmowa, a łapie jedyny realny scenariusz: ktoś zepsuł
 * maskowanie, a testy tego nie objęły.
 */
export function zostalyDaneOsobowe(tekst: string): boolean {
  return WZORCE.some((w) => new RegExp(w.re.source, w.re.flags).test(tekst));
}
