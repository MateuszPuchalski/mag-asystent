import { config } from "../config.js";
import { db as defaultDb, transaction, type Db } from "../db/db.js";
import { urlNaszychOfertStrona, urlOferty, OFERT_NA_STRONE, zapytajAllegro } from "../adapters/allegro.http.js";
import { BladLimituAllegro } from "../adapters/allegro.js";
import { kontoKanalu } from "./kanal-konto.js";
import { zapiszSnapshotOferty, type Oferta } from "./allegro-oferty-sync.js";
import { zbierzTresc } from "./allegro-oferta-tresc.js";
import { zaleznosciZdjecAllegro, type ZdjeciaAllegroDeps } from "./zdjecia-allegro.js";
import { logEvent } from "./events.js";
import { powodWylaczenia } from "./zdjecia-bez.js";
import { problemAllegro, stanPolaczenia } from "./allegro-token.js";

/* ── Indeks kodów producenta naszych ofert ───────────────────────────────────
   Część kartotek ma w ofercie inną sygnaturę niż symbol, ale symbol stoi
   w parametrze „Kod producenta". `/sale/offers` nie filtruje po parametrze
   i nie oddaje parametrów, więc budujemy lokalny indeks w dwóch krokach.

   Krok pierwszy przepisuje NASZĄ listę ofert do snapshotu. Krok drugi czyta
   parametry `/sale/product-offers/{id}`, jedno żądanie na ofertę, po dziesięć
   na kliknięcie. Oba woła biuro na żądanie, bez taktu. Stan leży w bazie,
   więc przerwany przebieg kolejne „Sprawdź" dokończy od miejsca przerwania. */

const STATUSY = ["ACTIVE", "ENDED"] as const;
/** Ofert na jeden krok parametrów. Krótki krok to szybki postęp na ekranie i mała strata przy 429. */
export const PARAMETROW_NA_KROK = 10;
/* Kod producenta zmienia się rzadziej niż opis, a jedno żądanie na ofertę
   przy tysiącach ofert to realny koszt limitu. Miesiąc godzi oba. */
const SWIEZOSC_KODU_MS = 30 * 86_400_000;

/* [WERYFIKUJ] Id „224017" stoi w specyfikacji tylko w PRZYKŁADACH, a nazwa
   raz po polsku, raz po angielsku. Dlatego id jest pierwszą drogą, a nazwa
   zapasową, dopóki nie zobaczymy parametru na żywym koncie. */
const ID_KODU_PRODUCENTA = "224017";
const NAZWA_KODU_PRODUCENTA = /kod producenta|manufacturer code/i;

type ParametrAllegro = { id?: unknown; name?: unknown; values?: unknown };
type OdpowiedzOferty = {
  parameters?: unknown;
  productSet?: unknown;
};

function parametryZ(lista: unknown): ParametrAllegro[] {
  return Array.isArray(lista) ? lista.filter((p): p is ParametrAllegro => !!p && typeof p === "object") : [];
}

function pierwszaWartosc(p: ParametrAllegro): string {
  const wartosci = Array.isArray(p.values) ? p.values : [];
  for (const w of wartosci) {
    const t = typeof w === "string" ? w.trim() : "";
    if (t) return t;
  }
  return "";
}

/**
 * Kod producenta z surowej odpowiedzi `/sale/product-offers/{id}`.
 *
 * Czytamy surowe ciało, bo `zbierzTresc` gubi `id` parametru. Kod bywa
 * w parametrach oferty albo w parametrach produktu z `productSet`. Najpierw
 * szukamy po id we wszystkich, dopiero potem po nazwie, bo id nie zależy
 * od języka konta. Pusty łańcuch znaczy „oferta kodu nie ma".
 */
export function kodProducenta(body: unknown): string {
  const b = (body && typeof body === "object" ? body : {}) as OdpowiedzOferty;
  const wszystkie = [...parametryZ(b.parameters)];
  for (const el of Array.isArray(b.productSet) ? b.productSet : []) {
    const produkt = (el as { product?: { parameters?: unknown } } | null)?.product;
    wszystkie.push(...parametryZ(produkt?.parameters));
  }
  for (const p of wszystkie) {
    if (String(p.id ?? "") !== ID_KODU_PRODUCENTA) continue;
    const w = pierwszaWartosc(p);
    if (w) return w;
  }
  for (const p of wszystkie) {
    if (typeof p.name !== "string" || !NAZWA_KODU_PRODUCENTA.test(p.name)) continue;
    const w = pierwszaWartosc(p);
    if (w) return w;
  }
  return "";
}

/**
 * Dlaczego indeksu nie da się teraz budować albo `null`. Trasy oddają to jako 409.
 *
 * Bez połączonego konta każde żądanie skończyłoby się błędem Allegro, a panel
 * pokazałby „Allegro nie odpowiedziało" zamiast drogi do naprawy.
 */
export function powodBrakuIndeksu(): string | null {
  const wylaczone = powodWylaczenia();
  if (wylaczone) return wylaczone;
  const s = stanPolaczenia();
  switch (s.stan) {
    case "polaczone":
      return null;
    case "dev":
      return "Tryb dev: ta instalacja nie łączy się z Allegro, więc nie ma czego indeksować.";
    case "wylaczone":
      return "Połączenie z Allegro jest wyłączone (brak ALLEGRO_CLIENT_ID).";
    default:
      return problemAllegro() ?? "Konto Allegro niepołączone.";
  }
}

export interface WynikListy {
  ofert: number;
  razem: number | null;
  nastepny: number | null;
}

/**
 * Jedna strona NASZEJ listy ofert do snapshotu, ze znacznikiem `nasza_lista_at`.
 * Błąd Allegro idzie w górę, z 429 włącznie, bo biuro czeka na postęp.
 */
export async function odswiezListeOfert(
  offset: number,
  kto: string,
  depsWejscie: ZdjeciaAllegroDeps = {},
): Promise<WynikListy> {
  const deps = zaleznosciZdjecAllegro(depsWejscie);
  const query = deps.query ?? ((url: string) => zapytajAllegro(url));
  const apiUrl = deps.apiUrl ?? config.allegro.apiUrl;
  const od = Math.max(0, Math.trunc(offset));
  const odp = await query(urlNaszychOfertStrona(apiUrl, STATUSY, od)) as
    { offers?: Oferta[]; totalCount?: unknown } | null;
  const oferty = Array.isArray(odp?.offers) ? odp.offers : [];
  const razem = typeof odp?.totalCount === "number" && Number.isFinite(odp.totalCount) ? odp.totalCount : null;

  const database = deps.database ?? defaultDb();
  const at = (deps.now ?? (() => new Date()))().toISOString();
  let zapisanych = 0;
  transaction(database, () => {
    const konto = kontoKanalu(database, deps.accountId ?? config.allegro.clientId);
    const znacznik = database.prepare(
      "UPDATE offer_snapshot SET nasza_lista_at=? WHERE channel_account_id=? AND external_id=?",
    );
    /* Jedna oferta z kwotą spoza schematu nie może zabrać indeksu pozostałym.
       Pisarz rzuca przed INSERT-em, więc transakcja zostaje czysta. */
    for (const o of oferty) {
      if (!o?.id) continue;
      try {
        zapiszSnapshotOferty(database, o, konto, at);
        znacznik.run(at, konto, String(o.id));
        zapisanych++;
      } catch (e) {
        console.warn(`[zdjecia-allegro-indeks] oferta ${o.id}: ${e instanceof Error ? e.message : e}`);
      }
    }
    logEvent("zdjecia_allegro_indeks_lista", kto, null, { offset: od, ofert: oferty.length, zapisanych, razem },
      undefined, database);
  })();

  /* Kolejna strona tylko przy pełnej, jak przy dopasowaniu: `totalCount`
     bywa nieobecny, a niepełna strona jest ostatnia według specyfikacji. */
  const dalej = od + OFERT_NA_STRONE;
  const nastepny = oferty.length >= OFERT_NA_STRONE && (razem === null || dalej < razem) ? dalej : null;
  return { ofert: oferty.length, razem, nastepny };
}

/** Warunek „trzeba zapytać o kod": nasza oferta, nigdy nie pytana albo pytana dawno. */
const DO_POBRANIA = `channel_account_id=? AND nasza_lista_at IS NOT NULL
  AND (kod_producenta_at IS NULL OR kod_producenta_at < ?)`;

const prog = (teraz: Date) => new Date(teraz.getTime() - SWIEZOSC_KODU_MS).toISOString();

/* Oferta, której odczyt padł, czeka godzinę na kolejną próbę. Bez tego
   dziesięć trwale złych ofert wracałoby w każdym kroku i zatrzymało kolejkę. */
const PRZERWA_PO_BLEDZIE_MS = 3_600_000;
const progBledu = (teraz: Date) => new Date(teraz.getTime() - PRZERWA_PO_BLEDZIE_MS).toISOString();

export interface WynikParametrow {
  pobrano: number;
  zostalo: number;
}

/**
 * Krok indeksu: parametry do dziesięciu ofert, najpierw aktywnych.
 *
 * Każdą ofertę zapisujemy zaraz po odpowiedzi, bez wspólnej transakcji.
 * Dlatego 429 w połowie kroku nie zabiera tego, co już przyszło.
 * Przy okazji odświeżamy treść dla Copilota, bo to ta sama odpowiedź.
 */
export async function pobierzParametryOfert(
  kto: string,
  depsWejscie: ZdjeciaAllegroDeps = {},
): Promise<WynikParametrow> {
  const deps = zaleznosciZdjecAllegro(depsWejscie);
  const query = deps.query ?? ((url: string) => zapytajAllegro(url));
  const apiUrl = deps.apiUrl ?? config.allegro.apiUrl;
  const database = deps.database ?? defaultDb();
  const now = deps.now ?? (() => new Date());
  const konto = kontoKanalu(database, deps.accountId ?? config.allegro.clientId);

  const doKroku = database.prepare(`SELECT external_id AS id FROM offer_snapshot
      WHERE ${DO_POBRANIA} AND (kod_producenta_blad_at IS NULL OR kod_producenta_blad_at < ?)
      ORDER BY kod_producenta_blad_at IS NOT NULL, (status = 'ACTIVE') DESC, kod_producenta_at IS NOT NULL,
        external_id
      LIMIT ?`).all(konto, prog(now()), progBledu(now()), PARAMETROW_NA_KROK) as Array<{ id: string }>;

  const zKodem = database.prepare(`UPDATE offer_snapshot
      SET kod_producenta=?, kod_producenta_at=?, opis=?, parametry_json=?, pasuje_do_json=?, tresc_synced_at=?,
        kod_producenta_blad_at=NULL
    WHERE channel_account_id=? AND external_id=?`);
  const bezOferty = database.prepare(`UPDATE offer_snapshot
      SET kod_producenta='', kod_producenta_at=?, kod_producenta_blad_at=NULL
    WHERE channel_account_id=? AND external_id=?`);
  const zBledem = database.prepare(`UPDATE offer_snapshot SET kod_producenta_blad_at=?
    WHERE channel_account_id=? AND external_id=?`);

  let pobrano = 0;
  let bledow = 0;
  let ostatniBlad: unknown = null;
  const dziennik = () => {
    /* Znacznik błędu też jest zapisem, więc i sam błąd zostawia ślad. */
    if (pobrano > 0 || bledow > 0) {
      logEvent("zdjecia_allegro_indeks_parametry", kto, null, { pobrano, bledow }, undefined, database);
    }
  };
  for (const { id } of doKroku) {
    let body: unknown;
    try {
      body = await query(urlOferty(apiUrl, id));
    } catch (e) {
      /* Limit przerywa krok, bo kolejne żądanie pogłębiłoby przerwę. Wpis
         w dzienniku zostaje, bo zapisane oferty to już mutacja. */
      if (e instanceof BladLimituAllegro) {
        dziennik();
        throw e;
      }
      /* Jedna zła oferta nie zatrzymuje kroku. Kodu nie zapisujemy, więc
         liczy się dalej w `zostalo`, ale wraca dopiero po przerwie. */
      zBledem.run(now().toISOString(), konto, id);
      bledow++;
      ostatniBlad = e;
      console.warn(`[zdjecia-allegro-indeks] parametry ${id}: ${e instanceof Error ? e.message : e}`);
      continue;
    }
    const at = now().toISOString();
    /* 404 adapter oddaje jako `null`: oferty już nie ma, więc i kodu nie ma.
       Treści nie ruszamy, bo Copilot może jeszcze cytować starą. */
    if (body === null || body === undefined) {
      bezOferty.run(at, konto, id);
    } else {
      const tresc = zbierzTresc(body as Parameters<typeof zbierzTresc>[0]);
      zKodem.run(kodProducenta(body), at, tresc.opis, JSON.stringify(tresc.parametry),
        JSON.stringify(tresc.pasujeDo), at, konto, id);
    }
    pobrano++;
  }
  dziennik();
  /* Same błędy w całym kroku to najpewniej awaria Allegro, nie pech ofert.
     Przerywamy, zamiast przejść błędem przez cały katalog. Znaczniki błędu
     zostają, więc kolejne kliknięcie zacznie od innych ofert. */
  if (doKroku.length > 0 && pobrano === 0 && ostatniBlad !== null) throw ostatniBlad;
  return { pobrano, zostalo: policzDoPobrania(database, konto, now()) };
}

function policzDoPobrania(database: Db, konto: number, teraz: Date): number {
  return (database.prepare(`SELECT COUNT(*) AS n FROM offer_snapshot WHERE ${DO_POBRANIA}`)
    .get(konto, prog(teraz)) as { n: number }).n;
}

export interface StanIndeksu {
  ofert: number;
  zKodem: number;
  doPobrania: number;
  listaAt: string | null;
}

/**
 * Stan indeksu do ekranu. Sam odczyt: konta kanału szukamy bez zakładania,
 * bo `kontoKanalu` wstawia brakujący wiersz, a patrzenie niczego nie zapisuje.
 */
export function stanIndeksu(depsWejscie: ZdjeciaAllegroDeps = {}): StanIndeksu {
  const deps = zaleznosciZdjecAllegro(depsWejscie);
  const database = deps.database ?? defaultDb();
  const now = deps.now ?? (() => new Date());
  const zewn = (deps.accountId ?? config.allegro.clientId) || "domyslne";
  const w = database.prepare(
    "SELECT id FROM channel_account WHERE channel='allegro' AND external_account_id=?",
  ).get(zewn) as { id: number } | undefined;
  if (!w) return { ofert: 0, zKodem: 0, doPobrania: 0, listaAt: null };
  const konto = Number(w.id);
  const s = database.prepare(`SELECT COUNT(*) AS ofert,
        COALESCE(SUM(CASE WHEN TRIM(COALESCE(kod_producenta, '')) <> '' THEN 1 ELSE 0 END), 0) AS zKodem,
        MAX(nasza_lista_at) AS listaAt
      FROM offer_snapshot WHERE channel_account_id=? AND nasza_lista_at IS NOT NULL`)
    .get(konto) as { ofert: number; zKodem: number; listaAt: string | null };
  return {
    ofert: Number(s.ofert),
    zKodem: Number(s.zKodem),
    doPobrania: policzDoPobrania(database, konto, now()),
    listaAt: s.listaAt ?? null,
  };
}
