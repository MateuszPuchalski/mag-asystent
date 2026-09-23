import { config } from "../config.js";
import { db as defaultDb, transaction, type Db } from "../db/db.js";
import { zapytajAllegro } from "../adapters/allegro.http.js";
import { BladLimituAllegro } from "../adapters/allegro.js";
import { zwin } from "../tekst.js";
import { logEvent } from "./events.js";
import { kontoKanalu } from "./kanal-konto.js";
import { zapiszSnapshotOferty, type Oferta } from "./allegro-oferty-sync.js";
import { dociagnijTresc } from "./allegro-oferta-tresc.js";
import { kartotekaOferty } from "./dopasowanie-sku.js";
import { lukiZOferty } from "./copilot-szkic.js";
import { zapiszWiedzeZOferty } from "./wiedza-z-oferty.js";
import { pozycjaMaszyny } from "./zgodnosc-oferty.js";
import { czlowiekZBiura, zastosowaniaTowaru } from "./wiedza.js";
import { nastepnyOdstep } from "./takt.js";
import { linkOferty } from "./allegro-linki.js";

/**
 * „Pasuje do" ze WSZYSTKICH naszych ofert Allegro — zbiórka i sprawdzenie.
 *
 * ── PO CO ─────────────────────────────────────────────────────────────────
 * Lista „Pasuje do" to nasze własne, spisane twierdzenie „ta część pasuje do
 * tej maszyny". Do tego wydania czytaliśmy ją wyłącznie przy ofercie, o którą
 * klient zapytał, i tylko przy układaniu szkicu, po dwadzieścia pozycji na
 * kliknięcie (0.264.0). Oferta, pod którą nikt nie napisał, nie oddawała nic,
 * bo `offer_snapshot` znał wyłącznie takie, pod którymi ktoś napisał.
 *
 * ── TYLKO CZYTANIE ALLEGRO ────────────────────────────────────────────────
 * Decyzja właściciela: bez publikowania do Allegro. Ten moduł woła wyłącznie
 * dwie końcówki z uprawnieniem `allegro:api:sale:offers:read`, które już
 * mamy: listę ofert konta i treść jednej oferty. Zapisuje wyłącznie u nas.
 *
 * ── PARTIE Z EKRANU, NIE PRZEBIEG W TLE ───────────────────────────────────
 * Tickerów dziś nie ma i nie ma ich tu przybywać (CLAUDE.md). Zbiórkę prowadzi
 * ekran: jedno żądanie to jedna partia, odpowiedź mówi, ile zostało, a ekran
 * pyta o następną, dopóki człowiek nie zatrzyma. Serwer nie trzyma stanu
 * przebiegu, więc restart w połowie niczego nie psuje — następna partia
 * zaczyna tam, gdzie wskazuje baza.
 *
 * ── RYTM ŻĄDAŃ ────────────────────────────────────────────────────────────
 * Treść oferty kosztuje jedno żądanie na ofertę. Sierpień 2026 nauczył, że
 * równy, zegarowy ciąg żądań z jednego adresu kończy się blokadą IP (nagłówek
 * `takt.ts`). Stąd mała partia, odstęp z rozrzutem ±10% i przerwanie całej
 * partii na pierwszym 429 z czasem, o który Allegro prosi.
 */

/** Ofert na partię treści. Dziesięć × półtorej sekundy to kilkanaście sekund na żądanie. */
export const PARTIA = 10;
/** Odstęp między żądaniami o treść — baza, do której `nastepnyOdstep` dokłada rozrzut. */
export const ODSTEP_MS = 1500;
/** Ofert na stronę listy — sufit końcówki `/sale/offers` w specyfikacji. */
export const STRONA = 1000;
/**
 * Ile razy wolno powtórzyć zapis z jednej oferty. `zapiszWiedzeZOferty`
 * bierze po dwadzieścia pozycji (porcja z 0.264.0 chroni kolejkę przed ścianą
 * z jednego kliknięcia). Tu kliknięcie świadomie zbiera wszystko, więc
 * powtarzamy — ale z sufitem, żeby lista na tysiąc pozycji nie zablokowała
 * partii. Reszta dojdzie przy następnej zbiórce.
 */
const MAX_PORCJI = 10;

export interface PasujeDoDeps {
  database?: Db;
  query?: (url: string) => Promise<unknown | null>;
  now?: () => Date;
  apiUrl?: string;
  accountId?: string;
  /** Pauza między żądaniami — w testach natychmiastowa. */
  czekaj?: (ms: number) => Promise<void>;
  los?: () => number;
}

const czekajNaprawde = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/* ── Krok 1: lista ofert konta ────────────────────────────────────────────── */

export interface WynikListy { zapisano: number; nastepny: number | null; razem: number | null }

/**
 * Jedna strona AKTYWNYCH ofert konta do `offer_snapshot`. Ta sama funkcja
 * zapisu co przebieg ofert przy rozmowach (`zapiszSnapshotOferty`), bo dwa
 * kawałki kodu piszące do jednej tabeli rozjechałyby się po cichu.
 *
 * `nastepny` to przesunięcie następnej strony albo `null`, gdy to była ostatnia.
 * Ekran przekazuje je z powrotem — serwer nie pamięta, gdzie skończył.
 */
export async function spiszOferty(offset: number, userId: number, deps: PasujeDoDeps = {}): Promise<WynikListy> {
  const database = deps.database ?? defaultDb();
  const autor = czlowiekZBiura(database, userId);
  const query = deps.query ?? zapytajAllegro;
  const apiUrl = deps.apiUrl ?? config.allegro.apiUrl;
  const od = Number.isInteger(offset) && offset >= 0 ? offset : 0;
  const body = (await query(`${apiUrl}/sale/offers?publication.status=ACTIVE&limit=${STRONA}&offset=${od}`)) as
    { offers?: Oferta[]; totalCount?: number } | null;
  const oferty = (body?.offers ?? []).filter((o): o is Oferta => typeof o?.id === "string");
  const at = (deps.now ?? (() => new Date()))().toISOString();
  const konto = kontoKanalu(database, deps.accountId ?? config.allegro.clientId);
  const razem = typeof body?.totalCount === "number" ? body.totalCount : null;
  transaction(database, () => {
    for (const o of oferty) zapiszSnapshotOferty(database, o, konto, at);
    logEvent("pasuje_do_lista", autor, null, { offset: od, zapisano: oferty.length, razem }, userId, database);
  })();
  const dalej = od + oferty.length;
  /* Pusta strona kończy listę nawet bez `totalCount` — inaczej ekran pytałby
     w nieskończoność o stronę, której nie ma. */
  const nastepny = oferty.length > 0 && (razem === null ? oferty.length === STRONA : dalej < razem) ? dalej : null;
  return { zapisano: oferty.length, nastepny, razem };
}

/* ── Które oferty i do której kartoteki ───────────────────────────────────── */

interface OfertaZKartoteka {
  konto: number; ofertaId: string; nazwa: string; twId: number; symbol: string;
  trescAt: string | null; zebranoAt: string | null; lista: string[] | null;
}

const czytajListe = (json: string | null): string[] | null => {
  if (json == null) return null;
  try { const l = JSON.parse(json); return Array.isArray(l) ? l.map(String) : []; } catch { return []; }
};

/**
 * Aktywne oferty z PEWNĄ kartoteką — po sygnaturze albo po wskazaniu
 * człowieka. Domysł po nazwie wystarcza, żeby pokazać kartotekę obok oferty,
 * ale nie żeby dopisać jej cudze zastosowania: bramka z 0.264.0, ta sama.
 */
function ofertyZKartoteka(database: Db): OfertaZKartoteka[] {
  const wiersze = database.prepare(`SELECT channel_account_id AS konto, external_id AS id, nazwa, sku,
      tresc_synced_at AS tresc, pasuje_do_zebrano_at AS zebrano, pasuje_do_json AS lista
    FROM offer_snapshot WHERE status='ACTIVE' ORDER BY id`).all() as
    Array<{ konto: number; id: string; nazwa: string; sku: string | null; tresc: string | null; zebrano: string | null; lista: string | null }>;
  const wynik: OfertaZKartoteka[] = [];
  for (const w of wiersze) {
    const k = kartotekaOferty(database, Number(w.konto), w.id, w.sku);
    if (k.twId === null || !k.symbol || (k.pewnosc !== "sku" && k.pewnosc !== "pamiec")) continue;
    wynik.push({ konto: Number(w.konto), ofertaId: w.id, nazwa: w.nazwa, twId: k.twId, symbol: k.symbol,
      trescAt: w.tresc, zebranoAt: w.zebrano, lista: czytajListe(w.lista) });
  }
  return wynik;
}

/* Do zebrania: nigdy nie zbierana albo treść nowsza niż ostatnia zbiórka.
   Świeżość treści (tydzień) pilnuje `dociagnijTresc` — oferta zebrana
   z tygodniowej treści wraca sama, gdy ta się zestarzeje i zostanie pobrana. */
const doZebrania = (o: OfertaZKartoteka) => o.zebranoAt === null || (o.trescAt !== null && o.zebranoAt < o.trescAt);

/* ── Krok 2: partia treści i zapis wiedzy ─────────────────────────────────── */

export interface WynikPartii {
  przejrzano: number;
  /** Ile razy poszliśmy do Allegro — dziennik ma mówić prawdę o koszcie. */
  pobrano: number;
  numerow: number;
  /** Pozycje zapisane od razu jako zatwierdzone (marka rozpoznana — decyzja z 0.341.0). */
  wpisanych: number;
  /** Pozycje odłożone do kolejki „Z opisów i ofert" — tam czeka człowiek. */
  wKolejce: number;
  /** Pozycje pominięte, bo ta maszyna już stoi przy kartotece. */
  znanych: number;
  /** Pozycje pominięte, bo wiedza mówi „nie pasuje" — pokazuje je sprawdzenie ofert. */
  sprzecznych: number;
  pozostalo: number;
  /** Limit z Allegro przerwał partię; ekran czeka tyle, ile prosi Allegro. */
  przerwano: { powod: "limit"; poIluMs: number | null } | null;
}

/** Tekst kartoteki, w którym numery z oferty są „znane" — nie dopisujemy ich drugi raz. */
function korpusKartoteki(database: Db, twId: number): string {
  const t = database.prepare("SELECT symbol, nazwa, COALESCE(opis,'') opis FROM sgt_towar WHERE tw_id=?").get(twId) as
    { symbol: string; nazwa: string; opis: string } | undefined;
  const numery = (database.prepare("SELECT wartosc FROM towar_identyfikator WHERE tw_id=?").all(twId) as
    Array<{ wartosc: string }>).map((r) => r.wartosc);
  return [t?.symbol ?? "", t?.nazwa ?? "", t?.opis ?? "", ...numery].join(" ");
}

/**
 * Pozycje listy, które NIE powtarzają maszyny już stojącej przy kartotece.
 *
 * Bez tego sita zbiórka zalałaby kolejkę duplikatami: `przerobModelZOpisu`
 * odbija parę już znaną, a wiersz zostaje w kolejce jako „nowy". Porównanie
 * to samo, którym panel podświetla maszynę na liście (`pozycjaMaszyny`).
 *
 * Pozycja bez cyfry odpada — „Wiele modeli" albo „Uniwersalny" to nie maszyna.
 * To świadomie luźniej niż `lukiZOferty`, które wymaga słowa z cyfrą I literą:
 * „STIHL FS 250" ma model w dwóch słowach i tamten filtr gubił go w całości.
 */
function noweModele(database: Db, twId: number, lista: string[]): { modele: string[]; znanych: number; sprzecznych: number } {
  const zywe = database.prepare(`SELECT m.marka, m.nazwa, z.polaryzacja FROM zastosowanie z JOIN model_urzadzenia m ON m.id=z.model_id
    WHERE z.tw_id=? AND z.stan IN ('propozycja','zatwierdzone')`).all(twId) as
    Array<{ marka: string; nazwa: string; polaryzacja: string }>;
  const modele: string[] = [];
  const widziane = new Set<string>();
  let znanych = 0; let sprzecznych = 0;
  for (const surowa of lista) {
    const p = surowa.trim().replace(/\s+/g, " ").slice(0, 200);
    const klucz = zwin(p);
    if (!p || !/\d/.test(p) || !klucz || widziane.has(klucz)) continue;
    widziane.add(klucz);
    /* NEGATYW WYGRYWA Z DEKLARACJĄ OFERTY. Pozycja, dla której wiedza mówi
       „nie pasuje", nie idzie do zapisu — automat z 0.341.0 zatwierdziłby ją
       obok negatywu i baza twierdziłaby jedno i drugie naraz. Taki rozjazd
       jest błędem w OFERCIE i pokazuje go sprawdzenie ofert. */
    const trafione = zywe.filter((m) => pozycjaMaszyny(p, m.marka, m.nazwa));
    if (trafione.some((m) => m.polaryzacja === "nie_pasuje")) { sprzecznych++; continue; }
    if (trafione.length > 0) { znanych++; continue; }
    modele.push(p);
  }
  return { modele, znanych, sprzecznych };
}

/**
 * Jedna partia: treść kolejnych ofert i zapis wiedzy z nich. Zapisuje, więc
 * woła ją wyłącznie przycisk — nigdy odczyt ekranu.
 */
export async function zbierzPartie(userId: number, deps: PasujeDoDeps = {}): Promise<WynikPartii> {
  const database = deps.database ?? defaultDb();
  const kto = { id: userId, name: czlowiekZBiura(database, userId) };
  const czekaj = deps.czekaj ?? czekajNaprawde;
  const los = deps.los ?? Math.random;
  const wynik: WynikPartii = { przejrzano: 0, pobrano: 0, numerow: 0, wpisanych: 0, wKolejce: 0, znanych: 0,
    sprzecznych: 0, pozostalo: 0, przerwano: null };
  /* Nigdy niepobrane pierwsze: tam jest najwięcej do zebrania. */
  const kolejka = ofertyZKartoteka(database).filter(doZebrania)
    .sort((a, b) => Number(a.trescAt !== null) - Number(b.trescAt !== null));
  for (const o of kolejka.slice(0, PARTIA)) {
    try {
      if (wynik.pobrano > 0) await czekaj(nastepnyOdstep(ODSTEP_MS, los()));
      if (await dociagnijTresc(o.konto, o.ofertaId, { database, query: deps.query, now: deps.now, apiUrl: deps.apiUrl })) {
        wynik.pobrano++;
      }
    } catch (e) {
      if (e instanceof BladLimituAllegro) {
        wynik.przerwano = { powod: "limit", poIluMs: e.poIluMs };
        break;
      }
      throw e;
    }
    const snap = database.prepare(`SELECT opis, parametry_json, pasuje_do_json, tresc_synced_at FROM offer_snapshot
      WHERE channel_account_id=? AND external_id=?`).get(o.konto, o.ofertaId) as
      { opis: string | null; parametry_json: string | null; pasuje_do_json: string | null; tresc_synced_at: string | null };
    wynik.przejrzano++;
    /* Treści nie ma nadal — Allegro odmówiło tej jednej oferty. Nie znakujemy
       jej jako zebranej: wróci przy następnej zbiórce. */
    if (!snap.tresc_synced_at) continue;

    const lista = czytajListe(snap.pasuje_do_json) ?? [];
    let parametry: Array<{ nazwa: string; wartosci: string[] }> = [];
    try { parametry = JSON.parse(snap.parametry_json ?? "[]"); } catch { parametry = []; }
    const { numery } = lukiZOferty({ parametry, zgodnosc: [], opis: snap.opis ?? "" }, korpusKartoteki(database, o.twId));
    const { modele, znanych, sprzecznych } = noweModele(database, o.twId, lista);
    wynik.znanych += znanych;
    wynik.sprzecznych += sprzecznych;
    const cel = { twId: o.twId, symbol: o.symbol, ofertaId: o.ofertaId };
    for (let i = 0; i < MAX_PORCJI; i++) {
      const r = zapiszWiedzeZOferty(cel, { numery, modele }, kto, database);
      wynik.numerow += r.numery.length;
      wynik.wpisanych += r.wpisane.length;
      wynik.wKolejce += r.modele.length;
      if (r.numery.length + r.modele.length + r.wpisane.length === 0) break;
    }
    database.prepare(`UPDATE offer_snapshot SET pasuje_do_zebrano_at=? WHERE channel_account_id=? AND external_id=?`)
      .run((deps.now ?? (() => new Date()))().toISOString(), o.konto, o.ofertaId);
  }
  wynik.pozostalo = ofertyZKartoteka(database).filter(doZebrania).length;
  if (wynik.przejrzano > 0) {
    logEvent("pasuje_do_zbiorka", kto.name, null, { ...wynik }, userId, database);
  }
  return wynik;
}

/* ── Stan i sprawdzenie — czyste odczyty ──────────────────────────────────── */

export interface StanPasujeDo {
  /** Aktywne oferty w snapshocie. */
  ofert: number;
  /** Z nich z pewną kartoteką (sygnatura albo wskazanie człowieka). */
  zKartoteka: number;
  zTresca: number;
  zListe: number;
  pozycji: number;
  doZebrania: number;
  /** Kiedy ostatnio pobrano listę ofert konta — `null` = nigdy z tego ekranu. */
  listaAt: string | null;
}

export function stanPasujeDo(database: Db = defaultDb()): StanPasujeDo {
  const ofert = Number((database.prepare("SELECT count(*) n FROM offer_snapshot WHERE status='ACTIVE'").get() as { n: number }).n);
  const z = ofertyZKartoteka(database);
  const listaAt = (database.prepare(`SELECT MAX(created_at) at FROM events WHERE type='pasuje_do_lista'`).get() as
    { at: string | null } | undefined)?.at ?? null;
  return {
    ofert, zKartoteka: z.length, zTresca: z.filter((o) => o.trescAt !== null).length,
    zListe: z.filter((o) => (o.lista?.length ?? 0) > 0).length,
    pozycji: z.reduce((s, o) => s + (o.lista?.length ?? 0), 0),
    doZebrania: z.filter(doZebrania).length, listaAt,
  };
}

export interface RozjazdOferty {
  konto: number; ofertaId: string; nazwa: string; twId: number; symbol: string;
  /** Oferta na Allegro — poprawia się ją tam, bo publikacji z panelu nie ma. */
  link: string | null;
  pozycji: number;
  /** Oferta deklaruje maszynę, dla której wiedza mówi „nie pasuje" — ryzyko zwrotu. */
  sprzeczne: Array<{ pozycja: string; maszyna: string; powod: string; warunki: string | null; zrodlo: string }>;
  /** Wiedza zna maszynę, której lista nie wymienia — kupujący jej nie znajdzie. */
  brakujace: Array<{ maszyna: string; warunki: string | null; zrodlo: string }>;
}

export interface SprawdzenieOfert {
  sprawdzonych: number;
  /** Oferty z kartoteką, ale bez pobranej treści — tych sprawdzić się nie da. */
  bezTresci: number;
  sprzecznych: number;
  brakujacych: number;
  oferty: RozjazdOferty[];
}

/**
 * Lista „Pasuje do" każdej oferty przeciw ZATWIERDZONEJ wiedzy o jej kartotece.
 * Czysty odczyt: niczego nie zapisuje i nie woła Allegro.
 *
 * Dwa rodzaje rozjazdu, bo dwa różne koszty. Sprzeczność to zwrot „nie
 * pasuje" czekający na kupującego. Brak to sprzedaż, której nie było, bo
 * filtr „Pasuje do" na Allegro tej oferty nie pokazał. Pierwsze stoi wyżej.
 *
 * Porównanie po słowach (`pozycjaMaszyny`), to samo co w panelu. Wiedza
 * z warunkiem, np. „od nr seryjnego X", wchodzi z tym warunkiem w zdaniu:
 * lista to wolny tekst i nie da się z niej odczytać, czy go respektuje.
 */
export function sprawdzOferty(database: Db = defaultDb()): SprawdzenieOfert {
  const oferty = ofertyZKartoteka(database);
  const wynik: SprawdzenieOfert = { sprawdzonych: 0, bezTresci: 0, sprzecznych: 0, brakujacych: 0, oferty: [] };
  const wiedzaTw = new Map<number, ReturnType<typeof zastosowaniaTowaru>>();
  for (const o of oferty) {
    if (o.trescAt === null) { wynik.bezTresci++; continue; }
    wynik.sprawdzonych++;
    const lista = o.lista ?? [];
    const w = wiedzaTw.get(o.twId) ?? zastosowaniaTowaru(o.twId, database);
    wiedzaTw.set(o.twId, w);
    const naLiscie = (m: { marka: string; nazwa: string }) => lista.find((p) => pozycjaMaszyny(p, m.marka, m.nazwa)) ?? null;
    const sprzeczne = w.negatywne.flatMap((z) => {
      const pozycja = naLiscie(z.model);
      return pozycja ? [{ pozycja, maszyna: z.model.etykieta, powod: z.zdaniePowodu ?? "nie pasuje",
        warunki: z.zdanieWarunkow, zrodlo: z.zdanieZrodla }] : [];
    });
    const brakujace = w.potwierdzone.filter((z) => naLiscie(z.model) === null)
      .map((z) => ({ maszyna: z.model.etykieta, warunki: z.zdanieWarunkow, zrodlo: z.zdanieZrodla }));
    if (sprzeczne.length === 0 && brakujace.length === 0) continue;
    wynik.sprzecznych += sprzeczne.length;
    wynik.brakujacych += brakujace.length;
    wynik.oferty.push({ konto: o.konto, ofertaId: o.ofertaId, nazwa: o.nazwa, twId: o.twId, symbol: o.symbol,
      link: linkOferty(o.ofertaId), pozycji: lista.length, sprzeczne, brakujace });
  }
  wynik.oferty.sort((a, b) => b.sprzeczne.length - a.sprzeczne.length || b.brakujace.length - a.brakujace.length
    || a.symbol.localeCompare(b.symbol));
  return wynik;
}
