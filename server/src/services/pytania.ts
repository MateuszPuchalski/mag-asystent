import { db, nowIso } from "../db/db.js";
import { config } from "../config.js";
import { subiekt } from "../context.js";
import { logEvent } from "./events.js";
import { allegroAdapter, LIMIT_WIADOMOSCI } from "../adapters/allegro.js";
import { stanPolaczenia } from "./allegro-token.js";
import type { OfertaAllegro, WiadomoscAllegro } from "../adapters/allegro.js";
import { dostepneW, zamiennikiZOpisu } from "./stock.js";
import { stanyNiezerowe } from "./magazyny.js";
import { zamowioneUDostawcy } from "./zamowienia-towaru.js";
import { nierozlozoneZDostaw } from "./dostawy-towaru.js";
import type { ProductRow, Zamienniki } from "../types.js";
import type { ZamowioneUDostawcy } from "./zamowienia-towaru.js";
import type { WDostawie } from "./dostawy-towaru.js";
import {
  aiTryb,
  generujOdpowiedz,
  stanAI,
  zbudujSystem,
  type OdpowiedzAI,
  type ObrazPytania,
  type PrzykladOdpowiedzi,
} from "./ai.js";

/* ── Pytania klientów — worklista biura ──────────────────────────────────────
   Właściciel odpowiadał na pytania z Allegro ręcznie: screenshot z poczty szedł
   do zewnętrznego czata, a odpowiedź wracała przez schowek. Ten moduł zamyka
   tę pętlę w aplikacji, która i tak zna kartotekę, stany i zamienniki.

   Trzy decyzje rozstrzygają całą resztę:

   1. TRZYMAMY NASZĄ PRACĘ, NIE ROZMOWĘ. Wiersz `pytanie` to snapshot pytania,
      nasz szkic, nasza odpowiedź i klasyfikacja. Pełny wątek czyta się na
      kliknięcie prosto z Allegro — ta sama zasada, co przy zwrotach.
   2. SZKIC POWSTAJE W TLE. Ticker synchronizuje wątki i od razu liczy szkice,
      więc otwarte pytanie ma odpowiedź gotową do przeczytania, a nie przycisk
      „wygeneruj" i czekanie. Awaria modelu zostawia status `nowe` i przycisk
      wraca — degradacja, nie blokada.
   3. WIEDZA ROŚNIE Z WYSŁANYCH ODPOWIEDZI. Poprawki człowieka wracają jako
      przykłady stylu, a potwierdzone pary maszyna→część jako tabela
      `dopasowanie`. Jedno i drugie zapisuje się WYŁĄCZNIE przy wysyłce, czyli
      po akceptacji człowieka: uczenie się z własnych zgadywanek to najkrótsza
      droga do utrwalenia błędu.                                              */

/** Awaria pracy z pytaniem. `kod` niesie status HTTP dla trasy (wzorzec BladZwrotu). */
export class BladPytania extends Error {
  constructor(
    message: string,
    readonly kod = 400
  ) {
    super(message);
    this.name = "BladPytania";
  }
}

export interface Pytanie {
  id: number;
  zrodlo: string;
  threadId: string | null;
  kupujacyLogin: string | null;
  ofertaId: string | null;
  ofertaTytul: string | null;
  tresc: string;
  otrzymanoAt: string | null;
  status: string;
  szkicAi: string | null;
  odpowiedz: string | null;
  wyslanoAt: string | null;
  odpowiedzial: string | null;
  edytowano: boolean;
  kategoria: string | null;
  urzadzenie: string | null;
  produkty: Array<{ twId: number | null; symbol: string }>;
  wOfercie: boolean | null;
  /** Kto wziął sprawę — znacznik dla reszty biura, nie blokada. */
  prowadzi: string | null;
  prowadziAt: string | null;
}

/** Ile ostatnich poprawionych odpowiedzi pokazujemy modelowi jako wzór stylu. */
const PRZYKLADOW = 5;

/** Ile kartotek maksymalnie wchodzi do kontekstu. Więcej rozmywa, mniej nie wystarcza. */
const KARTOTEK_W_KONTEKSCIE = 8;

const tekstLubNull = (v: unknown): string | null =>
  typeof v === "string" && v.trim() !== "" ? v : null;

function zWiersza(w: Record<string, unknown>): Pytanie {
  let produkty: Array<{ twId: number | null; symbol: string }> = [];
  try {
    const rozebrane = JSON.parse((w.produkty_json as string) || "[]");
    if (Array.isArray(rozebrane)) produkty = rozebrane;
  } catch {
    /* Uszkodzony JSON nie ma prawa wywalić listy pytań — pole jest pochodne. */
  }
  return {
    id: w.id as number,
    zrodlo: w.zrodlo as string,
    threadId: tekstLubNull(w.thread_id),
    kupujacyLogin: tekstLubNull(w.kupujacy_login),
    ofertaId: tekstLubNull(w.oferta_id),
    ofertaTytul: tekstLubNull(w.oferta_tytul),
    tresc: (w.tresc as string) ?? "",
    otrzymanoAt: tekstLubNull(w.otrzymano_at),
    status: w.status as string,
    szkicAi: tekstLubNull(w.szkic_ai),
    odpowiedz: tekstLubNull(w.odpowiedz),
    wyslanoAt: tekstLubNull(w.wyslano_at),
    odpowiedzial: tekstLubNull(w.odpowiedzial),
    edytowano: (w.edytowano as number) === 1,
    kategoria: tekstLubNull(w.kategoria),
    urzadzenie: tekstLubNull(w.urzadzenie),
    prowadzi: tekstLubNull(w.prowadzi),
    prowadziAt: tekstLubNull(w.prowadzi_at),
    produkty,
    wOfercie: w.w_ofercie == null ? null : (w.w_ofercie as number) === 1,
  };
}

function wiersz(id: number): Record<string, unknown> {
  const w = db().prepare("SELECT * FROM pytanie WHERE id = ?").get(id) as
    | Record<string, unknown>
    | undefined;
  if (!w) throw new BladPytania("Nie ma takiego pytania", 404);
  return w;
}

export function szczegolPytania(id: number): Pytanie {
  return zWiersza(wiersz(id));
}

export function listaPytan(opcje: { status?: string; limit?: number } = {}): Pytanie[] {
  const limit = Math.min(Math.max(opcje.limit ?? 100, 1), 500);
  /* Domyślnie WORKLISTA, nie archiwum: pytanie odpowiedziane schodzi z oczu,
     bo lista ma pokazywać robotę do zrobienia. Filtr statusu daje wgląd
     w resztę, gdy ktoś szuka konkretnej sprawy. */
  /* `wszystkie` to trzeci tryb, nie status: pokazuje archiwum razem z pracą,
     pod czip „Wszystkie" ze skrzynki (0.96.0). BRAK filtra dalej znaczy
     worklistę — i to zostaje domyślne, bo tak zachowuje się każde wejście
     na zakładkę. */
  const wszystko = opcje.status === "wszystkie";
  const sql = wszystko
    ? "SELECT * FROM pytanie ORDER BY otrzymano_at DESC, id DESC LIMIT ?"
    : opcje.status
      ? "SELECT * FROM pytanie WHERE status = ? ORDER BY otrzymano_at DESC, id DESC LIMIT ?"
      : `SELECT * FROM pytanie WHERE status IN ('nowe','szkic')
         ORDER BY otrzymano_at DESC, id DESC LIMIT ?`;
  const args = !wszystko && opcje.status ? [opcje.status, limit] : [limit];
  return (db().prepare(sql).all(...args) as Array<Record<string, unknown>>).map(zWiersza);
}

/** Ile pytań czeka — do licznika na zakładce, odpytywanego co 30 s. */
export function licznikOtwartych(): number {
  const w = db()
    .prepare("SELECT COUNT(*) AS ile FROM pytanie WHERE status IN ('nowe','szkic')")
    .get() as { ile: number };
  return w.ile;
}

/**
 * Otwarte Z PODZIAŁEM na „czeka na szkic" i „szkic gotowy".
 *
 * Sama suma zlewa dwa różne stany pracy. Od 0.85.0 nic nie liczy szkiców
 * w tle, a ręczne ODŚWIEŻ bierze najwyżej pięć — więc przy dziesięciu nowych
 * pytaniach reszta zostaje bez szkicu i licznik nie ma jak tego powiedzieć.
 */
export function licznikiPytan(): { nowe: number; szkice: number } {
  const w = db()
    .prepare(
      `SELECT
         SUM(CASE WHEN status = 'nowe'  THEN 1 ELSE 0 END) AS nowe,
         SUM(CASE WHEN status = 'szkic' THEN 1 ELSE 0 END) AS szkice
       FROM pytanie`
    )
    .get() as { nowe: number | null; szkice: number | null };
  return { nowe: w.nowe ?? 0, szkice: w.szkice ?? 0 };
}

/** Najstarsze otwarte pytanie poza wskazanym — tryb „skrzynka do zera". */
export function nastepneOtwarte(pomijajac: number): number | null {
  const w = db()
    .prepare(
      `SELECT id FROM pytanie WHERE status IN ('nowe','szkic') AND id <> ?
       ORDER BY otrzymano_at ASC, id ASC LIMIT 1`
    )
    .get(pomijajac) as { id: number } | undefined;
  return w?.id ?? null;
}

/* ── Konfiguracja modelu (prompt + fakty firmowe) ────────────────────────── */

export interface KonfiguracjaAI {
  prompt: string;
  fakty: string;
  zmienionoAt: string | null;
  zmienionoPrzez: string | null;
}

export function pobierzKonfiguracje(): KonfiguracjaAI {
  const w = db().prepare("SELECT * FROM ai_config WHERE id = 1").get() as
    | Record<string, unknown>
    | undefined;
  return {
    prompt: (w?.prompt as string) ?? "",
    fakty: (w?.fakty as string) ?? "",
    zmienionoAt: tekstLubNull(w?.zmieniono_at),
    zmienionoPrzez: tekstLubNull(w?.zmieniono_przez),
  };
}

function zapiszPole(pole: "prompt" | "fakty", tresc: string, autor: string): KonfiguracjaAI {
  db()
    .prepare(
      `INSERT INTO ai_config (id, ${pole}, zmieniono_at, zmieniono_przez)
       VALUES (1, ?, datetime('now'), ?)
       ON CONFLICT(id) DO UPDATE SET
         ${pole} = excluded.${pole},
         zmieniono_at = excluded.zmieniono_at,
         zmieniono_przez = excluded.zmieniono_przez`
    )
    .run(tresc, autor);
  logEvent("pytanie_konfiguracja", autor, null, { pole, znakow: tresc.length });
  return pobierzKonfiguracje();
}

export const zapiszPrompt = (tresc: string, autor: string) => zapiszPole("prompt", tresc, autor);
export const zapiszFakty = (tresc: string, autor: string) => zapiszPole("fakty", tresc, autor);

/* ── Synchronizacja z Allegro ────────────────────────────────────────────── */

export interface WynikSynchronizacji {
  nowych: number;
  przejrzanychWatkow: number;
}

/**
 * Od kiedy schodzić listą wątków.
 *
 * Doba zapasu wstecz od najnowszego znanego pytania, bo wątek mógł dojść
 * między przebiegami, a `INSERT OR IGNORE` po `wiadomosc_id` i tak odsieje
 * powtórki. Pusta baza daje `null` — wtedy hamuje limit stron.
 */
export function odKiedySync(): string | null {
  /* Tylko pytania Z ALLEGRO. Wklejka ma datę wklejenia, nie datę wiadomości
     w Centrum — wpuszczona tutaj przesuwałaby zakładkę listy wątków w przód
     i chowała pytania, które przyszły wcześniej tego samego dnia. */
  const w = db()
    .prepare("SELECT MAX(otrzymano_at) AS max FROM pytanie WHERE zrodlo = 'allegro'")
    .get() as { max: string | null };
  if (!w.max) return null;
  const t = Date.parse(w.max);
  if (!Number.isFinite(t)) return null;
  return new Date(t - 86_400_000).toISOString();
}

/**
 * Ostatnia nieprzerwana seria wiadomości kupującego.
 *
 * Pytanie bywa rozbite na trzy wiadomości pod rząd („dzień dobry" / „mam
 * kosiarkę X" / „czy pasuje?"). Sklejamy je, bo dopiero razem są pytaniem —
 * a odpowiadamy tylko wtedy, gdy ostatnie słowo należy do klienta. Wątek
 * zakończony NASZĄ wiadomością jest sprawą załatwioną i nie ma tu czego robić.
 */
export function ostatniaSeriaKupujacego(
  wiadomosci: WiadomoscAllegro[]
): { id: string; tresc: string; at: string | null } | null {
  const ostatnia = wiadomosci[wiadomosci.length - 1];
  if (!ostatnia || !ostatnia.odKupujacego) return null;

  const seria: WiadomoscAllegro[] = [];
  for (let i = wiadomosci.length - 1; i >= 0; i--) {
    if (!wiadomosci[i].odKupujacego) break;
    seria.unshift(wiadomosci[i]);
  }
  return {
    id: ostatnia.id,
    tresc: seria
      .map((w) => w.tresc.trim())
      .filter((t) => t !== "")
      .join("\n"),
    at: ostatnia.at,
  };
}

/** Jeden przebieg synchronizacji: nowe pytania z Centrum wiadomości. */
export async function synchronizujPytania(autor: string): Promise<WynikSynchronizacji> {
  const adapter = allegroAdapter();
  const odKiedy = odKiedySync();
  /* Pierwsze uruchomienie schodzi płycej: trzy strony to sześćdziesiąt
     najświeższych rozmów. Zaciąganie całej historii konta zrobiłoby ze
     startu listę setek „pytań", na które dawno odpowiedziano. */
  const watki = await adapter.listaWatkow(odKiedy, odKiedy ? 10 : 3);

  const wstaw = db().prepare(
    `INSERT OR IGNORE INTO pytanie
       (zrodlo, thread_id, wiadomosc_id, kupujacy_login, oferta_id, oferta_tytul,
        tresc, otrzymano_at, status, produkty_json, utworzono_at, utworzono_przez)
     VALUES ('allegro', ?, ?, ?, ?, ?, ?, ?, 'nowe', '[]', datetime('now'), ?)`
  );

  let nowych = 0;
  for (const watek of watki) {
    if (!watek.threadId) continue;
    const wiadomosci = await adapter.wiadomosciWatku(watek.threadId);
    const seria = ostatniaSeriaKupujacego(wiadomosci);
    if (!seria || seria.tresc === "") continue;

    const wynik = wstaw.run(
      watek.threadId,
      seria.id,
      watek.interlokutor,
      watek.ofertaId,
      watek.ofertaTytul,
      seria.tresc,
      seria.at ?? watek.ostatniaWiadomoscAt,
      autor
    );
    if (wynik.changes > 0) nowych++;
  }

  if (nowych > 0) {
    logEvent("pytanie_sync", autor, null, { nowych, przejrzanychWatkow: watki.length });
  }
  /* Ślad przebiegu zapisujemy ZAWSZE, także gdy nic nie przyszło — bo to
     właśnie wtedy jest potrzebny. Zdarzenie w audycie leci tylko przy nowych
     pytaniach i słusznie: przebieg bez zmian nie jest faktem o towarze ani
     o ludziach. Ale skrzynka na zero wygląda identycznie, gdy nic nie
     przyszło, i gdy od wczoraj nikt nie pytał Allegro — a to dwie zupełnie
     różne sytuacje. */
  stanSynchronizacji = {
    at: nowIso(),
    przez: autor,
    nowych,
    przejrzanychWatkow: watki.length,
  };
  return { nowych, przejrzanychWatkow: watki.length };
}

/**
 * Ślad ostatniego pobrania pytań z Allegro — na ekran biura.
 *
 * W PAMIĘCI, nie w bazie, dokładnie jak `stanOdswiezania` przy zapowiedziach
 * zwrotów (`services/zapowiedzi.ts`). Restart serwera go kasuje i to jest
 * poprawne: „nie wiem, kiedy ostatnio pytaliśmy" jest prawdą po restarcie,
 * a nie brakiem danych do odzyskania. Tabela kosztowałaby migrację i zapis
 * przy każdym przebiegu tickera za wiedzę, która i tak starzeje się w minuty.
 */
export interface StanSynchronizacjiPytan {
  at: string;
  przez: string;
  nowych: number;
  przejrzanychWatkow: number;
}

let stanSynchronizacji: StanSynchronizacjiPytan | null = null;

export function stanSynchronizacjiPytan(): StanSynchronizacjiPytan | null {
  return stanSynchronizacji;
}

/* ── Kontekst dla modelu ─────────────────────────────────────────────────── */

/**
 * Frazy, którymi szukamy w kartotece.
 *
 * Tytuł oferty jest najlepszym tropem, gdy wątek go niesie — to dosłownie
 * nazwa towaru, o który klient pyta. Z treści bierzemy tokeny Z CYFRAMI
 * (kształt numeru katalogowego i modelu maszyny: `T375`, `MS180`, `W80-2005`)
 * oraz najdłuższe słowa, bo one niosą rzeczownik („cewka", „gaźnik"), a nie
 * uprzejmości.
 */
export function frazySzukania(tresc: string, ofertaTytul: string | null): string[] {
  const frazy: string[] = [];
  if (ofertaTytul?.trim()) frazy.push(ofertaTytul.trim());

  const tokeny = tresc
    .split(/[^\p{L}\p{N}\-/]+/u)
    .map((t) => t.trim())
    .filter((t) => t.length >= 3);

  const zCyframi = tokeny.filter((t) => /\d/.test(t) && /\p{L}|-/u.test(t));
  const dlugie = tokeny
    .filter((t) => !/\d/.test(t) && t.length >= 6)
    .sort((a, b) => b.length - a.length)
    .slice(0, 3);

  for (const t of [...zCyframi, ...dlugie]) {
    if (!frazy.some((f) => f.toLowerCase() === t.toLowerCase())) frazy.push(t);
  }
  return frazy.slice(0, 6);
}

export interface TrafienieKartoteki {
  twId: number;
  symbol: string;
  nazwa: string;
  ean: string;
  /**
   * Stan magazynu głównego SKORYGOWANY o kolejkę zapisów — to samo, co widzi
   * kolektor na karcie towaru. Surowy stan z read-modelu potrafi kłamać przez
   * kilka minut po przesunięciu, a klientowi odpisuje się raz.
   */
  stan: number;
  lokalizacje: string[];
  /**
   * Zamienniki ROZSTRZYGNIĘTE kartoteką: `znane` mamy u siebie, `obce` to cudze
   * numery katalogowe. Do 0.89.0 szła stąd płaska lista kandydatów i nie było
   * jak odróżnić „mamy zamiennik" od „klient podał numer, którego nie znamy".
   */
  zamienniki: Zamienniki;
  /** Zamówione u dostawcy i jeszcze nieprzyjęte — „nie mamy, ale będzie". */
  zamowione: ZamowioneUDostawcy[];
  /** Przyjechało i czeka na rozłożenie — fizycznie jest, na półce jeszcze nie. */
  wDostawie: WDostawie[];
}

/**
 * Kartoteki pasujące do fraz — z furtką na literówki, bez powtórek.
 *
 * `symbole` to droga na skróty i zarazem najpewniejsza: sygnatura sprzedawcy
 * z naszej aukcji (`offer.external.id`) JEST symbolem kartoteki. Szukanie po
 * nazwie musi tu istnieć dla pytań bez kontekstu oferty, ale samo nie
 * wystarcza — tytuł aukcji rzadko brzmi dokładnie tak jak nazwa w Subiekcie
 * („Pozycja X — oferta Allegro" kontra „Pozycja X"), a wyszukiwarka wymaga
 * wszystkich słów.
 */
function szukajKartotek(frazy: string[], symbole: string[] = []): TrafienieKartoteki[] {
  const znalezione = new Map<number, TrafienieKartoteki>();

  const dodaj = (twId: number, p: ProductRow) => {
    if (znalezione.has(twId) || znalezione.size >= KARTOTEK_W_KONTEKSCIE) return;
    /* Opis kartoteki nosi zamienniki („Zamiennie: …") i jest jedynym
       miejscem, gdzie wiedza o pasowaniu już u nas jest — `ProductRow` go
       nie niesie, więc dobieramy go wprost z read-modelu. */
    const opis = db().prepare("SELECT opis FROM sgt_towar WHERE tw_id = ?").get(twId) as
      | { opis: string | null }
      | undefined;
    znalezione.set(twId, {
      twId,
      symbol: p.sym,
      nazwa: p.name,
      ean: p.ean,
      /* Ta sama korekta o kolejkę, którą liczy karta towaru — nie surowe
         `p.mag`. Osiem kartotek to osiem zapytań do LOKALNEGO SQLite; żadne
         z nich nie dotyka Allegro, a to jest tu jedyny reglamentowany zasób. */
      stan: dostepneW(config.magId.MAG, twId),
      lokalizacje: p.locs,
      zamienniki: zamiennikiZOpisu(subiekt, opis?.opis ?? "", p.sym),
      zamowione: zamowioneUDostawcy(twId),
      wDostawie: nierozlozoneZDostaw(twId),
    });
  };

  /* Symbole z aukcji idą PIERWSZE — mają pierwszeństwo w limicie, bo to
     twarde dopasowanie, a nie trafienie po słowach. */
  for (const symbol of symbole) {
    for (const p of subiekt.getProductsBySymbols([symbol])) {
      dodaj(p.id, p);
    }
  }
  for (const fraza of frazy) {
    if (znalezione.size >= KARTOTEK_W_KONTEKSCIE) break;
    for (const p of subiekt.szukajZFurtka(fraza, KARTOTEK_W_KONTEKSCIE).wyniki) {
      dodaj(p.id, p);
    }
  }
  return [...znalezione.values()];
}

/** Potwierdzone wcześniej pary maszyna→część dla fraz z pytania. */
/** Potwierdzona para „ta maszyna → ten symbol", zbudowana z wysłanych odpowiedzi. */
export interface ZnaneDopasowanie {
  urzadzenie: string;
  symbol: string;
}

function znanaDopasowania(frazy: string[]): ZnaneDopasowanie[] {
  if (frazy.length === 0) return [];
  const pytajniki = frazy.map(() => "?").join(",");
  return db()
    .prepare(
      `SELECT urzadzenie, symbol FROM dopasowanie
       WHERE urzadzenie IN (${pytajniki}) ORDER BY potwierdzono_at DESC LIMIT 10`
    )
    .all(...frazy) as Array<{ urzadzenie: string; symbol: string }>;
}

/** Co odpowiedzieliśmy wcześniej na pytania o tę samą ofertę. */
function poprzednieOdpowiedzi(ofertaId: string | null, pomijajac: number): PrzykladOdpowiedzi[] {
  if (!ofertaId) return [];
  return (
    db()
      .prepare(
        `SELECT tresc, odpowiedz FROM pytanie
         WHERE oferta_id = ? AND status = 'wyslane' AND id <> ?
         ORDER BY wyslano_at DESC LIMIT 2`
      )
      .all(ofertaId, pomijajac) as Array<{ tresc: string; odpowiedz: string }>
  ).map((w) => ({ pytanie: w.tresc, odpowiedz: w.odpowiedz }));
}

export interface Kontekst {
  tekst: string;
  kartoteki: TrafienieKartoteki[];
  oferty: OfertaAllegro[];
  /**
   * Powód, dla którego lista aukcji jest pusta — albo `null`, gdy pusta jest
   * zgodnie z prawdą.
   *
   * Model dostawał to zdanie od 0.80.0, człowiek nie dostawał go wcale: panel
   * pisał „Nic nie pasuje" i wtedy, gdy Allegro odpowiedziało, i wtedy, gdy
   * padło. To dwie różne odpowiedzi dla klienta — „nie mamy" wolno napisać,
   * „nie sprawdziliśmy" trzeba sprawdzić.
   */
  bladOfert: string | null;
  /** Frazy, po których szukaliśmy — bez nich zły dobór jest nie do wyjaśnienia. */
  frazy: string[];
  /** Potwierdzone pary urządzenie→symbol użyte w tym szkicu. */
  dopasowania: ZnaneDopasowanie[];
  /** Co odpowiadaliśmy wcześniej na pytania o tę samą ofertę. */
  poprzednie: PrzykladOdpowiedzi[];
}

/**
 * Blok wiedzy dla modelu — kartoteki, stany, zamienniki, nasze aukcje.
 *
 * Zwykły tekst po polsku, nie JSON: to samo czyta potem człowiek w panelu,
 * a i model radzi sobie z nim lepiej niż z zagnieżdżonym obiektem.
 *
 * Awaria wyszukiwania ofert NIE wywraca generowania. Bez linków szkic jest
 * gorszy, ale wciąż użyteczny; brak szkicu nie jest użyteczny wcale — więc
 * zamiast wyjątku wchodzi zdanie o tym, czego zabrakło.
 */
export async function kontekstPytania(p: Pytanie): Promise<Kontekst> {
  const frazy = frazySzukania(p.tresc, p.ofertaTytul);

  /* Aukcje PRZED kartoteką, choć w odpowiedzi stoją po niej. Powód jest
     jeden: sygnatura z aukcji trafia w kartotekę pewniej niż jakiekolwiek
     szukanie po nazwie, więc najpierw pytamy Allegro, a potem wchodzimy do
     Subiekta z gotowym symbolem. */
  let oferty: OfertaAllegro[] = [];
  let bladOfert: string | null = null;
  try {
    const adapter = allegroAdapter();
    for (const fraza of frazy.slice(0, 4)) {
      for (const o of await adapter.szukajOfert(fraza)) {
        if (!oferty.some((x) => x.offerId === o.offerId)) oferty.push(o);
      }
    }
    oferty = oferty.slice(0, 10);
  } catch (e) {
    bladOfert = e instanceof Error ? e.message : String(e);
  }

  const kartoteki = szukajKartotek(
    frazy,
    oferty.map((o) => o.externalId).filter((s): s is string => !!s)
  );

  const linie: string[] = ["KONTEKST Z MAGAZYNU — dane wewnętrzne, nie cytuj ich wprost."];

  if (kartoteki.length === 0) {
    linie.push("\nKARTOTEKI: nic nie pasuje do tego pytania w naszej kartotece.");
  } else {
    linie.push("\nKARTOTEKI (nasz asortyment):");
    for (const k of kartoteki) {
      const zam = k.zamienniki.znane.length
        ? ` | mamy zamienniki: ${k.zamienniki.znane.map((z) => z.sym).join(", ")}`
        : "";
      /* Obce numery katalogowe podajemy modelowi ODDZIELNIE i z etykietą, bo
         to numery CUDZE — wolno po nich rozpoznać część, nie wolno ich
         sprzedać jako naszych. */
      const obce = k.zamienniki.obce.length
        ? ` | pasuje do numerów obcych: ${k.zamienniki.obce.slice(0, 8).join(", ")}`
        : "";
      const lok = k.lokalizacje.length ? ` | półka: ${k.lokalizacje.join(", ")}` : "";
      const ean = k.ean ? ` | EAN: ${k.ean}` : "";
      linie.push(`- SYMBOL: ${k.symbol} | ${k.nazwa}${ean} | stan: ${k.stan} szt.${lok}${zam}${obce}`);

      /* „Nie mamy" i „nie mamy, ale przyjdzie" to dla klienta dwie różne
         odpowiedzi — a do 0.89.0 model nie miał skąd wziąć tej drugiej.
         Termin podajemy tylko wtedy, gdy baza go zna: obiecana data, której
         nikt nie potwierdził, jest gorsza od jej braku. */
      for (const z of k.zamowione.slice(0, 2)) {
        const kiedy = z.termin ? `termin ${z.termin}` : "termin nieznany";
        linie.push(
          `    ZAMÓWIONE U DOSTAWCY: ${z.ilosc} szt., ${kiedy} (${z.dostawca || "dostawca nieznany"})` +
            `${z.szacunek ? " — ilość szacunkowa" : ""}`
        );
      }
      for (const d of k.wDostawie.slice(0, 2)) {
        linie.push(
          `    PRZYJECHAŁO, NIEROZŁOŻONE: ${d.ilosc} szt. z ${d.nrPelny} (${d.dataWyst})`
        );
      }
    }
  }

  if (oferty.length > 0) {
    linie.push("\nNASZE AUKCJE ALLEGRO (tylko te linki wolno podać klientowi):");
    for (const o of oferty) {
      const cena = o.cena ? ` | ${o.cena}` : "";
      const sym = o.externalId ? ` | symbol: ${o.externalId}` : "";
      linie.push(`- ${o.nazwa}${cena}${sym} | ${o.url}`);
    }
  } else if (bladOfert) {
    linie.push(
      `\nNASZE AUKCJE: nie udało się ich pobrać (${bladOfert}). NIE podawaj linków — ` +
        "napisz, że prześlesz link w kolejnej wiadomości."
    );
  } else {
    linie.push("\nNASZE AUKCJE: brak aktywnych ofert pasujących do pytania.");
  }

  const dopasowania = znanaDopasowania(frazy);
  if (dopasowania.length > 0) {
    linie.push("\nDOPASOWANIA POTWIERDZONE WCZEŚNIEJ (nasza własna wiedza, ufaj im):");
    for (const d of dopasowania) linie.push(`- ${d.urzadzenie} → ${d.symbol}`);
  }

  const poprzednie = poprzednieOdpowiedzi(p.ofertaId, p.id);
  if (poprzednie.length > 0) {
    linie.push("\nCO ODPOWIADALIŚMY NA PYTANIA O TĘ OFERTĘ:");
    for (const o of poprzednie) linie.push(`- „${o.pytanie.slice(0, 160)}" → ${o.odpowiedz}`);
  }

  return { tekst: linie.join("\n"), kartoteki, oferty, bladOfert, frazy, dopasowania, poprzednie };
}

/* ── Historia klienta ────────────────────────────────────────────────────────
   Ten sam login pisze drugi raz częściej, niż się wydaje — a odpowiedź brzmi
   inaczej, gdy widać, że tydzień temu coś zwrócił albo pytał o tę samą część.
   Czytane NA KLIK, osobną trasą: otwarcie sprawy ma być tanie, a te dwa
   zapytania są potrzebne tylko przy wątpliwości.                             */

export interface PytanieHistorii {
  id: number;
  otrzymanoAt: string | null;
  tresc: string;
  odpowiedz: string | null;
  status: string;
  ofertaTytul: string | null;
}

export interface ZwrotHistorii {
  id: number;
  referencja: string | null;
  status: string;
  utworzonoAt: string | null;
  pozycji: number;
}

export interface HistoriaKlienta {
  login: string | null;
  pytania: PytanieHistorii[];
  zwroty: ZwrotHistorii[];
}

/** Ile wstecz pokazujemy — tyle, ile mieści się w karcie bez przewijania. */
const HISTORII_KLIENTA = 10;

/**
 * Co ten kupujący już u nas załatwiał.
 *
 * Pytanie z wklejki nie ma loginu i to jest poprawny wynik pusty, nie błąd:
 * screenshot z poczty nie niesie tożsamości kupującego z Allegro.
 */
export function historiaKlienta(id: number): HistoriaKlienta {
  const p = wiersz(id);
  const login = (p.kupujacy_login as string | null) ?? null;
  if (!login) return { login: null, pytania: [], zwroty: [] };

  const pytania = db()
    .prepare(
      `SELECT id, otrzymano_at, tresc, odpowiedz, status, oferta_tytul
       FROM pytanie
       WHERE kupujacy_login = ? AND id <> ?
       ORDER BY otrzymano_at DESC, id DESC LIMIT ?`
    )
    .all(login, id, HISTORII_KLIENTA) as Array<Record<string, unknown>>;

  /* Zwroty tego samego loginu — z licznikiem pozycji, bo „zwrot" bez liczby
     rzeczy nie mówi, czy wróciła jedna uszczelka, czy cała paczka. */
  const zwroty = db()
    .prepare(
      `SELECT z.id, z.referencja, z.status, z.utworzono_at,
              (SELECT COUNT(*) FROM zwrot_pozycja p WHERE p.zwrot_id = z.id) AS pozycji
       FROM zwrot z
       WHERE z.kupujacy_login = ?
       ORDER BY z.utworzono_at DESC LIMIT ?`
    )
    .all(login, HISTORII_KLIENTA) as Array<Record<string, unknown>>;

  return {
    login,
    pytania: pytania.map((r) => ({
      id: Number(r.id),
      otrzymanoAt: (r.otrzymano_at as string) ?? null,
      tresc: (r.tresc as string) ?? "",
      odpowiedz: (r.odpowiedz as string) ?? null,
      status: (r.status as string) ?? "nowe",
      ofertaTytul: (r.oferta_tytul as string) ?? null,
    })),
    zwroty: zwroty.map((r) => ({
      id: Number(r.id),
      referencja: (r.referencja as string) ?? null,
      status: (r.status as string) ?? "",
      utworzonoAt: (r.utworzono_at as string) ?? null,
      pozycji: Number(r.pozycji ?? 0),
    })),
  };
}

/* ── Szkic ───────────────────────────────────────────────────────────────── */

/** Ostatnie odpowiedzi POPRAWIONE ręką — wzór stylu dla modelu. */
function przykladyStylu(): PrzykladOdpowiedzi[] {
  return (
    db()
      .prepare(
        `SELECT tresc, odpowiedz FROM pytanie
         WHERE status = 'wyslane' AND edytowano = 1 AND odpowiedz IS NOT NULL
         ORDER BY wyslano_at DESC LIMIT ?`
      )
      .all(PRZYKLADOW) as Array<{ tresc: string; odpowiedz: string }>
  ).map((w) => ({ pytanie: w.tresc, odpowiedz: w.odpowiedz }));
}

/** Symbole od modelu → identyfikatory kartotek (symbol spoza kartoteki zostaje z null). */
function zmapujProdukty(
  produkty: Array<{ symbol: string }>
): Array<{ twId: number | null; symbol: string }> {
  const znajdz = db().prepare("SELECT tw_id FROM sgt_towar WHERE symbol = ? COLLATE NOCASE");
  const widziane = new Set<string>();
  const wynik: Array<{ twId: number | null; symbol: string }> = [];
  for (const p of produkty) {
    const symbol = p.symbol.trim();
    const klucz = symbol.toLowerCase();
    if (symbol === "" || widziane.has(klucz)) continue;
    widziane.add(klucz);
    const w = znajdz.get(symbol) as { tw_id: number } | undefined;
    wynik.push({ twId: w?.tw_id ?? null, symbol });
  }
  return wynik;
}

/** Zapisuje wynik modelu na wierszu pytania. */
function zapiszSzkic(id: number, wynik: OdpowiedzAI, tresc: string | null): Pytanie {
  const produkty = zmapujProdukty(wynik.produkty);
  db()
    .prepare(
      `UPDATE pytanie SET
         tresc = COALESCE(?, tresc),
         szkic_ai = ?, szkic_at = datetime('now'),
         odpowiedz = ?, edytowano = 0,
         kategoria = ?, urzadzenie = ?, produkty_json = ?, w_ofercie = ?,
         status = CASE WHEN status = 'nowe' THEN 'szkic' ELSE status END
       WHERE id = ?`
    )
    .run(
      tresc,
      wynik.odpowiedz,
      /* Szkic ląduje OD RAZU w polu odpowiedzi: człowiek ma redagować gotowy
         tekst, nie przepisywać go z sąsiedniego pola. `edytowano` wraca do
         zera, bo o poprawce decyduje dopiero różnica przy zapisie. */
      wynik.odpowiedz,
      wynik.kategoria,
      wynik.urzadzenie,
      JSON.stringify(produkty),
      wynik.wOfercie == null ? null : wynik.wOfercie ? 1 : 0,
      id
    );
  return szczegolPytania(id);
}

export async function generujSzkic(id: number, autor: string): Promise<Pytanie> {
  if (aiTryb() === "wylaczone") throw new BladPytania(stanAI().opis, 400);
  const p = szczegolPytania(id);
  const kontekst = await kontekstPytania(p);
  const konfiguracja = pobierzKonfiguracje();

  const wynik = await generujOdpowiedz({
    system: zbudujSystem(konfiguracja.prompt, konfiguracja.fakty, przykladyStylu()),
    tekst: p.tresc,
    kontekst: kontekst.tekst,
  });

  logEvent("pytanie_szkic", autor, null, {
    id,
    kategoria: wynik.kategoria,
    kartotek: kontekst.kartoteki.length,
    ofert: kontekst.oferty.length,
  });
  return zapiszSzkic(id, wynik, null);
}

/* ── Wklejka (screenshot albo tekst z poczty) ────────────────────────────── */

const MIME_OBRAZOW = ["image/png", "image/jpeg", "image/webp"];

/** Największy przyjmowany obraz po zdekodowaniu; globalny bodyLimit to 6 MiB. */
const MAX_OBRAZ_B = 4 * 1024 * 1024;

export interface Wklejka {
  tekst?: string;
  /** Base64 obrazu, z przedrostkiem `data:` albo bez. */
  obrazBase64?: string;
  mime?: string;
}

/**
 * Pytanie z wklejki — screenshot z poczty albo przeklejona treść.
 *
 * OBRAZU NIE ZAPISUJEMY. To dane osobowe klienta i kilkaset kilobajtów na
 * wiersz, a wartość ma wyłącznie transkrypcja pytania, która wraca w JSON-ie
 * modelu i ląduje w `tresc`. Ścieżka bez AI nie istnieje: bez transkrypcji
 * z obrazu nie zostałoby nic.
 */
export async function pytanieZWklejki(w: Wklejka, autor: string): Promise<Pytanie> {
  if (aiTryb() === "wylaczone") throw new BladPytania(stanAI().opis, 400);

  const tekst = w.tekst?.trim() || null;
  let obraz: ObrazPytania | undefined;

  if (w.obrazBase64) {
    /* Schowek przeglądarki daje data-URL; API chce sam base64 i osobno typ. */
    const dataUrl = /^data:([^;,]+);base64,(.*)$/s.exec(w.obrazBase64.trim());
    const mime = (dataUrl?.[1] ?? w.mime ?? "").toLowerCase();
    const base64 = (dataUrl?.[2] ?? w.obrazBase64).replace(/\s/g, "");
    if (!MIME_OBRAZOW.includes(mime)) {
      throw new BladPytania(`Nieobsługiwany format obrazu (${mime || "brak"}) — wklej PNG, JPEG albo WEBP`);
    }
    /* Base64 rozdyma dane o jedną trzecią — liczymy rozmiar PO zdekodowaniu,
       bo to on decyduje o tym, co poleci do modelu. */
    if (Math.floor((base64.length * 3) / 4) > MAX_OBRAZ_B) {
      throw new BladPytania("Obraz jest za duży (limit 4 MB) — wklej wycinek samego pytania");
    }
    obraz = { base64, mime };
  }

  if (!tekst && !obraz) throw new BladPytania("Wklej treść pytania albo screenshot");

  const wynik = db()
    .prepare(
      `INSERT INTO pytanie
         (zrodlo, tresc, otrzymano_at, status, produkty_json, utworzono_at, utworzono_przez)
       VALUES ('wklejka', ?, datetime('now'), 'nowe', '[]', datetime('now'), ?)`
    )
    .run(tekst ?? "", autor);
  const id = Number(wynik.lastInsertRowid);

  const p = szczegolPytania(id);
  const kontekst = await kontekstPytania(p);
  const konfiguracja = pobierzKonfiguracje();
  const odpowiedz = await generujOdpowiedz({
    system: zbudujSystem(konfiguracja.prompt, konfiguracja.fakty, przykladyStylu()),
    tekst,
    obraz,
    kontekst: kontekst.tekst,
  });

  logEvent("pytanie_wklejka", autor, null, { id, zObrazem: !!obraz });
  /* Transkrypcja nadpisuje pustą treść tylko wtedy, gdy tekstu nie było — przy
     wklejce tekstowej oryginał klienta jest wierniejszy niż powtórzenie modelu. */
  return zapiszSzkic(id, odpowiedz, tekst ? null : odpowiedz.pytanieKlienta);
}

/* ── Redakcja i wysyłka ──────────────────────────────────────────────────── */

export function zapiszOdpowiedz(id: number, tresc: string, autor?: string): Pytanie {
  const p = szczegolPytania(id);
  const nowa = tresc.trim();
  if (nowa === "") throw new BladPytania("Odpowiedź nie może być pusta");
  /* Redakcja odpowiedzi JEST wzięciem sprawy — reszta biura ma to widzieć. */
  if (autor) stempelProwadzi(id, autor);
  db()
    .prepare(
      `UPDATE pytanie SET odpowiedz = ?, edytowano = ?,
         status = CASE WHEN status = 'nowe' THEN 'szkic' ELSE status END
       WHERE id = ?`
    )
    /* „Bez edycji" znaczy DOSŁOWNIE tyle, że wysłaliśmy szkic modelu co do
       znaku — inaczej wskaźnik jakości szkiców mierzyłby sam siebie. */
    .run(nowa, p.szkicAi !== null && nowa === p.szkicAi.trim() ? 0 : 1, id);
  return szczegolPytania(id);
}

/** Zapisuje potwierdzone pary maszyna→część z wysłanej odpowiedzi. */
function utrwalDopasowania(p: Pytanie, autor: string): void {
  if (p.kategoria !== "dobor-czesci" || !p.urzadzenie) return;
  const wstaw = db().prepare(
    `INSERT OR IGNORE INTO dopasowanie
       (urzadzenie, symbol, tw_id, pytanie_id, potwierdzono_at, potwierdzono_przez)
     VALUES (?, ?, ?, ?, datetime('now'), ?)`
  );
  for (const produkt of p.produkty) {
    wstaw.run(p.urzadzenie, produkt.symbol, produkt.twId, p.id, autor);
  }
}

export interface WynikWysylki {
  pytanie: Pytanie;
  /** Następne otwarte pytanie — panel otwiera je sam („skrzynka do zera"). */
  nastepneId: number | null;
}

export async function wyslijOdpowiedz(id: number, autor: string): Promise<WynikWysylki> {
  const p = szczegolPytania(id);
  if (!p.threadId) {
    throw new BladPytania(
      "To pytanie przyszło z wklejki — skopiuj odpowiedź i wyślij ją w Centrum wiadomości Allegro"
    );
  }
  if (p.status === "wyslane") throw new BladPytania("Odpowiedź na to pytanie już poszła", 409);
  const tresc = (p.odpowiedz ?? "").trim();
  if (tresc === "") throw new BladPytania("Najpierw wygeneruj albo napisz odpowiedź");
  if (tresc.length > LIMIT_WIADOMOSCI) {
    throw new BladPytania(
      `Odpowiedź ma ${tresc.length} znaków, a Allegro przyjmuje do ${LIMIT_WIADOMOSCI} — skróć ją`
    );
  }

  const adapter = allegroAdapter();
  await adapter.wyslijWiadomosc(p.threadId, tresc);
  /* Wiadomość JUŻ POSZŁA. Nieudane odhaczenie wątku jest kosmetyką po stronie
     panelu Allegro — udawanie porażki kazałoby biuru wysłać to samo drugi raz. */
  try {
    await adapter.oznaczPrzeczytany(p.threadId);
  } catch (e) {
    console.error("[pytania] nie udało się odhaczyć wątku:", e instanceof Error ? e.message : e);
  }

  db()
    .prepare(
      `UPDATE pytanie SET status = 'wyslane', wyslano_at = datetime('now'), odpowiedzial = ?,
              prowadzi = NULL, prowadzi_at = NULL
       WHERE id = ?`
    )
    .run(autor, id);
  utrwalDopasowania(p, autor);
  logEvent("pytanie_wyslane", autor, null, {
    id,
    edytowano: p.edytowano,
    kategoria: p.kategoria,
    znakow: tresc.length,
  });

  return { pytanie: szczegolPytania(id), nastepneId: nastepneOtwarte(id) };
}

/** Zdejmuje pytanie z listy: `zamkniete` = załatwione poza aplikacją. */
export function zmienStatus(id: number, status: "zamkniete" | "pominiete", autor: string): WynikWysylki {
  const p = szczegolPytania(id);
  if (p.status === "wyslane") throw new BladPytania("Odpowiedź już poszła — nie ma czego zamykać", 409);
  db()
    .prepare(
      "UPDATE pytanie SET status = ?, odpowiedzial = ?, prowadzi = NULL, prowadzi_at = NULL WHERE id = ?"
    )
    .run(status, autor, id);
  logEvent(`pytanie_${status}`, autor, null, { id });
  return { pytanie: szczegolPytania(id), nastepneId: nastepneOtwarte(id) };
}

/**
 * Kto prowadzi sprawę — stemplowane PRACĄ nad nią, nie jej otwarciem.
 *
 * Panel biura ma twardą regułę od 0.18.0: żadnego zapisu przy samym PATRZENIU
 * na ekran (patrz `routes/biuro.test.ts` i zakaz `POST .../open`). Znacznik
 * prowadzącego nie jest od niej wyjątkiem, więc nie stawia własnego przycisku
 * ani nie strzela przy wejściu w sprawę: nazwisko pojawia się wtedy, gdy ktoś
 * policzy szkic albo zapisze odpowiedź, czyli przy zapisie, który i tak
 * następuje. Kto tylko zajrzał, niczego nie zajmuje.
 *
 * Stempluje TYLKO praca nad jedną sprawą — nie zbiorcze liczenie szkiców.
 * Ticker liczy je pod nazwą procesu, a ODŚWIEŻ hurtem po pięć: jedno wstawiłoby
 * do kolumny nazwę usługi, drugie zajęłoby pięć spraw komuś, kto kliknął
 * „sprawdź, co przyszło".
 *
 * ZNACZNIK, nie zamek. Twarda blokada w kilkuosobowym biurze przeszkadza
 * częściej, niż pomaga — ktoś wychodzi na obiad z otwartą sprawą i nikt jej
 * nie dokończy. Ostrzeżenie na ekranie wystarcza, żeby dwie osoby nie pisały
 * równolegle, a ostatni pracujący po prostu podmienia nazwisko.
 */
export function stempelProwadzi(id: number, autor: string): void {
  db()
    .prepare("UPDATE pytanie SET prowadzi = ?, prowadzi_at = datetime('now') WHERE id = ?")
    .run(autor, id);
}

/* ── Ticker ──────────────────────────────────────────────────────────────── */

/** Szkice dla wszystkiego, co ich nie ma. Zwraca liczbę policzonych. */
export async function dogenerujSzkice(autor: string, limit = 20): Promise<number> {
  if (aiTryb() === "wylaczone") return 0;
  const czekajace = db()
    .prepare("SELECT id FROM pytanie WHERE status = 'nowe' ORDER BY id ASC LIMIT ?")
    .all(limit) as Array<{ id: number }>;

  let policzonych = 0;
  for (const { id } of czekajace) {
    try {
      await generujSzkic(id, autor);
      policzonych++;
    } catch (e) {
      /* Awaria modelu na jednym pytaniu nie ma prawa zatrzymać reszty ani
         przebiegu. Wiersz zostaje w `nowe`, więc panel pokaże przy nim
         przycisk GENERUJ i człowiek spróbuje ręką. */
      console.error(`[pytania] szkic dla #${id} nieudany:`, e instanceof Error ? e.message : e);
    }
  }
  return policzonych;
}

/**
 * Pętla synchronizacji pytań — wołana z `main()`, nigdy z `buildApp()`
 * (testy tras nie mają prawa strzelać do Allegro ani do modelu).
 *
 * Dzieli interwał z zapowiedziami zwrotów (`ALLEGRO_POLL_MS`): to ten sam
 * rodzaj pracy w tle na tym samym koncie i osobne pokrętło niczego by nie
 * dostroiło, a dołożyłoby drugie miejsce do pomylenia.
 */
export function uruchomTickerPytan(): void {
  if (config.zwroty.pollMs <= 0) return;
  const przebieg = () => {
    /* Przebieg tylko przy sensownym stanie konta — dev zawsze, http dopiero
       po sparowaniu. Bez tego log zapełniałby się co pięć minut błędem
       o brakującym tokenie na instalacji, która pytań w ogóle nie używa
       (dokładnie ten sam strażnik co w tickerze zapowiedzi). */
    const stan = stanPolaczenia().stan;
    if (stan !== "dev" && stan !== "polaczone") return;
    /* Bez modelu zostaje sama synchronizacja: lista czekających pytań ma
       wartość także wtedy, gdy szkiców nie ma kto napisać. */
    synchronizujPytania("ticker")
      .then(async ({ nowych }) => {
        if (nowych > 0) console.log(`[pytania] nowych pytań klientów: ${nowych}`);
        const szkicow = await dogenerujSzkice("ticker");
        if (szkicow > 0) console.log(`[pytania] szkiców przygotowanych: ${szkicow}`);
      })
      .catch((e) =>
        console.error("[pytania] przebieg nieudany:", e instanceof Error ? e.message : e)
      );
  };
  przebieg();
  setInterval(przebieg, config.zwroty.pollMs);
}

/* ── Statystyki ──────────────────────────────────────────────────────────── */

export const OKNA_DNI = [30, 90, 180] as const;

export function oknoDniPytan(raw: unknown): number {
  const n = Number(raw);
  return (OKNA_DNI as readonly number[]).includes(n) ? n : 90;
}

export interface StatystykiPytan {
  dni: number;
  produkty: Array<{
    twId: number | null;
    symbol: string;
    nazwa: string;
    pytan: number;
    /** Ile leży na magazynach widocznych dla biura; null = towar spoza kartoteki. */
    stan: number | null;
    jednostka: string | null;
  }>;
  kategorie: Array<{ kategoria: string; ile: number }>;
  tygodnie: Array<{ tydzien: string; ile: number }>;
  /** Mediana czasu od pytania do wysłanej odpowiedzi, w godzinach. */
  medianaGodzin: number | null;
  wyslanych: number;
  bezEdycji: number;
  pozaOferta: Array<{
    id: number;
    tresc: string;
    otrzymanoAt: string | null;
    /** Model maszyny wyłuskany z pytania — bez niego lista to sam wolny tekst. */
    urzadzenie: string | null;
  }>;
  /** Dopasowania potwierdzone ręką w tym oknie — praca, która zostaje na potem. */
  potwierdzonychDopasowan: number;
  /**
   * Tydzień szczytowy i jego tło, pod zdanie interpretujące. `null`, gdy próbka
   * jest za cienka, żeby cokolwiek twierdzić — patrz `wyliczSzczyt`.
   */
  szczyt: { tydzien: string; ile: number; medianaPozostalych: number; kategoria: string | null } | null;
  /**
   * Najświeższe pytanie, które zestawienie obejmuje. Pasek filtrów pisze z tego
   * „Dane do…": zegar serwera powiedziałby tylko, że zapytanie właśnie poszło,
   * a to zdanie ma mówić, czy synchronizacja z Allegro stoi.
   */
  daneDo: string | null;
  /** Kto odpisywał w tym oknie — pod filtr OSOBA w pasku ANALIZY. */
  osoby: string[];
  /** Wybrana osoba albo `null`. Karta mówi wtedy, czego filtr NIE obejmuje. */
  osoba: string | null;
}

/**
 * O co klienci pytają — i czego u nas nie ma.
 *
 * Okno liczy się od `otrzymano_at`, czyli od chwili, gdy klient napisał.
 * Ostatnia sekcja jest tu najcenniejsza: lista pytań o towar SPOZA oferty to
 * najtańszy research asortymentu, jaki firma może mieć — ktoś już chciał
 * kupić, a my nie mieliśmy co sprzedać.
 */
/*
 * Filtr OSOBA obejmuje WYŁĄCZNIE to, co da się komuś przypisać: wysłane
 * odpowiedzi, ich medianę czasu i udział szkiców bez poprawki. Pytania
 * przychodzą od klientów i nie mają autora po naszej stronie, dopóki ktoś
 * na nie nie odpisze — „najczęściej pytane towary per osoba" byłoby liczbą
 * bez desygnatu. Te przekroje zostają globalne, a karta mówi o tym wprost.
 */
export function statystykiPytan(dni: number, osoba?: string | null): StatystykiPytan {
  const d = db();
  const odKiedy = `-${dni} days`;
  const kto = osoba?.trim() || null;
  const iOsoba = kto ? " AND odpowiedzial = ?" : "";
  /** Parametry zapytania przypisywalnego: okno, a po nim osoba, jeśli wybrana. */
  const zOsoba = (...a: unknown[]) => (kto ? [...a, kto] : a);

  const produkty = (
    d
      .prepare(
        `SELECT json_extract(j.value, '$.twId') AS tw_id,
                json_extract(j.value, '$.symbol') AS symbol,
                COALESCE(t.nazwa, '') AS nazwa,
                COUNT(*) AS pytan
         FROM pytanie p, json_each(p.produkty_json) j
         LEFT JOIN sgt_towar t ON t.tw_id = json_extract(j.value, '$.twId')
         WHERE p.otrzymano_at >= datetime('now', ?)
         GROUP BY symbol
         ORDER BY pytan DESC, symbol
         LIMIT 20`
      )
      .all(odKiedy) as Array<Record<string, unknown>>
  ).map((w) => ({
    twId: (w.tw_id as number) ?? null,
    symbol: (w.symbol as string) ?? "",
    nazwa: w.nazwa as string,
    pytan: w.pytan as number,
  }));

  /* Ile tego leży — kolumna STAN przy najczęściej pytanych towarach. Bez niej
     lista mówi „pytają o to dwadzieścia razy" i nie mówi, czy jest co sprzedać;
     to dwa różne wnioski zakupowe. `stanyNiezerowe` bierze KOMPLET jednym
     zapytaniem i pomija magazyny ukryte przez biuro — reguła widoczności ma
     jednego właściciela i nie kopiujemy jej tutaj. */
  const stany = stanyNiezerowe(produkty.flatMap((p) => (p.twId == null ? [] : [p.twId])));
  const jednostki = new Map(
    produkty.flatMap((p) => (p.twId == null ? [] : [[p.twId, null as string | null]]))
  );
  if (jednostki.size > 0) {
    for (const w of d
      .prepare(
        `SELECT tw_id, unit FROM sgt_towar
          WHERE tw_id IN (${[...jednostki.keys()].map(() => "?").join(",")})`
      )
      .all(...[...jednostki.keys()]) as Array<{ tw_id: number; unit: string }>) {
      jednostki.set(w.tw_id, w.unit);
    }
  }
  const produktyZeStanem = produkty.map((p) => ({
    ...p,
    /* Towar spoza kartoteki dostaje `null`, nie zero: „nie mamy ani sztuki"
       i „nie wiemy, o czym mowa" to dwie różne odpowiedzi, a zero mówi
       pierwszą z nich w sytuacji drugiej. */
    stan:
      p.twId == null
        ? null
        : (stany.get(p.twId) ?? []).reduce((suma, m) => suma + m.stan, 0),
    jednostka: p.twId == null ? null : (jednostki.get(p.twId) ?? "szt."),
  }));

  const kategorie = d
    .prepare(
      `SELECT COALESCE(NULLIF(kategoria, ''), 'nieokreślone') AS kategoria, COUNT(*) AS ile
       FROM pytanie WHERE otrzymano_at >= datetime('now', ?)
       GROUP BY kategoria ORDER BY ile DESC`
    )
    .all(odKiedy) as Array<{ kategoria: string; ile: number }>;

  /* Tygodnie z kalendarza, nie z danych: tydzień bez ani jednego pytania ma
     zostać na osi jako zero, inaczej wykres kłamie o ciągłości (ten sam
     zabieg co w statystykach zwrotów). */
  const liczby = new Map(
    (
      d
        .prepare(
          `SELECT strftime('%Y-%W', otrzymano_at) AS tydzien, COUNT(*) AS ile
           FROM pytanie WHERE otrzymano_at >= datetime('now', ?) GROUP BY tydzien`
        )
        .all(odKiedy) as Array<{ tydzien: string; ile: number }>
    ).map((w) => [w.tydzien, w.ile])
  );
  const tygodnie = (
    d
      .prepare(
        `WITH RECURSIVE kalendarz(dzien) AS (
           SELECT date('now', ?)
           UNION ALL SELECT date(dzien, '+1 day') FROM kalendarz WHERE dzien < date('now')
         )
         SELECT DISTINCT strftime('%Y-%W', dzien) AS tydzien FROM kalendarz ORDER BY tydzien`
      )
      .all(odKiedy) as Array<{ tydzien: string }>
  ).map((w) => ({ tydzien: w.tydzien, ile: liczby.get(w.tydzien) ?? 0 }));

  /* Mediana, nie średnia: jedno pytanie odpowiedziane po urlopie przesunęłoby
     średnią o dobę i schowało fakt, że reszta idzie w kwadrans. */
  const czasy = (
    d
      .prepare(
        `SELECT (julianday(wyslano_at) - julianday(otrzymano_at)) * 24 AS godzin
         FROM pytanie
         WHERE status = 'wyslane' AND zrodlo = 'allegro'
           AND otrzymano_at IS NOT NULL AND wyslano_at >= datetime('now', ?)${iOsoba}
         ORDER BY godzin`
      )
      .all(...(zOsoba(odKiedy) as never[])) as Array<{ godzin: number }>
  )
    .map((w) => w.godzin)
    .filter((g) => Number.isFinite(g) && g >= 0);
  const medianaGodzin =
    czasy.length === 0
      ? null
      : Math.round(
          (czasy.length % 2 === 1
            ? czasy[(czasy.length - 1) / 2]
            : (czasy[czasy.length / 2 - 1] + czasy[czasy.length / 2]) / 2) * 10
        ) / 10;

  const wysylki = d
    .prepare(
      `SELECT COUNT(*) AS wyslanych, SUM(CASE WHEN edytowano = 0 THEN 1 ELSE 0 END) AS bez
       FROM pytanie WHERE status = 'wyslane' AND wyslano_at >= datetime('now', ?)${iOsoba}`
    )
    .get(...(zOsoba(odKiedy) as never[])) as { wyslanych: number; bez: number | null };

  /* Kto w tym oknie odpisywał — listę podaje serwer, bo tylko on to wie.
     Pusta przy oknie bez wysyłek i wtedy filtr w pasku nie ma czego oferować. */
  const osoby = (
    d
      .prepare(
        `SELECT DISTINCT odpowiedzial FROM pytanie
          WHERE odpowiedzial IS NOT NULL AND status = 'wyslane'
            AND wyslano_at >= datetime('now', ?)
          ORDER BY odpowiedzial`
      )
      .all(odKiedy) as Array<{ odpowiedzial: string }>
  ).map((w) => w.odpowiedzial);

  const pozaOferta = (
    d
      .prepare(
        `SELECT id, tresc, otrzymano_at, urzadzenie FROM pytanie
         WHERE w_ofercie = 0 AND otrzymano_at >= datetime('now', ?)
         ORDER BY otrzymano_at DESC LIMIT 20`
      )
      .all(odKiedy) as Array<Record<string, unknown>>
  ).map((w) => ({
    id: w.id as number,
    tresc: w.tresc as string,
    otrzymanoAt: tekstLubNull(w.otrzymano_at),
    urzadzenie: tekstLubNull(w.urzadzenie),
  }));

  /* Potwierdzone dopasowania maszyna→część. Ma AUTORA (`potwierdzono_przez`),
     więc jako jedyny z przekrojów produktowych wchodzi pod filtr OSOBA —
     w odróżnieniu od pytań, które przychodzą od klientów i autora po naszej
     stronie nie mają. To praca, która zostaje: każde kolejne pytanie o tę samą
     maszynę zaczyna się od gotowej odpowiedzi, a nie od zera. */
  const dopasowania = d
    .prepare(
      `SELECT COUNT(*) AS ile FROM dopasowanie
        WHERE potwierdzono_at >= datetime('now', ?)${kto ? " AND potwierdzono_przez = ?" : ""}`
    )
    .get(...(zOsoba(odKiedy) as never[])) as { ile: number };

  const daneDo = tekstLubNull(
    (
      d.prepare("SELECT MAX(otrzymano_at) AS ost FROM pytanie").get() as {
        ost: string | null;
      }
    ).ost
  );

  return {
    dni,
    produkty: produktyZeStanem,
    kategorie,
    tygodnie,
    medianaGodzin,
    wyslanych: wysylki.wyslanych,
    bezEdycji: wysylki.bez ?? 0,
    pozaOferta,
    osoby,
    osoba: kto,
    potwierdzonychDopasowan: dopasowania.ile,
    szczyt: wyliczSzczyt(tygodnie, odKiedy),
    daneDo,
  };
}

/**
 * Tydzień szczytowy i jego tło — materiał na jedno zdanie pod wykresem.
 *
 * Makieta pisze tu zdanie w rodzaju „szczyt zbiega się z sezonem kosiarek".
 * Drugiej połowy takiego zdania NIE DA SIĘ policzyć: „sezon kosiarek" jest
 * sądem człowieka, a nie liczbą w bazie, i wypisanie go z automatu byłoby
 * zmyśleniem podanym w tonie wniosku. Zwracamy więc same fakty, które wykres
 * i tak pokazuje, a zdanie składa z nich strona.
 *
 * `null` przy próbce zbyt cienkiej, żeby cokolwiek twierdzić — mniej niż trzy
 * tygodnie albo szczyt nieodstający od reszty. Zdanie „szczyt jest w W31,
 * a w pozostałych tygodniach jest tyle samo" nie jest obserwacją, tylko szumem
 * w miejscu, w którym czytelnik spodziewa się wniosku.
 */
function wyliczSzczyt(
  tygodnie: Array<{ tydzien: string; ile: number }>,
  odKiedy: string
): StatystykiPytan["szczyt"] {
  if (tygodnie.length < 3) return null;
  const szczyt = tygodnie.reduce((a, b) => (b.ile > a.ile ? b : a));
  if (szczyt.ile === 0) return null;

  const reszta = tygodnie.filter((t) => t !== szczyt).map((t) => t.ile).sort((a, b) => a - b);
  const mediana =
    reszta.length % 2 === 1
      ? reszta[(reszta.length - 1) / 2]
      : (reszta[reszta.length / 2 - 1] + reszta[reszta.length / 2]) / 2;
  /* Próg 1,5×: niżej to normalne falowanie tygodnia, a nie szczyt. */
  if (mediana > 0 && szczyt.ile < mediana * 1.5) return null;

  const wiodaca = db()
    .prepare(
      `SELECT COALESCE(NULLIF(kategoria, ''), 'nieokreślone') AS kategoria, COUNT(*) AS ile
         FROM pytanie
        WHERE otrzymano_at >= datetime('now', ?) AND strftime('%Y-%W', otrzymano_at) = ?
        GROUP BY kategoria ORDER BY ile DESC LIMIT 1`
    )
    .get(odKiedy, szczyt.tydzien) as { kategoria: string; ile: number } | undefined;

  return {
    tydzien: szczyt.tydzien,
    ile: szczyt.ile,
    medianaPozostalych: Math.round(mediana * 10) / 10,
    /* Kategoria wchodzi do zdania tylko wtedy, gdy naprawdę DOMINUJE w tym
       tygodniu. Przy rozkładzie po równo „wiodąca" jest artefaktem sortowania. */
    kategoria: wiodaca && wiodaca.ile * 2 > szczyt.ile ? wiodaca.kategoria : null,
  };
}
