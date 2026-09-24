import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { config } from "../config.js";
import { dataLokalna, godzinaLokalna } from "../czas.js";

/* ── Kopie bazy aplikacji robi sam serwer (0.487.0) ──────────────────────────
   Do tego wydania kopia była czynnością człowieka w DWÓCH miejscach, a obie
   stały tylko w dokumentacji:

   1. „Przed KAŻDĄ aktualizacją zrób kopię wertis.db" (DEPLOY.md §2), bo
      migracje przy starcie kasują tabele — trzy razy dotąd: 0.140.0, 0.388.0
      i 0.434.0. `-Aktualizuj` instalatora tej kopii NIE robił.
   2. Nocna kopia w Harmonogramie zadań (DEPLOY.md §7). Instalator kończył
      prośbą, żeby ją ustawić. Bramka etapu 4 wdrożenia stoi na niej.

   Krok, na którym stoi bramka, nie może zależeć od pamięci. Serwer ma bazę
   otwartą przez cały czas, więc wie lepiej niż ktokolwiek, kiedy jej kopia
   jest potrzebna.

   `VACUUM INTO`, nie kopia pliku. Baza chodzi w WAL, a dwa procesy piszą do
   niej naraz: zwykła kopia `wertis.db` bez `-wal` gubi ostatnie zapisy, a z
   `-wal` bywa niespójna. `VACUUM INTO` czyta jedną migawkę transakcji i daje
   samodzielny plik bez WAL-a, więc przywrócenie to jedno przeniesienie.

   Każda kopia przechodzi `PRAGMA quick_check`. Kopia, której nikt nie
   otworzył, jest przypuszczeniem, a nie kopią. Sprawdzenie nie zastępuje
   próby odtworzenia z etapu 3 — mówi tylko, że plik jest bazą.            */

/** Ile kopii każdego rodzaju zostaje. Starsze znikają przy następnej. */
export const ZOSTAW_PRZED = 5;
export const ZOSTAW_NOCNYCH = 14;

/* Okno nocne po czasie z zegara na ścianie. `VACUUM INTO` w `node:sqlite`
   jest synchroniczne i na czas kopii zatrzymuje obsługę żądań. W nocy nikt
   tego nie zauważy, w dzień kolektor dostałby kilka sekund ciszy. Dlatego
   zaległa kopia NIE jest nadrabiana w dzień — zdrowie mówi o niej zdaniem. */
export const NOC_OD = 1;
export const NOC_DO = 5;

/* Po tylu godzinach bez nocnej kopii zdrowie robi się czerwone. Dwie doby,
   nie jedna: jedna przegapiona noc (serwer wyłączony na święta) to jeszcze
   nie awaria, a zdanie, które krzyczy za wcześnie, uczy je ignorować. */
export const ALARM_PO_GODZINACH = 48;

export interface WpisKopii {
  at: string;
  plik: string;
  bajtow: number;
}

/** Stan kopii w `stan.json` obok nich — poza bazą, której dotyczy. */
export interface StanKopii {
  /** Wersja, na której ostatnio skończyła się migracja schematu. */
  wersja?: string;
  /** Pierwszy zapis stanu — od niego liczy się alarm, gdy kopii jeszcze nie ma. */
  od?: string;
  przed?: WpisKopii;
  noc?: WpisKopii;
  rekoncyliacja?: { at: string; rozjazdow: number; plik: string | null };
  /** Ostatnia nieudana kopia. Znika przy następnej udanej. */
  blad?: { at: string; rodzaj: "przed" | "noc"; komunikat: string };
}

const plikStanu = (katalog: string) => path.join(katalog, "stan.json");

export function czytajStan(katalog: string = config.kopie.katalog): StanKopii {
  try {
    return JSON.parse(fs.readFileSync(plikStanu(katalog), "utf8")) as StanKopii;
  } catch {
    /* Brak pliku to pierwsza kopia, a zepsuty plik to nie powód, żeby nie
       zrobić następnej. W obu przypadkach zaczynamy od pustego stanu. */
    return {};
  }
}

function zapiszStan(katalog: string, stan: StanKopii, teraz: string): void {
  fs.mkdirSync(katalog, { recursive: true });
  const pelny: StanKopii = { ...stan, od: stan.od ?? teraz };
  /* Zapis przez plik tymczasowy: przerwany w połowie zostawiłby pusty JSON,
     a pusty stan znaczy „kopii nie było" i jeszcze jedną kopię przy starcie. */
  const tmp = `${plikStanu(katalog)}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(pelny, null, 2), "utf8");
  fs.renameSync(tmp, plikStanu(katalog));
}

/**
 * Migawka bazy do pliku `cel`, sprawdzona otwarciem. Rzuca, gdy się nie uda.
 */
export function zrobKopie(database: DatabaseSync, cel: string): number {
  fs.mkdirSync(path.dirname(cel), { recursive: true });
  /* `VACUUM INTO` odmawia, gdy plik istnieje — i dobrze, ale resztka po
     przerwanej próbie z tą samą nazwą nie może blokować następnej. */
  fs.rmSync(cel, { force: true });
  const tmp = `${cel}.tmp`;
  fs.rmSync(tmp, { force: true });
  database.prepare("VACUUM INTO ?").run(tmp);

  const kopia = new DatabaseSync(tmp, { readOnly: true });
  try {
    const wynik = kopia.prepare("PRAGMA quick_check").all() as Array<Record<string, unknown>>;
    const pierwszy = wynik[0] ? Object.values(wynik[0])[0] : null;
    if (wynik.length !== 1 || pierwszy !== "ok") {
      throw new Error(`kopia nie przeszła quick_check: ${JSON.stringify(wynik.slice(0, 3))}`);
    }
  } finally {
    kopia.close();
  }
  /* Pod właściwą nazwę dopiero po sprawdzeniu. Plik o nazwie kopii ma znaczyć
     kopię dobrą, bo po nazwie ktoś będzie go przywracał. */
  fs.renameSync(tmp, cel);
  return fs.statSync(cel).size;
}

/** Zostawia `zostaw` najnowszych plików z prefiksem; nazwy sortują się po czasie. */
export function przytnij(katalog: string, prefiks: string, zostaw: number): string[] {
  let pliki: string[];
  try {
    pliki = fs.readdirSync(katalog).filter((p) => p.startsWith(prefiks) && p.endsWith(".db"));
  } catch {
    return [];
  }
  const doUsuniecia = pliki.sort().reverse().slice(zostaw);
  for (const p of doUsuniecia) fs.rmSync(path.join(katalog, p), { force: true });
  return doUsuniecia;
}

/* Znacznik czasu do nazwy pliku: sortuje się tekstowo i nie ma dwukropków,
   których Windows nie przyjmie w nazwie. */
const stempel = (iso: string) => iso.slice(0, 19).replace(/[-:]/g, "").replace("T", "-");

function bazaPusta(database: DatabaseSync): boolean {
  const r = database.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table'").get() as
    { n: number };
  return r.n === 0;
}

/**
 * Kopia PRZED migracją schematu, gdy zmieniła się wersja aplikacji.
 *
 * Woła ją `db()` w procesie, który migruje, zanim ruszy `schema.sql`. Po
 * udanej migracji ten sam proces woła `zapiszWersjeSchematu`. Migracja, która
 * padła, nie przestawia znacznika — następny start robi kopię jeszcze raz.
 *
 * NIE zatrzymuje startu, gdy kopia się nie uda. Odmowa startu w usłudze NSSM
 * to pętla restartów i magazyn bez kolektorów (blizna 0.174.2). Nieudana
 * kopia melduje się zdaniem w `/api/health`, a migracja idzie dalej.
 */
export function kopiaPrzedMigracja(
  database: DatabaseSync,
  wersja: string,
  katalog: string = config.kopie.katalog,
  teraz: string = new Date().toISOString(),
): string | null {
  const stan = czytajStan(katalog);
  if (stan.wersja === wersja) return null;

  const plik = `przed-${stempel(teraz)}-${stan.wersja ?? "nieznana"}-do-${wersja}.db`;
  /* Parasol obejmuje TAKŻE sprawdzenie pustości: to pierwsze zapytanie do
     bazy w tym procesie, więc to ono rzuci przy zepsutym pliku. Rzut stąd
     zatrzymałby start, a ta funkcja obiecuje, że nie zatrzymuje. */
  try {
    /* Świeża baza nie ma czego tracić. Jej kopia byłaby pustym plikiem, który
       wygląda jak kopia sprzed aktualizacji. */
    if (bazaPusta(database)) return null;
    const bajtow = zrobKopie(database, path.join(katalog, plik));
    przytnij(katalog, "przed-", ZOSTAW_PRZED);
    const { blad: _stary, ...reszta } = stan;
    zapiszStan(katalog, { ...reszta, przed: { at: teraz, plik, bajtow } }, teraz);
    console.log(`[kopie] przed migracją do ${wersja}: ${plik} (${bajtow} B)`);
    return plik;
  } catch (e) {
    const komunikat = e instanceof Error ? e.message : String(e);
    console.error(`[kopie] kopia przed migracją NIE POWSTAŁA: ${komunikat}`);
    try {
      zapiszStan(katalog, { ...stan, blad: { at: teraz, rodzaj: "przed", komunikat } }, teraz);
    } catch {
      /* Katalog niezapisywalny — to samo, co zatrzymało kopię. Zdanie w logu
         wyżej zostaje jedynym śladem i to wystarcza, żeby start szedł dalej. */
    }
    return null;
  }
}

/** Znacznik udanej migracji. Bez niego każdy start robiłby kopię od nowa. */
export function zapiszWersjeSchematu(
  wersja: string,
  katalog: string = config.kopie.katalog,
  teraz: string = new Date().toISOString(),
): void {
  try {
    const stan = czytajStan(katalog);
    if (stan.wersja !== wersja) zapiszStan(katalog, { ...stan, wersja }, teraz);
  } catch (e) {
    /* Niezapisany znacznik kosztuje jedną kopię za dużo przy następnym
       starcie. Zatrzymanie serwera z tego powodu kosztowałoby magazyn. */
    console.error(`[kopie] nie zapisałem wersji schematu: ${e instanceof Error ? e.message : e}`);
  }
}

/** Czy teraz jest okno nocnej kopii (czas lokalny magazynu). */
export function wOknieNocnym(teraz: string): boolean {
  const h = godzinaLokalna(teraz);
  return h >= NOC_OD && h < NOC_DO;
}

/**
 * Nocna kopia — raz na dobę lokalną, w oknie `NOC_OD`–`NOC_DO`.
 * Zwraca nazwę pliku albo `null`, gdy nie ma czego robić.
 */
export function kopiaNocna(
  database: DatabaseSync,
  katalog: string = config.kopie.katalog,
  teraz: string = new Date().toISOString(),
): string | null {
  if (!wOknieNocnym(teraz)) return null;
  const plik = `noc-${dataLokalna(teraz)}.db`;
  if (fs.existsSync(path.join(katalog, plik))) return null;

  const stan = czytajStan(katalog);
  try {
    const bajtow = zrobKopie(database, path.join(katalog, plik));
    przytnij(katalog, "noc-", ZOSTAW_NOCNYCH);
    const { blad: _stary, ...reszta } = stan;
    zapiszStan(katalog, { ...reszta, noc: { at: teraz, plik, bajtow } }, teraz);
    return plik;
  } catch (e) {
    const komunikat = e instanceof Error ? e.message : String(e);
    try {
      zapiszStan(katalog, { ...stan, blad: { at: teraz, rodzaj: "noc", komunikat } }, teraz);
    } catch { /* jak wyżej: log przy wywołującym zostaje jedynym śladem */ }
    throw e;
  }
}

/** Zapis wyniku nocnej rekoncyliacji — czyta go zdrowie, a nie tylko log. */
export function zapiszRekoncyliacje(
  rozjazdow: number,
  plik: string | null,
  katalog: string = config.kopie.katalog,
  teraz: string = new Date().toISOString(),
): void {
  zapiszStan(katalog, { ...czytajStan(katalog), rekoncyliacja: { at: teraz, rozjazdow, plik } }, teraz);
}

/** Czy rekoncyliacja przeszła już dziś (doba lokalna). */
export function rekoncyliacjaDzisiaj(stan: StanKopii, teraz: string): boolean {
  return !!stan.rekoncyliacja && dataLokalna(stan.rekoncyliacja.at) === dataLokalna(teraz);
}

/**
 * Zdania do `problemy` w `/api/health`.
 *
 * Tylko przy `SGT_MODE=mssql`. Dane demo i instancja dev nie mają czego
 * chronić, a czerwone zdrowie na pilocie uczyłoby, że czerwone jest normalne.
 */
export function problemyKopii(
  stan: StanKopii,
  sgtMode: string,
  katalog: string = config.kopie.katalog,
  teraz: string = new Date().toISOString(),
): string[] {
  if (sgtMode !== "mssql") return [];
  const problemy: string[] = [];

  if (stan.blad) {
    problemy.push(
      `Kopia bazy aplikacji (${stan.blad.rodzaj === "przed" ? "przed aktualizacją" : "nocna"}) `
        + `nie powstała ${dataLokalna(stan.blad.at)}: ${stan.blad.komunikat}. `
        + `Sprawdź miejsce na dysku i prawa zapisu do ${katalog}.`,
    );
  }

  /* Bez żadnej kopii alarm liczy się od pierwszego zapisu stanu, czyli od
     startu tego wydania. Świeża instalacja nie jest czerwona pierwszego dnia. */
  const odKiedy = stan.noc?.at ?? stan.od;
  if (odKiedy) {
    const godzin = (Date.parse(teraz) - Date.parse(odKiedy)) / 3_600_000;
    if (godzin > ALARM_PO_GODZINACH) {
      problemy.push(
        stan.noc
          ? `Ostatnia nocna kopia bazy jest z ${dataLokalna(stan.noc.at)}. `
            + `Serwer robi ją sam między ${NOC_OD}:00 a ${NOC_DO}:00, więc maszyna była wtedy wyłączona albo kopia pada.`
          : `Nie ma jeszcze ani jednej nocnej kopii bazy. `
            + `Serwer robi ją sam między ${NOC_OD}:00 a ${NOC_DO}:00, więc maszyna była wtedy wyłączona albo kopia pada.`,
      );
    }
  }

  const r = stan.rekoncyliacja;
  if (r && r.rozjazdow > 0) {
    problemy.push(
      `Nocna rekoncyliacja z ${dataLokalna(r.at)} znalazła ${r.rozjazdow} rozjazdów z Subiektem. `
        + `Raport: ${r.plik ?? "brak pliku"}; podgląd na żywo pod GET /api/reconcile.`,
    );
  }
  return problemy;
}
