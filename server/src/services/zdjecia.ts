import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { db, nowIso } from "../db/db.js";
import { config } from "../config.js";
import { subiekt } from "../context.js";
import { pobierzZeZrodla, type ZdjecieZrodlo } from "../adapters/zdjecia.sgt.js";

/* ── Cache zdjęć kartotek ────────────────────────────────────────────────────
   LENIWY CACHE PRZELOTOWY, nigdy import masowy — i to jest decyzja, nie
   uproszczenie. 3415 kartotek × ~150 KB to ~500 MB; ciągnięcie tego w cyklu
   importu (60 s) obciążałoby maszynę, na której biuro wystawia faktury
   (docs/architektura.md §3). Tymczasem rozkład dostępu jest skrajnie
   nierówny: zmiana otwiera 100-300 różnych kartotek, nie 3415. Pobranie „przy
   pierwszym otwarciu karty i potem przez tydzień nic" zamienia pół gigabajta
   w kilkaset pojedynczych SELECT-ów po kluczu głównym — wspólnych dla
   wszystkich kolektorów, bo cache siedzi na serwerze.

   KATALOG JEST INNY NIŻ `data/photos` i to też jest decyzja. Tamto są zdjęcia
   dowodowe do reklamacji, których nie wolno skasować nigdy; to jest cache,
   który wolno skasować w każdej chwili i który kasuje się sam po przekroczeniu
   limitu. Jeden katalog na dwa takie cykle życia kończy się skasowanym
   dowodem.                                                                    */

export interface WpisZdjecia {
  tw_id: number;
  /** Nazwa pliku w `data/zdjecia`; `null` = ten towar zdjęcia NIE MA. */
  plik: string | null;
  mime: string | null;
  bajtow: number;
  etag: string | null;
  pobrano_at: string;
  uzyto_at: string;
  /** Zdanie o BŁĘDZIE. Nigdy o braku zdjęcia — to dwie różne rzeczy. */
  blad: string | null;
}

export function katalogZdjec(): string {
  const dir = path.resolve(path.dirname(config.dbPath), "zdjecia");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Pełna ścieżka pliku z cache'u albo `null`, gdy go nie ma.
 *
 * `path.basename` jak w `services/problems.ts`: nazwa pliku pochodzi z bazy,
 * a baza jest tu wejściem jak każde inne.
 */
export function sciezkaZdjecia(nazwa: string): string | null {
  const plik = path.join(katalogZdjec(), path.basename(nazwa));
  return fs.existsSync(plik) ? plik : null;
}

function wpis(twId: number): WpisZdjecia | undefined {
  return db().prepare("SELECT * FROM zdjecie_cache WHERE tw_id = ?").get(twId) as
    | WpisZdjecia
    | undefined;
}

function starszyNiz(iso: string, godzin: number): boolean {
  return Date.now() - Date.parse(iso) > godzin * 3_600_000;
}

const rozszerzenie = (mime: string): string =>
  ({ "image/jpeg": "jpg", "image/png": "png", "image/bmp": "bmp", "image/gif": "gif", "image/tiff": "tif" })[mime] ??
  "img";

function zapiszNaDysk(twId: number, z: ZdjecieZrodlo): { plik: string; etag: string } {
  const plik = `t${twId}.${rozszerzenie(z.mime)}`;
  fs.writeFileSync(path.join(katalogZdjec(), plik), z.bajty);
  // ETag z TREŚCI: to samo zdjęcie po rewalidacji daje ten sam znacznik,
  // więc kolektor dostaje 304 zamiast 150 KB przez Wi-Fi przy regale.
  return { plik, etag: createHash("sha1").update(z.bajty).digest("hex") };
}

function zapamietaj(twId: number, dane: Partial<WpisZdjecia>): void {
  const teraz = nowIso();
  db()
    .prepare(
      `INSERT INTO zdjecie_cache(tw_id, plik, mime, bajtow, etag, pobrano_at, uzyto_at, blad)
       VALUES (@tw_id,@plik,@mime,@bajtow,@etag,@pobrano_at,@uzyto_at,@blad)
       ON CONFLICT(tw_id) DO UPDATE SET
         plik=excluded.plik, mime=excluded.mime, bajtow=excluded.bajtow,
         etag=excluded.etag, pobrano_at=excluded.pobrano_at,
         uzyto_at=excluded.uzyto_at, blad=excluded.blad`
    )
    .run({
      tw_id: twId,
      plik: dane.plik ?? null,
      mime: dane.mime ?? null,
      bajtow: dane.bajtow ?? 0,
      etag: dane.etag ?? null,
      pobrano_at: teraz,
      uzyto_at: teraz,
      blad: dane.blad ?? null,
    });
}

/**
 * Sprzątanie cache'u: wypada to, czego najdłużej nikt nie oglądał.
 *
 * Po `uzyto_at`, nie po `pobrano_at` — inaczej zdjęcie towaru oglądanego
 * codziennie wypadałoby tylko dlatego, że pobrano je jako pierwsze.
 *
 * Kasujemy do 80% limitu, nie do samego limitu: do granicy znaczyłoby, że
 * KAŻDE kolejne pobranie uruchamia sprzątanie, a cache dyszy przy progu
 * zamiast pracować.
 */
export function przytnijCache(): void {
  const limit = config.zdjecia.cacheMb * 1024 * 1024;
  const { suma } = db()
    .prepare("SELECT COALESCE(SUM(bajtow),0) AS suma FROM zdjecie_cache")
    .get() as { suma: number };
  if (suma <= limit) return;

  let doZwolnienia = suma - limit * 0.8;
  const kandydaci = db()
    .prepare("SELECT tw_id, plik, bajtow FROM zdjecie_cache WHERE plik IS NOT NULL ORDER BY uzyto_at")
    .all() as Array<{ tw_id: number; plik: string; bajtow: number }>;

  for (const k of kandydaci) {
    if (doZwolnienia <= 0) break;
    try {
      fs.unlinkSync(path.join(katalogZdjec(), path.basename(k.plik)));
    } catch {
      /* pliku już nie ma — wpis i tak wypada */
    }
    db().prepare("DELETE FROM zdjecie_cache WHERE tw_id = ?").run(k.tw_id);
    doZwolnienia -= k.bajtow;
  }
}

/** Odnotowanie użycia — to po tym idzie eviction. */
function dotknij(twId: number): void {
  db().prepare("UPDATE zdjecie_cache SET uzyto_at = ? WHERE tw_id = ?").run(nowIso(), twId);
}

/** Odczyt ze źródła — podmieniany w testach (patrz `zapewnijZdjecie`). */
export type Zrodlo = (twId: number, symbol: string) => Promise<ZdjecieZrodlo | null>;

/**
 * Zdjęcie towaru z cache'u, pobrane ze źródła gdy trzeba.
 *
 * Zwraca wpis (także taki z `plik = null`, czyli „potwierdzony brak zdjęcia")
 * albo `null`, gdy funkcja jest wyłączona.
 *
 * Źródło wchodzi PARAMETREM, nie samym importem — tak jak adapter Sfery
 * w `worker/kolejka.ts`. Dzięki temu test podstawia własne i może policzyć,
 * ILE RAZY zostało zapytane; a policzenie tego jest tu całą stawką, bo ten
 * serwis istnieje wyłącznie po to, żeby drugie pytanie nie doszło do bazy firmy.
 */
export async function zapewnijZdjecie(
  twId: number,
  zrodloFn: Zrodlo = pobierzZeZrodla
): Promise<WpisZdjecia | null> {
  if (config.zdjecia.zrodlo === "") return null;

  const c = config.zdjecia;
  const stary = wpis(twId);

  if (stary) {
    /* Wpis mówi „plik jest", a pliku nie ma — ktoś wyczyścił katalog albo
       eviction wyprzedził zapis. Pobieramy ponownie zamiast zwracać 404:
       cache skasowany ręką nie ma prawa zabić funkcji. */
    const plikIstnieje = stary.plik ? sciezkaZdjecia(stary.plik) !== null : true;

    if (plikIstnieje) {
      if (stary.blad) {
        // Błąd źródła ponawiamy po minutach, nie po tygodniu.
        if (!starszyNiz(stary.pobrano_at, c.bladTtlMin / 60)) return stary;
      } else {
        /* „Zdjęcie jest" wolno trzymać tydzień — kartoteka rzadko zmienia
           obraz. „Zdjęcia nie ma" trzeba sprawdzać CZĘŚCIEJ, bo to jedyny
           stan, który zmienia się przez dodanie czegoś w Subiekcie, a kolektor
           obiecuje, że zobaczy to najdalej nazajutrz. Jeden próg na oba stany
           znaczył, że nowe zdjęcie czekało tydzień. */
        const prog = stary.plik ? c.ttlH : c.brakTtlH;
        if (!starszyNiz(stary.pobrano_at, prog)) {
          if (stary.plik) dotknij(twId);
          return stary;
        }
      }
    }
  }

  const towar = subiekt.getProductById(twId);
  if (!towar) return null;

  let zrodlo: ZdjecieZrodlo | null;
  try {
    zrodlo = await zrodloFn(twId, towar.symbol);
  } catch (e) {
    /* Źródło padło. Gdy mamy stary plik — oddajemy go: nieaktualne zdjęcie
       śruby jest nieszkodliwe, a brak zdjęcia w martwej strefie nie. */
    zapamietaj(twId, {
      plik: stary?.plik ?? null,
      mime: stary?.mime ?? null,
      bajtow: stary?.bajtow ?? 0,
      etag: stary?.etag ?? null,
      blad: e instanceof Error ? e.message : String(e),
    });
    return wpis(twId) ?? null;
  }

  if (!zrodlo) {
    // Potwierdzony BRAK zdjęcia — stan trzeci, nie brak wpisu. Bez niego setki
    // kartotek bez zdjęcia pytałyby Subiekta przy każdym otwarciu karty.
    zapamietaj(twId, {});
    return wpis(twId) ?? null;
  }

  const kb = Math.round(zrodlo.bajty.length / 1024);
  if (kb > c.maxKb) {
    /* Serwer nie umie zmniejszać obrazów (zero modułów natywnych), więc jedyną
       obroną przed skanem 20 MB jest odmowa. Zdanie mówi ile ważyło — próg
       dobiera się potem na liczbach z własnej bazy, nie na przypuszczeniu. */
    zapamietaj(twId, {
      blad: `Zdjęcie ma ${kb} kB, limit ZDJECIA_MAX_KB to ${c.maxKb} kB — pomijam.`,
    });
    return wpis(twId) ?? null;
  }

  const { plik, etag } = zapiszNaDysk(twId, zrodlo);
  zapamietaj(twId, { plik, mime: zrodlo.mime, bajtow: zrodlo.bajty.length, etag });
  przytnijCache();
  return wpis(twId) ?? null;
}

/**
 * Kasuje wpisy „zdjęcia nie ma" i te po błędzie — następne wejście na kartę
 * zapyta źródło od nowa. Zwraca liczbę skasowanych.
 *
 * POWSTAŁO, BO NIE BYŁO JAK POCZEKAĆ KRÓCEJ. Zdjęcie dodane w Subiekcie
 * pojawia się samo, ale dopiero po `ZDJECIA_BRAK_TTL_H` — a przy wdrożeniu
 * i przy sprawdzaniu „czy już działa" te godziny są nie do przyjęcia.
 *
 * Wpisów Z PLIKIEM nie ruszamy: mają swój własny, dłuższy cykl odświeżania,
 * a skasowanie ich kazałoby wszystkim kolektorom ściągnąć obrazy od nowa.
 */
export function zapomnijBrakiZdjec(): number {
  const r = db()
    .prepare("DELETE FROM zdjecie_cache WHERE plik IS NULL")
    .run();
  return Number(r.changes ?? 0);
}

/** Statystyki do `/api/health` — próg MAX_KB dobiera się na liczbach. */
export function statystykiZdjec(): {
  wCache: number;
  bezZdjecia: number;
  wBledzie: number;
  mb: number;
  najwiekszeKb: number;
} {
  const r = db()
    .prepare(
      `SELECT
         SUM(CASE WHEN plik IS NOT NULL THEN 1 ELSE 0 END) AS wCache,
         SUM(CASE WHEN plik IS NULL AND blad IS NULL THEN 1 ELSE 0 END) AS bezZdjecia,
         SUM(CASE WHEN blad IS NOT NULL THEN 1 ELSE 0 END) AS wBledzie,
         COALESCE(SUM(bajtow),0) AS bajtow,
         COALESCE(MAX(bajtow),0) AS max_bajtow
       FROM zdjecie_cache`
    )
    .get() as { wCache: number; bezZdjecia: number; wBledzie: number; bajtow: number; max_bajtow: number };
  return {
    wCache: r.wCache ?? 0,
    bezZdjecia: r.bezZdjecia ?? 0,
    wBledzie: r.wBledzie ?? 0,
    mb: Math.round((r.bajtow / 1048576) * 10) / 10,
    najwiekszeKb: Math.round(r.max_bajtow / 1024),
  };
}
