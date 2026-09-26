import type { DatabaseSync } from "node:sqlite";
import { db } from "../db/db.js";
import { config } from "../config.js";
import { logEvent } from "./events.js";
import { zwin } from "../tekst.js";
import type { Tokeny } from "./copilot-koszt.js";
import {
  czlowiekZBiura, kluczModelu, rozstrzygnijZastosowanie, WiedzaConflict, wTransakcji, zaproponujZastosowanie,
  type RodzajDowodu, type Zastosowanie,
} from "./wiedza.js";
import { MAX_GRUPA, MIN_CYFR, MIN_ZNAKOW } from "./zamiennosc-oem.js";
import {
  bezOgona, czyAllegro, host, sprawdzonychTejNocy, szukajPasowaniaWSieci,
  type NadawcaPasowaniaSieci, type WynikPrzebiegu, type ZrodloStrony,
} from "./pasowanie-z-sieci.js";
import { tekstyPdf, type CzytnikPdf } from "./pdf-tekst.js";
import { BladKluczaCopilota, BladLimituCopilota, BladPrzeciazeniaCopilota } from "../adapters/copilot.js";

/* ── Pasowanie od silnika (0.527.0) ──────────────────────────────────────────

   Właściciel: „szukanie pasowań od najpopularniejszych silników powinno
   znacznie przyspieszyć dopasowania”. I tak jest, z jednego powodu: wykaz
   części JEDNEGO silnika (Honda GCV160, B&S 450E) wymienia dziesiątki numerów
   OEM naraz. Tryb „od części” pyta o każdy numer osobno i płaci za każde
   wyszukiwanie; tryb „od silnika” czyta wykaz raz i dopasowuje wszystkie
   nasze kartoteki, które w nim stoją.

   PODZIAŁ PRACY JEST TWARDY:
   - Model TYLKO znajduje i czyta wykazy części tego silnika (często PDF)
     i mówi, które przeczytane strony nimi są. Niczego nie przepisuje.
   - Dopasowanie robi SERWER: szuka w tekście strony naszych numerów OEM,
     oryginalnych i z obcych katalogów. Porównuje CAŁE tokeny i ich sklejenia
     do trzech („532 16 56-30”), nie podciągi — bo w tabeli wykazu sąsiednie
     liczby zlepione w jeden ciąg dawałyby trafienia z niczego.
   Model nie ma więc czego zmyślić: numer albo stoi na stronie, albo nie.

   ALLEGRO — ta sama bariera co w trybie części: żadnego żądania stąd,
   domeny zablokowane w narzędziach, strona z Allegro odpada tutaj.

   Każde trafienie to PROPOZYCJA „nasza część → ten silnik” z wycinkiem strony
   wokół numeru. Przegląd idzie listą na silnik (`przegladOdSilnika`). */

/* Lista właściciela z 26 września 2026, rozwinięta do pojedynczych oznaczeń,
   w jego kolejności: od najczęstszych w polskich kosiarkach. Kolejność jest
   treścią — automat idzie od góry. Pełne nazwy rodzin (np. „Classic”) stoją
   tak, jak je piszą wykazy B&S. */
export const SILNIKI_POPULARNE: ReadonlyArray<{ marka: string; nazwa: string }> = [
  ...["Classic", "Sprint", "Quattro", "450E", "500E", "550E", "575EX", "625EX", "625EXi", "650EXi", "675EX", "675EXi"]
    .map((nazwa) => ({ marka: "Briggs & Stratton", nazwa })),
  ...["GCV135", "GCV160", "GCV170", "GCV200", "GCVx170", "GCVx200", "GXV140", "GXV160"]
    .map((nazwa) => ({ marka: "Honda", nazwa })),
  ...["LC1P61FA", "LC1P65FA", "LC1P68FA"].map((nazwa) => ({ marka: "Loncin", nazwa })),
  ...["RV145", "RV170", "R145", "R170"].map((nazwa) => ({ marka: "Rato", nazwa })),
  ...["ST 120", "ST 140", "ST 170", "ST 200"].map((nazwa) => ({ marka: "STIGA", nazwa })),
  ...["K500", "K600", "K650", "K700"].map((nazwa) => ({ marka: "Emak", nazwa })),
  ...["FJ151V", "FJ180V"].map((nazwa) => ({ marka: "Kawasaki", nazwa })),
];

/** Po ilu dniach silnik wraca. Wykazy części zmieniają się rzadziej niż sklepy. */
export const SILNIK_PONOWNIE_PO_DNIACH = 90;
const SILNIK_PO_BLEDZIE_DNI = 7;
/** Promień wycinka wokół numeru — dość, żeby człowiek zobaczył wiersz tabeli. */
const PROMIEN_CYTATU = 90;
/** Najdłuższe sklejenie tokenów numeru: „532 16 56-30” to trzy. */
const MAX_TOKENOW_NUMERU = 3;

export interface ZapytanieOSilnik { marka: string; nazwa: string }

export interface WynikWykazu {
  /** Strony, które model uznał za wykaz części TEGO silnika. */
  wykazy: Array<{ url: string; zrodloStrony: ZrodloStrony }>;
  strony: Array<{ url: string; tekst: string }>;
  pdfy: Array<{ url: string; base64: string }>;
  wyszukiwan: number;
  model: string;
  zuzycie: Tokeny;
  ms: number;
}

export type NadawcaWykazuSilnika = (s: ZapytanieOSilnik) => Promise<WynikWykazu>;

const klucz = (s: ZapytanieOSilnik) => kluczModelu("silnik", s.marka, s.nazwa);

/** Silniki z listy do sprawdzenia, w kolejności listy. Czysty ODCZYT. */
export function silnikiDoSieci(limit: number, teraz = new Date(), database: DatabaseSync = db()): ZapytanieOSilnik[] {
  if (limit <= 0) return [];
  const odKiedy = new Date(teraz.getTime() - SILNIK_PONOWNIE_PO_DNIACH * 86_400_000).toISOString();
  const poBledzie = new Date(teraz.getTime() - SILNIK_PO_BLEDZIE_DNI * 86_400_000).toISOString();
  const swieze = new Set((database.prepare(`SELECT klucz FROM pasowanie_siec_silnik
      WHERE (wynik='ok' AND at >= ?) OR (wynik='blad' AND at >= ?)`).all(odKiedy, poBledzie) as Array<{ klucz: string }>)
    .map((w) => w.klucz));
  return SILNIKI_POPULARNE.filter((s) => !swieze.has(klucz(s))).slice(0, limit);
}

/* ── Dopasowanie numerów (czyste) ─────────────────────────────────────────── */

const znakiNumeru = (n: string) => n.length >= MIN_ZNAKOW && (n.match(/\d/g)?.length ?? 0) >= MIN_CYFR;

/** Nasze numery: postać zwinięta → kartoteki. Numer wspólny dla grupy większej niż `MAX_GRUPA` odpada. */
export function naszeNumery(database: DatabaseSync = db()): Map<string, Array<{ twId: number; symbol: string; numer: string }>> {
  const mapa = new Map<string, Array<{ twId: number; symbol: string; numer: string }>>();
  const wiersze = database.prepare(`SELECT tw_id, tw_symbol, wartosc, wartosc_norm FROM towar_identyfikator
      WHERE rodzaj IN ('oem','nr_oryg','katalog_obcy')`).all() as
    Array<{ tw_id: number; tw_symbol: string; wartosc: string; wartosc_norm: string }>;
  for (const w of wiersze) {
    const n = String(w.wartosc_norm);
    if (!znakiNumeru(n)) continue;
    const lista = mapa.get(n) ?? [];
    if (!lista.some((x) => x.twId === Number(w.tw_id))) lista.push({ twId: Number(w.tw_id), symbol: w.tw_symbol, numer: w.wartosc });
    mapa.set(n, lista);
  }
  /* Ten sam powód co w zamienności OEM: numer na cztery kartoteki to rodzina
     (noże lewe, prawe i mielące), a nie ta jedna część. */
  for (const [n, lista] of mapa) if (lista.length > MAX_GRUPA) mapa.delete(n);
  return mapa;
}

export interface TrafienieNumeru { twId: number; symbol: string; numer: string; cytat: string }

/**
 * Nasze numery w tekście strony. Tokeny to ciągi bez białych znaków; okno
 * jednego do trzech sąsiednich tokenów zwija się i porównuje DOKŁADNIE z mapą.
 * Jedno trafienie na kartotekę — pierwsze, z wycinkiem wokół niego.
 */
export function trafieniaWTekscie(
  tekst: string, numery: Map<string, Array<{ twId: number; symbol: string; numer: string }>>,
): TrafienieNumeru[] {
  const tokeny = [...tekst.matchAll(/\S+/g)].map((m) => ({ t: m[0], od: m.index ?? 0 }));
  const wynik = new Map<number, TrafienieNumeru>();
  for (let i = 0; i < tokeny.length; i++) {
    for (let d = 1; d <= MAX_TOKENOW_NUMERU && i + d <= tokeny.length; d++) {
      const okno = tokeny.slice(i, i + d);
      /* Obcięcie interpunkcji na brzegach: „15600-ZE1-003,” w tabeli to ten sam numer. */
      const n = zwin(okno.map((x) => x.t).join(" ").replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ""));
      const kartoteki = numery.get(n);
      if (!kartoteki) continue;
      const od = okno[0]!.od;
      const doo = okno[d - 1]!.od + okno[d - 1]!.t.length;
      const cytat = tekst.slice(Math.max(0, od - PROMIEN_CYTATU), Math.min(tekst.length, doo + PROMIEN_CYTATU))
        .replace(/\s+/g, " ").trim();
      for (const k of kartoteki) if (!wynik.has(k.twId)) wynik.set(k.twId, { ...k, cytat });
    }
  }
  return [...wynik.values()];
}

/** Czy strona mówi o TYM silniku: marka i oznaczenie stoją w jej tekście. */
export function stronaOSilniku(tekst: string, s: ZapytanieOSilnik): boolean {
  const t = zwin(tekst);
  /* „Briggs & Stratton” bywa „B&S” albo „Briggs”; wystarczy pierwszy człon marki. */
  const marka = zwin(s.marka.split(/[\s&]+/)[0] ?? s.marka);
  return t.includes(zwin(s.nazwa)) && (t.includes(marka) || t.includes(zwin(s.marka)));
}

/* ── Przebieg ─────────────────────────────────────────────────────────────── */

const RODZAJ_DOWODU: Record<ZrodloStrony, RodzajDowodu> = {
  producent: "producent", katalog_dostawcy: "katalog_dostawcy", sklep: "katalog_dostawcy",
};

export interface WynikSilnika {
  sprawdzono: number;
  zaproponowano: number;
  trafien: number;
  bledow: number;
  przerwane: string | null;
}

/**
 * Jeden przebieg po silnikach z listy. Mutacje: propozycje w kolejce Wiedzy,
 * wiersz `pasowanie_siec_silnik` na silnik i wiersz księgi na wywołanie.
 */
export async function szukajOdSilnikow(deps: {
  nadaj: NadawcaWykazuSilnika;
  /** Ile silników w tym przebiegu — liczone przez koordynatora z limitu nocy. */
  ile: number;
  teraz?: () => Date;
  database?: DatabaseSync;
  czytajPdf?: CzytnikPdf;
}): Promise<WynikSilnika> {
  const database = deps.database ?? db();
  const teraz = deps.teraz ?? (() => new Date());
  const wynik: WynikSilnika = { sprawdzono: 0, zaproponowano: 0, trafien: 0, bledow: 0, przerwane: null };
  const silniki = silnikiDoSieci(deps.ile, teraz(), database);
  if (!silniki.length) return wynik;
  const numery = naszeNumery(database);

  for (const s of silniki) {
    let odp: WynikWykazu;
    try {
      odp = await deps.nadaj(s);
    } catch (e) {
      const slad = (e as { slad?: string }).slad || (e as Error).message;
      zapiszKsiege(database, null, "blad", slad, teraz(), (e as { zuzycie?: Tokeny }).zuzycie);
      zapiszPrzebieg(database, s, "blad", 0, 0, 0, slad, teraz());
      wynik.bledow += 1;
      if (e instanceof BladLimituCopilota || e instanceof BladKluczaCopilota || e instanceof BladPrzeciazeniaCopilota) {
        wynik.przerwane = (e as Error).message;
        break;
      }
      continue;
    }

    wynik.sprawdzono += 1;
    zapiszKsiege(database, odp, "ok", null, teraz());
    const wszystkie = [...odp.strony, ...await tekstyPdf(odp.pdfy ?? [], deps.czytajPdf)];
    /* Tylko strony, które model NAZWAŁ wykazem tego silnika, spoza Allegro
       i z oznaczeniem silnika w tekście. Reszta przeczytanych stron to
       zwykle wyniki pośrednie, na których numery znaczą co innego. */
    const wykazy = new Map(odp.wykazy.map((w) => [bezOgona(w.url), w.zrodloStrony]));
    let stron = 0; let trafien = 0; let zaproponowano = 0;
    for (const strona of wszystkie) {
      const zrodlo = wykazy.get(bezOgona(strona.url));
      const h = host(strona.url);
      if (!zrodlo || !h || czyAllegro(h) || !stronaOSilniku(strona.tekst, s)) continue;
      stron += 1;
      for (const t of trafieniaWTekscie(strona.tekst, numery)) {
        trafien += 1;
        if (zaproponujDlaSilnika(database, s, t, strona.url, zrodlo)) zaproponowano += 1;
      }
    }
    wynik.trafien += trafien;
    wynik.zaproponowano += zaproponowano;
    zapiszPrzebieg(database, s, "ok", stron, trafien, zaproponowano, null, teraz());
  }

  if (wynik.sprawdzono || wynik.bledow) {
    logEvent("pasowanie_siec_silnik", "automat (siec-silnik)", null, { ...wynik }, null, database);
  }
  return wynik;
}

/* Jedna propozycja. Zatwierdzone „nie pasuje” do tego silnika wygrywa —
   człowiek już zmierzył i powiedział nie; wykaz z sieci tego nie odwraca. */
function zaproponujDlaSilnika(
  database: DatabaseSync, s: ZapytanieOSilnik, t: TrafienieNumeru, url: string, zrodlo: ZrodloStrony,
): boolean {
  const negatyw = database.prepare(`SELECT 1 FROM zastosowanie z JOIN model_urzadzenia m ON m.id=z.model_id
      WHERE z.tw_id=? AND m.klucz=? AND z.polaryzacja='nie_pasuje' AND z.stan='zatwierdzone'`).get(t.twId, klucz(s));
  if (negatyw) return false;
  try {
    return zaproponujZastosowanie({
      twId: t.twId,
      model: { rodzaj: "silnik", marka: s.marka, nazwa: s.nazwa },
      polaryzacja: "pasuje",
      zrodlo: "copilot",
      komentarz: `Automat znalazł numer ${t.numer} w wykazie części silnika ${s.marka} ${s.nazwa}. `
        + "Sprawdź wiersz wykazu przed zatwierdzeniem.",
      dowod: { rodzaj: RODZAJ_DOWODU[zrodlo], tresc: `„…${t.cytat.slice(0, 380)}…” — numer ${t.numer}, ${host(url)}`, link: url },
    }, { automat: "siec-silnik" }, database) !== null;
  } catch {
    return false;
  }
}

function zapiszPrzebieg(
  database: DatabaseSync, s: ZapytanieOSilnik, stan: "ok" | "blad", stron: number, trafien: number,
  zaproponowano: number, blad: string | null, teraz: Date,
): void {
  database.prepare(`INSERT INTO pasowanie_siec_silnik(klucz,marka,nazwa,at,wynik,stron,trafien,zaproponowano,blad)
    VALUES (?,?,?,?,?,?,?,?,?)`).run(klucz(s), s.marka, s.nazwa, teraz.toISOString(), stan, stron, trafien,
    zaproponowano, blad ? blad.slice(0, 300) : null);
}

function zapiszKsiege(
  database: DatabaseSync, odp: WynikWykazu | null, stan: "ok" | "blad", blad: string | null, teraz: Date,
  zuzyciePrzedBledem?: Tokeny,
): void {
  const t = odp?.zuzycie ?? zuzyciePrzedBledem;
  const model = odp?.model ?? (t && (t.wej || t.wyj) ? config.copilot.model : "");
  database.prepare(`INSERT INTO copilot_wywolanie
    (zadanie,model,tokeny_wej,tokeny_wyj,tokeny_cache_zapis,tokeny_cache_odczyt,wyszukiwania,ms,wynik,blad,at)
    VALUES ('pasowanie_siec_silnik',?,?,?,?,?,?,?,?,?,?)`)
    .run(model, t?.wej ?? 0, t?.wyj ?? 0, t?.cacheZapis ?? 0, t?.cacheOdczyt ?? 0,
      odp?.wyszukiwan ?? t?.wyszukiwania ?? 0, odp?.ms ?? 0, stan, blad ? blad.slice(0, 300) : null,
      teraz.toISOString());
}

/* ── Przegląd listą: jedna karta na silnik ────────────────────────────────── */

export const AUTOR_SILNIKA = "automat (siec-silnik)";

/**
 * Propozycje trybu silnika pogrupowane po silniku, w kształcie przeglądu
 * wykazu — ekran rysuje je tym samym komponentem. Czysty ODCZYT.
 */
export function przegladOdSilnika(propozycje: Zastosowanie[], database: DatabaseSync = db()): Array<{
  id: number; zrodlo: string; link: string | null; rodzaj: "maszyna" | "silnik";
  pozycje: Array<{ id: number; twId: number; symbol: string; nazwa: string | null; maszyna: string;
    warunki: string | null; dowod: string; link: string | null }>;
}> {
  const grupy = new Map<number, ReturnType<typeof przegladOdSilnika>[number]>();
  for (const z of propozycje) {
    if (z.stan !== "propozycja" || z.zaproponowal !== AUTOR_SILNIKA) continue;
    let g = grupy.get(z.model.id);
    if (!g) {
      g = { id: z.model.id, zrodlo: `${z.model.etykieta} — wykazy części z sieci`, link: null, rodzaj: z.model.rodzaj, pozycje: [] };
      grupy.set(z.model.id, g);
    }
    const t = database.prepare("SELECT nazwa FROM sgt_towar WHERE tw_id=?").get(z.twId) as { nazwa: string } | undefined;
    const d = z.dowody[0];
    g.pozycje.push({ id: z.id, twId: z.twId, symbol: z.symbol, nazwa: t?.nazwa ?? null, maszyna: z.model.etykieta,
      warunki: z.zdanieWarunkow, dowod: d?.tresc ?? "", link: d?.link ?? null });
  }
  return [...grupy.values()].sort((a, b) => b.pozycje.length - a.pozycje.length || a.id - b.id);
}

/**
 * Zatwierdzenie LISTY propozycji dla jednego silnika. Ten sam kształt co
 * `zatwierdzZSieci`: id spoza tego silnika albo nie od automatu wywraca całe
 * żądanie, rozstrzygnięte w międzyczasie liczy się jako pominięte.
 */
export function zatwierdzOdSilnika(
  modelId: number, ids: unknown, userId: number, database: DatabaseSync = db(),
): { zatwierdzono: number; pominieto: number } {
  const autor = czlowiekZBiura(database, userId);
  if (!Array.isArray(ids) || ids.length === 0 || !ids.every((i) => Number.isInteger(i))) {
    throw new Error("Zaznacz co najmniej jedną część z listy");
  }
  const lista = [...new Set(ids as number[])];
  return wTransakcji(database, () => {
    const swoje = new Map((database.prepare(`SELECT id, stan FROM zastosowanie
        WHERE model_id=? AND zaproponowal=? AND id IN (${lista.map(() => "?").join(",")})`)
      .all(modelId, AUTOR_SILNIKA, ...lista) as Array<{ id: number; stan: string }>).map((w) => [Number(w.id), w.stan]));
    const obce = lista.filter((i) => !swoje.has(i));
    if (obce.length > 0) throw new Error(`Propozycje spoza tego silnika albo nie od automatu: ${obce.join(", ")}`);
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
    logEvent("pasowanie_siec_silnik_zatwierdzenie", autor, null, { modelId, zatwierdzono, pominieto, ids: lista }, userId, database);
    return { zatwierdzono, pominieto };
  });
}

/* ── Koordynator nocy i przycisku (0.527.0) ─────────────────────────────────
   Najpierw silniki z listy, potem kartoteki — z JEDNEGO limitu. Silnik idzie
   pierwszy, bo jeden jego wykaz dopasowuje dziesiątki kartotek naraz; tryb
   części dostaje to, co z limitu zostało. Ekran woła to samo po jednej
   jednostce, więc przycisk także zaczyna od silników. */

export type WynikNocySieci = WynikPrzebiegu & { silniki: WynikSilnika };

export async function przebiegSieci(deps: {
  nadaj: NadawcaPasowaniaSieci;
  nadajSilnik: NadawcaWykazuSilnika;
  naNoc: number;
  naPrzebieg?: number;
  teraz?: () => Date;
  database?: DatabaseSync;
  czytajPdf?: CzytnikPdf;
}): Promise<WynikNocySieci> {
  const database = deps.database ?? db();
  const teraz = deps.teraz ?? (() => new Date());
  const zostalo = Math.min(deps.naNoc - sprawdzonychTejNocy(teraz(), database), deps.naPrzebieg ?? Infinity);
  const silniki = await szukajOdSilnikow({
    nadaj: deps.nadajSilnik, ile: Math.max(0, zostalo), teraz, database, czytajPdf: deps.czytajPdf,
  });
  const reszta = zostalo - silniki.sprawdzono - silniki.bledow;
  const czesci: WynikPrzebiegu = silniki.przerwane || reszta <= 0
    ? { sprawdzono: 0, zaproponowano: 0, odrzucono: {}, bledow: 0, przerwane: null }
    : await szukajPasowaniaWSieci({
      nadaj: deps.nadaj, naNoc: deps.naNoc, naPrzebieg: reszta, teraz, database, czytajPdf: deps.czytajPdf,
    });
  return {
    sprawdzono: czesci.sprawdzono + silniki.sprawdzono,
    zaproponowano: czesci.zaproponowano + silniki.zaproponowano,
    odrzucono: czesci.odrzucono,
    bledow: czesci.bledow + silniki.bledow,
    przerwane: silniki.przerwane ?? czesci.przerwane,
    silniki,
  };
}

/** Postęp listy silników dla ekranu. Czysty ODCZYT. */
export function stanSilnikow(teraz = new Date(), database: DatabaseSync = db()): { razem: number; doSprawdzenia: number } {
  return { razem: SILNIKI_POPULARNE.length, doSprawdzenia: silnikiDoSieci(SILNIKI_POPULARNE.length, teraz, database).length };
}
