import type { DatabaseSync } from "node:sqlite";
import { db } from "../db/db.js";
import { config } from "../config.js";
import { logEvent } from "./events.js";
import { zwin } from "../tekst.js";
import type { Tokeny } from "./copilot-koszt.js";
import { zaproponujZastosowanie, type RodzajDowodu } from "./wiedza.js";
import { BladKluczaCopilota, BladLimituCopilota, BladPrzeciazeniaCopilota } from "../adapters/copilot.js";

/* ── Pasowanie z sieci: nocny automat uzupełnia luki wiedzy (@wydanie) ───────

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
}

export interface WynikSieci {
  znaleziska: ZnaleziskoSurowe[];
  /** Strony PRZECZYTANE przez `web_fetch` — tekst do sprawdzenia cytatu. */
  strony: Array<{ url: string; tekst: string }>;
  wyszukiwan: number;
  model: string;
  zuzycie: Tokeny;
  ms: number;
}

export type NadawcaPasowaniaSieci = (z: ZapytanieOPasowanie) => Promise<WynikSieci>;

export type PowodOdrzucenia =
  | "zly_adres" | "allegro" | "strona_nieprzeczytana" | "cytat_spoza_strony"
  | "model_spoza_cytatu" | "marka_spoza_strony" | "numer_spoza_strony" | "za_krotki_model";

const host = (url: string): string | null => {
  try {
    const u = new URL(url);
    return u.protocol === "https:" || u.protocol === "http:" ? u.hostname : null;
  } catch {
    return null;
  }
};

/* Adres porównujemy bez kotwicy i końcowego ukośnika: model cytuje adres
   tak, jak go podał w `web_fetch`, a serwer oddaje go czasem znormalizowany. */
const bezOgona = (url: string) => url.replace(/#.*$/, "").replace(/\/+$/, "").toLowerCase();

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
  /* Oznaczenie krótsze niż trzy znaki („25") trafia w każdą liczbę na stronie. */
  if (model.length < 3) return "za_krotki_model";
  if (!cytat.includes(model)) return "model_spoza_cytatu";
  const marka = zwin(z.marka);
  if (!marka || !(cytat.includes(marka) || tekst.includes(marka))) return "marka_spoza_strony";
  if (!numery.some((n) => zwin(n).length >= 4 && tekst.includes(zwin(n)))) return "numer_spoza_strony";
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

export interface Kandydat {
  twId: number;
  symbol: string;
  nazwa: string;
  numery: string[];
}

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
  const wiersze = database.prepare(`SELECT t.tw_id, t.symbol, t.nazwa,
        (SELECT group_concat(i.wartosc, char(31)) FROM towar_identyfikator i
          WHERE i.tw_id=t.tw_id AND i.rodzaj IN ('oem','nr_oryg')) AS numery
      FROM sgt_towar t
     WHERE EXISTS (SELECT 1 FROM towar_identyfikator i WHERE i.tw_id=t.tw_id AND i.rodzaj IN ('oem','nr_oryg'))
       AND NOT EXISTS (SELECT 1 FROM zastosowanie z WHERE z.tw_id=t.tw_id AND z.stan IN ('propozycja','zatwierdzone'))
       AND NOT EXISTS (SELECT 1 FROM pasowanie_siec p WHERE p.tw_id=t.tw_id
             AND ((p.wynik='ok' AND p.at >= ?) OR (p.wynik='blad' AND p.at >= ?)))
     ORDER BY EXISTS (SELECT 1 FROM oferta_kartoteka k WHERE k.tw_id=t.tw_id) DESC, t.tw_id
     LIMIT ?`).all(odKiedy, poBledzie, limit) as Array<{ tw_id: number; symbol: string; nazwa: string; numery: string | null }>;
  return wiersze.map((w) => ({
    twId: Number(w.tw_id), symbol: w.symbol, nazwa: w.nazwa,
    numery: [...new Set(String(w.numery ?? "").split("\u001f").map((n) => n.trim()).filter(Boolean))].slice(0, 5),
  }));
}

/** Ile kartotek sprawdzono w ostatniej nocy — z księgi, więc restart nie zeruje. */
export function sprawdzonychTejNocy(teraz = new Date(), database: DatabaseSync = db()): number {
  const od = new Date(teraz.getTime() - OKNO_NOCY_MS).toISOString();
  return (database.prepare(`SELECT count(*) n FROM copilot_wywolanie WHERE zadanie='pasowanie_siec' AND at >= ?`)
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
  teraz?: () => Date;
  database?: DatabaseSync;
}): Promise<WynikPrzebiegu> {
  const database = deps.database ?? db();
  const teraz = deps.teraz ?? (() => new Date());
  const wynik: WynikPrzebiegu = { sprawdzono: 0, zaproponowano: 0, odrzucono: {}, bledow: 0, przerwane: null };
  const zostalo = deps.naNoc - sprawdzonychTejNocy(teraz(), database);

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
    const odrzucone: Partial<Record<PowodOdrzucenia, number>> = {};
    let zaproponowano = 0;
    for (const z of odp.znaleziska.slice(0, SUFIT_ZNALEZISK)) {
      const powod = sprawdzZnalezisko(z, odp.strony, k.numery);
      if (powod) {
        odrzucone[powod] = (odrzucone[powod] ?? 0) + 1;
        continue;
      }
      try {
        const p = zaproponujZastosowanie({
          twId: k.twId,
          model: { rodzaj: z.rodzaj, marka: z.marka.trim(), nazwa: z.model.trim(), wariant: z.wariant?.trim() || null },
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
