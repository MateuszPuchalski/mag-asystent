import { config } from "../config.js";
import { db as defaultDb, transaction, type Db } from "../db/db.js";
import { urlOfertPoSygnaturzeStrona, OFERT_NA_STRONE, zapytajAllegro } from "../adapters/allegro.http.js";
import { kontoKanalu } from "./kanal-konto.js";
import { zapiszSnapshotOferty, type Oferta } from "./allegro-oferty-sync.js";
import { adresMiniatury, pobierzZCdn, type PobranyObraz, type ZrodloObrazu } from "./zdjecia-ofert.js";
import { powodWylaczenia } from "./zdjecia-bez.js";
import { logEvent } from "./events.js";
import { towaryPoSymbolach } from "../adapters/zdjecia.sgt.js";

/* ── Zdjęcia kartotek z NASZYCH ofert Allegro ────────────────────────────────
   Biuro podaje symbole kartotek bez zdjęcia, serwer szuka ofert z tą
   sygnaturą i wskazuje jedną na symbol. Obraz składa potem przeglądarka,
   tak jak przy imporcie z folderu, i zapisuje go tą samą trasą `gotowe`.

   Pytamy na żądanie biura, bez taktu i bez katalogu ofert. Katalog trzeba
   by odświeżać, a tu człowiek patrzy na wynik teraz i sam go zatwierdza.

   Statusy ACTIVE i ENDED, bo zdjęcie towaru z zakończonej aukcji jest równie
   dobre. INACTIVE i ACTIVATING to szkice, w których obraz bywa roboczy. */

/** Sufit `external.id` w specyfikacji (`maxItems: 100`). Więcej to błąd 400 od Allegro. */
export const SYMBOLI_ALLEGRO_MAX = 100;
/** Sufit znaków jednej sygnatury w specyfikacji. */
const ZNAKOW_SYMBOLU_MAX = 100;
const STATUSY = ["ACTIVE", "ENDED"] as const;
/**
 * Bezpiecznik paginacji. Sto symboli na tysiącach aukcji to już błąd danych,
 * a pętla bez dna przy dziwnej odpowiedzi strzelałaby do Allegro bez końca.
 */
const STRON_MAX = 20;
/** Duże zdjęcie idzie przez pamięć serwera, więc ma sufit. Nie trzyma się go na dysku. */
const DUZE_MAX_BAJTOW = 10 * 1024 * 1024;
/** Wariant CDN-u, z którego przeglądarka składa kwadrat 800 px z zapasem. */
const DUZE_PX = 1280;

export interface ZdjeciaAllegroDeps {
  database?: Db;
  query?: (url: string) => Promise<unknown | null>;
  apiUrl?: string;
  accountId?: string;
  now?: () => Date;
  pobierz?: ZrodloObrazu;
  /** Kartoteki Subiekta o podanych symbolach; wyjątek = nie dało się zapytać. */
  towary?: (symbole: string[]) => Promise<Array<{ symbol: string }>>;
}

/* Podmiana dla testów tras, jak `ustawZrodloDopasowania` w imporcie z folderu.
   Trasa nie przyjmuje zależności, a test nie ma prawa wyjść do Allegro. */
let nadpisane: ZdjeciaAllegroDeps = {};
export function ustawZaleznosciZdjecAllegro(deps: ZdjeciaAllegroDeps | null): void {
  nadpisane = deps ?? {};
}

/** Zależności wołającego nałożone na podmianę testową. Wspólne z indeksem kodów producenta. */
export function zaleznosciZdjecAllegro(wejscie: ZdjeciaAllegroDeps = {}): ZdjeciaAllegroDeps {
  return { ...nadpisane, ...wejscie };
}

export interface OfertaZdjecia {
  id: string;
  nazwa: string;
  status: string | null;
  startedAt: string | null;
  zdjecie: boolean;
}

/** Droga, którą oferta trafiła w symbol. Kod producenta to słabszy dowód niż sygnatura. */
export type DrogaDopasowania = "sygnatura" | "kod_producenta";

export interface PozycjaAllegro {
  symbol: string;
  ofert: number;
  oferta: OfertaZdjecia | null;
  po: DrogaDopasowania | null;
  /** Oferta kodu producenta trafia w kilka symboli wejścia, więc żaden jej nie dostaje. */
  niejednoznaczny: boolean;
}

export type WynikDopasowaniaAllegro =
  | { wlaczone: false; powod: string; pozycje: [] }
  | { wlaczone: true; pozycje: PozycjaAllegro[] };

/**
 * Lista symboli z ciała żądania albo zdanie o błędzie.
 *
 * Limit liczymy PO czyszczeniu, bo sufit stawia Allegro na tym, co wysyłamy.
 * Za długi symbol odrzucamy od razu, zamiast oddać 502 z ich odmowy.
 */
export function symboleAllegroZCiala(
  surowe: unknown,
): { ok: true; symbole: string[] } | { ok: false; error: string } {
  if (!Array.isArray(surowe)) return { ok: false, error: "Pole symbole musi być listą" };
  const widziane = new Set<string>();
  const symbole: string[] = [];
  for (const s of surowe) {
    if (typeof s !== "string") return { ok: false, error: "Każdy symbol musi być tekstem" };
    const przyciety = s.trim();
    if (!przyciety || widziane.has(przyciety)) continue;
    if (przyciety.length > ZNAKOW_SYMBOLU_MAX) {
      return { ok: false, error: `Symbol dłuższy niż ${ZNAKOW_SYMBOLU_MAX} znaków: ${przyciety.slice(0, 20)}…` };
    }
    widziane.add(przyciety);
    symbole.push(przyciety);
  }
  if (symbole.length > SYMBOLI_ALLEGRO_MAX) {
    return { ok: false, error: `Najwyżej ${SYMBOLI_ALLEGRO_MAX} symboli naraz — Allegro nie przyjmie więcej.` };
  }
  return { ok: true, symbole };
}

const maZdjecie = (o: Oferta): boolean => (o.primaryImage?.url ?? "").trim() !== "";

/** Brak albo śmieć w dacie liczy się jak najstarsza aktywacja. */
function startMs(o: Oferta): number {
  const t = Date.parse(o.publication?.startedAt ?? "");
  return Number.isFinite(t) ? t : Number.NEGATIVE_INFINITY;
}

/**
 * Która z ofert jednego symbolu daje zdjęcie.
 *
 * Najpierw oferta z obrazem, bo bez niego wybór niczego nie daje. Potem
 * aktywna, bo jej zdjęcie sprzedawca utrzymuje dziś. Potem najświeższa
 * aktywacja. Remis zostaje w kolejności odpowiedzi Allegro, żeby wynik był
 * powtarzalny między kliknięciami.
 */
export function wybierzOferte(kandydatki: readonly Oferta[]): Oferta | null {
  if (kandydatki.length === 0) return null;
  const ponumerowane = kandydatki.map((o, i) => ({ o, i }));
  ponumerowane.sort((a, b) => {
    const zdj = Number(maZdjecie(b.o)) - Number(maZdjecie(a.o));
    if (zdj !== 0) return zdj;
    const akt = Number(b.o.publication?.status === "ACTIVE") - Number(a.o.publication?.status === "ACTIVE");
    if (akt !== 0) return akt;
    const sa = startMs(a.o);
    const sb = startMs(b.o);
    if (sa !== sb) return sb > sa ? 1 : -1;
    return a.i - b.i;
  });
  return ponumerowane[0].o;
}

type Odpowiedz = { offers?: Oferta[] };

/**
 * Wszystkie oferty z podanymi sygnaturami. Kolejna strona tylko przy pełnej
 * poprzedniej: tak mówi specyfikacja, a `totalCount` bywa nieobecny.
 * Błąd idzie w górę, z limitem 429 włącznie. Biuro czeka na wynik, więc
 * cichy pusty wynik wyglądałby jak „Allegro nie ma tych ofert".
 */
async function pobierzOferty(
  symbole: readonly string[],
  query: (url: string) => Promise<unknown | null>,
  apiUrl: string,
): Promise<Oferta[]> {
  const wszystkie: Oferta[] = [];
  for (let strona = 0; strona < STRON_MAX; strona++) {
    const odp = await query(
      urlOfertPoSygnaturzeStrona(apiUrl, symbole, STATUSY, strona * OFERT_NA_STRONE),
    ) as Odpowiedz | null;
    const oferty = Array.isArray(odp?.offers) ? odp.offers : [];
    wszystkie.push(...oferty);
    if (oferty.length < OFERT_NA_STRONE) break;
  }
  return wszystkie;
}

/* Klucz jak kolacja Subiekta: bez wielkości liter, po przycięciu. NIE `zwin`:
   zwinięcie skleja dwie różne kartoteki (LS51-139 i LS51139) i obie dostałyby
   zdjęcie jednej oferty. Allegro i tak filtruje po dokładnej sygnaturze. */
const kluczSymbolu = (s: string) => s.trim().toLocaleLowerCase("pl");

const naOferte = (o: Oferta): OfertaZdjecia => ({
  id: String(o.id),
  nazwa: String(o.name ?? ""),
  status: o.publication?.status ?? null,
  startedAt: o.publication?.startedAt ?? null,
  zdjecie: maZdjecie(o),
});

/** Oferta z lokalnego indeksu w kształcie, który zna `wybierzOferte`, z kodem i sygnaturą obok. */
interface OfertaZIndeksu {
  oferta: Oferta;
  kod: string;
  sygnatura: string;
}

/**
 * Kandydatki po kodzie producenta, z lokalnego indeksu, pogrupowane kluczem
 * symbolu. Wyłącznie oferty z naszej listy, bo snapshot zna też cudze aukcje.
 *
 * Indeks nie zna `startedAt`, więc w obrębie grupy idą od najświeższego
 * snapshotu. `wybierzOferte` zostawia remis dat w kolejności wejścia.
 * Klucz liczymy w kodzie, nie w SQL-u: `lower()` SQLite nie zna polskich liter.
 */
function kandydatkiPoKodzie(database: Db, konto: number): Map<string, OfertaZIndeksu[]> {
  const wiersze = database.prepare(`SELECT external_id AS id, nazwa, status, primary_image_url AS url,
        sku, kod_producenta AS kod
      FROM offer_snapshot
      WHERE channel_account_id=? AND nasza_lista_at IS NOT NULL AND TRIM(COALESCE(kod_producenta, '')) <> ''
      ORDER BY synced_at DESC, external_id`).all(konto) as Array<{
        id: string; nazwa: string | null; status: string | null; url: string | null; sku: string | null; kod: string;
      }>;
  const grupy = new Map<string, OfertaZIndeksu[]>();
  for (const w of wiersze) {
    const klucz = kluczSymbolu(w.kod);
    const lista = grupy.get(klucz) ?? [];
    lista.push({
      oferta: {
        id: String(w.id),
        name: w.nazwa ?? "",
        publication: w.status ? { status: w.status } : null,
        primaryImage: (w.url ?? "").trim() ? { url: w.url! } : null,
      },
      kod: w.kod,
      sygnatura: w.sku ?? "",
    });
    grupy.set(klucz, lista);
  }
  return grupy;
}

/**
 * Dopasowanie ofert do symboli kartotek: po sygnaturze, a bez zdjęcia także
 * po kodzie producenta z indeksu. Zapisuje snapshot ofert i wybór na każdy
 * symbol, więc to jest mutacja z wpisem w dzienniku.
 */
export async function dopasujOfertyAllegro(
  symbole: readonly string[],
  kto: string,
  depsWejscie: ZdjeciaAllegroDeps = {},
): Promise<WynikDopasowaniaAllegro> {
  const powod = powodWylaczenia();
  if (powod) return { wlaczone: false, powod, pozycje: [] };
  if (symbole.length === 0) return { wlaczone: true, pozycje: [] };

  const deps = { ...nadpisane, ...depsWejscie };
  const query = deps.query ?? ((url: string) => zapytajAllegro(url));
  const apiUrl = deps.apiUrl ?? config.allegro.apiUrl;
  const oferty = await pobierzOferty(symbole, query, apiUrl);

  /* Grupy po sygnaturze bez wielkości liter, w kolejności odpowiedzi. Oferta bez
     sygnatury nie należy do żadnej kartoteki i nie zgadujemy, do której. */
  const grupy = new Map<string, Oferta[]>();
  for (const o of oferty) {
    if (!o?.id) continue;
    const klucz = kluczSymbolu(String(o.external?.id ?? ""));
    if (!klucz) continue;
    const lista = grupy.get(klucz) ?? [];
    lista.push(o);
    grupy.set(klucz, lista);
  }

  const database = deps.database ?? defaultDb();
  const at = (deps.now ?? (() => new Date()))().toISOString();
  const konto = kontoKanalu(database, deps.accountId ?? config.allegro.clientId);

  const poSygnaturze = symbole.map((symbol) => {
    const kandydatki = grupy.get(kluczSymbolu(symbol)) ?? [];
    return { symbol, kandydatki, o: wybierzOferte(kandydatki) };
  });

  /* Kod producenta to druga droga, tylko gdy sygnatura nie dała zdjęcia.
     Sygnatura to wpis sprzedawcy pod tę kartotekę, więc wygrywa zawsze. */
  const bezZdjecia = poSygnaturze.some((p) => !p.o || !maZdjecie(p.o));
  const poKodzie = bezZdjecia ? kandydatkiPoKodzie(database, konto) : new Map<string, OfertaZIndeksu[]>();

  /* Ile symboli wejścia trafia każda oferta: kodem producenta albo sygnaturą.
     Oferta jednej kartoteki, której kod jest symbolem drugiej, dałaby obu
     to samo zdjęcie. Takiej nie dajemy nikomu, a biuro dodaje ręcznie. */
  const symboliNaKlucz = new Map<string, number>();
  for (const s of symbole) {
    const k = kluczSymbolu(s);
    symboliNaKlucz.set(k, (symboliNaKlucz.get(k) ?? 0) + 1);
  }
  /* Sygnatura z odpowiedzi jest świeższa niż ta w snapshocie indeksu. */
  const sygnaturaZOdpowiedzi = new Map<string, string>();
  for (const o of oferty) {
    if (o?.id) sygnaturaZOdpowiedzi.set(String(o.id), String(o.external?.id ?? ""));
  }
  const sygnaturaOferty = (c: OfertaZIndeksu): { klucz: string; tekst: string } => {
    const tekst = (sygnaturaZOdpowiedzi.get(c.oferta.id ?? "") ?? c.sygnatura).trim();
    return { klucz: kluczSymbolu(tekst), tekst };
  };
  const niejednoznaczna = (o: OfertaZIndeksu): boolean => {
    const kod = kluczSymbolu(o.kod);
    const syg = sygnaturaOferty(o).klucz;
    const trafien = (symboliNaKlucz.get(kod) ?? 0) + (syg && syg !== kod ? symboliNaKlucz.get(syg) ?? 0 : 0);
    return trafien > 1;
  };

  /* Oferta z sygnaturą INNEJ kartoteki Subiekta należy do tamtej kartoteki.
     Tamta bywa w innej paczce albo ma już zdjęcie, więc symbole wejścia tego
     nie wykryją. Pytamy Subiekt raz na żądanie, o wszystkie takie sygnatury. */
  const doSprawdzenia = new Map<string, string>();
  for (const { symbol, o } of poSygnaturze) {
    if (o && maZdjecie(o)) continue;
    const klucz = kluczSymbolu(symbol);
    for (const c of poKodzie.get(klucz) ?? []) {
      const syg = sygnaturaOferty(c);
      if (syg.klucz && syg.klucz !== klucz) doSprawdzenia.set(syg.klucz, syg.tekst);
    }
  }
  const wSubiekcie = new Set<string>();
  let subiektPadl = false;
  if (doSprawdzenia.size > 0) {
    try {
      const towary = await (deps.towary ?? towaryPoSymbolach)([...doSprawdzenia.values()]);
      for (const t of towary) wSubiekcie.add(kluczSymbolu(t.symbol));
    } catch (e) {
      /* Bez odpowiedzi Subiektu nie wiemy, czyja to oferta. Odrzucamy, bo
         cudze zdjęcie w kartotece jest gorsze niż brak zdjęcia. */
      subiektPadl = true;
      console.warn(`[zdjecia-allegro] sygnatury w Subiekcie: ${e instanceof Error ? e.message : e}`);
    }
  }
  const cudzejKartoteki = (c: OfertaZIndeksu, klucz: string): boolean => {
    const syg = sygnaturaOferty(c).klucz;
    return !!syg && syg !== klucz && (subiektPadl || wSubiekcie.has(syg));
  };

  const pozycje: PozycjaAllegro[] = poSygnaturze.map(({ symbol, kandydatki, o }) => {
    if (o && maZdjecie(o)) {
      return { symbol, ofert: kandydatki.length, oferta: naOferte(o), po: "sygnatura", niejednoznaczny: false };
    }
    const zKodem = (poKodzie.get(kluczSymbolu(symbol)) ?? []).filter((c) => !cudzejKartoteki(c, kluczSymbolu(symbol)));
    const czyste = zKodem.filter((k) => !niejednoznaczna(k));
    const k = wybierzOferte(czyste.map((c) => c.oferta));
    /* Oferta z kodu bez zdjęcia nie wypiera oferty z sygnatury: obie nic
       nie dają, a sygnatura mówi biuru więcej o tym, skąd wiersz. */
    if (k && (maZdjecie(k) || !o)) {
      return { symbol, ofert: czyste.length, oferta: naOferte(k), po: "kod_producenta", niejednoznaczny: false };
    }
    const niejednoznaczny = zKodem.length > czyste.length;
    return o
      ? { symbol, ofert: kandydatki.length, oferta: naOferte(o), po: "sygnatura", niejednoznaczny }
      : { symbol, ofert: kandydatki.length, oferta: null, po: null, niejednoznaczny };
  });

  transaction(database, () => {
    /* Snapshot to produkt uboczny, jak w linkach Copilota. Pisarz rzuca na
       kwocie spoza schematu, a jedna dziwna oferta nie może zabrać wyboru
       pozostałym. Rzut pada przed INSERT-em, więc transakcja zostaje czysta. */
    for (const o of oferty) {
      if (!o?.id) continue;
      try {
        zapiszSnapshotOferty(database, o, konto, at);
      } catch (e) {
        console.warn(`[zdjecia-allegro] oferta ${o.id}: ${e instanceof Error ? e.message : e}`);
      }
    }
    const zapis = database.prepare(`INSERT INTO zdjecie_oferty_wybor
        (symbol_klucz, symbol, channel_account_id, offer_id, status, started_at, ofert, wybrano_at, wybrano_przez, po)
      VALUES (?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(symbol_klucz) DO UPDATE SET
        symbol=excluded.symbol, channel_account_id=excluded.channel_account_id,
        offer_id=excluded.offer_id, status=excluded.status, started_at=excluded.started_at,
        ofert=excluded.ofert, wybrano_at=excluded.wybrano_at, wybrano_przez=excluded.wybrano_przez,
        po=excluded.po`);
    for (const p of pozycje) {
      const klucz = kluczSymbolu(p.symbol);
      if (!klucz) continue;
      zapis.run(klucz, p.symbol, konto, p.oferta?.id ?? null, p.oferta?.status ?? null,
        p.oferta?.startedAt ?? null, p.ofert, at, kto, p.po);
    }
    logEvent("zdjecia_allegro_dopasowane", kto, null, {
      symboli: symbole.length,
      ofert: oferty.length,
      wybranych: pozycje.filter((p) => p.oferta).length,
      zeZdjeciem: pozycje.filter((p) => p.oferta?.zdjecie).length,
      poKodzieProducenta: pozycje.filter((p) => p.po === "kod_producenta").length,
      niejednoznacznych: pozycje.filter((p) => p.niejednoznaczny).length,
    }, undefined, database);
  })();

  return { wlaczone: true, pozycje };
}

export type DuzeZdjecie =
  | { ok: true; obraz: PobranyObraz }
  | { ok: false; kod: 404 | 502; error: string };

/**
 * Duże zdjęcie oferty do złożenia kwadratu w przeglądarce.
 *
 * Bez cache'u na dysku: biuro bierze obraz raz, przy zapisie do kartoteki.
 * Cache miniatur ma swoją sprzątaczkę i swoje rozmiary, więc go nie mieszamy.
 * Najpierw wariant 1280 px, potem oryginał, z tego samego powodu co przy
 * miniaturach: wariant rozmiarowy to konwencja CDN-u, nie specyfikacja.
 */
export async function duzeZdjecieOferty(
  offerId: string,
  depsWejscie: ZdjeciaAllegroDeps = {},
): Promise<DuzeZdjecie> {
  const deps = { ...nadpisane, ...depsWejscie };
  const database = deps.database ?? defaultDb();
  const konto = kontoKanalu(database, deps.accountId ?? config.allegro.clientId);
  /* Zasada właściciela: zdjęcie kartoteki pochodzi WYŁĄCZNIE z naszej oferty.
     `offer_snapshot` zna też cudze aukcje, pod którymi klient do nas napisał,
     więc sam wiersz snapshotu niczego nie dowodzi. Dowodem jest wybór
     z `dopasuj`, bo `/sale/offers` oddaje tylko oferty zalogowanego konta. */
  const nasza = database.prepare(
    "SELECT 1 FROM zdjecie_oferty_wybor WHERE channel_account_id=? AND offer_id=? LIMIT 1",
  ).get(konto, offerId);
  if (!nasza) return { ok: false, kod: 404, error: "To nie jest oferta wskazana przy dopasowaniu zdjęć" };
  const snap = database.prepare(
    "SELECT primary_image_url AS url FROM offer_snapshot WHERE channel_account_id=? AND external_id=?",
  ).get(konto, offerId) as { url: string | null } | undefined;
  const url = (snap?.url ?? "").trim();
  if (!url) return { ok: false, kod: 404, error: "Brak zdjęcia tej oferty" };

  const pobierz = deps.pobierz ?? pobierzZCdn;
  const proby = [adresMiniatury(url, DUZE_PX), url].filter((u): u is string => typeof u === "string");
  let blad = "Allegro nie oddało obrazu spod tego adresu.";
  for (const proba of proby) {
    let obraz: PobranyObraz | null = null;
    try {
      obraz = await pobierz(proba);
    } catch (e) {
      blad = e instanceof Error ? e.message : String(e);
    }
    if (!obraz) continue;
    if (obraz.bajty.length > DUZE_MAX_BAJTOW) {
      blad = `Zdjęcie oferty ma ${Math.round(obraz.bajty.length / 1024 / 1024)} MB, limit to 10 MB.`;
      continue;
    }
    return { ok: true, obraz };
  }
  return { ok: false, kod: 502, error: blad };
}
