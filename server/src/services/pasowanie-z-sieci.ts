import type { DatabaseSync } from "node:sqlite";
import { db } from "../db/db.js";
import { config } from "../config.js";
import { logEvent } from "./events.js";
import { zwin } from "../tekst.js";
import type { Tokeny } from "./copilot-koszt.js";
import {
  czlowiekZBiura, rozstrzygnijZastosowanie, WiedzaConflict, wTransakcji, zaproponujZastosowanie,
  type RodzajDowodu, type Zastosowanie,
} from "./wiedza.js";
import { BladKluczaCopilota, BladLimituCopilota, BladPrzeciazeniaCopilota } from "../adapters/copilot.js";
import { tekstyPdf, type CzytnikPdf } from "./pdf-tekst.js";
import { sprawdzWarunki } from "./warunki-zastosowania.js";

/* ── Pasowanie z sieci: nocny automat uzupełnia luki wiedzy (0.507.0) ───────

   Właściciel: „z innych stron możesz ściągnąć, aby uzupełnić fitment", z
   zastrzeżeniem: „bądź ostrożny, nie chcę dostać bana na Allegro".

   CO ROBI. Bierze kartotekę, która ma numer OEM albo oryginalny, a nie ma
   ANI JEDNEGO żywego zastosowania, i prosi model, żeby poszukał w sieci, do
   jakich maszyn i silników ta część pasuje. Znalezisko staje w kolejce Wiedzy
   jako PROPOZYCJA z linkiem do strony. Nic nie zatwierdza się samo.

   ALLEGRO — TRZY BARIERY, każda osobno wystarczająca:
   1. Ten plik nie woła Allegro ani razu. Kandydaci, nazwy i numery idą
      z lokalnej bazy; test pilnuje, że moduł nie importuje adaptera Allegro.
   2. Wyszukiwanie i pobieranie stron robią serwery Anthropic, nie nasz adres,
      z listą `blocked_domains` obejmującą domeny Allegro (`copilot.anthropic`).
   3. Znalezisko z domeny Allegro serwer i tak odrzuca (`czyAllegro`), gdyby
      lista domen kiedyś przeciekła.

   SITO JEST DETERMINISTYCZNE, bo model czyta cudze strony — a te bywają
   pomyłką, reklamą albo próbą wstrzyknięcia poleceń. Propozycja przechodzi
   tylko wtedy, gdy:
   - model PRZECZYTAŁ stronę (`web_fetch`), a nie tylko widział ją w wynikach,
   - cytat stoi na tej stronie dosłownie (po zwinięciu odstępów i wielkości),
   - oznaczenie modelu maszyny stoi w cytacie,
   - marka stoi w cytacie albo na stronie,
   - NASZ numer (OEM albo oryginalny) stoi na tej stronie — bez tego strona
     mogła mówić o innej części o podobnej nazwie.
   Człowiek i tak zatwierdza każdą propozycję, ale nie ma prawa dostać do
   kolejki zmyślonego cytatu z prawdziwym linkiem.

   KOSZT. Wyszukiwanie to 1 cent za zapytanie plus tokeny pobranych stron.
   Sufit na noc (`naNoc`) liczy się z księgi, więc restart serwera go nie
   zeruje. Kartoteka sprawdzona raz wraca dopiero po `PONOWNIE_PO_DNIACH`.  */

/** Po ilu dniach kartoteka bez wyniku może wrócić. Sieć nie zmienia się co noc. */
export const PONOWNIE_PO_DNIACH = 90;
/** Po ilu dniach wraca kartoteka, której sprawdzenie skończyło się błędem dostawcy. */
export const PONOWNIE_PO_BLEDZIE_DNI = 7;
/** Ile znalezisk z jednej kartoteki. Więcej to już lista, nie pasowanie. */
export const SUFIT_ZNALEZISK = 15;
/** Okno liczenia sufitu nocnego w księdze. Noc to 1–5, dwanaście godzin z zapasem. */
const OKNO_NOCY_MS = 12 * 3_600_000;

/** Domeny, których automat NIE czyta — Allegro i jego obrazki. Subdomeny też. */
export const DOMENY_ZAKAZANE = [
  "allegro.pl", "allegro.cz", "allegro.sk", "allegro.hu", "allegro.eu",
  "allegrolokalnie.pl", "allegroimg.com", "allegrostatic.com",
] as const;

export function czyAllegro(host: string): boolean {
  const h = host.toLowerCase().replace(/\.$/, "");
  return DOMENY_ZAKAZANE.some((d) => h === d || h.endsWith(`.${d}`));
}

/** Pytanie o jedną kartotekę. Nasze dane o towarze — żadnych danych klienta. */
export interface ZapytanieOPasowanie {
  symbol: string;
  nazwa: string;
  /** Numery OEM i oryginalne z kartoteki. Po nich się szuka i po nich sprawdza. */
  numery: string[];
}

export const ZRODLA_STRONY = ["producent", "katalog_dostawcy", "sklep"] as const;
export type ZrodloStrony = (typeof ZRODLA_STRONY)[number];

export interface ZnaleziskoSurowe {
  rodzaj: "maszyna" | "silnik";
  marka: string;
  model: string;
  wariant: string | null;
  url: string;
  /** Dosłowny fragment strony, na którym znalezisko stoi. */
  cytat: string;
  zrodloStrony: ZrodloStrony;
  /* Warunki (0.527.0): roczniki i zakres numerów seryjnych, gdy strona je
     podaje. Bez nich „pasuje do MS 250" jest za szerokie dla części, która
     zmieniła się w trakcie produkcji. Każdy musi stać w cytacie — patrz sito. */
  rokOd: number | null;
  rokDo: number | null;
  seryjnyOd: string | null;
  seryjnyDo: string | null;
}

export interface WynikSieci {
  znaleziska: ZnaleziskoSurowe[];
  /** Strony PRZECZYTANE przez `web_fetch` — tekst do sprawdzenia cytatu. */
  strony: Array<{ url: string; tekst: string }>;
  /** PDF-y przeczytane przez `web_fetch`, surowe — tekst wyciąga `pdf-tekst.ts` (0.527.0). */
  pdfy: Array<{ url: string; base64: string }>;
  wyszukiwan: number;
  model: string;
  zuzycie: Tokeny;
  ms: number;
}

export type NadawcaPasowaniaSieci = (z: ZapytanieOPasowanie) => Promise<WynikSieci>;

export type PowodOdrzucenia =
  | "zly_adres" | "allegro" | "strona_nieprzeczytana" | "cytat_spoza_strony"
  | "model_spoza_cytatu" | "marka_spoza_strony" | "numer_spoza_strony" | "za_krotki_model"
  | "warunek_spoza_cytatu" | "zle_warunki";

export const host = (url: string): string | null => {
  try {
    const u = new URL(url);
    return u.protocol === "https:" || u.protocol === "http:" ? u.hostname : null;
  } catch {
    return null;
  }
};

/* Adres porównujemy bez kotwicy i końcowego ukośnika: model cytuje adres
   tak, jak go podał w `web_fetch`, a serwer oddaje go czasem znormalizowany. */
export const bezOgona = (url: string) => url.replace(/#.*$/, "").replace(/\/+$/, "").toLowerCase();

/**
 * Sito jednego znaleziska. Czyste — żadnego zapisu, żadnej sieci. Zwraca
 * powód odrzucenia albo `null`, gdy znalezisko może stanąć w kolejce.
 */
export function sprawdzZnalezisko(
  z: ZnaleziskoSurowe, strony: WynikSieci["strony"], numery: string[],
): PowodOdrzucenia | null {
  const h = host(z.url);
  if (!h) return "zly_adres";
  if (czyAllegro(h)) return "allegro";
  const strona = strony.find((s) => bezOgona(s.url) === bezOgona(z.url));
  if (!strona) return "strona_nieprzeczytana";
  const tekst = zwin(strona.tekst);
  const cytat = zwin(z.cytat);
  if (!cytat || !tekst.includes(cytat)) return "cytat_spoza_strony";
  const model = zwin(z.model);
  const marka = zwin(z.marka);
  /* Oznaczenie krótsze niż trzy znaki („25") samo trafia w każdą liczbę na
     stronie. Od 0.527.0 przechodzi, gdy w cytacie stoi TUŻ ZA MARKĄ
     („Stihl 025” → „stihl025”): wtedy to oznaczenie, nie przypadkowa liczba.
     Pierwszy dzień na żywo odrzucił tak pięć znalezisk na piętnaście. */
  if (model.length < 3) {
    if (!model || !marka || !cytat.includes(marka + model)) return "za_krotki_model";
  } else if (!cytat.includes(model)) return "model_spoza_cytatu";
  if (!marka || !(cytat.includes(marka) || tekst.includes(marka))) return "marka_spoza_strony";
  if (!numery.some((n) => zwin(n).length >= 4 && tekst.includes(zwin(n)))) return "numer_spoza_strony";
  /* Warunek, którego nie ma w cytacie, jest zgadnięty — a zgadnięty rocznik
     zawęża pasowanie tam, gdzie strona go nie zawęża, albo odwrotnie. */
  const wCytacie = [z.rokOd, z.rokDo, z.seryjnyOd, z.seryjnyDo].filter((w) => w !== null && w !== undefined);
  if (wCytacie.some((w) => !cytat.includes(zwin(String(w))))) return "warunek_spoza_cytatu";
  try {
    sprawdzWarunki({ rokOd: z.rokOd, rokDo: z.rokDo, seryjnyOd: z.seryjnyOd, seryjnyDo: z.seryjnyDo });
  } catch {
    return "zle_warunki";
  }
  return null;
}

/* Rodzaj dowodu w bazie wiedzy. Sklep nie ma osobnego rodzaju, więc idzie jako
   katalog dostawcy — a treść dowodu mówi wprost, że to sklep. */
const RODZAJ_DOWODU: Record<ZrodloStrony, RodzajDowodu> = {
  producent: "producent", katalog_dostawcy: "katalog_dostawcy", sklep: "katalog_dostawcy",
};
const OPIS_ZRODLA: Record<ZrodloStrony, string> = {
  producent: "strona producenta", katalog_dostawcy: "katalog dostawcy", sklep: "sklep internetowy",
};

/* Jeden warunek dla listy kandydatów i dla ich liczby na ekranie — dwie kopie
   rozjechałyby się przy pierwszej poprawce i ekran obiecywałby co innego, niż
   automat zrobi. Parametry: próg dni po wyniku, potem próg po błędzie. */
const WARUNEK_KANDYDATA = `
      EXISTS (SELECT 1 FROM towar_identyfikator i WHERE i.tw_id=t.tw_id AND i.rodzaj IN ('oem','nr_oryg'))
  AND NOT EXISTS (SELECT 1 FROM zastosowanie z WHERE z.tw_id=t.tw_id AND z.stan IN ('propozycja','zatwierdzone'))
  AND NOT EXISTS (SELECT 1 FROM pasowanie_siec p WHERE p.tw_id=t.tw_id
        AND ((p.wynik='ok' AND p.at >= ?) OR (p.wynik='blad' AND p.at >= ?)))`;

export interface Kandydat {
  twId: number;
  symbol: string;
  nazwa: string;
  /** Numery do WYSZUKIWARKI: własne OEM i oryginalne, najwyżej pięć. */
  numery: string[];
  /** Numery do SITA: szerzej — patrz `numery_sita` w zapytaniu (0.527.0). */
  numerySita: string[];
  /** Waga popytu z `POPYT` — do kolejności i do testu, nie na ekran. */
  popyt: number;
}

/** Lista z `group_concat(..., char(31))` — bez pustych i bez powtórzeń. */
const lista = (s: string | null) =>
  [...new Set(String(s ?? "").split("\u001f").map((n) => n.trim()).filter(Boolean))];

/* ── Kolejność: najpierw to, o co pytają klienci (0.527.0) ──────────────────
   Do tego wydania kolejność brzmiała „ma ofertę, potem numer kartoteki”.
   Przy ponad tysiącu kartotek w kolejce i dziesięciu na noc pierwszy miesiąc
   szedłby na części, o które nikt nie pyta. Teraz waga popytu, WYŁĄCZNIE
   z naszej bazy:
   - ×5 zwrot z powodem pasowania. Allegro nie ma kodu „nie pasuje”, więc
     bierzemy kody, pod którymi taki zwrot przychodzi (MISTAKE — klient
     zamówił złą część, DIFFERENT, NOT_AS_DESCRIBED, NOT_AS_EXPECTED,
     TOO_LARGE, TOO_SMALL), albo słowa klienta o pasowaniu i wymiarze.
     Najdroższy sygnał: towar już pojechał w obie strony.
   - ×3 dobór w rozmowie wskazał tę kartotekę — ktoś o nią pytał wprost.
   - ×2 rozmowa pod ofertą tej kartoteki.
   - ×1 sztuka sprzedana w 90 dni, najwyżej 20 — żeby hit sprzedaży nie
     przykrył części, przy której klienci się mylą.
   Kartoteka bez żadnego sygnału dalej wchodzi, tylko na końcu. */
const OKNO_POPYTU_DNI = 90;
const POPYT = `WITH oferta_tw AS (
    SELECT channel_account_id AS konto, offer_id AS oferta, tw_id FROM oferta_kartoteka
    UNION
    SELECT s.channel_account_id, s.external_id, t.tw_id
      FROM offer_snapshot s JOIN sgt_towar t ON t.symbol = s.sku
     WHERE s.sku IS NOT NULL AND s.sku <> ''
  ),
  zwroty AS (
    SELECT p.tw_id, COUNT(DISTINCT p.zwrot_id) AS n FROM zwrot_klienta_pozycja p
     WHERE p.tw_id IS NOT NULL
       AND (p.powod IN ('MISTAKE','DIFFERENT','NOT_AS_DESCRIBED','NOT_AS_EXPECTED','TOO_LARGE','TOO_SMALL')
            OR lower(COALESCE(p.powod_komentarz, '')) LIKE '%pasuj%'
            OR lower(COALESCE(p.powod_komentarz, '')) LIKE '%pasow%'
            OR lower(COALESCE(p.powod_komentarz, '')) LIKE '%wymiar%'
            OR lower(COALESCE(p.powod_komentarz, '')) LIKE '%rozmiar%')
     GROUP BY p.tw_id
  ),
  dobory AS (
    SELECT wybrany_tw_id AS tw_id, COUNT(*) AS n FROM dobor_rozmowy
     WHERE wybrany_tw_id IS NOT NULL GROUP BY wybrany_tw_id
  ),
  rozmowy AS (
    SELECT ot.tw_id, COUNT(DISTINCT m.conversation_id) AS n
      FROM message m JOIN conversation c ON c.id = m.conversation_id
      JOIN oferta_tw ot ON ot.konto = c.channel_account_id AND ot.oferta = m.related_object_id
     WHERE m.related_object_type = 'OFFER'
     GROUP BY ot.tw_id
  ),
  sprzedaz AS (
    SELECT ot.tw_id, SUM(p.ilosc) AS n
      FROM zamowienie_klienta_pozycja p
      JOIN zamowienie_klienta z ON z.id = p.zamowienie_id
      JOIN oferta_tw ot ON ot.konto = z.channel_account_id AND ot.oferta = p.offer_id
     WHERE z.kupiono_at >= ? AND COALESCE(z.status, '') <> 'CANCELLED'
     GROUP BY ot.tw_id
  )`;

/**
 * Kartoteki do sprawdzenia w sieci. Czysty ODCZYT.
 *
 * Tylko z numerem OEM albo oryginalnym: sama nazwa („Gaźnik do kosiarki")
 * znajduje w sieci wszystko i nic. Tylko bez żywego zastosowania: automat
 * uzupełnia LUKI, nie dokłada drugiego zdania tam, gdzie pierwsze już stoi.
 * Najpierw te, które sprzedajemy na Allegro — tam pytanie o pasowanie pada.
 */
export function kandydaciDoSieci(
  limit: number, teraz = new Date(), database: DatabaseSync = db(),
): Kandydat[] {
  if (limit <= 0) return [];
  const odKiedy = new Date(teraz.getTime() - PONOWNIE_PO_DNIACH * 86_400_000).toISOString();
  /* Błąd dostawcy to nie odpowiedź sieci o tej części — kartoteka wraca po
     tygodniu, nie po kwartale. Inaczej jedna zła noc wyłączałaby dziesięć
     kartotek na trzy miesiące. */
  const poBledzie = new Date(teraz.getTime() - PONOWNIE_PO_BLEDZIE_DNI * 86_400_000).toISOString();
  const odSprzedazy = new Date(teraz.getTime() - OKNO_POPYTU_DNI * 86_400_000).toISOString();
  const wiersze = database.prepare(`${POPYT}
    SELECT t.tw_id, t.symbol, t.nazwa,
        (SELECT group_concat(i.wartosc, char(31)) FROM towar_identyfikator i
          WHERE i.tw_id=t.tw_id AND i.rodzaj IN ('oem','nr_oryg')) AS numery,
        /* Numery, którymi strona może POTWIERDZIĆ tę część (0.527.0): własne,
           z obcych katalogów i zatwierdzonych zamienników OEM. Strona często
           podaje nowszy numer zamiennika, a nie ten z naszej kartoteki —
           a zamienność zatwierdził już człowiek. */
        (SELECT group_concat(i.wartosc, char(31)) FROM towar_identyfikator i
          WHERE i.rodzaj IN ('oem','nr_oryg','katalog_obcy')
            AND (i.tw_id=t.tw_id OR i.tw_id IN (
              SELECT CASE WHEN zo.tw_a=t.tw_id THEN zo.tw_b ELSE zo.tw_a END FROM zamiennosc_oem zo
               WHERE (zo.tw_a=t.tw_id OR zo.tw_b=t.tw_id) AND zo.stan='zatwierdzone'))) AS numery_sita,
        5 * COALESCE(zw.n, 0) + 3 * COALESCE(d.n, 0) + 2 * COALESCE(r.n, 0) + MIN(COALESCE(s.n, 0), 20) AS popyt
      FROM sgt_towar t
      LEFT JOIN zwroty zw ON zw.tw_id = t.tw_id
      LEFT JOIN dobory d ON d.tw_id = t.tw_id
      LEFT JOIN rozmowy r ON r.tw_id = t.tw_id
      LEFT JOIN sprzedaz s ON s.tw_id = t.tw_id
     WHERE ${WARUNEK_KANDYDATA}
     ORDER BY popyt DESC, EXISTS (SELECT 1 FROM oferta_kartoteka k WHERE k.tw_id=t.tw_id) DESC, t.tw_id
     LIMIT ?`).all(odSprzedazy, odKiedy, poBledzie, limit) as
    Array<{ tw_id: number; symbol: string; nazwa: string; numery: string | null; numery_sita: string | null; popyt: number }>;
  return wiersze.map((w) => ({
    twId: Number(w.tw_id), symbol: w.symbol, nazwa: w.nazwa, popyt: Number(w.popyt),
    numery: lista(w.numery).slice(0, 5),
    numerySita: lista(w.numery_sita),
  }));
}

/** Ile kartotek sprawdzono w ostatniej nocy — z księgi, więc restart nie zeruje. */
export function sprawdzonychTejNocy(teraz = new Date(), database: DatabaseSync = db()): number {
  const od = new Date(teraz.getTime() - OKNO_NOCY_MS).toISOString();
  /* Oba tryby (0.527.0) — część i silnik — ciągną z jednego limitu. */
  return (database.prepare(`SELECT count(*) n FROM copilot_wywolanie
      WHERE zadanie IN ('pasowanie_siec','pasowanie_siec_silnik') AND at >= ?`)
    .get(od) as { n: number }).n;
}

export interface WynikPrzebiegu {
  sprawdzono: number;
  zaproponowano: number;
  odrzucono: Partial<Record<PowodOdrzucenia, number>>;
  bledow: number;
  /** Powód przerwania: limit, klucz albo przeciążenie dostawcy. */
  przerwane: string | null;
}

/**
 * Jeden przebieg nocny. Mutacje: propozycje w kolejce Wiedzy, wiersz
 * `pasowanie_siec` na kartotekę i wiersz księgi na wywołanie.
 */
export async function szukajPasowaniaWSieci(deps: {
  nadaj: NadawcaPasowaniaSieci;
  naNoc: number;
  /** Sufit JEDNEGO przebiegu — ekran woła po jednej kartotece. Brak = do sufitu nocy. */
  naPrzebieg?: number;
  teraz?: () => Date;
  /** Wstrzykiwany, jak nadawca: test nie parsuje prawdziwych PDF-ów. */
  czytajPdf?: CzytnikPdf;
  database?: DatabaseSync;
}): Promise<WynikPrzebiegu> {
  const database = deps.database ?? db();
  const teraz = deps.teraz ?? (() => new Date());
  const wynik: WynikPrzebiegu = { sprawdzono: 0, zaproponowano: 0, odrzucono: {}, bledow: 0, przerwane: null };
  const zostalo = Math.min(deps.naNoc - sprawdzonychTejNocy(teraz(), database), deps.naPrzebieg ?? Infinity);

  for (const k of kandydaciDoSieci(zostalo, teraz(), database)) {
    let odp: WynikSieci;
    try {
      odp = await deps.nadaj({ symbol: k.symbol, nazwa: k.nazwa, numery: k.numery });
    } catch (e) {
      const slad = (e as { slad?: string }).slad || (e as Error).message;
      zapiszKsiege(database, null, "blad", slad, teraz(), (e as { zuzycie?: Tokeny }).zuzycie);
      zapiszPrzebieg(database, k.twId, "blad", 0, 0, {}, 0, slad, teraz());
      wynik.bledow += 1;
      /* Limit, zły klucz i przeciążenie to stan DOSTAWCY, nie tej kartoteki:
         następna dostałaby to samo. Przebieg staje, takt spróbuje jutro. */
      if (e instanceof BladLimituCopilota || e instanceof BladKluczaCopilota || e instanceof BladPrzeciazeniaCopilota) {
        wynik.przerwane = (e as Error).message;
        break;
      }
      continue;
    }

    wynik.sprawdzono += 1;
    zapiszKsiege(database, odp, "ok", null, teraz());
    /* PDF-y dochodzą do sita jako zwykłe strony z tekstem (0.527.0). Tekst
       wyciąga `pdf-tekst.ts`; PDF bez tekstu odpada razem ze znaleziskami. */
    const strony = [...odp.strony, ...await tekstyPdf(odp.pdfy ?? [], deps.czytajPdf)];
    const odrzucone: Partial<Record<PowodOdrzucenia, number>> = {};
    let zaproponowano = 0;
    for (const z of odp.znaleziska.slice(0, SUFIT_ZNALEZISK)) {
      const powod = sprawdzZnalezisko(z, strony, k.numerySita);
      if (powod) {
        odrzucone[powod] = (odrzucone[powod] ?? 0) + 1;
        continue;
      }
      try {
        const p = zaproponujZastosowanie({
          twId: k.twId,
          model: { rodzaj: z.rodzaj, marka: z.marka.trim(), nazwa: z.model.trim(), wariant: z.wariant?.trim() || null },
          warunki: { rokOd: z.rokOd ?? null, rokDo: z.rokDo ?? null, seryjnyOd: z.seryjnyOd ?? null, seryjnyDo: z.seryjnyDo ?? null },
          polaryzacja: "pasuje",
          zrodlo: "copilot",
          komentarz: `Automat nocny znalazł to w sieci (${OPIS_ZRODLA[z.zrodloStrony]}). Sprawdź stronę przed zatwierdzeniem.`,
          dowod: {
            rodzaj: RODZAJ_DOWODU[z.zrodloStrony],
            tresc: `„${z.cytat.trim().slice(0, 400)}” — ${OPIS_ZRODLA[z.zrodloStrony]} ${host(z.url)}`,
            link: z.url,
          },
        }, { automat: "siec" }, database);
        if (p) zaproponowano += 1;
      } catch {
        /* Zły wpis (np. kartoteka zniknęła po imporcie) nie wywraca reszty. */
        wynik.bledow += 1;
      }
    }
    for (const [p, n] of Object.entries(odrzucone)) {
      wynik.odrzucono[p as PowodOdrzucenia] = (wynik.odrzucono[p as PowodOdrzucenia] ?? 0) + n;
    }
    wynik.zaproponowano += zaproponowano;
    zapiszPrzebieg(database, k.twId, "ok", odp.znaleziska.length, zaproponowano, odrzucone, odp.wyszukiwan, null, teraz());
  }

  if (wynik.sprawdzono || wynik.bledow) {
    logEvent("pasowanie_siec", "automat (siec)", null, { ...wynik }, null, database);
  }
  return wynik;
}

function zapiszPrzebieg(
  database: DatabaseSync, twId: number, stan: "ok" | "blad", znalezisk: number, zaproponowano: number,
  odrzucone: Partial<Record<PowodOdrzucenia, number>>, wyszukiwan: number, blad: string | null, teraz: Date,
): void {
  database.prepare(`INSERT INTO pasowanie_siec(tw_id,at,wynik,znalezisk,zaproponowano,odrzucone,wyszukiwan,blad)
    VALUES (?,?,?,?,?,?,?,?)`).run(twId, teraz.toISOString(), stan, znalezisk, zaproponowano,
    JSON.stringify(odrzucone), wyszukiwan, blad ? blad.slice(0, 300) : null);
}

function zapiszKsiege(
  database: DatabaseSync, odp: WynikSieci | null, stan: "ok" | "blad", blad: string | null, teraz: Date,
  zuzyciePrzedBledem?: Tokeny,
): void {
  const t = odp?.zuzycie ?? zuzyciePrzedBledem;
  /* Model pusty tylko wtedy, gdy nic nie zapłacono — pomiar pomija takie
     wiersze, a z tokenami musi je policzyć. Wyszukiwania w osobnej kolumnie,
     bo płaci się za nie od sztuki, nie od tokenu. */
  const model = odp?.model ?? (t && (t.wej || t.wyj) ? config.copilot.model : "");
  database.prepare(`INSERT INTO copilot_wywolanie
    (zadanie,model,tokeny_wej,tokeny_wyj,tokeny_cache_zapis,tokeny_cache_odczyt,wyszukiwania,ms,wynik,blad,at)
    VALUES ('pasowanie_siec',?,?,?,?,?,?,?,?,?,?)`)
    .run(model, t?.wej ?? 0, t?.wyj ?? 0, t?.cacheZapis ?? 0, t?.cacheOdczyt ?? 0,
      odp?.wyszukiwan ?? t?.wyszukiwania ?? 0, odp?.ms ?? 0, stan, blad ? blad.slice(0, 300) : null,
      teraz.toISOString());
}

/* ── Stan dla ekranu Wiedzy (0.508.0) ───────────────────────────────────────
   Właściciel chciał uruchomić automat ręcznie, poza oknem nocnym, żeby
   zobaczyć go w pracy. Ekran potrzebuje wiedzieć trzy rzeczy: czy wolno
   (wyłącznik i klucz), ile zostało z sufitu i co wyszło ostatnio. */

export interface OstatniPrzebieg {
  symbol: string;
  at: string;
  wynik: "ok" | "blad";
  znalezisk: number;
  zaproponowano: number;
  odrzucone: Partial<Record<PowodOdrzucenia, number>>;
  blad: string | null;
}

export interface StanPasowaniaZSieci {
  /** `null` = można uruchomić; inaczej zdanie, czego brakuje. */
  niegotowy: string | null;
  naNoc: number;
  /** Ile kartotek sprawdzono w oknie sufitu — także ręcznie, w dzień. */
  sprawdzono: number;
  /** Ile kartotek czeka na sprawdzenie. */
  doSprawdzenia: number;
  ostatnie: OstatniPrzebieg[];
}

/** Czego brakuje, żeby automat mógł ruszyć. Jedno zdanie, bo ekran je pokazuje. */
export function czemuNiegotowy(): string | null {
  if (!config.pasowanieZSieci.wlaczony) return "Pasowanie z sieci jest wyłączone — włącza je PASOWANIE_Z_SIECI=1 w ustawieniach.";
  if (config.copilot.mode !== "anthropic" || !config.copilot.klucz) {
    return "Copilot nie ma połączenia z Anthropic — ustaw COPILOT_MODE=anthropic i klucz.";
  }
  return null;
}

/** Czysty ODCZYT — otwarcie ekranu niczego nie zapisuje. */
export function stanPasowaniaZSieci(teraz = new Date(), database: DatabaseSync = db()): StanPasowaniaZSieci {
  const odKiedy = new Date(teraz.getTime() - PONOWNIE_PO_DNIACH * 86_400_000).toISOString();
  const poBledzie = new Date(teraz.getTime() - PONOWNIE_PO_BLEDZIE_DNI * 86_400_000).toISOString();
  const doSprawdzenia = (database.prepare(`SELECT count(*) n FROM sgt_towar t WHERE ${WARUNEK_KANDYDATA}`)
    .get(odKiedy, poBledzie) as { n: number }).n;
  const ostatnie = (database.prepare(`SELECT COALESCE(t.symbol, '#' || p.tw_id) AS symbol, p.at, p.wynik,
      p.znalezisk, p.zaproponowano, p.odrzucone, p.blad
      FROM pasowanie_siec p LEFT JOIN sgt_towar t ON t.tw_id=p.tw_id ORDER BY p.id DESC LIMIT 5`)
    .all() as Array<Record<string, unknown>>).map((w) => ({
    symbol: String(w.symbol), at: String(w.at), wynik: w.wynik as "ok" | "blad",
    znalezisk: Number(w.znalezisk), zaproponowano: Number(w.zaproponowano),
    odrzucone: JSON.parse(String(w.odrzucone ?? "{}")) as Partial<Record<PowodOdrzucenia, number>>,
    blad: w.blad == null ? null : String(w.blad),
  }));
  return {
    niegotowy: czemuNiegotowy(), naNoc: config.pasowanieZSieci.naNoc,
    sprawdzono: sprawdzonychTejNocy(teraz, database), doSprawdzenia, ostatnie,
  };
}

/* ── Przegląd listą (0.527.0) ───────────────────────────────────────────────
   Pierwszy dzień na żywo: trzy kartoteki dały szesnaście propozycji, a w
   kolejce czeka ponad tysiąc kartotek. Zatwierdzane pojedynczo, z kartą na
   każdą maszynę, to kilka tysięcy kliknięć.

   Kształt przepisany z wykazów części (`wykaz-czesci.ts`), bo to ta sama
   robota: jedno źródło, wiele par część → maszyna, człowiek odznacza, co mu
   nie pasuje, i zatwierdza resztę jednym kliknięciem. Różnica jest jedna:
   grupa to KARTOTEKA, nie wykaz — bo automat pyta o jedną część naraz,
   a pytanie przy przeglądzie brzmi „czy ta część pasuje do tych maszyn”.

   Tak samo jak przy wykazach: NIEODZNACZONE NIE JEST ODRZUCONE. Zostaje
   w kolejce; odrzuca się pojedynczo, z powodem, bo powód uczy automat. */

/** Podpis, pod którym automat składa propozycje (`podpis({ automat: "siec" })`). */
export const AUTOR_SIECI = "automat (siec)";

export interface PozycjaZSieci {
  id: number;
  maszyna: string;
  warunki: string | null;
  /** Cytat ze strony razem z nazwą źródła — tak, jak stoi w dowodzie. */
  cytat: string;
  link: string | null;
}

export interface PrzegladZSieci {
  twId: number;
  symbol: string;
  nazwa: string | null;
  pozycje: PozycjaZSieci[];
}

/** Propozycje automatu pogrupowane po kartotece. Czysty ODCZYT. */
export function przegladZSieci(propozycje: Zastosowanie[], database: DatabaseSync = db()): PrzegladZSieci[] {
  const grupy = new Map<number, PrzegladZSieci>();
  for (const z of propozycje) {
    if (z.stan !== "propozycja" || z.zaproponowal !== AUTOR_SIECI || z.importId !== null) continue;
    let g = grupy.get(z.twId);
    if (!g) {
      const t = database.prepare("SELECT nazwa FROM sgt_towar WHERE tw_id=?").get(z.twId) as { nazwa: string } | undefined;
      g = { twId: z.twId, symbol: z.symbol, nazwa: t?.nazwa ?? null, pozycje: [] };
      grupy.set(z.twId, g);
    }
    const d = z.dowody[0];
    g.pozycje.push({ id: z.id, maszyna: z.model.etykieta, warunki: z.zdanieWarunkow, cytat: d?.tresc ?? "", link: d?.link ?? null });
  }
  /* Najpierw kartoteki z największą liczbą maszyn: jedno kliknięcie tam
     zdejmuje z kolejki najwięcej pracy. */
  return [...grupy.values()].sort((a, b) => b.pozycje.length - a.pozycje.length || a.twId - b.twId);
}

export interface WynikZatwierdzeniaZSieci {
  zatwierdzono: number;
  /** Rozstrzygnięte w międzyczasie przez kogoś innego — lista ich nie ruszyła. */
  pominieto: number;
}

/**
 * Zatwierdzenie LISTY propozycji automatu dla jednej kartoteki. Każda idzie
 * przez `rozstrzygnijZastosowanie`, więc zostawia ten sam ślad co pojedyncze
 * kliknięcie. Id spoza tej kartoteki albo nie od automatu wywraca całe
 * żądanie — lista to decyzja o TYM, co człowiek widział na ekranie.
 */
export function zatwierdzZSieci(
  twId: number, ids: unknown, userId: number, database: DatabaseSync = db(),
): WynikZatwierdzeniaZSieci {
  const autor = czlowiekZBiura(database, userId);
  if (!Array.isArray(ids) || ids.length === 0 || !ids.every((i) => Number.isInteger(i))) {
    throw new Error("Zaznacz co najmniej jedną maszynę z listy");
  }
  const lista = [...new Set(ids as number[])];
  return wTransakcji(database, () => {
    const swoje = new Map((database.prepare(`SELECT id, stan FROM zastosowanie
        WHERE tw_id=? AND zaproponowal=? AND import_id IS NULL AND id IN (${lista.map(() => "?").join(",")})`)
      .all(twId, AUTOR_SIECI, ...lista) as Array<{ id: number; stan: string }>).map((w) => [Number(w.id), w.stan]));
    const obce = lista.filter((i) => !swoje.has(i));
    if (obce.length > 0) throw new Error(`Propozycje spoza tej kartoteki albo nie od automatu: ${obce.join(", ")}`);
    let zatwierdzono = 0;
    let pominieto = 0;
    for (const id of lista) {
      if (swoje.get(id) !== "propozycja") { pominieto += 1; continue; }
      try {
        rozstrzygnijZastosowanie(id, "zatwierdz", null, userId, database);
        zatwierdzono += 1;
      } catch (e) {
        if (e instanceof WiedzaConflict) { pominieto += 1; continue; }
        throw e;
      }
    }
    logEvent("pasowanie_siec_zatwierdzenie", autor, twId, { twId, zatwierdzono, pominieto, ids: lista }, userId, database);
    return { zatwierdzono, pominieto };
  });
}
