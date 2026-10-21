import { config } from "../config.js";
import { db as defaultDb, transaction, type Db } from "../db/db.js";
import { urlOfertPoSygnaturzeStrona, OFERT_NA_STRONE, zapytajAllegro } from "../adapters/allegro.http.js";
import { kontoKanalu } from "./kanal-konto.js";
import { zapiszSnapshotOferty, type Oferta } from "./allegro-oferty-sync.js";
import { adresMiniatury, pobierzZCdn, type PobranyObraz, type ZrodloObrazu } from "./zdjecia-ofert.js";
import { powodWylaczenia } from "./zdjecia-bez.js";
import { logEvent } from "./events.js";

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
}

/* Podmiana dla testów tras, jak `ustawZrodloDopasowania` w imporcie z folderu.
   Trasa nie przyjmuje zależności, a test nie ma prawa wyjść do Allegro. */
let nadpisane: ZdjeciaAllegroDeps = {};
export function ustawZaleznosciZdjecAllegro(deps: ZdjeciaAllegroDeps | null): void {
  nadpisane = deps ?? {};
}

export interface OfertaZdjecia {
  id: string;
  nazwa: string;
  status: string | null;
  startedAt: string | null;
  zdjecie: boolean;
}

export interface PozycjaAllegro {
  symbol: string;
  ofert: number;
  oferta: OfertaZdjecia | null;
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

/**
 * Dopasowanie ofert do symboli kartotek. Zapisuje snapshot każdej oferty
 * i wybór na każdy symbol, więc to jest mutacja z wpisem w dzienniku.
 */
/* Klucz jak kolacja Subiekta: bez wielkości liter, po przycięciu. NIE `zwin`:
   zwinięcie skleja dwie różne kartoteki (LS51-139 i LS51139) i obie dostałyby
   zdjęcie jednej oferty. Allegro i tak filtruje po dokładnej sygnaturze. */
const kluczSymbolu = (s: string) => s.trim().toLocaleLowerCase("pl");

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

  const pozycje: PozycjaAllegro[] = symbole.map((symbol) => {
    const kandydatki = grupy.get(kluczSymbolu(symbol)) ?? [];
    const o = wybierzOferte(kandydatki);
    return {
      symbol,
      ofert: kandydatki.length,
      oferta: o ? {
        id: String(o.id),
        nazwa: String(o.name ?? ""),
        status: o.publication?.status ?? null,
        startedAt: o.publication?.startedAt ?? null,
        zdjecie: maZdjecie(o),
      } : null,
    };
  });

  const database = deps.database ?? defaultDb();
  const at = (deps.now ?? (() => new Date()))().toISOString();
  transaction(database, () => {
    const konto = kontoKanalu(database, deps.accountId ?? config.allegro.clientId);
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
        (symbol_klucz, symbol, channel_account_id, offer_id, status, started_at, ofert, wybrano_at, wybrano_przez)
      VALUES (?,?,?,?,?,?,?,?,?)
      ON CONFLICT(symbol_klucz) DO UPDATE SET
        symbol=excluded.symbol, channel_account_id=excluded.channel_account_id,
        offer_id=excluded.offer_id, status=excluded.status, started_at=excluded.started_at,
        ofert=excluded.ofert, wybrano_at=excluded.wybrano_at, wybrano_przez=excluded.wybrano_przez`);
    for (const p of pozycje) {
      const klucz = kluczSymbolu(p.symbol);
      if (!klucz) continue;
      zapis.run(klucz, p.symbol, konto, p.oferta?.id ?? null, p.oferta?.status ?? null,
        p.oferta?.startedAt ?? null, p.ofert, at, kto);
    }
    logEvent("zdjecia_allegro_dopasowane", kto, null, {
      symboli: symbole.length,
      ofert: oferty.length,
      wybranych: pozycje.filter((p) => p.oferta).length,
      zeZdjeciem: pozycje.filter((p) => p.oferta?.zdjecie).length,
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
