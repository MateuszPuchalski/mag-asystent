import { db } from "../db/db.js";
import { licznikOtwartych, licznikiPytan, stanSynchronizacjiPytan } from "./pytania.js";
import { licznikDyskusji, stanSynchronizacjiDyskusji } from "./dyskusje.js";
import { listaReklamacji, terminReklamacji } from "./reklamacje.js";
import { mapaZrodel, type WpisMapyZrodel } from "./sprawa.js";
import { metaHurtem } from "./watek-meta.js";

/* ── Sprawy — cztery rejestry Allegro, jedna kolejka pracy ───────────────────
   Pytania, zwroty, dyskusje i reklamacje to w backendzie osobne obiekty
   Allegro i osobne tabele — i tak ma zostać. Ale biuro nie pracuje
   w czterech modułach: pyta „co mam teraz zrobić?", a odpowiedź na to
   pytanie musi widzieć wszystkie cztery naraz. Ten moduł składa je w jedną
   listę SPRAW: wspólny kształt wiersza, wspólny sort po pilności (ustawowy
   termin przed wiekiem), wspólny licznik na zakładkę.

   WYŁĄCZNIE ODCZYT. Mutacje zostają w serwisach per-typ — sprawa w kolejce
   to widok na cudzy rejestr, nie nowy byt z własnym stanem.

   Predykaty „otwartości" są PRZEPISANE z serwisów źródłowych (wskazanych
   przy każdym SELECT); test w sprawy.test.ts porównuje liczby z tamtymi
   serwisami, żeby dopisany komuś status nie schował spraw z głównej kolejki. */

export type RodzajSprawy = "pytanie" | "zwrot" | "dyskusja" | "reklamacja";

export const RODZAJE_SPRAW: RodzajSprawy[] = ["pytanie", "zwrot", "dyskusja", "reklamacja"];

/**
 * Kto ma wykonać następny ruch (0.129.0) — najważniejszy stan sprawy z zasady
 * 2 w docs/architektura-spraw.md. Trzy wartości, nie cztery: ŚWIAT
 * (przewoźnik, Allegro) nie ma dziś producenta danych — tracking czyta się na
 * żądanie i nigdzie nie zapisuje, a zapowiedzi zwrotów nie są źródłem sprawy.
 * Dołożenie go później to jedna wartość w unii i jedno pasmo.
 *
 * PIŁKA JEST PROJEKCJĄ, nie kolumną: liczy się przy odczycie ze statusów
 * rejestrów i `watek_meta`, więc nie może się zestarzeć — dokładnie tak samo
 * jak termin i tytuł sprawy (patrz komentarz przy tabeli `sprawa`).
 */
export type Pilka = "my" | "klient" | "nikt";

/** Im mniej, tym pilniej — po tym redukuje się piłka sprawy i sortuje ogon. */
const RANGA_PILKI: Record<Pilka, number> = { my: 0, klient: 1, nikt: 2 };

export interface Sprawa {
  rodzaj: RodzajSprawy;
  /** Id w rejestrze źródłowym; dla reklamacji to id POZYCJI zwrotu. */
  id: number;
  klient: string | null;
  /** Co biuro widzi w wierszu: temat, tytuł oferty albo nazwa towaru. */
  tytul: string | null;
  /** Checkout-form id Allegro — klucz ciągu „to samo zamówienie". */
  orderId: string | null;
  status: string;
  /** Kiedy sprawa się zaczęła — po tym sortuje się ogon bez terminu. */
  kiedy: string | null;
  /** Ustawowy zegar (reklamacje i CLAIM-y); null = sprawa bez terminu. */
  dniDoTerminu: number | null;
  poTerminie: boolean;
  prowadzi: string | null;
  /** Pytania: klient dopisał po zarejestrowaniu sprawy (stempluje sync).
      Panel czyta to z pulsu klienta co cykl — z NASZEJ bazy, nie z Allegro. */
  nowaWiadomoscAt?: string | null;
  /** Dla reklamacji: zwrot, który UI ma otworzyć — reklamacja nie ma szczegółu. */
  zwrotId?: number;
  /** Dyskusje: `CLAIM` ma ustawowy zegar, zwykła dyskusja nie. Do 0.121.0
      kolejka pokazywała obu tę samą plakietkę DYSKUSJA — a to dwie różne
      pilności pod jedną nazwą. */
  typ?: string | null;
  /** Dyskusje: czy odpowiadaliśmy przez WERTIS. Kolejka NIE WIE, czy sprawa
      czeka na nas — synchronizacja czyta status z Allegro, nie treść rozmowy
      (pytania mają ten mechanizm, dyskusje nie). To jedyny lokalny ślad, po
      którym da się odróżnić dyskusję w toku od takiej, której nikt nie tknął
      od pobrania; panel składa z niego pasmo „bez potwierdzenia". */
  odpowiadalismy?: boolean;
  /** Sprawa zamknięta trafia tylko do historii klienta, nigdy do kolejki. */
  otwarta: boolean;
  /** Kto ma ruch (0.129.0). Pole WYMAGANE — sprawa bez piłki dałaby NaN
      w sorcie i cichy rozjazd kolejki z pasmami. */
  pilka: Pilka;
  /** Id encji sprawy (0.128.0); null = pseudo-sprawa, której rekoncyliacja
      jeszcze nie widziała — źródło i tak stoi w kolejce (siatka
      bezpieczeństwa: brak przebudowy nie ma prawa zgubić sprawy). */
  sprawaId?: number | null;
  /** Wszystkie źródła sprawy — plakietki w wierszu i stemple przejęcia. */
  zrodla?: Array<{ rodzaj: RodzajSprawy; id: number; otwarte: boolean }>;
  /** Odmaskowany identyfikator kupującego — nośnik podpowiedzi powiązań. */
  kupujacyId?: string | null;
}

const wiersz = (r: Record<string, unknown>) => r as Record<string, unknown>;

/* ── Wspólny sort kolejki ────────────────────────────────────────────────────
   Ustawowy termin, potem PIŁKA, na końcu wiek. Pasma w panelu czytają
   dokładnie te pola i w tej kolejności — inaczej pasmo przeplatałoby wiersze
   i ekran twierdziłby coś innego, niż pokazuje.                              */

/** Ranga terminowa: po terminie, z biegnącym zegarem, bez zegara. */
const rangaTerminu = (s: Sprawa) => (s.poTerminie ? 0 : s.dniDoTerminu !== null ? 1 : 2);

function poPilnosci(a: Sprawa, b: Sprawa): number {
  /* Ten podział ODTWARZA dotychczasową kolejność — sprawa po terminie ma
     ujemne `dniDoTerminu`, więc i tak stała pierwsza — tylko nazywa ją
     wprost, żeby piłka mogła wejść NIŻEJ, a nie zamiast niej. */
  const ra = rangaTerminu(a);
  const rb = rangaTerminu(b);
  if (ra !== rb) return ra - rb;
  if (ra < 2 && a.dniDoTerminu !== b.dniDoTerminu) {
    return a.dniDoTerminu! - b.dniDoTerminu!;
  }
  /* Ustawowy termin dalej bije wszystko; piłka rozstrzyga OGON kolejki,
     w którym dotąd decydował sam wiek. Sprawa czekająca NA NAS idzie przed
     tą, w której piłka jest u klienta — nawet jeśli tamta jest starsza. */
  const pa = RANGA_PILKI[a.pilka] ?? 9;
  const pb = RANGA_PILKI[b.pilka] ?? 9;
  if (pa !== pb) return pa - pb;
  const aOd = a.kiedy ? Date.parse(a.kiedy) : Infinity;
  const bOd = b.kiedy ? Date.parse(b.kiedy) : Infinity;
  return aOd - bOd;
}

/** Skrót treści do wiersza kolejki — pytanie bywa trzema akapitami. */
function skrot(tekst: string | null): string | null {
  if (!tekst) return null;
  const t = tekst.replace(/\s+/g, " ").trim();
  return t.length > 90 ? `${t.slice(0, 87)}…` : t;
}

function sprawyPytan(gdzie: string, param: unknown[]): Sprawa[] {
  const rows = db()
    .prepare(
      `SELECT id, kupujacy_login, oferta_tytul, tresc, status, otrzymano_at, prowadzi,
              nowa_wiadomosc_at
       FROM pytanie WHERE ${gdzie} ORDER BY id DESC LIMIT 500`
    )
    .all(...(param as never[])) as Array<Record<string, unknown>>;
  return rows.map((r0) => {
    const r = wiersz(r0);
    const status = (r.status as string) ?? "nowe";
    return {
      rodzaj: "pytanie" as const,
      id: Number(r.id),
      klient: (r.kupujacy_login as string) ?? null,
      tytul: (r.oferta_tytul as string) ?? skrot((r.tresc as string) ?? null),
      orderId: null, // pytanie wisi przy ofercie, nie przy zamówieniu
      status,
      kiedy: (r.otrzymano_at as string) ?? null,
      dniDoTerminu: null,
      poTerminie: false,
      prowadzi: (r.prowadzi as string) ?? null,
      nowaWiadomoscAt: (r.nowa_wiadomosc_at as string) ?? null,
      /* Ta sama para co worklista pytań (services/pytania.ts, listaPytan). */
      otwarta: status === "nowe" || status === "szkic",
      /* Pytanie otwarte ZAWSZE czeka na nas — i to nie jest domysł:
         synchronizacja rejestruje wątek tylko wtedy, gdy ostatnie słowo
         należy do klienta (`ostatniaSeriaKupujacego`). Wysłane pytanie jest
         sprawą ZAMKNIĘTĄ, a dopisek klienta zakłada nowy wiersz — dlatego
         nie ma tu stanu „otwarte, ale czeka na klienta". Ma go jako jedyna
         dyskusja: ona jednym wątkiem toczy się dalej po naszej odpowiedzi. */
      pilka: (status === "nowe" || status === "szkic" ? "my" : "nikt") as Pilka,
    };
  });
}

function sprawyZwrotow(gdzie: string, param: unknown[]): Sprawa[] {
  const rows = db()
    .prepare(
      `SELECT id, kupujacy_login, referencja, waybill, allegro_order_id, status,
              utworzono_allegro, utworzono_at, prowadzi
       FROM zwrot WHERE ${gdzie} ORDER BY id DESC LIMIT 500`
    )
    .all(...(param as never[])) as Array<Record<string, unknown>>;
  return rows.map((r0) => {
    const r = wiersz(r0);
    const status = (r.status as string) ?? "nowy";
    return {
      rodzaj: "zwrot" as const,
      id: Number(r.id),
      klient: (r.kupujacy_login as string) ?? null,
      tytul: (r.referencja as string) ?? (r.waybill as string) ?? null,
      orderId: (r.allegro_order_id as string) ?? null,
      status,
      kiedy: (r.utworzono_allegro as string) ?? (r.utworzono_at as string) ?? null,
      dniDoTerminu: null,
      poTerminie: false,
      /* Od 0.121.0 zwrot ma własny znacznik prowadzenia — był jedynym z czterech
         rejestrów bez niego, więc jako jedyny nie dawał się wziąć z kolejki. */
      prowadzi: (r.prowadzi as string) ?? null,
      /* Jedynym terminalnym statusem zwrotu jest `rozliczony` (przeliczStatus,
         services/zwroty.ts): `nowy` czeka na ocenę, `oceniony` na zwrot
         środków. Oba są pracą biura, więc oba stoją w kolejce. */
      otwarta: status === "nowy" || status === "oceniony",
      /* Obie fazy zwrotu to praca NASZA: ocena towaru i oddanie pieniędzy.
         Klient zrobił swoje, odsyłając paczkę. */
      pilka: (status === "nowy" || status === "oceniony" ? "my" : "nikt") as Pilka,
    };
  });
}

/**
 * Piłka dyskusji — jedyna, która potrzebuje metadanych wątku.
 *
 * Głos ALLEGRO (mediator sporu) liczy się jako NASZ ruch: ktoś u nas ma na
 * to zareagować, a przy niepewności sprawa ma być WIDOCZNA, nie schowana.
 *
 * FALLBACK bez metadanych to dokładnie dotychczasowa flaga `odpowiadalismy`,
 * zawężona do przypadku, w którym naprawdę nie wiemy: dyskusja, której nikt
 * nie tknął, ląduje w CZEKA NA NAS — czyli tam, gdzie przed 0.129.0 zbierało
 * ją pasmo „bez potwierdzenia".
 */
function pilkaDyskusji(
  otwarta: boolean,
  meta: { ostatniGlos: "my" | "klient" | "allegro" | null } | undefined,
  odpowiadalismy: boolean
): Pilka {
  if (!otwarta) return "nikt";
  const glos = meta?.ostatniGlos ?? null;
  if (glos === "klient" || glos === "allegro") return "my";
  if (glos === "my") return "klient";
  return odpowiadalismy ? "klient" : "my";
}

function sprawyDyskusji(gdzie: string, param: unknown[]): Sprawa[] {
  const rows = db()
    .prepare(
      `SELECT id, allegro_id, kupujacy_login, temat, typ, status, order_id,
              utworzono_allegro, utworzono_at, prowadzi, wyslano_at
       FROM dyskusja WHERE ${gdzie} ORDER BY id DESC LIMIT 500`
    )
    .all(...(param as never[])) as Array<Record<string, unknown>>;
  const teraz = Date.now();
  /* Metadane wątków HURTEM, raz na wywołanie — i tylko gdy jest co łączyć:
     `powiazaneSprawy` woła budowniczych po kilka razy, więc zapytanie na
     pustej liście byłoby czystym marnotrawstwem. Dyskusja to JEDYNY rejestr,
     którego własne kolumny nie wiedzą, kto powiedział ostatnie słowo. */
  const meta = rows.length > 0 ? metaHurtem("dyskusja") : new Map();
  return rows.map((r0) => {
    const r = wiersz(r0);
    const status = (r.status as string) ?? "nowa";
    const typ = (r.typ as string) ?? null;
    const kiedy = (r.utworzono_allegro as string) ?? (r.utworzono_at as string) ?? null;
    /* Zegar mają tylko CLAIM-y — ta sama arytmetyka i ten sam powód liczenia
       w JS co w licznikDyskusji (services/dyskusje.ts): drugie wydanie
       terminu w SQL rozjechałoby się z listą reklamacji. */
    const zegar =
      typ === "CLAIM" && (r.utworzono_allegro as string)
        ? terminReklamacji(r.utworzono_allegro as string, teraz)
        : null;
    const otwarta = status === "nowa" || status === "w_toku";
    return {
      rodzaj: "dyskusja" as const,
      id: Number(r.id),
      klient: (r.kupujacy_login as string) ?? null,
      tytul: (r.temat as string) ?? (typ === "CLAIM" ? "Reklamacja Allegro" : "Dyskusja"),
      orderId: (r.order_id as string) ?? null,
      status,
      kiedy,
      dniDoTerminu: zegar ? zegar.dniDoTerminu : null,
      poTerminie: otwarta && zegar !== null && zegar.dniDoTerminu < 0,
      prowadzi: (r.prowadzi as string) ?? null,
      typ,
      /* WYŁĄCZNIE nasze wysyłki — odpowiedź napisana w panelu Allegro nie
         zostawia tu śladu (rozmowa mieszka w Allegro). Od 0.129.0 to już
         tylko awaryjny trop: piłkę rozstrzygają metadane wątku. */
      odpowiadalismy: (r.wyslano_at as string) != null,
      /* Ta sama para co worklista dyskusji (services/dyskusje.ts). */
      otwarta,
      pilka: pilkaDyskusji(otwarta, meta.get(r.allegro_id as string), (r.wyslano_at as string) != null),
    };
  });
}

function sprawyReklamacji(gdzie: string, param: unknown[]): Sprawa[] {
  const rows = db()
    .prepare(
      `SELECT p.id AS pozycja_id, p.zwrot_id, p.nazwa, p.rekl_wynik, p.rekl_prowadzi,
              z.kupujacy_login, z.allegro_order_id, z.utworzono_allegro, z.utworzono_at
       FROM zwrot_pozycja p JOIN zwrot z ON z.id = p.zwrot_id
       WHERE p.decyzja = 'reklamacja' AND ${gdzie}
       ORDER BY p.id DESC LIMIT 500`
    )
    .all(...(param as never[])) as Array<Record<string, unknown>>;
  const teraz = Date.now();
  return rows.map((r0) => {
    const r = wiersz(r0);
    const wynik = (r.rekl_wynik as string) ?? null;
    const kiedy = (r.utworzono_allegro as string) ?? (r.utworzono_at as string) ?? null;
    const zegar = kiedy ? terminReklamacji(kiedy, teraz) : null;
    const otwarta = wynik === null;
    return {
      rodzaj: "reklamacja" as const,
      id: Number(r.pozycja_id),
      klient: (r.kupujacy_login as string) ?? null,
      tytul: (r.nazwa as string) ?? null,
      orderId: (r.allegro_order_id as string) ?? null,
      /* Status reklamacji to jej wynik; otwarta nie ma wyniku. Ten sam
         predykat co listaReklamacji (services/reklamacje.ts). */
      status: wynik ?? "otwarta",
      kiedy,
      dniDoTerminu: otwarta && zegar ? zegar.dniDoTerminu : null,
      poTerminie: otwarta && zegar !== null && zegar.dniDoTerminu < 0,
      prowadzi: (r.rekl_prowadzi as string) ?? null,
      zwrotId: Number(r.zwrot_id),
      otwarta,
      /* Reklamacja bez werdyktu czeka na nasze rozstrzygnięcie. */
      pilka: (otwarta ? "my" : "nikt") as Pilka,
    };
  });
}

/**
 * Grupowanie źródeł w sprawy (0.128.0). Wiersz kolejki to odtąd SPRAWA:
 * `rodzaj`/`id` wskazują źródło WIODĄCE (najpilniejsze otwarte wg tego
 * samego sortu co kolejka; w historii — najświeższe), więc panel otwiera
 * i przejmuje sprawę dokładnie tak, jak dotąd otwierał źródło. Projekcja
 * pilności liczy się z rejestrów przy każdym odczycie — nie może się
 * zestarzeć. Źródło spoza `sprawa_zrodlo` zostaje pseudo-sprawą.
 */
function zgrupujWSprawy(zrodla: Sprawa[]): Sprawa[] {
  const mapa = mapaZrodel();
  const grupy = new Map<string, { wpis: WpisMapyZrodel | null; czlonkowie: Sprawa[] }>();
  for (const z of zrodla) {
    const wpis = mapa.get(`${z.rodzaj}:${z.id}`) ?? null;
    const klucz = wpis ? `s:${wpis.sprawaId}` : `p:${z.rodzaj}:${z.id}`;
    const g = grupy.get(klucz) ?? { wpis, czlonkowie: [] };
    g.czlonkowie.push(z);
    grupy.set(klucz, g);
  }

  const wynik: Sprawa[] = [];
  for (const { wpis, czlonkowie } of grupy.values()) {
    czlonkowie.sort(poPilnosci);
    const otwarte = czlonkowie.filter((c) => c.otwarta);
    /* Wiodące: najpilniejsze otwarte; sprawa bez otwartych (historia) —
       najświeższe, bo tak czyta się kartotekę. */
    const wiodace =
      otwarte[0] ??
      [...czlonkowie].sort(
        (a, b) => (b.kiedy ? Date.parse(b.kiedy) : 0) - (a.kiedy ? Date.parse(a.kiedy) : 0)
      )[0];
    const terminy = otwarte
      .map((c) => c.dniDoTerminu)
      .filter((v): v is number => v !== null);
    const kiedyMs = czlonkowie
      .map((c) => (c.kiedy ? Date.parse(c.kiedy) : NaN))
      .filter((v) => !Number.isNaN(v));
    wynik.push({
      ...wiodace,
      /* Termin: najostrzejszy z otwartych źródeł. Początek: najstarsze
         źródło — sprawa zaczyna się pierwszym głosem klienta. */
      dniDoTerminu: terminy.length > 0 ? Math.min(...terminy) : wiodace.dniDoTerminu,
      poTerminie: otwarte.some((c) => c.poTerminie) || wiodace.poTerminie,
      kiedy:
        kiedyMs.length > 0 ? new Date(Math.min(...kiedyMs)).toISOString() : wiodace.kiedy,
      otwarta: otwarte.length > 0,
      /* Piłka sprawy = NAJOSTRZEJSZA piłka jej otwartych źródeł. Sprawa,
         w której cokolwiek czeka na nas, czeka na nas — zamknięte źródło nie
         ma prawa jej wyciszyć. Niezmiennik pilnowany testem: `nikt` wtedy
         i tylko wtedy, gdy sprawa jest zamknięta. */
      pilka:
        otwarte.length === 0
          ? "nikt"
          : otwarte.map((c) => c.pilka).sort((x, y) => RANGA_PILKI[x] - RANGA_PILKI[y])[0],
      prowadzi: wpis?.prowadzi ?? czlonkowie.map((c) => c.prowadzi).find((p) => p) ?? null,
      sprawaId: wpis?.sprawaId ?? null,
      kupujacyId: wpis?.kupujacyId ?? null,
      zrodla: czlonkowie.map((c) => ({ rodzaj: c.rodzaj, id: c.id, otwarte: c.otwarta })),
    });
  }
  return wynik;
}

/** Wszystkie OTWARTE źródła czterech rejestrów — surowiec grupowania. */
function otwarteZrodla(): Sprawa[] {
  return [
    ...sprawyPytan("status IN ('nowe','szkic')", []),
    ...sprawyZwrotow("status IN ('nowy','oceniony')", []),
    ...sprawyDyskusji("status IN ('nowa','w_toku')", []),
    ...sprawyReklamacji("p.rekl_wynik IS NULL", []),
  ];
}

/**
 * Kolejka spraw: wszystkie OTWARTE sprawy, po pilności. Od 0.128.0 wiersz
 * to sprawa (grupowanie po order_id przez sprawa_zrodlo), więc filtr
 * `rodzaj` znaczy „sprawy ZAWIERAJĄCE źródło tego rodzaju" — a źródła
 * zbieramy zawsze wszystkie, bo grupa przycięta filtrem byłaby kłamstwem.
 */
export function listaSpraw(rodzaj?: RodzajSprawy): Sprawa[] {
  const sprawy = zgrupujWSprawy(otwarteZrodla());
  const przefiltrowane = rodzaj
    ? sprawy.filter((s) => s.zrodla!.some((z) => z.rodzaj === rodzaj))
    : sprawy;
  return przefiltrowane.sort(poPilnosci);
}

/**
 * Klient 360 — drugi poziom, otwierany klikiem w login z dowolnej sprawy.
 * `login === null` to kubełek spraw bez klienta (wklejki, zwroty ręczne):
 * jeden wspólny, żeby nic nie ginęło poza kolejką.
 */
export function sprawyKlienta(login: string | null): { aktywne: Sprawa[]; historia: Sprawa[] } {
  const [gdzie, gdzieZ, gdzieR, param] = login
    ? ["kupujacy_login = ?", "kupujacy_login = ?", "z.kupujacy_login = ?", [login]]
    : ["kupujacy_login IS NULL", "kupujacy_login IS NULL", "z.kupujacy_login IS NULL", []];
  /* Grupowanie PRZED podziałem na aktywne/historię: sprawa z jednym źródłem
     otwartym i drugim zamkniętym jest JEDNĄ aktywną sprawą, nie parą. */
  const wszystkie = zgrupujWSprawy([
    ...sprawyPytan(gdzie, param),
    ...sprawyZwrotow(gdzieZ, param),
    ...sprawyDyskusji(gdzie, param),
    ...sprawyReklamacji(gdzieR, param),
  ]);
  const aktywne = wszystkie.filter((s) => s.otwarta).sort(poPilnosci);
  /* Historia od najnowszej — czytana jak kartoteka, nie jak kolejka. */
  const historia = wszystkie
    .filter((s) => !s.otwarta)
    .sort((a, b) => (b.kiedy ? Date.parse(b.kiedy) : 0) - (a.kiedy ? Date.parse(a.kiedy) : 0))
    .slice(0, 30);
  return { aktywne, historia };
}

/* ── Wyszukiwarka klientów ───────────────────────────────────────────────────
   Klient 360 istnieje od 0.109.0, ale wchodziło się do niego WYŁĄCZNIE klikiem
   w login na otwartej sprawie — czyli trzeba było najpierw znaleźć jakąś jego
   sprawę. Gdy klient dzwoni z pytaniem „co u mnie", a nic otwartego nie ma,
   nie było go jak odszukać. To jest to brakujące ogniwo.                     */

export interface ZnalezionyKlient {
  login: string;
  /** Ile spraw czeka na biuro — ta sama definicja, co w kolejce. */
  otwartych: number;
  /** Ile w ogóle, razem z historią — klient bez otwartych też ma tu liczbę. */
  wszystkich: number;
  /** Ostatnia aktywność w dowolnym rejestrze; null przy sprawie bez daty. */
  ostatnia: string | null;
}

/** Krótsza fraza przeczesuje cztery rejestry i zwraca pół bazy. */
export const MIN_ZNAKOW_KLIENTA = 2;

/**
 * Klienci pasujący do fragmentu loginu — wejście do Klienta 360 bez sprawy.
 *
 * Liczy TYMI SAMYMI budowniczymi, co kolejka i Klient 360, zamiast pisać
 * własne zapytanie z przepisanymi warunkami „otwartości". Gdyby je przepisać,
 * wyszukiwarka pokazywałaby „3 otwarte", a Klient 360 po kliknięciu cztery —
 * i rozjazd wyszedłby dopiero u kogoś przy biurku. Tu liczby zgadzają się
 * z KONSTRUKCJI: to jest ten sam kod, tylko z innym `WHERE`.
 *
 * Login `NULL` (wklejka ze screenshota, zwrot ręczny) nie wchodzi do wyników:
 * kubełek „bez klienta" istnieje w `sprawyKlienta(null)`, ale nie ma nazwy,
 * po której dałoby się go szukać.
 */
export function szukajKlientow(fraza: string, limit = 12): ZnalezionyKlient[] {
  const szukane = fraza.trim();
  if (szukane.length < MIN_ZNAKOW_KLIENTA) return [];
  const wzor = `%${szukane}%`;
  /* Od 0.128.0 `otwartych`/`wszystkich` liczą SPRAWY, nie obiekty rejestrów:
     zwrot i dyskusja jednego zamówienia to dla klienta jedna sprawa, a licznik
     w wynikach ma mówić jego językiem. */
  const wszystkie = zgrupujWSprawy([
    ...sprawyPytan("kupujacy_login LIKE ?", [wzor]),
    ...sprawyZwrotow("kupujacy_login LIKE ?", [wzor]),
    ...sprawyDyskusji("kupujacy_login LIKE ?", [wzor]),
    ...sprawyReklamacji("z.kupujacy_login LIKE ?", [wzor]),
  ]);

  const wg = new Map<string, ZnalezionyKlient>();
  for (const s of wszystkie) {
    if (!s.klient) continue; // LIKE i tak nie łapie NULL-a; jawnie, żeby to było widać
    const dotad = wg.get(s.klient) ?? {
      login: s.klient, otwartych: 0, wszystkich: 0, ostatnia: null,
    };
    dotad.wszystkich++;
    if (s.otwarta) dotad.otwartych++;
    if (s.kiedy && (!dotad.ostatnia || s.kiedy > dotad.ostatnia)) dotad.ostatnia = s.kiedy;
    wg.set(s.klient, dotad);
  }

  /* Najpierw ci, u których coś czeka — po to się zwykle szuka. Przy remisie
     świeższy pierwszy, a na końcu alfabet, żeby kolejność była powtarzalna. */
  return [...wg.values()]
    .sort(
      (a, b) =>
        b.otwartych - a.otwartych ||
        (b.ostatnia ?? "").localeCompare(a.ostatnia ?? "") ||
        a.login.localeCompare(b.login, "pl")
    )
    .slice(0, Math.min(Math.max(limit, 1), 50));
}

/**
 * Powiązane sprawy — ciąg „pytanie → zwrot → dyskusja" jednego problemu.
 * Allegro reprezentuje te obiekty osobno; łączymy je z kluczy, które już są.
 * Najpierw to samo zamówienie (`order_id` — najmocniejszy dowód), potem ten
 * sam login (podpisany słabiej, bo stały klient miewa wiele niezwiązanych
 * spraw). Pytania nie mają zamówienia — dołączają wyłącznie po loginie.
 */
export function powiazaneSprawy(rodzaj: RodzajSprawy, id: number): {
  /** Id encji sprawy, w której stoi ŹRÓDŁO pytania — panel podaje je jako
      docelową przy SCAL-u (0.129.0). */
  sprawaId: number | null;
  zamowienie: Sprawa[];
  klient: Sprawa[];
  kupujacy: Sprawa[];
} {
  const zrodlo = sprawaZrodlowa(rodzaj, id);
  if (!zrodlo) return { sprawaId: null, zamowienie: [], klient: [], kupujacy: [] };

  const nieJa = (s: Sprawa) => !(s.rodzaj === rodzaj && s.id === id);
  /* Reklamacja jest pozycją swojego zwrotu — nie pokazujemy zwrotu-rodzica
     jako „powiązania", bo UI i tak otwiera reklamację przez ten zwrot. */
  const nieRodzic = (s: Sprawa) =>
    !(rodzaj === "reklamacja" && s.rodzaj === "zwrot" && s.id === zrodlo.zwrotId);

  /* „To samo zamówienie" czyta odtąd sprawa_zrodlo zamiast powtarzać
     SELECT-y po order_id — po Etapie C to jest wprost lista pozostałych
     źródeł TEJ SAMEJ sprawy. Fallback po order_id zostaje dla źródła,
     którego rekoncyliacja jeszcze nie widziała. */
  const wpis = mapaZrodel().get(`${rodzaj}:${id}`);
  let zamowienie: Sprawa[] = [];
  if (wpis) {
    zamowienie = wpis.zrodla
      .filter((z) => !(z.rodzaj === rodzaj && z.lokalnyId === id))
      .map((z) => sprawaZrodlowa(z.rodzaj, z.lokalnyId))
      .filter((s): s is Sprawa => s !== null)
      .filter(nieRodzic)
      .sort(poPilnosci)
      .slice(0, 10);
  } else if (zrodlo.orderId) {
    zamowienie = [
      ...sprawyZwrotow("allegro_order_id = ?", [zrodlo.orderId]),
      ...sprawyDyskusji("order_id = ?", [zrodlo.orderId]),
      ...sprawyReklamacji("z.allegro_order_id = ?", [zrodlo.orderId]),
    ]
      .filter(nieJa)
      .filter(nieRodzic)
      .sort(poPilnosci)
      .slice(0, 10);
  }

  let klient: Sprawa[] = [];
  const zZamowienia = new Set(zamowienie.map((s) => `${s.rodzaj}:${s.id}`));
  if (zrodlo.klient) {
    const { aktywne } = sprawyKlienta(zrodlo.klient);
    klient = aktywne
      .filter(nieJa)
      .filter(nieRodzic)
      .filter((s) => !zZamowienia.has(`${s.rodzaj}:${s.id}`))
      .slice(0, 10);
  }

  /* PODPOWIEDŹ po odmaskowanym kupującym (0.128.0) — sam ODCZYT, nigdy
     sklejenie: pytanie spod maski `client:NNN` nie spotka zwrotu po loginie,
     ale NNN to buyer.id, więc tu wypływają sprawy, których złączenie po
     loginie nigdy nie widziało. SCAL jednym klikiem wejdzie w etapie D. */
  let kupujacy: Sprawa[] = [];
  const mojeId = wpis?.kupujacyId ?? null;
  if (mojeId) {
    const zLoginu = new Set(klient.map((s) => `${s.rodzaj}:${s.id}`));
    kupujacy = zgrupujWSprawy(otwarteZrodla())
      .filter((s) => s.kupujacyId === mojeId)
      .filter((s) => s.sprawaId !== wpis!.sprawaId)
      .filter(nieJa)
      .filter((s) => !zZamowienia.has(`${s.rodzaj}:${s.id}`))
      .filter((s) => !zLoginu.has(`${s.rodzaj}:${s.id}`))
      .sort(poPilnosci)
      .slice(0, 10);
  }
  return { sprawaId: wpis?.sprawaId ?? null, zamowienie, klient, kupujacy };
}

/** Jedna sprawa po (rodzaj, id) — punkt zaczepienia dla powiązań. */
function sprawaZrodlowa(rodzaj: RodzajSprawy, id: number): Sprawa | null {
  const jedna = (lista: Sprawa[]) => lista.find((s) => s.id === id) ?? null;
  switch (rodzaj) {
    case "pytanie":
      return jedna(sprawyPytan("id = ?", [id]));
    case "zwrot":
      return jedna(sprawyZwrotow("id = ?", [id]));
    case "dyskusja":
      return jedna(sprawyDyskusji("id = ?", [id]));
    case "reklamacja":
      return jedna(sprawyReklamacji("p.id = ?", [id]));
  }
}

export interface LicznikSpraw {
  /** Suma otwartych spraw — pigułka na zakładce. */
  otwartych: number;
  pytaniaOtwarte: number;
  pytaniaNowe: number;
  szkice: number;
  zwrotyOtwarte: number;
  dyskusjeNowe: number;
  dyskusjeWToku: number;
  poTerminie: number;
  reklamacjeOtwarte: number;
  synchronizacjaPytan: ReturnType<typeof stanSynchronizacjiPytan>;
  synchronizacjaDyskusji: ReturnType<typeof stanSynchronizacjiDyskusji>;
}

/**
 * Licznik na zakładkę SPRAWY — SKŁADANY z liczników per-typ, nie liczony
 * czwarty raz: pigułka i karty muszą pokazywać te same liczby, a dwie
 * implementacje tego samego COUNT-a zawsze w końcu się rozjeżdżają.
 */
export function licznikSpraw(): LicznikSpraw {
  const pyt = licznikiPytan();
  const dysk = licznikDyskusji();
  const reklamacje = listaReklamacji();
  const zwroty = db()
    .prepare(`SELECT COUNT(*) AS n FROM zwrot WHERE status IN ('nowy','oceniony')`)
    .get() as { n: number };
  const poTerminie =
    dysk.claimyPoTerminie + reklamacje.filter((r) => r.poTerminie).length;
  return {
    /* Od 0.128.0 pigułka liczy SPRAWY tym samym grupowaniem co kolejka —
       zgodność z konstrukcji, jak przy wyszukiwarce. Liczniki per-typ niżej
       zostają obiektami rejestrów: karty per-typ mówią o obiektach. */
    otwartych: listaSpraw().length,
    pytaniaOtwarte: licznikOtwartych(),
    pytaniaNowe: pyt.nowe,
    szkice: pyt.szkice,
    zwrotyOtwarte: zwroty.n,
    dyskusjeNowe: dysk.nowe,
    dyskusjeWToku: dysk.wToku,
    poTerminie,
    reklamacjeOtwarte: reklamacje.length,
    synchronizacjaPytan: stanSynchronizacjiPytan(),
    synchronizacjaDyskusji: stanSynchronizacjiDyskusji(),
  };
}
