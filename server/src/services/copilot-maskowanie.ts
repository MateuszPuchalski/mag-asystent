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
     dłuższego ciągu — ten i tak zniknął wyżej jako konto.

     ZAWĘŻENIE PO KONTEKŚCIE (decyzja właściciela z 8.09.2026, przyrost
     ekstrakcji). Numer OEM Husqvarny „532 19 93-77" ma dokładnie kształt
     telefonu i do tego wydania znikał jako `[telefon]` — klasyfikacji
     wystarczał ślad, ale rozpoznanie danych doboru ma ten numer ODDAĆ.
     Dziewięć cyfr tuż po słowie OEM / nr / numer / symbol / kod nie jest
     telefonem. Cena zapisana świadomie: „nr 532199377" podany jako telefon
     bez słowa „tel" przejdzie do dostawcy; „nr tel. 532…" znika dalej, bo
     tuż przed cyframi stoi „tel", nie „nr". */
  { nazwa: "telefon", znacznik: "[telefon]",
    re: /(?<![\d-])(?<!\b(?:oem|nr|numer|symbol|kod)\s*[:.]?\s*)(?:(?:\+|00)\s?48[\s-]?)?(?:\d[\s-]?){8}\d(?![\d-])/gi },
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

/* ── MASKOWANIE ODWRACALNE: SZKIC Z POLA AGENTA ─────────────────────────────
   „Dopytaj Copilota" poprawia tekst, który agent ma w polu odpowiedzi,
   i oddaje go CAŁY. Ten tekst niesie to samo, co nasze wychodzące w wątku:
   agent przepisuje klientowi jego adres albo telefon. Do dostawcy idzie więc
   zamaskowany jak wątek, ale wrócić musi z wartościami, bo trafia z powrotem
   do pola, a stamtąd do klienta.

   KAŻDA RÓŻNA WARTOŚĆ DOSTAJE WŁASNY NUMER, bo wzorce łapią też nasze numery
   części: dziewięć cyfr bez „nr" czy „OEM" to dla nich telefon, a „46-450
   Husqvarna" to kod z miastem. Szkic z dwoma takimi numerami pod jednym gołym
   `[telefon]` nie dałby się odmaskować bez zgadywania, który był który.

   Znacznik, którego nie wydaliśmy, oznacza daną, której model nie widział.
   `odmaskuj` go nie zgaduje: zwraca go w `obce`, a serwis odrzuca wersję. */

/**
 * Kształt znacznika danych, także cudzego: goły `[telefon]` z wątku, numer,
 * którego nie wydaliśmy, i dopisek w rodzaju `[telefon klienta]`.
 */
const ZNACZNIK_DANYCH = /\[(?:telefon|e-mail|email|adres|konto|login)\b[^\]\n]{0,20}\]/gi;

/** Klucz znacznika: model bywa zmienia wielkość liter albo odstęp, a to ten sam znacznik. */
const kluczZnacznika = (z: string) => z.toLowerCase().replace(/\s+/g, " ");

export interface MaskaOdwracalna {
  tresc: TrescBezpieczna;
  /**
   * Wydane znaczniki z powrotem na wartości. Każdy inny znacznik danych
   * zostaje w tekście i trafia do `obce`: tej wartości model nie widział.
   */
  odmaskuj(s: string): { tresc: string; obce: string[] };
}

/**
 * Maskowanie z pamięcią: te same wzorce w tej samej kolejności co `zamaskuj`,
 * ale każda różna wartość dostaje numerowany znacznik, a powtórzona ten sam.
 */
export function zamaskujOdwracalnie(tresc: string, login: string | null): MaskaOdwracalna {
  /* Klucz znacznika → oryginał. Znacznik stojący w tekście JUŻ PRZED
     maskowaniem jest tekstem, nie daną, więc wraca sam za siebie, a numeracja
     go omija. Inaczej `[telefon 1]` wpisany ręcznie dostałby cudzą wartość. */
  const wartosci = new Map<string, string>();
  for (const z of tresc.match(ZNACZNIK_DANYCH) ?? []) wartosci.set(kluczZnacznika(z), z);
  const wydane = new Map<string, string>();
  const licznik = new Map<string, number>();

  /* Linia adresowa zjada resztę linii, a w niej bywa wydany już znacznik
     e-maila. Wartość zapisujemy więc w pełni rozwiniętą: odmaskowanie ma być
     jednym przebiegiem, a ta sama wartość ma dostać ten sam numer. */
  const rozwin = (s: string) => s.replace(ZNACZNIK_DANYCH, (z) => wartosci.get(kluczZnacznika(z)) ?? z);
  const wydaj = (nazwa: string, trafienie: string): string => {
    const oryginal = rozwin(trafienie);
    const k = `${nazwa}\u0000${oryginal}`;
    const jest = wydane.get(k);
    if (jest) return jest;
    let n = licznik.get(nazwa) ?? 0;
    let znacznik: string;
    do { n += 1; znacznik = `[${nazwa} ${n}]`; } while (wartosci.has(kluczZnacznika(znacznik)));
    licznik.set(nazwa, n);
    wartosci.set(kluczZnacznika(znacznik), oryginal);
    wydane.set(k, znacznik);
    return znacznik;
  };

  let out = tresc;
  for (const w of WZORCE) out = out.replace(w.re, (m) => wydaj(w.nazwa, m));

  /* Login jak w `bezLoginu`, z tym samym progiem trzech znaków, ale omija
     wydane znaczniki: login „adres" nie ma prawa rozciąć `[adres 1]`.
     `[login]` wraca do pierwszej spotkanej pisowni; gdy loginu w tekście nie
     było, znacznik jest cudzy, bo model wziął go z wątku, nie z pola. */
  const l = (login ?? "").trim();
  if (l.length >= 3) {
    const esc = l.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    let pierwszy = null as string | null;
    out = out.replace(new RegExp(`(${ZNACZNIK_DANYCH.source})|${esc}`, "gi"), (m, znacznik?: string) => {
      if (znacznik) return m;
      pierwszy ??= m;
      return "[login]";
    });
    if (pierwszy !== null) wartosci.set("[login]", pierwszy);
  }

  return {
    tresc: out as TrescBezpieczna,
    odmaskuj(s: string) {
      const obce: string[] = [];
      const t = s.replace(ZNACZNIK_DANYCH, (z) => {
        const w = wartosci.get(kluczZnacznika(z));
        if (w !== undefined) return w;
        if (!obce.includes(z)) obce.push(z);
        return z;
      });
      return { tresc: t, obce };
    },
  };
}

/**
 * Jedna wiadomość wątku do zamaskowania — kierunek i treść BEZ stopki.
 * `odAllegro` — doradca albo komunikat Allegro w Problemie z zakupem
 * (`glos-allegro.ts`). Przychodzi jak klient, ale klientem nie jest, więc
 * model dostaje go pod własną etykietą.
 */
export interface WiadomoscWatku { odKlienta: boolean; tresc: string; odAllegro?: boolean }

/**
 * Sufit wątku wysyłanego dostawcy (polityka danych skrzynki, 0.231.0).
 * Liczony od NAJNOWSZEJ wiadomości: to ona niesie pytanie, na które szkic ma
 * odpowiedzieć, a dwunasta wstecz bywa już inną sprawą tego samego klienta.
 */
export const SUFIT_WATKU = { wiadomosci: 12, znakow: 6000 } as const;

export const ZNACZNIK_POMINIETYCH = "[wcześniejsze wiadomości pominięte]";

/**
 * Cały wątek jako jeden bezpieczny tekst — decyzja właściciela z 7 września
 * 2026 dla szkicu odpowiedzi (klasyfikacja dalej bierze jedną wiadomość).
 *
 * Nasze wychodzące też przechodzą przez maskowanie: agent bywa cytuje klienta
 * („proszę o adres — Polna 7, tak?"), a `zamaskuj()` nie wie, kto napisał
 * zdanie. Sufit tnie od najstarszej, zostawiając jeden znacznik: model ma
 * wiedzieć, że coś było wcześniej, ale nie ma się tego domyślać.
 */
export function zamaskujWatek(wiadomosci: WiadomoscWatku[], login: string | null): TrescBezpieczna {
  return zamaskujWatekZeSladem(wiadomosci, login).tresc;
}

/**
 * To samo co `zamaskujWatek`, plus ŚLAD tego, co weszło (klasyfikacja, 22
 * września 2026). Specyfikacja każe zapisać przy decyzji, na czym ją liczono
 * i czy kontekst był ucięty — liczone z tekstu po fakcie myliłoby się przy
 * wiadomościach wielowierszowych, więc liczy to pętla, która tnie.
 *
 * `ile` to liczba wiadomości od KOŃCA listy, które weszły do tekstu.
 */
export function zamaskujWatekZeSladem(
  wiadomosci: WiadomoscWatku[], login: string | null,
): { tresc: TrescBezpieczna; ile: number; uciety: boolean } {
  const linie: string[] = [];
  let znakow = 0;
  let pominieto = false;
  for (const w of [...wiadomosci].reverse()) {
    const kto = w.odAllegro ? "ALLEGRO" : w.odKlienta ? "KLIENT" : "MY";
    const linia = `${kto}: ${String(zamaskuj(w.tresc, login)).trim()}`;
    if (linie.length >= SUFIT_WATKU.wiadomosci || znakow + linia.length > SUFIT_WATKU.znakow) {
      pominieto = true;
      break;
    }
    linie.unshift(linia);
    znakow += linia.length;
  }
  const ile = linie.length;
  if (pominieto) linie.unshift(ZNACZNIK_POMINIETYCH);
  return { tresc: linie.join("\n") as TrescBezpieczna, ile, uciety: pominieto };
}

/**
 * Blok z nagłówkiem jako jeden bezpieczny tekst (0.282.0).
 *
 * Fakty ze sprawy idą tą samą drogą co wątek i to nie jest formalność: tytuł
 * aukcji bywa wklejony z nazwiskiem, a opis zgłoszenia z adresem, pod który
 * klient prosi o kuriera. Nagłówek NIE przechodzi przez maskowanie — piszemy
 * go my, nie klient — ale treść tak.
 */
export function zamaskujBlok(
  naglowek: string, tresc: string, login: string | null,
): TrescBezpieczna {
  return `${naglowek}\n${String(zamaskuj(tresc, login))}` as TrescBezpieczna;
}

/**
 * Sklejenie kilku bezpiecznych kawałków.
 *
 * Bezpieczne z definicji: łańcuch złożony z samych zamaskowanych łańcuchów nie
 * może zawierać nic, czego nie było w żadnym z nich. Rzut typu zostaje
 * WEWNĄTRZ strażnika, więc wołający dalej nie umie wyprodukować marki sam.
 */
export function polacz(...czesci: TrescBezpieczna[]): TrescBezpieczna {
  return czesci.filter((c) => String(c).trim() !== "").join("\n\n") as TrescBezpieczna;
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
