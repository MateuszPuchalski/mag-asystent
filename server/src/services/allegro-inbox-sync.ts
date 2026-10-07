import { config } from "../config.js";
import { db as defaultDb, transaction, type Db } from "../db/db.js";
import {
  AKCEPT_BETA, urlWatku, urlWatkow, urlWatkowBeta, urlWiadomosci, zapytajAllegro,
} from "../adapters/allegro.http.js";
import { stanSynchronizacji } from "./allegro-inbox-sync-state.js";
import { BladLimituAllegro, BladOdpowiedziAllegro } from "../adapters/allegro.js";
import { publishConversationEvent } from "./conversation-realtime.js";
import { logEvent } from "./events.js";
import { flagaAutoodpowiedzi, obudzPrzychodzaca } from "./conversations.js";
import { odkodujEncje } from "../tekst.js";
import { kontoKanalu } from "./kanal-konto.js";
import { zapiszZalaczniki } from "./zalaczniki-wiadomosci.js";
import { ROLE_ALLEGRO } from "./glos-allegro.js";

/* Kształt ze SPECYFIKACJI Allegro — patrz docs/allegro-ksztalt.md. Do 0.151.0
   stały tu nazwy wymyślone razem z kodem (`lastMessageDate`, `author.role`,
   `relatedObject`) i przez to skrzynka nie zapisała ani jednego wątku:
   `undefined` na trzecim parametrze wstawki wywracał każdy z nich.
   Pola, których świadomie nie mapujemy, są wymienione w kontrakcie —
   `surowe_json` i tak trzyma całą odpowiedź. Wyjątek: wątek z `beta.v1`
   idzie tam bez `participants`, bo loginów uczestników nie zapisujemy. */
type Thread = { id: string; read: unknown; lastMessageDateTime?: string | null;
  interlocutor?: { login: string } | null;
  /** Tylko wątek z listy `beta.v1` — patrz `watekZBety`. */
  beta?: WatekBeta };
type Message = { id: string; author: { login: string; isInterlocutor: unknown };
  text: string; subject?: string | null; status?: string; createdAt: string;
  relatesTo?: { offer?: { id: string } | null; order?: { id: string } | null } | null;
  attachments?: Array<{ fileName: string; mimeType?: string; url?: string; status: string }>;
  /** `author.role` z `beta.v1`, dosłownie. Wiadomość z `public.v1` roli nie ma. */
  rola?: string | null;
  /** Odpowiedź Allegro w kształcie, w jakim przyszła — do `surowe_json`. */
  surowe?: unknown };

/** Część wątku `beta.v1`, której nie ma w kształcie wspólnym obu wersji. */
interface WatekBeta {
  struktura: StrukturaWatku | null;
  /** `participants` — do rozmówcy i do rozpoznania naszych wiadomości, nie do bazy. */
  uczestnicy: Array<{ rola: string; login: string }>;
  surowe: unknown;
}

/** Typ wątku Problemu z zakupem w `ThreadVBeta1.type`. */
export const PROBLEM_Z_ZAKUPEM = "POST_PURCHASE_ISSUE";

/* Schemat mówi `type: boolean`, ale opublikowany PRZYKŁAD renderuje `read`
   jako tekst („false"). Ta funkcja przyjmuje obie postaci — kosztuje trzy
   linijki, a broni przed rozbieżnością, którą Allegro ma we własnej
   dokumentacji. Wszystko inne jest błędem wątku, nie zgadniętym zerem: po
   0.149.2 taki wątek zostaje pominięty, a przebieg leci dalej. */
function flaga(wartosc: unknown, pole: string): boolean {
  if (typeof wartosc === "boolean") return wartosc;
  if (wartosc === "true") return true;
  if (wartosc === "false") return false;
  throw new Error(`Pole ${pole} ma nieoczekiwaną postać: ${JSON.stringify(wartosc)}`);
}

/* Kod bierze się z KLASY błędu, nie z jego zdania. Do 0.149.0 stało tu
   wyrażenie szukające kodu w nawiasie — łapało „(401)", ale nie „Allegro
   odpowiedziało 503: …", więc status synchronizacji milczał akurat przy
   odmowach, które sam ma nazywać. */
const kodHttp = (error: unknown): number | null =>
  error instanceof BladOdpowiedziAllegro ? error.status : null;

function tablica<T>(value: unknown, pole: string): T[] {
  if (!value || typeof value !== "object" || !Array.isArray((value as Record<string, unknown>)[pole])) {
    throw new Error(`Odpowiedź Allegro nie ma tablicy ${pole} opisanej w docs/allegro-ksztalt.md`);
  }
  return (value as Record<string, unknown>)[pole] as T[];
}

/* ── Sufit stron w jednym przebiegu (0.164.1) ────────────────────────────────
   POWSTAŁO PO 316 TYSIĄCACH ŻĄDAŃ W CIĄGU DOBY. Skrzynka była jedyną z czterech
   pętli Allegro bez ogranicznika: zwroty mają `MAKS_STRON`, rabaty mają,
   zamówienia mają `NA_PRZEBIEG`, a tutaj przebieg szedł tyle stron, ile
   Allegro miało do oddania. Przy niesparowanym kursorze i szerokiej granicy
   znaczyło to całą historię konta — co minutę, przez siedem godzin.

   Sufit jest BEZPIECZNY, bo lista przychodzi posortowana po dacie ostatniej
   wiadomości, od najnowszej (specyfikacja: „sorted by last message date,
   starting from newest"). Wątek, w którym coś się dzieje, wskakuje na górę.
   Zejść pod sufit może więc wyłącznie rozmowa, w której nic się nie zmieniło
   od 500 nowszych wątków — a takiej nie ma czego dociągać.

   Sufit odcina teraz wyłącznie prawdziwą zaległość: kursor jest progiem daty,
   więc kolejna wiadomość w najnowszym wątku kończy przebieg na pierwszej stronie.

   CZEGO SUFIT NIE GWARANTUJE: gdyby między dwoma przebiegami przybyło ponad
   500 wątków z nowymi wiadomościami, te spod sufitu poczekają do następnego
   przebiegu. Przy takcie 60 s to jest ruch, którego ta firma nie generuje —
   ale to jest założenie, nie prawo, i dlatego stoi tu wypisane. */
const MAKS_STRON = 25;

/* Drugi argument niesie wymuszoną wersję zasobu. Atrapa w teście może go
   pominąć, a wtedy dostaje wyłącznie żądania w `public.v1`. */
type InboxQuery = (url: string, opcje?: { akcept?: typeof AKCEPT_BETA }) => Promise<unknown | null>;

/** Struktura wątku z `beta.v1` — tylko pola, po które przychodzimy. */
export interface StrukturaWatku {
  typ: string;
  podtyp: string | null;
  status: string | null;
  zamowienia: string[];
}

/** Odczyt struktury jednego wątku; `null` = Allegro nic nie oddało. */
export type OdczytStruktury = (threadId: string) => Promise<unknown | null>;

/**
 * Kształt `ThreadVBeta1` ze specyfikacji: `type` wymagany, `subType`
 * i `orders` opcjonalne. Wartości spoza znanego słownika ZOSTAJĄ, jak
 * przyszły (specyfikacja klasyfikacji: „preserve unknown values") — o tym,
 * czy je rozumiemy, rozstrzyga rejestr mapowań, nie synchronizacja.
 * Odpowiedź bez `type` to odpowiedź nie w tym kształcie: zwracamy `null`.
 */
export function strukturaZOdpowiedzi(x: unknown): StrukturaWatku | null {
  if (!x || typeof x !== "object") return null;
  const o = x as Record<string, unknown>;
  if (typeof o.type !== "string" || !o.type) return null;
  const zamowienia = Array.isArray(o.orders)
    ? o.orders.map((z) => (z && typeof z === "object" ? (z as { id?: unknown }).id : null))
      .filter((id): id is string => typeof id === "string" && id !== "")
    : [];
  return {
    typ: o.type,
    podtyp: typeof o.subType === "string" && o.subType ? o.subType : null,
    status: typeof o.status === "string" ? o.status : null,
    zamowienia,
  };
}

const tekstLubNull = (v: unknown): string | null => typeof v === "string" && v !== "" ? v : null;

/** Login porównuje się bez wielkości liter — zasada z `docs/allegro-ksztalt.md`. */
const tenSamLogin = (a: string | null | undefined, b: string | null | undefined): boolean =>
  !!a && !!b && a.toLocaleLowerCase("pl") === b.toLocaleLowerCase("pl");

/**
 * Wątek z listy `beta.v1` w kształcie, który zapisuje przebieg.
 *
 * Rozmówcy tu NIE MA: `ThreadVBeta1` zamiast `interlocutor` niesie listę
 * `participants`, a w zwykłym wątku obie strony mogą mieć rolę `USER`.
 * Rozmówcę wylicza `rozmowcaWatku`, gdy wiadomości są już przeczytane.
 * Do `surowe_json` idzie wątek BEZ `participants` — loginów uczestników
 * nie zapisujemy (`docs/obsluga-klienta.md`).
 */
export function watekZBety(x: Record<string, unknown>): Thread {
  const uczestnicy = (Array.isArray(x.participants) ? x.participants : [])
    .map((u) => u && typeof u === "object" ? u as Record<string, unknown> : {})
    .flatMap((u) => typeof u.role === "string" && tekstLubNull(u.login)
      ? [{ rola: u.role, login: String(u.login) }] : []);
  const { participants: _pominiete, ...bezUczestnikow } = x;
  return {
    id: x.id as string, read: x.read,
    lastMessageDateTime: typeof x.lastMessageDateTime === "string" ? x.lastMessageDateTime : null,
    interlocutor: null,
    beta: { struktura: strukturaZOdpowiedzi(x), uczestnicy, surowe: bezUczestnikow },
  };
}

/**
 * Wiadomość z `beta.v1` w kształcie `public.v1`, na którym stoi zapis.
 *
 * KIERUNEK Z ROLI, nie z `isInterlocutor`, którego beta nie ma. Nasza jest
 * wiadomość z rolą `SELLER` albo z loginem uczestnika-sprzedawcy wątku —
 * drugi warunek łapie rolę `USER`, gdyby Allegro dało ją także nam. Każda
 * inna rola (kupujący, doradca, Allegro) to strona, która NIE jest nami.
 * Rola nie będąca tekstem zostawia `isInterlocutor` pusty, a `flaga()` przy
 * zapisie pomija wtedy wątek, zamiast zgadywać kierunek.
 */
export function wiadomoscZBety(x: Record<string, unknown>, sprzedawca: string | null): Message {
  const autor = x.author && typeof x.author === "object" ? x.author as Record<string, unknown> : {};
  const rola = typeof autor.role === "string" ? autor.role : null;
  const login = tekstLubNull(autor.login);
  return {
    ...(x as unknown as Message),
    /* `author.login` jest w `beta.v1` nullable — wiadomość od Allegro go
       nie ma. Lądowisko trzyma pusty napis, a rolę niesie `surowe_json`. */
    author: { login: login ?? "",
      isInterlocutor: rola === null ? undefined : !(rola === "SELLER" || tenSamLogin(login, sprzedawca)) },
    rola, surowe: x,
  };
}

/**
 * Rozmówca wątku z `beta.v1` — kupujący, czyli klucz klienta.
 *
 * Kolejno: uczestnik z rolą `BUYER`; jedyny uczestnik, który nie jest
 * sprzedawcą i nie pisał naszych wiadomości; jedyny uczestnik, który pisał
 * wiadomości przychodzące. Rozmówcą może być wyłącznie UCZESTNIK — doradca
 * Allegro pisze w wątku, ale nim nie jest. Gdy nic nie rozstrzyga, `null`,
 * a zapis zostawia login z poprzedniego przebiegu. Zgadnięty login
 * przypiąłby rozmowę cudzemu klientowi.
 */
export function rozmowcaWatku(
  uczestnicy: Array<{ rola: string; login: string }>, wiadomosci: Message[],
): string | null {
  const kupujacy = uczestnicy.find((u) => u.rola === "BUYER");
  if (kupujacy) return kupujacy.login;
  /* Ta sama tolerancja co w `flaga()`: przykład Allegro renderuje flagi
     tekstem. Tu nie rzucamy — nieczytelna flaga po prostu nie rozstrzyga. */
  const kierunek = (v: unknown) => v === true || v === "true" ? true : v === false || v === "false" ? false : null;
  const pisal = (przychodzaca: boolean, login: string) => wiadomosci.some((m) =>
    kierunek(m.author.isInterlocutor) === przychodzaca && tenSamLogin(m.author.login, login));
  const kandydaci = uczestnicy.filter((u) => u.rola !== "SELLER" && !pisal(false, u.login));
  if (kandydaci.length === 1) return kandydaci[0]!.login;
  const piszacy = kandydaci.filter((u) => pisal(true, u.login));
  return piszacy.length === 1 ? piszacy[0]!.login : null;
}

/*
 * Wstrzymanie bety po odmowie. Konto bez dostępu do `beta.v1` (406) albo
 * bez uprawnienia (403) odmówi tak samo przy każdym żądaniu, a specyfikacja
 * mówi wprost, że dostępność bety trzeba sprawdzić na koncie — tu jest
 * `[WERYFIKUJ]`. Jedno wstrzymanie dla listy i dla pojedynczego wątku, bo
 * odmowa opisuje konto, nie końcówkę. DECYZJA żyje w pamięci procesu:
 * restart to naturalna chwila, żeby spróbować jeszcze raz. Baza trzyma
 * tylko kopię dla panelu (`beta_wstrzymana_do`), czytaną bez skutków.
 */
const WSTRZYMANIE_PO_ODMOWIE_MS = 6 * 3_600_000;
const WSTRZYMANIE_PO_LIMICIE_MS = 15 * 60_000;
let betaWstrzymanaDo = 0;

/** Wyłącznie dla testów: zdjęcie wstrzymania między przypadkami. */
export function _zdejmijWstrzymanieStruktury(): void {
  betaWstrzymanaDo = 0;
}

/** Odmowa wersji zasobu albo uprawnienia — ta, po której beta czeka sześć godzin. */
const odmowaBety = (e: unknown): boolean =>
  kodHttp(e) === 403 || /406\/415/.test(String((e as Error)?.message));

/**
 * Co zrobić, gdy PIERWSZA strona listy bety się nie udała.
 *
 * `przerwij` — 401, limit i brak sieci: `public.v1` skończyłoby tak samo,
 * a przebieg ma zapisać prawdziwy powód porażki. `przebieg` — błąd serwera
 * Allegro: ten jeden przebieg idzie `public.v1`, następny spróbuje bety
 * znowu. `wstrzymaj` — każda inna odmowa i inny kształt odpowiedzi: powtórzy
 * się przy każdym przebiegu, więc beta czeka sześć godzin.
 */
function poOdmowieListy(e: unknown): "przerwij" | "przebieg" | "wstrzymaj" {
  if (e instanceof BladLimituAllegro) return "przerwij";
  const kod = kodHttp(e);
  if (kod === 401) return "przerwij";
  if (kod !== null) return kod >= 500 ? "przebieg" : "wstrzymaj";
  const tresc = e instanceof Error ? e.message : String(e);
  return /406\/415|nextPage|tablicy threads/.test(tresc) ? "wstrzymaj" : "przerwij";
}

function wstrzymajBete(database: Db, teraz: Date, e: unknown, co: string): void {
  betaWstrzymanaDo = teraz.getTime() + WSTRZYMANIE_PO_ODMOWIE_MS;
  const tekst = e instanceof Error ? e.message : String(e);
  /* Głośno RAZ na wstrzymanie, nie przy każdym wątku: odmowa opisuje
     konto, nie wątek. */
  console.warn(`[allegro-inbox] ${co} z beta.v1 wstrzymana na 6 h:`, tekst);
  /* I w bazie, bo dziennik serwera czyta tylko admin, a brak Problemów
     z zakupem ma zobaczyć biuro (`stanProblemowZakupu`). Obcięcie chroni
     kolumnę przed odpowiedzią Allegro wklejoną w całości. */
  database.prepare(`INSERT INTO allegro_inbox_sync_state(id, beta_wstrzymana_do, beta_powod)
    VALUES (1,?,?) ON CONFLICT(id) DO UPDATE SET beta_wstrzymana_do=excluded.beta_wstrzymana_do,
    beta_powod=excluded.beta_powod`).run(new Date(betaWstrzymanaDo).toISOString(), tekst.slice(0, 300));
}

export interface InboxSyncDeps {
  database?: Db;
  query?: InboxQuery;
  now?: () => Date;
  apiUrl?: string;
  intervalMs?: number;
  accountId?: string;
  /** Granica czasu; `null` znaczy „bez progu". Patrz `config.allegro.inboxOd`. */
  inboxOd?: string | null;
  /**
   * Odczyt struktury wątku w `beta.v1`. `null` wyłącza. Domyślnie wyłączony,
   * gdy test podstawia `query` — atrapa listy nie ma prawa pociągnąć za sobą
   * prawdziwego żądania do Allegro.
   */
  struktura?: OdczytStruktury | null;
  /**
   * Lista wątków w `beta.v1` — jedyna, w której Allegro pokazuje Problemy
   * z zakupem. Domyślnie wyłączona, gdy test podstawia `query`: atrapy
   * listy mówią `public.v1` i mają nim mówić dalej. `ALLEGRO_WATKI_BETA=0`
   * wyłącza ją w produkcji razem z odczytem struktury.
   */
  listaBeta?: boolean;
}

/** Jeden przebieg. Sieć kończy się przed zapisem, więc wolne API nie blokuje SQLite. */
export async function synchronizujAllegroInbox(deps: InboxSyncDeps = {}): Promise<void> {
  const database = deps.database ?? defaultDb();
  const query = deps.query ?? zapytajAllegro;
  const now = deps.now ?? (() => new Date());
  const apiUrl = deps.apiUrl ?? config.allegro.apiUrl;
  const interval = deps.intervalMs ?? config.allegro.inboxSyncMs;
  const od = deps.inboxOd !== undefined ? deps.inboxOd : config.allegro.inboxOd;
  const startState = stanSynchronizacji(database);
  /* Wszystkie wątki tego przebiegu w kolejności od Allegro, czyli od
     najnowszego. Kursor wybiera się z tej listy DOPIERO po zapisie, bo dopiero
     wtedy wiadomo, który wątek faktycznie wszedł do skrzynki. */
  const widziane: Thread[] = [];
  const zepsute = new Set<string>();
  /* Wątki, których wiadomości ten przebieg NAPRAWDĘ przeczytał — dociąg
     `NEW` ma je pominąć. `widziane` to co innego: tam trafia też wątek
     zatrzymany na kursorze, którego nikt nie czytał. */
  const przeczytane = new Set<string>();
  const at = now().toISOString();
  const konto = kontoKanalu(database, deps.accountId ?? config.allegro.clientId);
  const struktura: OdczytStruktury | null = deps.struktura !== undefined ? deps.struktura
    : deps.query || !config.allegro.watkiBeta ? null
      : (id) => zapytajAllegro(urlWatku(apiUrl, id), { akcept: AKCEPT_BETA });
  /* Wersja listy na CAŁY przebieg. Stronicowanie obu wersji jest inne
     (kursor `page.id` wobec `offset`), więc zmiana w połowie listy nie ma
     sensu — zejście na `public.v1` wolno tylko przy pierwszej stronie. */
  let beta = (deps.listaBeta ?? (!deps.query && config.allegro.watkiBeta))
    && now().getTime() >= betaWstrzymanaDo;
  let stronaBety: string | null = null;
  let offset = 0;
  let stron = 0;
  let reachedCursor = false;
  let poniżejGranicy = false;
  /* Czy ten przebieg zszedł do dna listy — do granicy czasu albo do końca
     historii. Tylko taki przebieg ma prawo zapisać `dno_at`. */
  let doDna = false;
  let obciety = false;
  /* SUFIT OBOWIĄZUJE DOPIERO PO PIERWSZYM ZEJŚCIU DO DNA. Bez tego wyjątku
     instalacja z zaległością większą niż sufit nigdy by jej nie nadrobiła:
     każdy przebieg czytałby te same 25 stron i zawracał. Pierwsze zejście
     jest jednorazowe i ograniczone granicą czasu, więc wolno mu być długie. */
  const limitStron = startState.dnoAt === null ? Number.POSITIVE_INFINITY : MAKS_STRON;
  const kursorParsowany = startState.cursorAt ? Date.parse(startState.cursorAt) : NaN;
  const kursorMs = Number.isNaN(kursorParsowany) ? null : kursorParsowany;

  /**
   * Zapis JEDNEJ STRONY listy. Wydzielone z ciała przebiegu, bo od 0.164.1
   * woła się to po każdej stronie, a nie raz na końcu.
   */
  const zapiszPartie = (threads: Thread[], messages: Map<string, Message[]>,
    struktury: Map<string, StrukturaWatku> = new Map()): void => {
      /* KAŻDY WĄTEK MA WŁASNĄ TRANSAKCJĘ, bo §9 projektu panelu żąda, żeby
         synchronizator „izolował błąd pojedynczego wątku". Do 0.149.2 cała
         partia szła jedną transakcją i produkcja pokazała, co to znaczy:
         Allegro przysłało wątek bez
         `lastMessageDate`, `node:sqlite` odmówił związania `undefined`
         („Provided value cannot be bound to SQLite parameter 3"), a wycofanie
         zabrało ze sobą wszystkie zdrowe wątki z tego samego przebiegu. Skrzynka
         stała przez wiele przebiegów z rzędu przez JEDEN zepsuty wątek.

         Nie zgaduję tutaj, czy wątek bez daty ma prawo wejść do skrzynki z pustą
         datą — rozstrzyga to specyfikacja Allegro, której wciąż nie mamy (patrz
         znaczniki `[WERYFIKUJ]` w docs/allegro-ksztalt.md). Do tego czasu taki
         wątek jest odrzucany, czyli tak samo jak dotąd; zmienia się wyłącznie
         to, że nie zabiera reszty przebiegu ze sobą. */
      for (const thread of threads) {
        try {
          transaction(database, () => {
            /* Rozmówca NIE ZNIKA przy pustej wartości. Wątek nie zmienia
               kupującego, a lista bety podaje go tylko pośrednio — gdy
               `rozmowcaWatku` nie rozstrzyga, zostaje login z poprzedniego
               przebiegu, nie NULL odpinający klienta od rozmowy. */
            database.prepare(`INSERT INTO allegro_inbox_thread
              (id,read,last_message_at,interlocutor_login,surowe_json,synced_at)
              VALUES (?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET read=excluded.read,
              last_message_at=excluded.last_message_at,
              interlocutor_login=COALESCE(excluded.interlocutor_login, allegro_inbox_thread.interlocutor_login),
              surowe_json=excluded.surowe_json, synced_at=excluded.synced_at`).run(
              thread.id, Number(flaga(thread.read, "thread.read")),
              thread.lastMessageDateTime ?? null, thread.interlocutor?.login ?? null,
              JSON.stringify(thread.beta?.surowe ?? thread), at);
            /* Struktura TYLKO wtedy, gdy przyszła. Nieudany odczyt bety nie ma
               prawa zamazać wartości z poprzedniego przebiegu — typ wątku się
               nie zmienia, a NULL udawałby „wątek bez typu". */
            const st = struktury.get(thread.id);
            if (st) {
              database.prepare(`UPDATE allegro_inbox_thread SET watek_typ=?, watek_podtyp=?,
                watek_status=?, watek_zamowienia=?, struktura_at=? WHERE id=?`).run(
                st.typ, st.podtyp, st.status, JSON.stringify(st.zamowienia), at, thread.id);
            }
            database.prepare("DELETE FROM allegro_inbox_message WHERE thread_id=?").run(thread.id);
            for (const message of messages.get(thread.id) ?? []) {
              database.prepare(`INSERT INTO allegro_inbox_message
                (id,thread_id,author_login,author_is_interlocutor,text,subject,status,
                 created_at,related_object_type,related_object_id,surowe_json)
                VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(
                message.id, thread.id, message.author.login,
                Number(flaga(message.author.isInterlocutor, "author.isInterlocutor")),
                message.text, message.subject ?? null, message.status ?? null,
                message.createdAt, oferta(message)[0], oferta(message)[1],
                JSON.stringify(message.surowe ?? message));
            }
            zapiszKanonicznie(database, thread, messages.get(thread.id) ?? [], konto, st ?? null);
          })();
        } catch (e) {
          /* Wątek zostaje poza skrzynką, ale przebieg leci dalej. Dziennik niesie
             IDENTYFIKATOR, bo bez niego „wątek pominięty" jest nie do odtworzenia
             po stronie Allegro. Treści wątku nie logujemy — polityka danych
             z docs/obsluga-klienta.md obowiązuje też dziennik. */
          zepsute.add(thread.id);
          console.warn("[allegro-inbox] wątek pominięty:", thread.id,
            e instanceof Error ? e.message : e);
        }
      }
  };

  /**
   * Jedna strona listy w wersji tego przebiegu. `koniec` mówi, że dalszej
   * strony nie ma: w becie `nextPage` jest `null`, w `public.v1` strona ma
   * mniej niż 20 wątków.
   *
   * ZEJŚCIE NA `public.v1` przy pierwszej stronie, gdy beta odmawia albo
   * oddaje inny kształt. Skrzynka bez Problemów z zakupem dalej odpowiada
   * klientom; skrzynka stojąca na odmowie bety nie odpowiada nikomu.
   * Wstrzymanie bety mówi o tym w dzienniku. Co przerywa przebieg, a co
   * schodzi na `public.v1`, rozstrzyga `poOdmowieListy`.
   */
  const pobierzStrone = async (): Promise<{ watki: Thread[]; koniec: boolean }> => {
    if (beta) {
      try {
        const odp = await query(urlWatkowBeta(apiUrl, stronaBety), { akcept: AKCEPT_BETA });
        const surowe = tablica<Record<string, unknown>>(odp, "threads");
        /* `nextPage` jest w `ThreadsListVBeta1` WYMAGANE (nullable). Jego brak
           znaczy odpowiedź w innym kształcie, nie koniec listy — po cichu
           czytalibyśmy wtedy jedną stronę i uznali ją za całą skrzynkę. */
        if (!("nextPage" in (odp as object))) {
          throw new Error("Lista wątków beta.v1 bez pola nextPage opisanego w docs/allegro-ksztalt.md");
        }
        const dalej = (odp as { nextPage: { id?: unknown } | null }).nextPage;
        stronaBety = tekstLubNull(dalej?.id);
        return { watki: surowe.map(watekZBety), koniec: stronaBety === null || surowe.length === 0 };
      } catch (e) {
        const co = stron > 0 ? "przerwij" : poOdmowieListy(e);
        if (co === "przerwij") throw e;
        if (co === "wstrzymaj") wstrzymajBete(database, now(), e, "lista wątków");
        else console.warn("[allegro-inbox] lista wątków z beta.v1 — błąd Allegro, ten przebieg idzie public.v1:",
          e instanceof Error ? e.message : e);
        beta = false;
      }
    }
    const page = tablica<Thread>(await query(urlWatkow(apiUrl, offset)), "threads");
    offset += page.length;
    return { watki: page, koniec: page.length < 20 };
  };

  try {
    do {
      if (stron >= limitStron) {
        obciety = true;
        break;
      }
      const { watki: page, koniec } = await pobierzStrone();
      stron++;
      /* Partia jednej strony, nie całego przebiegu — patrz zapis niżej. */
      const threads: Thread[] = [];
      const messages = new Map<string, Message[]>();
      const struktury = new Map<string, StrukturaWatku>();
      for (const thread of page) {
        /* GRANICA CZASU (0.152.0). Lista przychodzi od najnowszego, więc
           pierwszy wątek poniżej progu znaczy „dalej są już same starsze" —
           i to jest jedyny moment, w którym wolno przestać czytać. Bez tego
           każdy przebieg chodził przez całą historię konta aż do końca.

           Wątek BEZ daty przepuszczamy: schemat Allegro dopuszcza brak
           `lastMessageDateTime` (patrz 0.151.0), a świeżo założona rozmowa nie
           ma jak mieć ostatniej wiadomości. Odrzucanie jej progiem znaczyłoby
           rozmowę, której panel nigdy nie pokaże. */
        if (od && thread.lastMessageDateTime && thread.lastMessageDateTime < od) {
          poniżejGranicy = true;
          break;
        }
        /* KURSOR TO PROG DATY, nie tylko konkretny wątek. Wątek starszy od kursora
           przeszedł już w którymś z poprzednich przebiegów, a lista idzie od
           najnowszego, więc dalej są same starsze. Sama para (data, id) nie
           wystarcza: kolejna wiadomość w wątku, który był kursorem, zmienia jego
           datę i starej pary nie ma już nigdzie na liście. Przebieg czytał wtedy
           cały sufit stron po KAŻDEJ wiadomości w najnowszym wątku, także po naszej
           własnej odpowiedzi. Wątek o dokładnie tej samej dacie idzie dalej:
           znany i niezmieniony nie kosztuje żądania, a nieznany nie może zostać
           pominięty. Data, której nie da się odczytać, progu nie uruchamia. */
        if (kursorMs !== null && thread.lastMessageDateTime
          && Date.parse(thread.lastMessageDateTime) < kursorMs) {
          reachedCursor = true;
          break;
        }
        widziane.push(thread);
        if (thread.lastMessageDateTime === startState.cursorAt && thread.id === startState.cursorId) {
          reachedCursor = true;
          break;
        }
        const known = database.prepare(
          "SELECT last_message_at FROM allegro_inbox_thread WHERE id=?"
        ).get(thread.id) as { last_message_at: string } | undefined;
        if (!known || known.last_message_at !== thread.lastMessageDateTime) {
          /* Struktura z samej listy, gdy lista szła betą — dodatkowe żądanie
             o wątek jest potrzebne wyłącznie przy liście `public.v1`. */
          const st = thread.beta ? thread.beta.struktura
            : await czytajStrukture(database, struktura, thread.id, now());
          messages.set(thread.id, await czytajWiadomosci(query, apiUrl, thread));
          threads.push(thread);
          przeczytane.add(thread.id);
          if (st) struktury.set(thread.id, st);
        }
      }
      /* ZAPIS PO KAŻDEJ STRONIE, nie na końcu przebiegu (0.164.1). Do tego
         wydania wszystko czekało w pamięci do ostatniej strony, więc awaria
         na stronie trzechsetnej kasowała dorobek dwustu dziewięćdziesięciu
         dziewięciu — i następny przebieg pytał Allegro o te same wiadomości
         raz jeszcze. Tak wyglądała doba z 316 tysiącami żądań: żaden przebieg
         nie doszedł do zapisu, więc każdy zaczynał od zera.

         Strona jest najmniejszą jednostką, jaką wolno tu zapisać: test
         „awaria sieci przy pobieraniu wiadomości kończy przebieg bez zapisu"
         pilnuje, że wątki strony NIEDOCZYTANEJ nie wchodzą pojedynczo. */
      zapiszPartie(threads, messages, struktury);
      if (poniżejGranicy || koniec) {
        doDna = true;
        break;
      }
    } while (!reachedCursor);

    /* Po liście, przed zapisem stanu: wątki z załącznikiem `NEW`, których
       data się nie zmieniła. Pomijamy te, które ten przebieg już przeczytał. */
    await dociagnijZalacznikiNew(database, query, apiUrl, konto, przeczytane);

    if (obciety) {
      /* Zdanie do dziennika, bo obcięcie jest STANEM, nie awarią: przebieg
         domknął się i przesunął kursor, ale reszty listy tym razem nie
         dotknął. Cisza w tym miejscu znaczyłaby, że nikt się nie dowie
         o skrzynce, która nie nadąża. */
      console.warn(`[allegro-inbox] przebieg obcięty na ${MAKS_STRON} stronach —`,
        "tyle wątków ma datę nowszą od kursora, reszta listy poczeka na następny przebieg.");
    }

    /* §8.3: kursora nie przesuwa się „po niepełnym zapisie". Może więc stanąć
       WYŁĄCZNIE na wątku, który przeszedł. Gdyby stanął na pominiętym, następny
       przebieg uznałby go za punkt odniesienia i przestał widzieć wszystko,
       co za nim — jeden zepsuty wątek zabrałby ze sobą
       historię, zamiast samego siebie. Wątek bez daty odpada z tego wyboru
       osobno, bo kursor porównuje się PARĄ (data, id). */
    const kursor = widziane.find((w) => !zepsute.has(w.id) && w.lastMessageDateTime != null);

    /* DNO zapisuje WYŁĄCZNIE przebieg, który do niego zszedł. Przebieg obcięty
       sufitem ani przebieg zatrzymany na kursorze nie mają czego stwierdzić
       o reszcie listy — a `dno_at` jest właśnie stwierdzeniem „to, co niżej,
       już przez nas przeszło". Pusta lista (konto bez rozmów) też jest dnem:
       nie ma czego czytać dalej. */
    const dno = doDna ? (widziane.at(-1)?.lastMessageDateTime ?? at) : startState.dnoAt;

    transaction(database, () => {
      /* `error_count` ZERUJE SIĘ na sukcesie i to jest zmiana z 0.147.0.
         Wcześniej klauzula `DO UPDATE` go pomijała, więc licznik rósł do
         końca życia bazy: pierwsza w tygodniu odmowa Allegro zostawiała
         w panelu „błędów: 1" na stałe, a §21 nie miał z czego policzyć,
         ile przebiegów Z RZĘDU się nie powiodło.

         `error_thread_count` liczy co innego i dlatego stoi osobno: przebieg
         z pominiętym wątkiem DOMKNĄŁ SIĘ, więc nie jest porażką przebiegu.
         Kolumna i wiersz „Wątki z błędem" w panelu istnieją od 0.147.0 —
         do 0.149.2 nikt do nich nie pisał, więc panel pokazywał zero także
         wtedy, gdy skrzynka gubiła wątki. */
      database.prepare(`INSERT INTO allegro_inbox_sync_state
        (id,cursor_at,cursor_id,last_success_at,last_attempt_at,last_error_code,
         last_error_text,error_count,error_thread_count,next_attempt_at,dno_at)
        VALUES(1,?,?,?,?,NULL,NULL,0,?,?,?) ON CONFLICT(id) DO UPDATE SET cursor_at=excluded.cursor_at,
        cursor_id=excluded.cursor_id,last_success_at=excluded.last_success_at,
        last_attempt_at=excluded.last_attempt_at,last_error_code=NULL,last_error_text=NULL,
        error_count=0,error_thread_count=excluded.error_thread_count,
        next_attempt_at=excluded.next_attempt_at,dno_at=excluded.dno_at`).run(
          kursor?.lastMessageDateTime ?? startState.cursorAt, kursor?.id ?? startState.cursorId,
          at, at, zepsute.size, new Date(Date.parse(at) + interval).toISOString(), dno);
      /* Lista przeszła betą do końca przebiegu — wstrzymanie, jeśli wisiało
         z poprzedniego procesu, już nie jest prawdą. */
      if (beta) {
        database.prepare(`UPDATE allegro_inbox_sync_state SET beta_wstrzymana_do=NULL, beta_powod=NULL
          WHERE id=1`).run();
      }
    })();
  } catch (error) {
    const wait = error instanceof BladLimituAllegro
      ? Math.max(interval, error.poIluMs ?? interval * 2)
      : interval;
    const next = new Date(now().getTime() + wait).toISOString();
    /* Kod porażki decyduje o statusie z §7: 401 i 403 to `authentication_error`
       („zawołaj admina"), 429 to `rate_limited` („poczekaj"). Bez zapamiętania
       kodu panel umiałby powiedzieć wyłącznie „nie udało się". */
    const kod = error instanceof BladLimituAllegro ? 429 : kodHttp(error);
    /* Zdanie, nie tylko kod. Komunikaty z `wazneBearer` i `zapytajAllegro` są
       pisane dla człowieka i niosą instrukcję, co kliknąć — przepisujemy je
       bez zmian, zamiast budować drugi słownik powodów. Obcięcie chroni
       kolumnę przed odpowiedzią serwera wklejoną w całości. */
    const tekst = (error instanceof Error ? error.message : String(error)).slice(0, 500);
    database.prepare(`INSERT INTO allegro_inbox_sync_state
      (id,error_count,last_attempt_at,last_error_code,last_error_text,next_attempt_at)
      VALUES(1,1,?,?,?,?) ON CONFLICT(id) DO UPDATE SET error_count=error_count+1,
      last_attempt_at=excluded.last_attempt_at,last_error_code=excluded.last_error_code,
      last_error_text=excluded.last_error_text,
      next_attempt_at=excluded.next_attempt_at`).run(now().toISOString(), kod, tekst, next);
    throw error;
  }
}

/**
 * Wiadomości jednego wątku, w wersji zależnej od jego typu.
 *
 * Problem z zakupem czytamy w `beta.v1`, bo Allegro obsługuje go wyłącznie
 * tą wersją. Zwykły wątek zostaje na `public.v1`: tylko tam kierunek niesie
 * `isInterlocutor`, a w becie obie strony zwykłego wątku mogą mieć rolę
 * `USER`. Wiadomości obu wersji czytamy tylko z pierwszej strony: wątek
 * czyta się przy każdej zmianie, więc nowa wiadomość zawsze jest na górze.
 * Starszych nie kasujemy — model pracy ich nie usuwa.
 *
 * Wątek z listy bety dostaje tu rozmówcę: lista podaje uczestników, a kto
 * z nich jest klientem, rozstrzygają dopiero wiadomości.
 */
async function czytajWiadomosci(query: InboxQuery, apiUrl: string, thread: Thread): Promise<Message[]> {
  const b = thread.beta;
  const lista = b?.struktura?.typ === PROBLEM_Z_ZAKUPEM
    ? tablica<Record<string, unknown>>(
      await query(urlWiadomosci(apiUrl, thread.id), { akcept: AKCEPT_BETA }), "messages")
      .map((m) => wiadomoscZBety(m, b.uczestnicy.find((u) => u.rola === "SELLER")?.login ?? null))
    : tablica<Message>(await query(urlWiadomosci(apiUrl, thread.id)), "messages");
  if (b) {
    const login = rozmowcaWatku(b.uczestnicy, lista);
    thread.interlocutor = login ? { login } : null;
  }
  return lista;
}

/* ── Model kanoniczny (0.144.0) ─────────────────────────────────────────────
   Tabele `allegro_inbox_*` zostają SUROWYM LĄDOWISKIEM: trzymają odpowiedź
   Allegro w kształcie, w jakim przyszła, razem z `surowe_json`. Obsługa
   klienta pracuje na `channel_account`/`conversation`/`message`, bo tylko ten
   model unosi drugi kanał, przypisanie agenta, szkic i komentarze.

   Do 0.143.1 nikt nie zapisywał do `conversation`, więc przejmowanie rozmowy
   i szkic z 0.143.0 były kodem nieosiągalnym — trasy przyjmowały liczbowe id
   rozmowy, której nic nie tworzyło. Ten zapis jest tym brakującym ogniwem. */

/* Powiązanie wiadomości z ofertą. Allegro daje `relatesTo` z osobnymi gałęziami
   `offer` i `order`, niezależnymi od siebie — wiadomość może nieść obie
   naraz albo żadnej. Typ zapisujemy jako `OFFER`, bo tak nazywa go model
   kanoniczny — to nasze słowo, nie cytat z Allegro. */
function oferta(message: Message): [string | null, string | null] {
  const id = message.relatesTo?.offer?.id;
  return id == null ? [null, null] : ["OFFER", String(id)];
}

/* Gałąź `order` idzie do OSOBNEJ kolumny (0.166.0). Do 0.165.0 była
   wyrzucana z uzasadnieniem „numer zamówienia zostaje w `surowe_json` do
   czasu, aż będzie miał ekran" — a sonda z 2 września pokazała, że to
   zamówienie, nie oferta, jest częstszym powiązaniem (7 z 33 wobec 5 z 33).
   Mail Allegro „Wiadomość dotyczy" bierze towar właśnie stąd; panel bez tej
   kolumny nie miał czego pokazać. */
function zamowienie(message: Message): string | null {
  const id = message.relatesTo?.order?.id;
  return id == null ? null : String(id);
}

/* Najpóźniejsze `createdAt` z wątku. `Message.createdAt` jest w schemacie
   WYMAGANE, więc gdy wiadomości są, data też jest. */
function najnowsza(messages: Message[]): string | null {
  return messages.map((m) => m.createdAt).sort().at(-1) ?? null;
}

/* Temat rozmowy niesie WIADOMOŚĆ, nie wątek. Bierzemy pierwszy niepusty —
   Allegro powtarza go w kolejnych wiadomościach tego samego wątku. Gdy go nie
   ma, wołający zostaje przy loginie rozmówcy, czyli przy tym, co stało
   w `conversation.subject` do 0.151.0. */
function temat(messages: Message[]): string | null {
  const s = messages.find((m) => typeof m.subject === "string" && m.subject !== "")?.subject;
  return s == null ? null : odkodujEncje(s);
}

/* ENCJE HTML SCHODZĄ TUTAJ, przy wjeździe do modelu pracy — nie przy
   wyświetlaniu. To jest blizna 0.127.0 („polskie znaki przyjeżdżały jako encje
   HTML") z listy w `docs/obsluga-klienta.md`, kupiona DRUGI RAZ: `odkodujEncje`
   czekała w `tekst.ts` z kompletem testów i z komentarzem mówiącym wprost, że
   nowa obsługa ma ją wziąć gotową, nie odkryć drugi raz na produkcji. Odkryła
   ją drugi raz na produkcji — panel escape'uje przy renderowaniu, więc
   `kt&oacute;ry` z bazy stał na ekranie dosłownie, w każdej polskiej
   wiadomości.

   Specyfikacja tego nie zapowiada: `Message.text` to goły `type: string`, bez
   słowa o HTML-u. Tak wygląda różnica między tym, co Allegro DEKLARUJE,
   a tym, co przysyła.

   LĄDOWISKO ZOSTAJE SUROWE. `allegro_inbox_message.text` i `surowe_json` niosą
   odpowiedź w kształcie, w jakim przyszła — to jedyny ślad, gdyby dekodowanie
   kiedyś skrzywdziło cudzy tekst. */
function zapiszKanonicznie(
  database: Db, thread: Thread, messages: Message[], konto: number, st: StrukturaWatku | null,
): void {
  /* ZAMÓWIENIE PROBLEMU Z ZAKUPEM wiąże się z całym wątkiem
     (`ThreadVBeta1.orders`), a gałąź `relatesTo.order` wiadomości jest
     w becie nullable. Bez tego numeru droga klienta nie połączyłaby sprawy
     ze zwrotem i reklamacją tego zakupu — mostkiem jest wyłącznie
     `message.related_order_id`. Tylko przy JEDNYM zamówieniu: z kilku nie
     wiadomo, którego dotyczy wiadomość, a zgadnięty numer pokazałby inny zakup. */
  const zamowienieWatku = st?.typ === PROBLEM_Z_ZAKUPEM && st.zamowienia.length === 1
    ? st.zamowienia[0]! : null;
  database.prepare(`INSERT INTO conversation(channel_account_id, external_conversation_id, subject, unread, updated_at)
    VALUES (?,?,?,?,?) ON CONFLICT(channel_account_id, external_conversation_id)
    DO UPDATE SET unread=excluded.unread, updated_at=excluded.updated_at`).run(
    konto, thread.id, temat(messages) ?? thread.interlocutor?.login ?? null,
    Number(!flaga(thread.read, "thread.read")),
    /* `updated_at` jest NOT NULL, a data wątku bywa pusta. Wtedy schodzimy na
       datę najnowszej wiadomości, a gdy wątek nie ma i wiadomości — na czas
       synchronizacji. Rozmowa musi mieć się gdzie ustawić na liście. */
    thread.lastMessageDateTime ?? najnowsza(messages) ?? new Date().toISOString());
  const rozmowa = Number((database.prepare(
    "SELECT id FROM conversation WHERE channel_account_id=? AND external_conversation_id=?",
  ).get(konto, thread.id) as { id: number }).id);

  /* OD NAJSTARSZEJ (23 września 2026). Allegro oddaje wiadomości od
     najnowszej, a wpis w tej kolejności dawał starszemu dopiskowi klienta
     wyższe `id` — i wysyłka odmawiała 409, bo kontrola świeżości szła po
     `id`. Kontrola czyta już po czasie; ten porządek sprawia, że nowe wiersze
     w ogóle nie mają rozjazdu. `createdAt` to ISO 8601, więc porównanie
     napisów jest porównaniem chwil. */
  const odNajstarszej = [...messages].sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  for (const message of odNajstarszej) {
    /* KIERUNEK Z `isInterlocutor`. Rozmówca to ten, który nie jest nami,
       więc jego wiadomość jest przychodząca. Do 0.151.0 stało tu porównanie
       z rolą `SELLER`, której Allegro nie przysyła — na prawdziwej
       odpowiedzi rzucało `TypeError`.

       Liczone RAZ, do zmiennej: ta sama flaga rozstrzyga o kierunku, o budzeniu
       rozmowy i o tym, czy zdarzenie ma zapalić pasek w panelu. Trzy odczyty
       tego samego pola dawałyby trzy okazje, żeby któryś się rozjechał. */
    const przychodzaca = flaga(message.author.isInterlocutor, "author.isInterlocutor");
    /* Głos Allegro w zamkniętym wątku nie jest ruchem (`glos-allegro.ts`):
       nie budzi rozmowy i nie zapala paska nowej wiadomości. Status liczy
       to samo przy odczycie, a budzenie zapisuje — oba muszą mówić jedno. */
    const ruchKlienta = przychodzaca
      && !(ROLE_ALLEGRO.has(message.rola ?? "") && st?.status === "CLOSED");
    const kierunek = przychodzaca ? "incoming" as const : "outgoing" as const;
    const tresc = odkodujEncje(message.text);
    const auto = flagaAutoodpowiedzi(kierunek, tresc);
    /* Wiadomości NIE kasujemy i nie nadpisujemy, inaczej niż w lądowisku:
       wiszą na nich szkic (`expected_last_message_id`) i zadania terenowe.
       Konflikt na unikalnym kluczu jest tu poprawnym końcem pracy. */
    const wynik = database.prepare(`INSERT INTO message(conversation_id, channel_account_id,
      external_message_id, direction, body, related_object_type, related_object_id,
      related_order_id, sent_at, auto_odpowiedz, autor_rola)
      VALUES (?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(channel_account_id, external_message_id) DO NOTHING`).run(
      rozmowa, konto, message.id,
      kierunek,
      tresc, oferta(message)[0], oferta(message)[1], zamowienie(message) ?? zamowienieWatku,
      /* Data POJEDYNCZEJ wiadomości. Do 0.151.0 wszystkie wiadomości wątku
         dostawały tu jedną datę — datę wątku — bo kod twierdził, że Allegro
         daty wiadomości nie podaje. Podaje: `createdAt`. */
      message.createdAt,
      /* AUTOODPOWIEDŹ ZNACZONA OD RAZU (0.257.0). Do tego wydania kolumny tu
         nie było, więc zostawało `DEFAULT 0`, a flagę dosypywała dopiero
         migracja przy starcie procesu. Między restartami nasze „Dziękujemy
         za kontakt" liczyło się jako ruch biura i przestawiało rozmowę na
         „czeka na klienta" — pytanie klienta gasło przez to, że skrzynka
         grzecznie potwierdziła jego odbiór. */
      auto,
      /* Rola autora z `beta.v1`. Doradca Allegro pisze w Problemie
         z zakupem jako strona przychodząca, a oś rozmowy podpisywała
         przychodzące loginem klienta — bez roli jego słowa stałyby
         na ekranie jako słowa kupującego. */
      message.rola ?? null);
    if (wynik.changes > 0) {
      /* PRZYCHODZĄCA BUDZI ROZMOWĘ (§7, 0.158.0). Klient dopisujący pytanie do
         sprawy uznanej za załatwioną musi ją z powrotem otworzyć — inaczej
         rozmowa zostaje na liście „rozwiązane" i nikt do niej nie zagląda.
         Wychodzące pomijamy: to nasza własna odpowiedź wracająca z Allegro. */
      if (ruchKlienta) obudzPrzychodzaca(database, rozmowa);
      else if (!przychodzaca) uzgodnijNiepewna(database, rozmowa, message.id, tresc);
      /* ZDARZENIE NIESIE KIERUNEK (0.257.0, dług z 0.228.0). Panel zapala pasek
         „Klient dopisał nową wiadomość" wyłącznie przy `odKlienta`. Tą drogą
         pole nie jechało nigdy, bo ustawiał je tylko `zapiszWiadomosc`, którego
         synchronizator nie woła — więc pasek nie zapalił się ani razu na
         prawdziwej wiadomości z Allegro. */
      publishConversationEvent("message.created", rozmowa, {
        messageId: Number(wynik.lastInsertRowid), external: message.id,
        odKlienta: ruchKlienta,
        automatyczna: auto === 1,
      });
    }
    /* ZAŁĄCZNIKI PRZY KAŻDYM PRZEBIEGU, także przy wiadomości już znanej.
       Do 0.242.0 wchodziły wyłącznie z nową wiadomością, więc `NEW`
       („Allegro jeszcze sprawdza") zostawało zamrożone na zawsze, a zdjęcia
       z wiadomości sprzed 0.155.0 nie istniały w bazie wcale. Sama wiadomość
       dalej jest nietykalna — wiszą na niej szkice i zadania; dotykamy
       wyłącznie tabeli załączników, po kluczu `(message_id, file_name)`. */
    const messageId = wynik.changes > 0
      ? Number(wynik.lastInsertRowid)
      : Number((database.prepare(
        "SELECT id FROM message WHERE channel_account_id=? AND external_message_id=?",
      ).get(konto, message.id) as { id: number }).id);
    zapiszZalaczniki(database, messageId, message.attachments);
  }
}

/** Sufit wątków dociąganych w jednym przebiegu po sam status załącznika. */
const MAKS_DOCIAGU_NEW = 5;

/**
 * Dociąg wątków, w których załącznik stoi na `NEW`.
 *
 * Wątek bez zmiany `lastMessageDateTime` nie jest czytany ponownie, więc
 * `NEW → SAFE` bez nowej wiadomości nie doszłoby nigdy — Allegro nie
 * przestawia daty wątku, gdy kończy sprawdzać plik. Pytamy więc osobno,
 * wyłącznie o wątki z takim załącznikiem i najwyżej pięć na przebieg:
 * to rzadkość, a sufit pilnuje, żeby nie stała się drugą listą.
 * Awaria jednego wątku nie kończy przebiegu — jak przy partii.
 */
async function dociagnijZalacznikiNew(
  database: Db, query: InboxQuery, apiUrl: string, konto: number, pominiete: Set<string>,
): Promise<void> {
  const watki = (database.prepare(`
    SELECT DISTINCT c.external_conversation_id AS id,
           (SELECT t.watek_typ FROM allegro_inbox_thread t
             WHERE t.id = c.external_conversation_id) AS typ
      FROM message_attachment a
      JOIN message m ON m.id = a.message_id
      JOIN conversation c ON c.id = m.conversation_id
     WHERE a.status = 'NEW' AND c.channel_account_id = ?
     LIMIT ?`).all(konto, MAKS_DOCIAGU_NEW) as Array<{ id: string; typ: string | null }>)
    .filter((w) => !pominiete.has(w.id));
  for (const { id, typ } of watki) {
    try {
      /* Ta sama wersja co przy czytaniu wątku. Załącznik `beta.v1` ma te
         same pola, po które tu przychodzimy, plus `id`, którego nie czytamy. */
      const wiadomosci = tablica<Message>(typ === PROBLEM_Z_ZAKUPEM
        ? await query(urlWiadomosci(apiUrl, id), { akcept: AKCEPT_BETA })
        : await query(urlWiadomosci(apiUrl, id)), "messages");
      transaction(database, () => {
        for (const m of wiadomosci) {
          const w = database.prepare(
            "SELECT id FROM message WHERE channel_account_id=? AND external_message_id=?",
          ).get(konto, m.id) as { id: number } | undefined;
          if (w) zapiszZalaczniki(database, Number(w.id), m.attachments);
        }
      })();
    } catch (e) {
      console.warn("[allegro-inbox] dociąg załączników NEW pominięty:", id,
        e instanceof Error ? e.message : e);
    }
  }
}

/**
 * Struktura jednego wątku — NIGDY nie przerywa przebiegu. Skrzynka bez typu
 * wątku działa jak do 22 września 2026; skrzynka bez wiadomości nie działa
 * wcale. Dlatego każda awaria bety kończy się tu `null`, a nie wyjątkiem.
 *
 * Odmowa wersji albo uprawnienia wstrzymuje odczyt na sześć godzin (patrz
 * `WSTRZYMANIE_PO_ODMOWIE_MS`); limit Allegro — na kwadrans, bo następne
 * żądanie tego przebiegu i tak dostałoby 429.
 */
async function czytajStrukture(
  database: Db, odczyt: OdczytStruktury | null, threadId: string, teraz: Date,
): Promise<StrukturaWatku | null> {
  if (!odczyt || teraz.getTime() < betaWstrzymanaDo) return null;
  try {
    return strukturaZOdpowiedzi(await odczyt(threadId));
  } catch (e) {
    if (e instanceof BladLimituAllegro) {
      betaWstrzymanaDo = teraz.getTime() + WSTRZYMANIE_PO_LIMICIE_MS;
    } else if (odmowaBety(e)) {
      wstrzymajBete(database, teraz, e, "struktura wątków");
    }
    return null;
  }
}

/**
 * Wysyłka `send_uncertain` rozstrzyga się sama, gdy synchronizacja przyniesie
 * naszą wiadomość o tej samej treści (22 września 2026).
 *
 * Specyfikacja: „if a request times out after possible submission, mark its
 * result UNKNOWN and reconcile against outgoing messages before retrying; do
 * not assume the remote API deduplicates requests". Do tej wersji rozstrzygał
 * to człowiek: wysyłka odmawiała ponowienia ze zdaniem „najpierw zsynchronizuj
 * wątek", a po synchronizacji wiersz i tak stał niepewny.
 *
 * Dopasowanie po TREŚCI w tej samej rozmowie, bez różnicy białych znaków —
 * Allegro nie oddaje naszego klucza idempotencji, więc treść jest jedynym
 * wspólnym śladem. Bierze NAJSTARSZY pasujący wiersz: dwie niepewne wysyłki
 * tej samej treści to dwie próby jednej odpowiedzi, a Allegro przyjęło jedną.
 *
 * Szkicu i statusu rozmowy nie rusza. Status liczy się z kierunku ostatniej
 * wiadomości, a szkic mógł się zmienić od próby — skasowanie go byłoby
 * cichym nadpisaniem pracy agenta.
 */
function uzgodnijNiepewna(database: Db, rozmowa: number, externalId: string, tresc: string): void {
  const zwin = (t: string) => t.replace(/\s+/g, " ").trim();
  const kandydaci = database.prepare(`SELECT id, body FROM outbox
    WHERE conversation_id=? AND status='send_uncertain' AND external_message_id IS NULL
    ORDER BY id`).all(rozmowa) as Array<{ id: number; body: string }>;
  const trafiony = kandydaci.find((o) => zwin(o.body) === zwin(tresc));
  if (!trafiony) return;
  database.prepare(`UPDATE outbox SET status='sent', external_message_id=?, blad=NULL,
    finished_at=COALESCE(finished_at, strftime('%Y-%m-%dT%H:%M:%fZ','now')) WHERE id=?`)
    .run(externalId, trafiony.id);
  logEvent("rozmowa_wysylka_uzgodniona", "synchronizacja", null,
    { conversationId: rozmowa, outboxId: trafiony.id, externalMessageId: externalId }, null, database);
}
