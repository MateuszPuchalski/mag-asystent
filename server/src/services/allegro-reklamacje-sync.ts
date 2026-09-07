import { config } from "../config.js";
import { db as defaultDb, transaction, type Db } from "../db/db.js";
import {
  urlDyskusji, urlWiadomosciDyskusji, zapytajAllegro,
} from "../adapters/allegro.http.js";
import { BladLimituAllegro, BladOdpowiedziAllegro } from "../adapters/allegro.js";
import { kontoKanalu } from "./kanal-konto.js";
import { oczyscSurowy } from "./allegro-oczyszczanie.js";
import { naGrosze } from "./allegro-zwroty-sync.js";

/* ── Synchronizator reklamacji klienckich (0.222.0) ──────────────────────────
   Kształt pól pochodzi z OFICJALNEJ specyfikacji OpenAPI Allegro (modele
   `PostPurchaseIssue`, `PostPurchaseIssueState`, `PostPurchaseIssueChat`,
   `PostPurchaseIssueExpectation`, `PostPurchaseIssueReason`), a nie z kodu
   sprzed 0.138.0 i nie z pamięci. Spis pól z uzasadnieniem stoi
   w `docs/allegro-ksztalt.md`.

   ŻADEN Z TYCH SCHEMATÓW NIE MA LISTY `required`. Wymagalność pola mówi
   wyłącznie ta lista, więc tutaj KAŻDE pole jest opcjonalne — poza `id`, bez
   którego nie ma czego zapisać. Tak samo potraktowaliśmy `OfferListingDto`
   w 0.214.0 i to nie była wtedy usterka Allegro, tylko normalna odpowiedź.

   TRZY RZECZY, KTÓRE TEN PLIK ROBI INACZEJ NIŻ ZWROTY:

   1. NIE MA KURSORA. `getListOfIssuesUsingGET` przyjmuje `offset`, `limit`,
      `status` i `checkoutForm.id` — ani `from`, ani granicy dat. Lista jest
      posortowana malejąco po dacie otwarcia, więc każdy przebieg czyta ją od
      początku i po prostu nadpisuje to, co już zna.
   2. ODSIEWAMY DYSKUSJE. Ta sama końcówka niesie `DISPUTE` i `CLAIM`; panel
      prowadzi wyłącznie reklamacje (decyzja właściciela z 6 września 2026).
      Filtr stoi TUTAJ, w jednym miejscu, a liczba odsianych idzie do stanu
      synchronizacji — inaczej ktoś szukałby kiedyś reklamacji, która nigdy
      reklamacją nie była.
   3. CZAT DOCIĄGAMY OSOBNO I Z LIMITEM. Lista niesie samą PIERWSZĄ wiadomość
      (`chat.initialMessage`) oraz licznik i status ostatniej. Pełna rozmowa to
      jedno żądanie NA SPRAWĘ, więc pytamy tylko o te, w których licznik
      Allegro rozjechał się z tym, co mamy, i nie więcej niż `CZATOW_NA_PRZEBIEG`
      naraz. Sześćdziesiąt żądań co trzy minuty byłoby prostą drogą do 429.

   Rytm i respekt dla 429 bierze `services/takt.ts`; ponowień w środku
   przebiegu nie ma.                                                         */

type Kwota = { amount?: string; currency?: string };

type Zalacznik = { fileName?: string; url?: string };

type Autor = { login?: string; role?: string };

type Wiadomosc = {
  id?: string;
  text?: string;
  attachments?: Zalacznik[];
  author?: Autor | null;
  createdAt?: string;
};

type Sprawa = {
  id: string;
  type?: string;
  referenceNumber?: string | null;
  decisionDueDate?: string | null;
  openedDate?: string;
  subject?: string | null;
  description?: string | null;
  right?: string | null;
  buyer?: { login?: string } | null;
  checkoutForm?: { id?: string } | null;
  offer?: { id?: string | null } | null;
  reason?: { type?: string; description?: string } | null;
  expectations?: Array<{ name?: string | null; refund?: Kwota | null }> | null;
  currentState?: {
    status?: string;
    statusDueDate?: string | null;
    returnRequired?: boolean | null;
    chatActive?: boolean;
  } | null;
  chat?: {
    messagesCount?: number;
    lastMessage?: { status?: string; createdAt?: string } | null;
    initialMessage?: Wiadomosc | null;
  } | null;
  attachments?: Zalacznik[];
};

/** Kod bierze się z KLASY błędu, nie z jego zdania (wzorzec skrzynki). */
const kodHttp = (error: unknown): number | null =>
  error instanceof BladOdpowiedziAllegro ? error.status : null;

/**
 * Ile stron wolno przejść w jednym przebiegu.
 *
 * BEZPIECZNIK, nie limit poprawnościowy — ta sama blizna 0.127.0 co przy
 * zwrotach. Dziesięć stron to tysiąc spraw; sonda z żywego konta widziała ich
 * sto w całej historii.
 */
const MAKS_STRON = 10;

/** Ile rekordów prosi jedna strona; musi zgadzać się z `urlDyskusji`. */
const NA_STRONE = 100;

/**
 * Ile rozmów dociągamy w jednym przebiegu.
 *
 * Jedno żądanie na sprawę, więc to jest budżet zapytań, a nie ozdoba.
 * Dwadzieścia co trzy minuty domyka zaległość stu spraw w kwadrans, a przy
 * normalnej pracy wystarcza na wszystko, co się zmieniło od ostatniego taktu.
 */
export const CZATOW_NA_PRZEBIEG = 20;

export interface ReklamacjeSyncDeps {
  database?: Db;
  query?: (url: string) => Promise<unknown | null>;
  now?: () => Date;
  apiUrl?: string;
  intervalMs?: number;
  accountId?: string;
  /** Ile rozmów wolno dociągnąć; zero wyłącza dociąganie (testy tras). */
  czatow?: number;
}

function tablica<T>(value: unknown, pole: string): T[] {
  if (!value || typeof value !== "object" || !Array.isArray((value as Record<string, unknown>)[pole])) {
    throw new Error(`Odpowiedź Allegro nie ma tablicy ${pole} opisanej w docs/allegro-ksztalt.md`);
  }
  return (value as Record<string, unknown>)[pole] as T[];
}

/**
 * `count` z odpowiedzi listy.
 *
 * `PostPurchaseIssueListResponse` ma w schemacie WYŁĄCZNIE pole `issues` —
 * licznika tam nie ma. Czytamy go więc miękko: jeśli Allegro go dołoży, ogon
 * przebiegu będzie policzony; jeśli nie, zostaje `null`, czyli „nie wiem".
 * Zero kłamałoby, że nic nie zostało.
 */
function liczba(value: unknown): number | null {
  const n = (value as Record<string, unknown> | null)?.count;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

/** Czy sprawa jest reklamacją. Dyskusji panel nie prowadzi. */
export const czyReklamacja = (s: Sprawa): boolean => s.type === "CLAIM";

/**
 * Pierwsze oczekiwanie klienta i jego kwota.
 *
 * `expectations` bywa tablicą dłuższą niż jednoelementowa, a wiersz kolejki
 * niesie jedno zdanie. Bierzemy pierwsze z nazwą — element bez `name` jest
 * w schemacie dopuszczony i nie mówi nic.
 */
export function pierwszeOczekiwanie(sprawa: Sprawa):
  { nazwa: string | null; grosze: number | null; waluta: string } {
  const e = (sprawa.expectations ?? []).find((x) => Boolean(x?.name));
  return {
    nazwa: e?.name ?? null,
    grosze: e?.refund?.amount ? naGrosze(e.refund.amount) : null,
    waluta: e?.refund?.currency ?? "PLN",
  };
}

/** Jeden przebieg. Sieć kończy się PRZED transakcją, więc wolne API nie blokuje SQLite. */
export async function synchronizujAllegroReklamacje(
  deps: ReklamacjeSyncDeps = {},
): Promise<{ reklamacji: number; dyskusji: number; czatow: number }> {
  const database = deps.database ?? defaultDb();
  const query = deps.query ?? zapytajAllegro;
  const now = deps.now ?? (() => new Date());
  const apiUrl = deps.apiUrl ?? config.allegro.apiUrl;
  const interval = deps.intervalMs ?? config.allegro.reklamacjeSyncMs;
  const budzetCzatow = deps.czatow ?? CZATOW_NA_PRZEBIEG;

  const reklamacje: Sprawa[] = [];
  let pobrano = 0;
  let dyskusji = 0;
  let wszystkich: number | null = null;
  /* Czy lista skończyła się sama. `false` znaczy, że urwał ją bezpiecznik
     stron — i wtedy reszta spraw zostaje po tamtej stronie. */
  let komplet = false;

  try {
    for (let strona = 0; strona < MAKS_STRON; strona++) {
      const body = await query(urlDyskusji(apiUrl, strona * NA_STRONE));
      const partia = tablica<Sprawa>(body, "issues");
      if (strona === 0) wszystkich = liczba(body);
      pobrano += partia.length;
      for (const sprawa of partia) {
        if (typeof sprawa?.id !== "string") continue;
        if (czyReklamacja(sprawa)) reklamacje.push(sprawa);
        else dyskusji += 1;
      }
      if (partia.length < NA_STRONE) { komplet = true; break; }
    }

    /* OGON, czyli czego ten przebieg NIE wziął. Lista domknięta własnym końcem
       nie ma ogona z definicji — nawet gdyby `count` mówił inaczej, bo między
       pierwszą a ostatnią stroną mogła dojść nowa sprawa. */
    const pozostalo = komplet ? 0
      : wszystkich === null ? null : Math.max(0, wszystkich - pobrano);

    const at = now().toISOString();
    let konto = 0;
    transaction(database, () => {
      konto = kontoKanalu(database, deps.accountId ?? config.allegro.clientId);
      for (const sprawa of reklamacje) zapisz(database, sprawa, konto, at);
      database.prepare(`INSERT INTO allegro_reklamacje_sync_state
        (id,last_success_at,last_attempt_at,last_error_code,error_count,
         next_attempt_at,pozostalo,dyskusji)
        VALUES(1,?,?,NULL,0,?,?,?) ON CONFLICT(id) DO UPDATE SET
        last_success_at=excluded.last_success_at, last_attempt_at=excluded.last_attempt_at,
        last_error_code=NULL, error_count=0, next_attempt_at=excluded.next_attempt_at,
        pozostalo=excluded.pozostalo, dyskusji=excluded.dyskusji`).run(
        at, at, new Date(Date.parse(at) + interval).toISOString(), pozostalo, dyskusji);
    })();

    /* Rozmowy idą PO transakcji, bo wychodzą do sieci: trzymanie otwartej
       transakcji SQLite na czas żądań HTTP blokowałoby worker na tyle, ile
       trwa najwolniejsza odpowiedź Allegro. */
    const czatow = await uzupelnijCzaty(database, konto, {
      query, apiUrl, limit: budzetCzatow,
    });
    return { reklamacji: reklamacje.length, dyskusji, czatow };
  } catch (error) {
    const wait = error instanceof BladLimituAllegro
      ? Math.max(interval, error.poIluMs ?? interval * 2)
      : interval;
    const next = new Date(now().getTime() + wait).toISOString();
    const kod = error instanceof BladLimituAllegro ? 429 : kodHttp(error);
    database.prepare(`INSERT INTO allegro_reklamacje_sync_state
      (id,error_count,last_attempt_at,last_error_code,next_attempt_at)
      VALUES(1,1,?,?,?) ON CONFLICT(id) DO UPDATE SET error_count=error_count+1,
      last_attempt_at=excluded.last_attempt_at,last_error_code=excluded.last_error_code,
      next_attempt_at=excluded.next_attempt_at`).run(now().toISOString(), kod, next);
    throw error;
  }
}

/**
 * Które rozmowy warto dociągnąć.
 *
 * Licznik `chat.messagesCount` z listy jest tu jedynym sygnałem: gdy zgadza się
 * z liczbą wiadomości, które mamy, rozmowa jest kompletna i pytanie o nią byłoby
 * żądaniem bez treści. Kolejność bierze się z TERMINU DECYZJI rosnąco — przy
 * ciasnym budżecie pierwszeństwo ma sprawa, która się najbardziej pali, a nie
 * ta, która przypadkiem stoi wyżej na liście Allegro.
 *
 * Sprawy rozstrzygnięte odpadają: ich rozmowa już niczego nie zmieni, a każde
 * żądanie to koszt u Allegro.
 */
export function czatyDoUzupelnienia(
  database: Db, konto: number, limit = CZATOW_NA_PRZEBIEG,
): Array<{ id: number; externalId: string }> {
  /* `status_allegro IS NULL` przechodzi świadomie: sprawa bez statusu nie jest
     rozstrzygnięta, a `NOT IN` przy NULL-u dałoby fałsz i cicho by ją pominęło. */
  const wiersze = database.prepare(`
    SELECT r.id, r.external_id
      FROM reklamacja_klienta r
     WHERE r.channel_account_id = ?
       AND COALESCE(r.status_allegro,'') NOT IN ('CLAIM_ACCEPTED','CLAIM_REJECTED')
       AND r.wiadomosci_ile >
           (SELECT COUNT(*) FROM reklamacja_wiadomosc w WHERE w.reklamacja_id = r.id)
     ORDER BY r.decyzja_do IS NULL, r.decyzja_do ASC, r.id ASC
     LIMIT ?`).all(konto, Math.max(0, limit)) as Array<{ id: number; external_id: string }>;
  return wiersze.map((w) => ({ id: Number(w.id), externalId: String(w.external_id) }));
}

/**
 * Dociągnięcie rozmów, jedna po drugiej.
 *
 * BŁĄD PRZY JEDNEJ SPRAWIE NIE PRZERYWA RESZTY — poza limitem. Sprawa
 * skasowana albo zamknięta po stronie Allegro oddaje 404 i nie jest powodem,
 * żeby nie dociągnąć dziewiętnastu pozostałych; 429 jest, bo wtedy każde
 * następne żądanie tylko pogłębia karę.
 */
async function uzupelnijCzaty(
  database: Db, konto: number,
  opcje: { query: (url: string) => Promise<unknown | null>; apiUrl: string; limit: number },
): Promise<number> {
  if (opcje.limit <= 0) return 0;
  let ile = 0;
  for (const sprawa of czatyDoUzupelnienia(database, konto, opcje.limit)) {
    let body: unknown | null;
    try {
      body = await opcje.query(urlWiadomosciDyskusji(opcje.apiUrl, sprawa.externalId));
    } catch (e) {
      if (e instanceof BladLimituAllegro) throw e;
      continue;
    }
    const wiadomosci = Array.isArray((body as Record<string, unknown> | null)?.chat)
      ? ((body as Record<string, unknown>).chat as Wiadomosc[]) : [];
    if (!wiadomosci.length) continue;
    transaction(database, () => {
      for (const w of wiadomosci) zapiszWiadomosc(database, sprawa.id, w);
    })();
    ile += 1;
  }
  return ile;
}

/**
 * Lądowisko plus model pracy, jednym ruchem.
 *
 * PRACA CZŁOWIEKA JEST NIETYKALNA. Ponowne pobranie uzupełnia pola z Allegro
 * i podnosi `synced_at`, ale nie rusza `prowadzi`, `notatka` ani `wersja` —
 * to jest blizna 0.128.0 rozszerzona o pracę biura, dokładnie jak przy
 * zwrotach.
 */
function zapisz(database: Db, sprawa: Sprawa, konto: number, at: string): void {
  const otwarto = sprawa.openedDate ?? at;
  database.prepare(`INSERT INTO allegro_reklamacja(id,created_at,surowe_json,synced_at)
    VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET created_at=excluded.created_at,
    surowe_json=excluded.surowe_json, synced_at=excluded.synced_at`).run(
    sprawa.id, otwarto, JSON.stringify(oczyscSurowy(sprawa)), at);

  const stan = sprawa.currentState ?? {};
  const oczek = pierwszeOczekiwanie(sprawa);
  /* `chatActive` ma w schemacie `nullable: false`, ale schemat nie ma listy
     `required` — brak pola czytamy więc jako „czat działa". Odwrotne założenie
     wyłączyłoby odpowiadanie przy pierwszym polu, którego Allegro nie odda. */
  const czatAktywny = stan.chatActive === false ? 0 : 1;
  database.prepare(`INSERT INTO reklamacja_klienta
    (channel_account_id,external_id,reference_number,order_id,offer_id,kupujacy_login,
     typ,prawo,powod_typ,powod_opis,temat,opis,oczekiwanie,oczekiwana_kwota_grosze,waluta,
     status_allegro,decyzja_do,status_do,zwrot_wymagany,czat_aktywny,wiadomosci_ile,
     ostatnia_wiadomosc_status,ostatnia_wiadomosc_at,otwarto_at,synced_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(channel_account_id, external_id) DO UPDATE SET
      reference_number=excluded.reference_number, order_id=excluded.order_id,
      offer_id=excluded.offer_id, kupujacy_login=excluded.kupujacy_login,
      typ=excluded.typ, prawo=excluded.prawo, powod_typ=excluded.powod_typ,
      powod_opis=excluded.powod_opis, temat=excluded.temat, opis=excluded.opis,
      oczekiwanie=excluded.oczekiwanie,
      oczekiwana_kwota_grosze=excluded.oczekiwana_kwota_grosze, waluta=excluded.waluta,
      status_allegro=excluded.status_allegro, decyzja_do=excluded.decyzja_do,
      status_do=excluded.status_do, zwrot_wymagany=excluded.zwrot_wymagany,
      czat_aktywny=excluded.czat_aktywny, wiadomosci_ile=excluded.wiadomosci_ile,
      ostatnia_wiadomosc_status=excluded.ostatnia_wiadomosc_status,
      ostatnia_wiadomosc_at=excluded.ostatnia_wiadomosc_at,
      otwarto_at=excluded.otwarto_at, synced_at=excluded.synced_at`).run(
    konto, sprawa.id, sprawa.referenceNumber ?? null, sprawa.checkoutForm?.id ?? null,
    sprawa.offer?.id ?? null, sprawa.buyer?.login ?? null,
    sprawa.type ?? "CLAIM", sprawa.right ?? null,
    sprawa.reason?.type ?? null, sprawa.reason?.description ?? null,
    sprawa.subject ?? null, sprawa.description ?? null,
    oczek.nazwa, oczek.grosze, oczek.waluta,
    stan.status ?? null, sprawa.decisionDueDate ?? null, stan.statusDueDate ?? null,
    stan.returnRequired == null ? null : (stan.returnRequired ? 1 : 0),
    czatAktywny, Number(sprawa.chat?.messagesCount ?? 0),
    sprawa.chat?.lastMessage?.status ?? null, sprawa.chat?.lastMessage?.createdAt ?? null,
    otwarto, at);

  const id = Number((database.prepare(
    "SELECT id FROM reklamacja_klienta WHERE channel_account_id=? AND external_id=?",
  ).get(konto, sprawa.id) as { id: number }).id);

  /* PIERWSZA WIADOMOŚĆ JEST W LIŚCIE i to jest cały zysk: treść zgłoszenia
     widać zaraz po synchronizacji, bez ani jednego żądania więcej. Reszta
     rozmowy dochodzi `uzupelnijCzaty`. */
  if (sprawa.chat?.initialMessage) zapiszWiadomosc(database, id, sprawa.chat.initialMessage);

  /* Załączniki SAMEJ SPRAWY — te spoza rozmowy. Sonda widziała je przy 57
     sprawach na 100, więc to nie jest przypadek brzegowy. */
  for (const z of sprawa.attachments ?? []) zapiszZalacznik(database, id, null, z);
}

/**
 * Jedna wiadomość czatu.
 *
 * `id` bywa nieobecne — schemat nie ma listy `required`, a bez identyfikatora
 * nie da się zbudować idempotencji (blizna 0.128.0). Taka wiadomość PRZEPADA
 * świadomie: duplikat przy każdym przebiegu byłby gorszy od jej braku, a
 * `wiadomosci_ile` z Allegro i tak powie na ekranie, że rozmowa ma dalszy ciąg.
 */
function zapiszWiadomosc(database: Db, reklamacjaId: number, w: Wiadomosc): void {
  if (typeof w?.id !== "string" || !w.id) return;
  database.prepare(`INSERT INTO reklamacja_wiadomosc
    (reklamacja_id,external_id,autor_login,autor_rola,tresc,utworzono_at)
    VALUES (?,?,?,?,?,?)
    ON CONFLICT(reklamacja_id, external_id) DO UPDATE SET
      autor_login=excluded.autor_login, autor_rola=excluded.autor_rola,
      tresc=excluded.tresc, utworzono_at=excluded.utworzono_at`).run(
    reklamacjaId, w.id, w.author?.login ?? null, w.author?.role ?? null,
    w.text ?? "", w.createdAt ?? null);

  const id = Number((database.prepare(
    "SELECT id FROM reklamacja_wiadomosc WHERE reklamacja_id=? AND external_id=?",
  ).get(reklamacjaId, w.id) as { id: number }).id);
  for (const z of w.attachments ?? []) zapiszZalacznik(database, reklamacjaId, id, z);
}

/** Załącznik: nazwa i adres. PLIKU NIE POBIERAMY (polityka danych 0.143.0). */
function zapiszZalacznik(
  database: Db, reklamacjaId: number, wiadomoscId: number | null, z: Zalacznik,
): void {
  if (typeof z?.url !== "string" || !z.url) return;
  database.prepare(`INSERT INTO reklamacja_zalacznik
    (reklamacja_id,wiadomosc_id,nazwa,url) VALUES (?,?,?,?)
    ON CONFLICT(reklamacja_id, url) DO UPDATE SET
      wiadomosc_id=COALESCE(excluded.wiadomosc_id, reklamacja_zalacznik.wiadomosc_id),
      nazwa=excluded.nazwa`).run(
    reklamacjaId, wiadomoscId, z.fileName ?? "", z.url);
}
