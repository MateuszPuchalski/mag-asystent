import { db } from "../db/db.js";
import { DLUGOSC_SYMBOLU, towaryPoSymbolach, type TowarPoSymbolu } from "../adapters/zdjecia.sgt.js";
import { powodWylaczenia } from "./zdjecia-bez.js";

/* ── Import zdjęć z folderu — dopasowanie nazw plików do kartotek ────────────
   Biuro wskazuje folder plików nazwanych symbolem towaru. Przeglądarka
   wysyła same symbole, a serwer mówi, który plik trafi w kartotekę i czy
   ta ma już zdjęcie. Odczyt bez zapisu: zapis idzie potem po jednym pliku. */

/** Najwięcej symboli w jednym pytaniu. Folder właściciela ma ich kilkaset. */
export const SYMBOLI_MAX = 2000;

export interface PozycjaDopasowania {
  /** Symbol tak, jak przyszedł, po przycięciu. Po nim panel łączy odpowiedź z plikiem. */
  symbol: string;
  twId: number | null;
  nazwa: string | null;
  maZdjecie: boolean;
  /** Zdjęcie leży w WERTIS i czeka na Subiekt — drugi import by je zdublował. */
  oczekuje: boolean;
  zablokowany: boolean;
  /** Symbol trafia w kilka aktywnych kartotek; rozstrzyga człowiek, nie kolejność. */
  niejednoznaczny?: true;
}

export interface WynikDopasowania {
  wlaczone: boolean;
  powod?: string;
  pozycje: PozycjaDopasowania[];
}

type Zrodlo = typeof towaryPoSymbolach;
let zrodlo: Zrodlo = towaryPoSymbolach;

/** Wyłącznie dla testów: w CI nie ma bazy Subiekta, a trasa ma się dać sprawdzić. */
export function ustawZrodloDopasowania(fn: Zrodlo | null): void {
  zrodlo = fn ?? towaryPoSymbolach;
}

/**
 * Lista symboli z ciała żądania — albo zdanie o tym, co jest nie tak.
 *
 * Przycięte, bez pustych i bez powtórzeń, w kolejności pierwszego wystąpienia.
 * Limit liczymy na tym, co przyszło: dwa tysiące duplikatów to też za dużo.
 */
export function symboleZCiala(
  surowe: unknown
): { ok: true; symbole: string[] } | { ok: false; error: string } {
  if (!Array.isArray(surowe)) return { ok: false, error: "Pole symbole musi być listą" };
  if (surowe.length > SYMBOLI_MAX) {
    return { ok: false, error: `Najwyżej ${SYMBOLI_MAX} symboli naraz — podziel folder na części.` };
  }
  const widziane = new Set<string>();
  const symbole: string[] = [];
  for (const s of surowe) {
    if (typeof s !== "string") return { ok: false, error: "Każdy symbol musi być tekstem" };
    const przyciety = s.trim();
    if (!przyciety || widziane.has(przyciety)) continue;
    widziane.add(przyciety);
    symbole.push(przyciety);
  }
  return { ok: true, symbole };
}

/* Klucz porównania jak kolacja Subiekta: bez wielkości liter, po przycięciu.
   Polskie litery zmniejsza locale, żeby „Ł" trafiało w „ł". */
const klucz = (s: string) => s.trim().toLocaleLowerCase("pl");

/** Które z towarów mają u nas zdjęcie, którego Subiekt jeszcze nie ma. */
function oczekujace(twIds: number[]): Set<number> {
  if (twIds.length === 0) return new Set();
  const wynik = new Set<number>();
  /* Paczkami, bo SQLite też ma sufit parametrów, a lista bywa długa. */
  for (let i = 0; i < twIds.length; i += 500) {
    const czesc = twIds.slice(i, i + 500);
    const wiersze = db()
      .prepare(
        `SELECT tw_id FROM zdjecie_wlasne WHERE w_subiekcie_at IS NULL AND tw_id IN (${czesc.map(() => "?").join(",")})`
      )
      .all(...czesc) as Array<{ tw_id: number }>;
    for (const w of wiersze) wynik.add(w.tw_id);
  }
  return wynik;
}

/**
 * Jedna kartoteka dla symbolu — albo żadna.
 *
 * Zablokowany duplikat to zwykle stara, wycofana karta, więc ustępuje
 * aktywnej. Dwie aktywne to błąd kartoteki: pierwsza z brzegu dostałaby
 * zdjęcie przypadkiem, więc nie dostaje go żadna.
 */
function wybierz(trafienia: TowarPoSymbolu[]): { towar: TowarPoSymbolu | null; niejednoznaczny: boolean } {
  if (trafienia.length <= 1) return { towar: trafienia[0] ?? null, niejednoznaczny: false };
  const aktywne = trafienia.filter((t) => !t.zablokowany);
  if (aktywne.length === 1) return { towar: aktywne[0], niejednoznaczny: false };
  if (aktywne.length === 0) return { towar: trafienia[0], niejednoznaczny: false };
  return { towar: null, niejednoznaczny: true };
}

/**
 * Dopasowanie symboli do kartotek. Wyjątek źródła przechodzi wyżej: awaria
 * bazy to nie „funkcja wyłączona" i panel ma pokazać ją jako błąd.
 */
export async function dopasujSymbole(symbole: string[]): Promise<WynikDopasowania> {
  const powod = powodWylaczenia();
  if (powod) return { wlaczone: false, powod, pozycje: [] };

  /* Za długi symbol nie istnieje w kartotece, a do bazy by nie doszedł cały. */
  const doBazy = symbole.filter((s) => s.length <= DLUGOSC_SYMBOLU);
  const wiersze = doBazy.length ? await zrodlo(doBazy) : [];

  const poKluczu = new Map<string, TowarPoSymbolu[]>();
  for (const w of wiersze) {
    const k = klucz(w.symbol);
    const lista = poKluczu.get(k) ?? [];
    lista.push(w);
    poKluczu.set(k, lista);
  }

  const wybrane = symbole.map((s) => ({ symbol: s, ...wybierz(poKluczu.get(klucz(s)) ?? []) }));
  const czeka = oczekujace(
    wybrane.flatMap((w) => (w.towar ? [w.towar.twId] : []))
  );
  return {
    wlaczone: true,
    pozycje: wybrane.map(({ symbol, towar, niejednoznaczny }) => ({
      symbol,
      twId: towar?.twId ?? null,
      nazwa: towar?.nazwa ?? null,
      maZdjecie: towar?.maZdjecie ?? false,
      oczekuje: towar ? czeka.has(towar.twId) : false,
      zablokowany: towar?.zablokowany ?? false,
      ...(niejednoznaczny ? { niejednoznaczny: true as const } : {}),
    })),
  };
}
