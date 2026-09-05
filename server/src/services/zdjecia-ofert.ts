import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { config } from "../config.js";
import { db as defaultDb, nowIso, type Db } from "../db/db.js";

/* ── Cache zdjęć listingowych z Allegro (0.213.0) ────────────────────────────
   Adres `primaryImage.url` leży w `offer_snapshot`; tutaj mieszka PLIK.

   DLACZEGO PRZEZ SERWER, A NIE WPROST Z `<img src>`. Do 0.210.0 zdjęcia oferty
   nie było wcale, z uzasadnieniem „obrazek z serwera Allegro znaczyłby wyjście
   przeglądarki biura poza własną sieć". Ten zakaz obowiązuje dalej i ten moduł
   jest sposobem, żeby go DOTRZYMAĆ, a nie obejść: do sieci wychodzi serwer,
   który i tak rozmawia z Allegro, a przeglądarka bierze plik z naszej trasy.

   Trzy rzeczy, które to daje poza prywatnością:
   1. DOWÓD. Sprzedawca podmienia zdjęcie w ofercie, a rozmowa sprzed tygodnia
      ma pokazywać to, co klient WIDZIAŁ, kupując (§15.2). Hotlink traci ten
      obraz w chwili podmiany; kopia zostaje.
   2. Panel działa na stanowisku bez wyjścia na świat.
   3. Jeden pobór na ofertę dla wszystkich agentów, nie jeden na spojrzenie.

   ŚWIEŻOŚĆ IDZIE PO ADRESIE, NIE PO CZASIE. Allegro wydaje nowy adres dla
   podmienionego obrazu, więc `zrodlo_url` inny niż w snapshocie znaczy „pobierz
   od nowa", a taki sam — „to jest ten sam obraz". Cache kartotek musi zgadywać
   TTL-em, bo tam adresu nie ma; tutaj zgadywać nie trzeba.                    */

/**
 * Hosty, z których wolno pobierać.
 *
 * To NIE jest ostrożność na wyrost. Adres przyjeżdża z zewnątrz i ląduje
 * w naszej bazie, a potem serwer sam po niego idzie — czyli mamy żądanie
 * sterowane cudzą treścią. Bez tej listy wystarczyłby jeden dziwny wiersz,
 * żeby zamienić tę trasę w czytnik cudzej sieci wewnętrznej.
 *
 * Lista jest po SUFIKSIE domeny, bo Allegro rozkłada obrazy na wiele hostów
 * (`a.allegroimg.com`, `5.allegroimg.com` — oba stoją w przykładach
 * specyfikacji) i numeracja jest ich, nie nasza.
 */
const DOZWOLONE_HOSTY = [".allegroimg.com"];

/** Wpis cache'u. `plik = null` znaczy „pobranie się nie udało", patrz `blad`. */
export interface WpisZdjeciaOferty {
  channel_account_id: number;
  external_id: string;
  zrodlo_url: string;
  plik: string | null;
  mime: string | null;
  bajtow: number;
  etag: string | null;
  pobrano_at: string;
  uzyto_at: string;
  blad: string | null;
}

export function katalogZdjecOfert(): string {
  const dir = path.resolve(path.dirname(config.dbPath), "zdjecia-ofert");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function sciezkaZdjeciaOferty(nazwa: string): string | null {
  /* `path.basename` jak w `services/zdjecia.ts`: nazwa pochodzi z bazy,
     a baza jest tu wejściem jak każde inne. */
  const plik = path.join(katalogZdjecOfert(), path.basename(nazwa));
  return fs.existsSync(plik) ? plik : null;
}

/**
 * Adres miniatury albo `null`, gdy tego adresu nie da się przerobić.
 *
 * ── DLACZEGO TO NIE JEST ZGADYWANIE, ALE TEŻ NIE JEST PEWNIK ───────────────
 * Specyfikacja Allegro dokumentuje wyłącznie adres w rozmiarze ORYGINALNYM
 * („The url to the image in its original size"). Wariant rozmiarowy przez
 * podmianę segmentu (`/original/` → `/s128/`) jest niepisaną konwencją ich
 * CDN-u: widać ją w adresach na stronach Allegro, ale w `swagger.yaml` jej
 * nie ma, więc nie wolno na niej STANĄĆ — zasada „kształt Allegro czyta się
 * z pliku, nie z pamięci" kosztowała już trzy wydania.
 *
 * Rozstrzygnięcie: miniatura jest PRÓBĄ, a nie założeniem. Pobranie idzie
 * najpierw po nią, a gdy CDN odpowie czymkolwiek innym niż obrazem, ten sam
 * przebieg bierze adres oryginalny. Konwencja, która działa, oszczędza więc
 * transfer; konwencja, która przestanie działać, kosztuje jedno dodatkowe
 * żądanie do CDN-u i NIC na ekranie. Tym różni się to od mapowania z pamięci:
 * tam pomyłka jest cicha, tu ma jawną drogę wyjścia.
 *
 * `ALLEGRO_ZDJECIA_PX=0` wyłącza próbę i zostawia sam oryginał.
 */
export function adresMiniatury(url: string, px = config.allegroZdjecia.miniaturaPx): string | null {
  if (px <= 0) return null;
  if (!url.includes("/original/")) return null;
  return url.replace("/original/", `/s${px}/`);
}

function bezpiecznyAdres(url: string): URL | null {
  let adres: URL;
  try {
    adres = new URL(url);
  } catch {
    return null;
  }
  if (adres.protocol !== "https:") return null;
  const host = adres.hostname.toLowerCase();
  if (!DOZWOLONE_HOSTY.some((d) => host === d.slice(1) || host.endsWith(d))) return null;
  return adres;
}

const rozszerzenie = (mime: string): string =>
  ({ "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif" })[mime] ?? "img";

/** Nazwa pliku bez znaków z zewnątrz: numer oferty bywa czymkolwiek. */
const nazwaPliku = (konto: number, externalId: string, mime: string): string =>
  `o${konto}-${createHash("sha1").update(externalId).digest("hex").slice(0, 16)}.${rozszerzenie(mime)}`;

export interface PobranyObraz { bajty: Buffer; mime: string }

/**
 * Pobranie z CDN-u. Wydzielone, bo test podstawia własne — dokładnie jak
 * `Zrodlo` w `services/zdjecia.ts`. Policzenie, ILE RAZY tu weszliśmy, jest
 * całą stawką tego modułu.
 */
export type ZrodloObrazu = (url: string) => Promise<PobranyObraz | null>;

export async function pobierzZCdn(url: string): Promise<PobranyObraz | null> {
  const adres = bezpiecznyAdres(url);
  if (!adres) throw new Error(`Adres spoza allegroimg.com albo nie-https: ${url}`);

  /* BEZ TOKENA. To jest publiczny CDN, a nie API — nagłówek `Authorization`
     wysłany pod cudzy adres to wyciek poświadczeń, nie uwierzytelnienie. */
  const sygnal = AbortSignal.timeout(config.allegroZdjecia.timeoutMs);
  const odp = await fetch(adres, { redirect: "follow", signal: sygnal });
  if (!odp.ok) return null;
  const mime = (odp.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  /* Odpowiedź, która nie jest obrazem, to NIE jest obraz — także wtedy, gdy
     przyszła z kodem 200. Tak wygląda strona błędu CDN-u i tak wyglądałaby
     nietrafiona miniatura. */
  if (!mime.startsWith("image/")) return null;
  return { bajty: Buffer.from(await odp.arrayBuffer()), mime };
}

function wpis(database: Db, konto: number, externalId: string): WpisZdjeciaOferty | undefined {
  return database.prepare(
    "SELECT * FROM zdjecie_oferty_cache WHERE channel_account_id=? AND external_id=?",
  ).get(konto, externalId) as WpisZdjeciaOferty | undefined;
}

function zapamietaj(database: Db, konto: number, externalId: string, url: string,
  dane: Partial<WpisZdjeciaOferty>): void {
  const teraz = nowIso();
  database.prepare(
    `INSERT INTO zdjecie_oferty_cache
       (channel_account_id,external_id,zrodlo_url,plik,mime,bajtow,etag,pobrano_at,uzyto_at,blad)
     VALUES (?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(channel_account_id, external_id) DO UPDATE SET
       zrodlo_url=excluded.zrodlo_url, plik=excluded.plik, mime=excluded.mime,
       bajtow=excluded.bajtow, etag=excluded.etag, pobrano_at=excluded.pobrano_at,
       uzyto_at=excluded.uzyto_at, blad=excluded.blad`,
  ).run(konto, externalId, url, dane.plik ?? null, dane.mime ?? null, dane.bajtow ?? 0,
    dane.etag ?? null, teraz, teraz, dane.blad ?? null);
}

/**
 * Sprzątanie: wypada to, czego najdłużej nikt nie oglądał — jak przy
 * kartotekach, i do 80% limitu z tego samego powodu (cache przy samym progu
 * uruchamiałby sprzątanie przy KAŻDYM pobraniu).
 */
export function przytnijCacheOfert(database: Db = defaultDb()): void {
  const limit = config.allegroZdjecia.cacheMb * 1024 * 1024;
  const { suma } = database.prepare(
    "SELECT COALESCE(SUM(bajtow),0) AS suma FROM zdjecie_oferty_cache",
  ).get() as { suma: number };
  if (suma <= limit) return;

  let doZwolnienia = suma - limit * 0.8;
  const kandydaci = database.prepare(
    `SELECT channel_account_id AS konto, external_id AS id, plik, bajtow
       FROM zdjecie_oferty_cache WHERE plik IS NOT NULL ORDER BY uzyto_at`,
  ).all() as Array<{ konto: number; id: string; plik: string; bajtow: number }>;

  for (const k of kandydaci) {
    if (doZwolnienia <= 0) break;
    try {
      fs.unlinkSync(path.join(katalogZdjecOfert(), path.basename(k.plik)));
    } catch {
      /* pliku już nie ma — wpis i tak wypada */
    }
    database.prepare(
      "DELETE FROM zdjecie_oferty_cache WHERE channel_account_id=? AND external_id=?",
    ).run(k.konto, k.id);
    doZwolnienia -= k.bajtow;
  }
}

/**
 * Zdjęcie oferty z cache'u, pobrane z CDN-u, gdy trzeba.
 *
 * `null` znaczy „nie ma czego pokazać": snapshotu nie ma albo Allegro nie
 * podało adresu. Wpis z `plik = null` znaczy co innego — próbowaliśmy
 * i się nie udało, a `blad` mówi dlaczego.
 */
export async function zapewnijZdjecieOferty(
  konto: number,
  externalId: string,
  database: Db = defaultDb(),
  zrodloFn: ZrodloObrazu = pobierzZCdn,
): Promise<WpisZdjeciaOferty | null> {
  const snap = database.prepare(
    "SELECT primary_image_url AS url FROM offer_snapshot WHERE channel_account_id=? AND external_id=?",
  ).get(konto, externalId) as { url: string | null } | undefined;
  const url = (snap?.url ?? "").trim();
  if (!url) return null;

  const stary = wpis(database, konto, externalId);
  if (stary && stary.zrodlo_url === url) {
    const plikJest = stary.plik ? sciezkaZdjeciaOferty(stary.plik) !== null : true;
    if (plikJest) {
      if (stary.blad) {
        /* Błąd ponawiamy po minutach, nie w kółko: CDN bywa chwilowo zajęty,
           a agent odświeżający ekran nie ma go dobijać. */
        const wiek = Date.now() - Date.parse(stary.pobrano_at);
        if (wiek < config.allegroZdjecia.bladTtlMin * 60_000) return stary;
      } else {
        database.prepare(
          "UPDATE zdjecie_oferty_cache SET uzyto_at=? WHERE channel_account_id=? AND external_id=?",
        ).run(nowIso(), konto, externalId);
        return wpis(database, konto, externalId) ?? null;
      }
    }
  }

  /* NAJPIERW MINIATURA, POTEM ORYGINAŁ — patrz `adresMiniatury`. */
  const proby = [adresMiniatury(url), url].filter((u): u is string => typeof u === "string");
  let obraz: PobranyObraz | null = null;
  let ostatniBlad: string | null = null;
  for (const proba of proby) {
    try {
      obraz = await zrodloFn(proba);
    } catch (e) {
      ostatniBlad = e instanceof Error ? e.message : String(e);
      obraz = null;
    }
    if (obraz) break;
  }

  if (!obraz) {
    zapamietaj(database, konto, externalId, url, {
      blad: ostatniBlad ?? "Allegro nie oddało obrazu spod tego adresu.",
    });
    return wpis(database, konto, externalId) ?? null;
  }

  const kb = Math.round(obraz.bajty.length / 1024);
  if (kb > config.allegroZdjecia.maxKb) {
    /* Serwer nie umie zmniejszać obrazów (zero modułów natywnych), więc jedyną
       obroną przed galerią 20 MB jest odmowa — ta sama, co przy kartotekach.
       Zdanie mówi ILE ważyło: próg dobiera się potem na własnych liczbach. */
    zapamietaj(database, konto, externalId, url, {
      blad: `Zdjęcie oferty ma ${kb} kB, limit ALLEGRO_ZDJECIA_MAX_KB to ${config.allegroZdjecia.maxKb} kB — pomijam.`,
    });
    return wpis(database, konto, externalId) ?? null;
  }

  const plik = nazwaPliku(konto, externalId, obraz.mime);
  fs.writeFileSync(path.join(katalogZdjecOfert(), plik), obraz.bajty);
  /* ETag z TREŚCI: ten sam obraz po ponownym pobraniu daje ten sam znacznik,
     więc panel dostaje 304 zamiast pliku. */
  zapamietaj(database, konto, externalId, url, {
    plik, mime: obraz.mime, bajtow: obraz.bajty.length,
    etag: createHash("sha1").update(obraz.bajty).digest("hex"),
  });
  przytnijCacheOfert(database);
  return wpis(database, konto, externalId) ?? null;
}
