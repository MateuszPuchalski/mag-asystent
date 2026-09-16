import { db } from "../db/db.js";
import { mediana, OKNO } from "./raporty.js";

/**
 * Ile trwa wymiana między halą a biurem — własność „Miara".
 *
 * DLACZEGO TO POWSTAŁO. §22 projektu panelu wymienia „czas realizacji zadania
 * magazynowego" wśród metryk biznesowych i nie podaje przy nim ani progu, ani
 * miejsca pomiaru. W kodzie nie było go wcale: znaczniki obu końców każdej
 * wymiany leżą w bazie od lat — `utworzono_at`/`wykonano_at` przy zadaniach,
 * `created_at`/`resolved_at` przy niezgodnościach, `pominieto_at`/
 * `zalatwione_at` przy koszu — i NIKT NIGDY nie liczył różnicy. Trzy miejsca
 * czytały `wykonano_at`, żeby go WYŚWIETLIĆ.
 *
 * MEDIANA I OGON, NIGDY ŚREDNIA. Jedna sprawa sprzed tygodnia utopiłaby sto
 * załatwionych w kwadrans, a właśnie ta jedna jest tu treścią. `p90` mówi,
 * jak wygląda zły dzień; mediana — jak wygląda zwykły.
 *
 * KAŻDA LICZBA NIESIE SWOJE `n`. Reguła z raportu wydajności magazynu:
 * mediana z czterech spraw i tak zostanie przeczytana jako werdykt, więc
 * liczba spraw jedzie obok, a nie w przypisie.
 *
 * CZEGO TU NIE MA: PROGU „ZA PÓŹNO". Żadna liczba godzin nie jest ustaleniem
 * właściciela — §22 wymienia metrykę i nie podaje terminu. Raport pokazuje,
 * ile trwa; czy to długo, rozstrzyga człowiek. Termin wpisany tutaj byłby
 * werdyktem, którego nikt nie wydał.
 *
 * OTWARTE LICZĄ SIĘ OSOBNO i to nie jest ozdoba: wymiana, która trwa DO DZIŚ,
 * nie ma czasu zamknięcia, więc nie wchodzi do mediany — a bywa najgorsza
 * z całej listy. Bez kolumny „najstarsza otwarta" raport pokazywałby wyłącznie
 * sprawy, które ktoś domknął, czyli mierzył własny sukces.
 */

export interface WierszWymiany {
  /** Klucz kanału — polszczyzna stoi na ekranie, nie w API. */
  kanal: "zadanie" | "niezgodnosc" | "pominiecie" | "kolizja" | "notatka";
  /** Kierunek: kto na kogo czeka, gdy sprawa stoi. */
  kierunek: "biuro→hala" | "hala→biuro";
  zamknietych: number;
  medianaMin: number | null;
  p90Min: number | null;
  otwartych: number;
  najstarszaOtwartaMin: number | null;
}

/** Dziewięćdziesiąty percentyl metodą najbliższej rangi — bez interpolacji. */
export function p90(liczby: number[]): number | null {
  if (liczby.length === 0) return null;
  const s = [...liczby].sort((a, b) => a - b);
  /* Najbliższa ranga, nie interpolacja: przy ośmiu sprawach interpolacja
     zwróciłaby liczbę, której żadna sprawa nie miała — a ten raport ma mówić
     o sprawach, nie o rozkładzie. */
  return s[Math.min(s.length - 1, Math.ceil(0.9 * s.length) - 1)];
}

const MINUTA = 60_000;
const zaokr = (v: number | null) => (v === null ? null : Math.round(v));

/** Minuty między dwoma znacznikami ISO; `null`, gdy któregoś nie ma. */
function minuty(od: string | null | undefined, do_: string | null | undefined): number | null {
  if (!od || !do_) return null;
  const m = (Date.parse(do_) - Date.parse(od)) / MINUTA;
  /* Ujemne odpadają zamiast psuć medianę. Biorą się z ręcznych poprawek
     znaczników i z zegara maszyny przestawionego wstecz — ta sama ostrożność
     co przy czasie do wyboru w raporcie skuteczności doboru. */
  return Number.isFinite(m) && m >= 0 ? m : null;
}

function wiersz(
  kanal: WierszWymiany["kanal"],
  kierunek: WierszWymiany["kierunek"],
  zamkniete: number[],
  otwarte: number[],
): WierszWymiany {
  return {
    kanal,
    kierunek,
    zamknietych: zamkniete.length,
    medianaMin: zaokr(mediana(zamkniete)),
    p90Min: zaokr(p90(zamkniete)),
    otwartych: otwarte.length,
    najstarszaOtwartaMin: otwarte.length ? zaokr(Math.max(...otwarte)) : null,
  };
}

interface Kanal {
  kanal: WierszWymiany["kanal"];
  kierunek: WierszWymiany["kierunek"];
  /** Minuty spraw ZAMKNIĘTYCH — surowo, bo alarm liczy z nich własny próg. */
  zamkniete: number[];
  /** Minuty spraw trwających DO DZIŚ, liczone do `teraz`. */
  otwarte: number[];
}

/**
 * Pięć kanałów, jedno okno czasu — surowe minuty, nie podsumowania.
 *
 * SUROWE, BO CZYTELNICY SĄ DWAJ. Tabela robi z tego medianę i ogon, alarm
 * niżej — próg i listę spóźnionych. Druga kopia tych czterech zapytań
 * rozjechałaby się z pierwszą przy pierwszej zmianie definicji kanału,
 * a wtedy tabela i alarm mówiłyby o dwóch różnych zbiorach spraw pod
 * jedną nazwą. To gorsze niż brak alarmu.
 *
 * NOTATKI DOSZŁY W 0.366.0, A ICH WYŁĄCZENIE BYŁO POMYŁKĄ. 0.361.0 zostawiło
 * je poza miarą z uzasadnieniem „odpowiedź na notatkę bywa rozmową na kilka
 * tur, więc czas wymiany znaczyłby tam co innego". To zdanie jest NIEPRAWDZIWE
 * o tej tabeli i mówi to sam kod: `odpowiedzNaNotatke` odmawia nadpisania,
 * bo „odpowiedź jest jedna i ostateczna", a nowe ustalenie to NOWA NOTATKA.
 * Rozmowa na kilka tur to kilka notatek, z których każda jest osobną wymianą
 * o dwóch końcach — czyli dokładnie tym, co ta funkcja mierzy. Uzasadnienie
 * przyszło z `conversation_event` w panelu obsługi, gdzie rzeczywiście jest
 * wątkiem, i zostało przeniesione na strukturę, która działa inaczej.
 *
 * TEN KANAŁ JEST ZRESZTĄ JEDYNYM, W KTÓRYM BRAK ODPOWIEDZI WSTRZYMUJE PRACĘ:
 * `czekaNaOdpowiedz` nie pozwala domknąć dostawy, póki notatka wisi bez
 * odpowiedzi. Sprawa o najwyższej stawce z całej piątki siedziała poza miarą
 * i poza alarmem.
 */
function zbierzKanaly(dni: number, teraz: number): Kanal[] {
  const okno = OKNO(dni);
  const granica = "strftime('%Y-%m-%dT%H:%M:%fZ','now',?)";

  /* ── Zadania terenowe: zlecenie → wynik ALBO odesłanie ──────────────────
     Odesłanie liczy się jako zamknięcie, bo hala odpowiedziała. Gdyby nie
     liczyło, „czas realizacji" mierzyłby wyłącznie zadania, które się udały —
     a te trudne wypadałyby z miary właśnie dlatego, że były trudne. */
  const zadania = db().prepare(
    `SELECT utworzono_at AS od, COALESCE(wykonano_at, odeslano_at) AS domkniete, status
       FROM zadanie_terenowe WHERE utworzono_at >= ${granica}`
  ).all(okno) as Array<{ od: string; domkniete: string | null; status: string }>;

  const nadal = (s: string) => s === "nowe" || s === "w_toku";
  const zadaniaZamkniete = zadania
    .map((z) => (nadal(z.status) ? null : minuty(z.od, z.domkniete)))
    .filter((m): m is number => m !== null);
  const zadaniaOtwarte = zadania
    .filter((z) => nadal(z.status))
    .map((z) => minuty(z.od, new Date(teraz).toISOString()))
    .filter((m): m is number => m !== null);

  /* ── Niezgodności w dostawie: zgłoszenie → zamknięcie przez biuro ─────── */
  const problemy = db().prepare(
    `SELECT created_at AS od, resolved_at AS domkniete
       FROM problem WHERE created_at >= ${granica}`
  ).all(okno) as Array<{ od: string; domkniete: string | null }>;

  /* ── Pominięcia w koszu: pominięcie → załatwienie ─────────────────────── */
  const pominiecia = db().prepare(
    `SELECT pominieto_at AS od, zalatwione_at AS domkniete
       FROM kosz_pozycja WHERE pominieto_at IS NOT NULL AND pominieto_at >= ${granica}`
  ).all(okno) as Array<{ od: string; domkniete: string | null }>;

  /* ── Kolizje kodów: PIERWSZE trafienie → decyzja biura ─────────────────
     Pierwsze, nie ostatnie: sprawa zaczyna się wtedy, gdy kod zatrzymał
     kogoś po raz pierwszy, a nie gdy zatrzymał po raz dwudziesty. */
  const kolizje = db().prepare(
    `SELECT MIN(c.seen_at) AS od, r.at AS domkniete
       FROM ean_conflict c LEFT JOIN ean_rozstrzygniecie r ON r.ean = c.ean
      WHERE c.seen_at >= ${granica} GROUP BY c.ean`
  ).all(okno) as Array<{ od: string; domkniete: string | null }>;

  const rozbij = (w: Array<{ od: string; domkniete: string | null }>) => {
    const zamkniete: number[] = [];
    const otwarte: number[] = [];
    for (const r of w) {
      const m = r.domkniete
        ? minuty(r.od, r.domkniete)
        : minuty(r.od, new Date(teraz).toISOString());
      if (m === null) continue;
      (r.domkniete ? zamkniete : otwarte).push(m);
    }
    return { zamkniete, otwarte };
  };

  /* ── Notatki do dostaw: pytanie biura → odpowiedź hali ─────────────────
     Trzeci znacznik (`odp_widziana_at`, odczyt odpowiedzi przez biuro) do
     miary NIE wchodzi: wymiana kończy się, gdy hala odpowiedziała. Kiedy
     biuro odpowiedź przeczytało, jest osobnym pytaniem i ma własny licznik
     w nagłówku panelu od 0.57.0. */
  const notatki = db().prepare(
    `SELECT created_at AS od, odp_at AS domkniete
       FROM delivery_note WHERE created_at >= ${granica}`
  ).all(okno) as Array<{ od: string; domkniete: string | null }>;

  const p = rozbij(problemy);
  const k = rozbij(pominiecia);
  const e = rozbij(kolizje);
  const n = rozbij(notatki);

  return [
    { kanal: "zadanie", kierunek: "biuro→hala", zamkniete: zadaniaZamkniete, otwarte: zadaniaOtwarte },
    { kanal: "niezgodnosc", kierunek: "hala→biuro", zamkniete: p.zamkniete, otwarte: p.otwarte },
    { kanal: "pominiecie", kierunek: "hala→biuro", zamkniete: k.zamkniete, otwarte: k.otwarte },
    { kanal: "kolizja", kierunek: "hala→biuro", zamkniete: e.zamkniete, otwarte: e.otwarte },
    { kanal: "notatka", kierunek: "biuro→hala", zamkniete: n.zamkniete, otwarte: n.otwarte },
  ];
}

export function czasyWymiany(dni = 30, teraz = Date.now()): {
  dni: number;
  wiersze: WierszWymiany[];
} {
  return {
    dni,
    wiersze: zbierzKanaly(dni, teraz).map((k) =>
      wiersz(k.kanal, k.kierunek, k.zamkniete, k.otwarte)
    ),
  };
}

/* ── ALARM: co stoi dłużej, niż stoi zwykle (0.364.0) ─────────────────────────
 *
 * DLACZEGO PRÓG NIE JEST WPISANY RĘKĄ. Poprzednie wydanie zostawiło tę rzecz
 * otwartą z uzasadnieniem, które było SŁABSZE, niż wyglądało: „§22 nie podaje
 * terminu, więc terminu nie ma". To prawda o §22 i nieprawda o systemie —
 * termin da się WYMIERZYĆ zamiast ogłaszać. Sprawa jest spóźniona, gdy stoi
 * dłużej niż dziewięć na dziesięć spraw TEGO SAMEGO KANAŁU, które w tym oknie
 * ktoś domknął. Taki próg nie jest niczyim werdyktem: jest zdaniem o własnej
 * historii firmy i da się go sprawdzić, patrząc na te same dane.
 *
 * PRÓG OSOBNY DLA KAŻDEGO KANAŁU, bo jedna liczba byłaby zła dla co najmniej
 * trzech. Kolizja kodu czeka na decyzję biura przy biurku; zadanie terenowe
 * wymaga przejścia przez halę. Wspólne „cztery godziny" alarmowałoby przy
 * każdej kolizji i przy żadnym zadaniu.
 *
 * CZEGO TEN ALARM NIE MÓWI — i to jest jego prawdziwa granica. Wykrywa
 * ODSTAJĄCE OD WŁASNEJ NORMY, nie ZŁE. Magazyn, w którym każda sprawa stoi
 * trzy dni, ma próg trzech dni i milczy. Na to potrzebna jest liczba
 * właściciela i pytanie o nią zostaje otwarte — ale alarm z własnej historii
 * działa DZIŚ i przyjmie tamtą liczbę bez przebudowy: wystarczy, żeby
 * `progKanalu` zwróciło ją zamiast `p90`.
 */

/**
 * Ile spraw musi być zamkniętych, zanim `p90` znaczy cokolwiek.
 *
 * DZIESIĘĆ Z ARYTMETYKI, NIE Z WYCZUCIA. `p90` liczy się najbliższą rangą:
 * indeks to `ceil(0.9·n) − 1`. Dla `n = 9` wychodzi `ceil(8.1) − 1 = 8`,
 * czyli OSTATNI element — próg równy najdłuższej sprawie, jaka się zdarzyła.
 * Alarm z takim progiem nie zapala się nigdy, a wygląda, jakby działał. To
 * gorsze od jego braku, bo cisza znaczy wtedy dwie różne rzeczy. Dopiero
 * `n = 10` daje `ceil(9) − 1 = 8`, czyli dziewiątą z dziesięciu — pierwszy
 * `n`, przy którym ogon jest naprawdę odcięty.
 */
export const MIN_SPRAW = 10;

/**
 * Podłoga progu: nic młodszego niż godzina nie jest spóźnione.
 *
 * Kanał, w którym wszystko domyka się w trzy minuty, miałby `p90` rzędu
 * kilku minut — i alarmowałby przy sprawie sprzed kwadransa, czyli przy
 * NORMALNEJ pracy. Alarm zapalający się codziennie uczy, że alarm nic nie
 * znaczy, i zabiera ten jedyny sygnał także tym sprawom, które naprawdę stoją.
 */
export const PROG_MIN_MINUT = 60;

export interface AlarmKanalu {
  kanal: WierszWymiany["kanal"];
  kierunek: WierszWymiany["kierunek"];
  /** Minuty, powyżej których sprawa jest spóźniona; `null` = za mało historii. */
  progMin: number | null;
  /** Skąd wziął się próg — ekran ma powiedzieć to wprost, nie podać gołą liczbę. */
  podstawa: "p90" | "podloga" | "za_malo_spraw";
  /** Ile zamkniętych spraw złożyło się na próg. Każda liczba niesie swoje `n`. */
  n: number;
  spoznionych: number;
  najstarszaSpoznionaMin: number | null;
}

/**
 * Próg jednego kanału.
 *
 * Podłoga wygrywa z `p90`, gdy `p90` jest od niej niższe — i wtedy `podstawa`
 * mówi „podłoga", bo ekran nie ma prawa pokazywać liczby wyliczonej z danych,
 * gdy ta akurat z danych nie pochodzi.
 */
export function progKanalu(zamkniete: number[]): {
  progMin: number | null;
  podstawa: AlarmKanalu["podstawa"];
} {
  if (zamkniete.length < MIN_SPRAW) return { progMin: null, podstawa: "za_malo_spraw" };
  const ogon = p90(zamkniete) as number;
  return ogon >= PROG_MIN_MINUT
    ? { progMin: Math.round(ogon), podstawa: "p90" }
    : { progMin: PROG_MIN_MINUT, podstawa: "podloga" };
}

/**
 * Pięć kanałów, pięć własnych progów, jedno stałe okno.
 *
 * OKNO JEST STAŁE I NIE BIERZE SIĘ Z EKRANU. Tabela obok ma suwak dni, alarm
 * nie ma go celowo: sygnał, który zmienia treść przy przestawieniu listy
 * rozwijanej, nie jest sygnałem, tylko widokiem. Trzydzieści dni, zawsze te
 * same, na każdej zakładce.
 */
export function alarmyWymiany(dni = 30, teraz = Date.now()): {
  dni: number;
  minSpraw: number;
  progMinMinut: number;
  spoznionychRazem: number;
  kanaly: AlarmKanalu[];
} {
  const kanaly = zbierzKanaly(dni, teraz).map((k): AlarmKanalu => {
    const { progMin, podstawa } = progKanalu(k.zamkniete);
    const spoznione = progMin === null ? [] : k.otwarte.filter((m) => m > progMin);
    return {
      kanal: k.kanal,
      kierunek: k.kierunek,
      progMin,
      podstawa,
      n: k.zamkniete.length,
      spoznionych: spoznione.length,
      najstarszaSpoznionaMin: spoznione.length ? Math.round(Math.max(...spoznione)) : null,
    };
  });
  return {
    dni,
    minSpraw: MIN_SPRAW,
    progMinMinut: PROG_MIN_MINUT,
    spoznionychRazem: kanaly.reduce((a, k) => a + k.spoznionych, 0),
    kanaly,
  };
}
