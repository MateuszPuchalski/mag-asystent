import { db, nowIso } from "../db/db.js";
import { config } from "../config.js";
import { subiekt } from "../context.js";
import { logEvent } from "./events.js";

/* ── Magazyny i ich widoczność na karcie towaru ─────────────────────────────
   Do lipca 2026 aplikacja znała trzy magazyny — te z `MAG_ID_*`. Karta towaru
   miała trzy sztywne pola, a importer filtrował `tw_Stan` po tych samych
   identyfikatorach, więc stany reszty w ogóle nie istniały w read-modelu.

   Teraz karta pokazuje wszystkie, a biuro może wybrane ukryć. Filtruje SERWER,
   nie kolektor: reguła ma mieć jednego właściciela (tak samo jak wzorce
   lokalizacji), a przy kilku kolektorach ukrycie musi zadziałać wszędzie
   naraz — nie na tym urządzeniu, na którym ktoś je akurat kliknął.          */

/** Rola magazynu w procesie; `null` = zwykły magazyn firmy. */
export type RolaMagazynu = "MAG" | "MGP" | "ZWROTY" | null;

export interface Magazyn {
  magId: number;
  kod: string;
  nazwa: string;
  rola: RolaMagazynu;
  ukryty: boolean;
}

/** Stan towaru w magazynie bez roli — to, co dochodzi na kartę. */
export interface MagazynStan {
  magId: number;
  kod: string;
  nazwa: string;
  stan: number;
  rez: number;
}

export function rolaMagazynu(magId: number): RolaMagazynu {
  if (magId === config.magId.MAG) return "MAG";
  if (magId === config.magId.MGP) return "MGP";
  if (magId === config.magId.ZWROTY) return "ZWROTY";
  return null;
}

/**
 * MAG, MGP i Zwroty nie dają się ukryć — i to nie jest ostrożność, tylko
 * konsekwencja tego, że prowadzą rozkładanie. MGP to strefa przyjęć, z której
 * bierze się towar; Zwroty sterują koszykiem i MM; MAG jest celem każdego
 * przesunięcia. Ukrycie MGP zostawiłoby magazyniera z dostawą do rozłożenia
 * i bez kafla mówiącego, ile jeszcze w tej strefie leży.
 */
export const daSieUkryc = (magId: number): boolean => rolaMagazynu(magId) === null;

const ukryteIds = (): Set<number> =>
  new Set(
    (db().prepare("SELECT mag_id FROM magazyn_widocznosc WHERE ukryty = 1").all() as unknown as Array<{
      mag_id: number;
    }>).map((r) => r.mag_id)
  );

/** Wszystkie magazyny z flagą `ukryty` i rolą — do ekranu ustawień. */
export function listaMagazynow(): Magazyn[] {
  const ukryte = ukryteIds();
  return subiekt.listMagazyny().map((m) => ({
    magId: m.mag_id,
    kod: m.kod,
    nazwa: m.nazwa,
    rola: rolaMagazynu(m.mag_id),
    // rola wygrywa nad zapisem: gdyby ktoś ukrył magazyn, a potem przypisał mu
    // rolę w konfiguracji, ma być widoczny mimo starego wpisu
    ukryty: ukryte.has(m.mag_id) && daSieUkryc(m.mag_id),
  }));
}

/**
 * Stany towaru w magazynach BEZ ROLI, pominąwszy ukryte.
 *
 * Trójka z rolami ma na karcie własne kafle z własną semantyką (MAG pokazuje
 * dostępne, MGP „do zasilenia", Zwroty „czeka na rozłożenie"), więc
 * powtarzanie jej w tym zestawieniu byłoby dublowaniem tej samej liczby
 * w dwóch miejscach.
 */
export function magazynyTowaru(twId: number): MagazynStan[] {
  const widoczne = new Map(
    listaMagazynow()
      .filter((m) => m.rola === null && !m.ukryty)
      .map((m) => [m.magId, m])
  );
  if (widoczne.size === 0) return [];

  return subiekt
    .getStockAll(twId)
    .flatMap((s) => {
      const m = widoczne.get(s.mag_id);
      if (!m) return [];
      return [{ magId: m.magId, kod: m.kod, nazwa: m.nazwa, stan: s.stan, rez: s.stan_rez }];
    })
    /* Malejąco po stanie: pierwsze pytanie brzmi „gdzie tego jeszcze jest",
       a nie „jaki jest numer magazynu". Zerowe zostają na dole — widoczne,
       bo zgłoszenie mówiło o WSZYSTKICH magazynach, a od zaśmiecania ekranu
       jest ukrywanie. */
    .sort((a, b) => b.stan - a.stan || a.kod.localeCompare(b.kod, "pl"));
}

export interface WynikUkrycia {
  ok: boolean;
  blad?: string;
  ukryte?: number[];
}

/** Zapis listy ukrytych magazynów. Lista jest PEŁNA — czego nie ma, jest widoczne. */
export function ustawUkryte(ukryte: number[], autor: string): WynikUkrycia {
  const znane = new Map(listaMagazynow().map((m) => [m.magId, m]));

  for (const id of ukryte) {
    const m = znane.get(id);
    if (!m) return { ok: false, blad: `Nie znam magazynu o id ${id}` };
    if (!daSieUkryc(id)) {
      return {
        ok: false,
        blad:
          `Magazyn ${m.kod} prowadzi rozkładanie (rola ${m.rola}) i nie da się go ukryć — ` +
          "karta towaru bez niego nie powiedziałaby, ile zostało do rozłożenia.",
      };
    }
  }

  const d = db();
  d.prepare("DELETE FROM magazyn_widocznosc").run();
  const ins = d.prepare(
    "INSERT INTO magazyn_widocznosc(mag_id, ukryty, at, przez) VALUES (?,1,?,?)"
  );
  const teraz = nowIso();
  for (const id of ukryte) ins.run(id, teraz, autor);

  logEvent("magazyny_widocznosc", autor, null, {
    ukryte,
    kody: ukryte.map((id) => znane.get(id)?.kod ?? String(id)),
  });
  return { ok: true, ukryte };
}
