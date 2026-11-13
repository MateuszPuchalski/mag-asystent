import { config } from "../config.js";
import { STATUSY_ODDANE } from "./zwrot-pieniedzy.js";
import { db as defaultDb, transaction, type Db } from "../db/db.js";
import {
  ODSWIEZENIE_NA_STRONE, urlListyZwrotow, urlOdswiezeniaZwrotow, zapytajAllegro,
} from "../adapters/allegro.http.js";
import { BladLimituAllegro, BladOdpowiedziAllegro } from "../adapters/allegro.js";
import { kontoKanalu } from "./kanal-konto.js";
import { stanZwrotow } from "./allegro-zwroty-sync-state.js";
import { oczyscSurowy } from "./allegro-oczyszczanie.js";
import { odkodujEncje } from "../tekst.js";
import { uzupelnijDoreczenia, type DoSprawdzenia } from "./allegro-tracking.js";
import { uzupelnijWyplaty, zwrotyDoSprawdzeniaWyplaty } from "./allegro-wyplaty.js";
import { synchronizujZwrotyPlatnosci } from "./allegro-zwroty-platnosci.js";

/* ── Synchronizator zwrotów klienckich ───────────────────────────────────────
   Kształt pól pochodzi z OFICJALNEJ specyfikacji OpenAPI Allegro (modele
   `CustomerReturn`, `CustomerReturnItem`, `CustomerReturnReturnParcel`,
   `CustomerReturnRejection`), nie z pamięci.
   Spis pól z uzasadnieniem stoi w `docs/allegro-ksztalt.md`; §8.2 projektu
   panelu każe traktować TAMTEN dokument jako kontrakt, a ten plik jako jego
   wykonanie.

   TRZECH RZECZY NIE MAPUJEMY, i to jest decyzja, nie przeoczenie:
   `refund.bankAccount` (właściciel, numer, IBAN, SWIFT, adres),
   `parcels[].sender.phoneNumber` oraz adres z konta bankowego. Zwrot da się
   rozstrzygnąć bez nich, a raz pobrane dane osobowe zostają w kopii
   zapasowej na lata. Kolumn na nie po prostu NIE MA — nieuważne mapowanie
   wywali się na SQL-u zamiast wyciec po cichu (pilnuje
   `db/migracja-zwrotow.test.ts`).

   DOTYCZY TO TAKŻE LĄDOWISKA. `surowe_json` przechodzi przez `oczyscSurowy`:
   wartość znika, klucz zostaje, kształt nadal da się obejrzeć.

   Rytm i respekt dla 429 bierze `services/takt.ts`; ponowień w środku
   przebiegu nie ma.                                                         */

type Kwota = { amount?: string; currency?: string };
type Pozycja = {
  offerId?: string; quantity?: number; name?: string; price?: Kwota; url?: string;
  reason?: { type?: string; userComment?: string } | null;
};
type Paczka = { createdAt?: string; waybill?: string; carrierId?: string };
type Zwrot = {
  id: string;
  createdAt?: string;
  referenceNumber?: string;
  orderId?: string;
  /* Sam login. `CustomerReturnBuyer` ma w specyfikacji DWA pola — `login`
     i `email` — i tego drugiego nie bierzemy. Sonda pokazuje zresztą, że
     Allegro przysyła przy zwrocie `email: null` w stu przypadkach na sto. */
  buyer?: { login?: string } | null;
  items?: Pozycja[];
  parcels?: Paczka[];
  rejection?: { code?: string; reason?: string; createdAt?: string } | null;
  /* Oś czasu zwrotu po stronie Allegro. Zwykły `string`, bo schemat
     wymienia jedenaście wartości słownie i nie zamyka ich enumem — nieznana
     wartość ma przejść dalej, a nie wywrócić przebieg. */
  status?: string;
};

/* Kod bierze się z KLASY błędu, nie z jego zdania — jak w skrzynce. */
const kodHttp = (error: unknown): number | null =>
  error instanceof BladOdpowiedziAllegro ? error.status : null;

/**
 * Ile stron wolno przejść w jednym przebiegu.
 *
 * BEZPIECZNIK, nie limit poprawnościowy: chodzimy dalej, dopóki Allegro
 * oddaje pełne strony, ale nie w nieskończoność — zapętlona paginacja biłaby
 * w konto aż do blokady. Dziesięć stron to tysiąc zwrotów na przebieg,
 * czyli więcej, niż firma dostaje w kwartale.
 */
const MAKS_STRON = 10;

/** Ile rekordów prosi jedna strona; musi zgadzać się z `urlListyZwrotow`. */
const NA_STRONE = 100;

export interface ZwrotySyncDeps {
  database?: Db;
  query?: (url: string) => Promise<unknown | null>;
  now?: () => Date;
  apiUrl?: string;
  intervalMs?: number;
  accountId?: string;
  /** Próg bezwzględny; `null` znaczy „bez granicy". Patrz `config.allegro.zwrotyOd`. */
  zwrotyOd?: string | null;
}

function tablica<T>(value: unknown, pole: string): T[] {
  if (!value || typeof value !== "object" || !Array.isArray((value as Record<string, unknown>)[pole])) {
    throw new Error(`Odpowiedź Allegro nie ma tablicy ${pole} opisanej w docs/allegro-ksztalt.md`);
  }
  return (value as Record<string, unknown>)[pole] as T[];
}

/**
 * `count` z odpowiedzi — ile zwrotów pasuje do zapytania W CAŁOŚCI.
 *
 * Schemat `CustomerReturnResponse` wymienia to pole w `required` obok
 * `customerReturns`, więc mamy prawo go oczekiwać. Brak NIE WYWRACA przebiegu:
 * pobranie zwrotów jest ważniejsze od licznika, a `null` umie powiedzieć
 * „nie wiem" — w przeciwieństwie do zera, które kłamałoby, że nic nie zostało.
 */
function liczba(value: unknown): number | null {
  const n = (value as Record<string, unknown> | null)?.count;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

/**
 * Tekst od klienta z odkodowanymi encjami HTML.
 *
 * Ta sama decyzja i ten sam powód co w `allegro-reklamacje-sync.ts`:
 * Allegro koduje niekonsekwentnie, więc dekodujemy każde pole niosące słowa
 * człowieka. Komentarz do zwrotu jest jedynym takim polem w tym pliku —
 * reszta to kody z enumów, w których encji nie ma i być nie może.
 */
const ludzkiZwrot = (s: string | null | undefined): string | null =>
  typeof s === "string" && s !== "" ? odkodujEncje(s) : null;

/**
 * Kwota Allegro na grosze.
 *
 * Allegro oddaje kwotę STRINGIEM i mówi wprost dlaczego: „to avoid rounding
 * errors". Zamiana na `number` i mnożenie przez sto zwróciłaby ten błąd
 * tylnymi drzwiami (`19.99 * 100` to 1998.9999...), a my te kwoty sumujemy,
 * żeby zaproponować zwrot. Liczymy więc na tekście.
 */
export function naGrosze(amount: string | undefined): number {
  if (!amount) return 0;
  const m = /^(-?)(\d+)(?:[.,](\d{1,2}))?$/.exec(amount.trim());
  if (!m) throw new Error(`Kwota Allegro „${amount}" nie ma kształtu z docs/allegro-ksztalt.md`);
  const grosze = Number(m[2]) * 100 + Number((m[3] ?? "0").padEnd(2, "0"));
  return m[1] === "-" ? -grosze : grosze;
}

/**
 * Najwcześniejsza paczka: jej data, przewoźnik i NUMER LISTU.
 *
 * `data` na NULL znaczy „towar jeszcze nie wrócił". Wszystkie trzy pola idą
 * z TEJ SAMEJ paczki — inaczej zwrot w dwóch przesyłkach pokazywałby datę
 * jednej, firmę drugiej, a numer trzeciej.
 */
function pierwszaPaczka(paczki: Paczka[] | undefined):
  { data: string | null; przewoznik: string | null; waybill: string | null } {
  const zDatami = (paczki ?? []).filter((p) => Boolean(p.createdAt))
    .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  const p = zDatami[0];
  return {
    data: p?.createdAt ?? null,
    przewoznik: p?.carrierId ?? null,
    waybill: (p?.waybill ?? "").trim() || null,
  };
}

/** Jeden przebieg. Sieć kończy się PRZED transakcją, więc wolne API nie blokuje SQLite. */
export async function synchronizujAllegroZwroty(deps: ZwrotySyncDeps = {}): Promise<void> {
  const database = deps.database ?? defaultDb();
  const query = deps.query ?? zapytajAllegro;
  const now = deps.now ?? (() => new Date());
  const apiUrl = deps.apiUrl ?? config.allegro.apiUrl;
  const interval = deps.intervalMs ?? config.allegro.zwrotySyncMs;
  const od = deps.zwrotyOd !== undefined ? deps.zwrotyOd : config.allegro.zwrotyOd;
  const start = stanZwrotow(database);

  /* Kursor rządzi w ZAPYTANIU, gdy jest; filtr dat wchodzi tylko przy pierwszym
     przebiegu. Trzymanie obu naraz zawężałoby wynik dwa razy i cicho przestałoby
     oddawać cokolwiek nowego.

     PRÓG jest granicą tego, co firma w ogóle chce widzieć, więc obowiązuje
     ZAWSZE — także wtedy, gdy
     kursor już stoi i zapytanie nie niesie żadnej daty. Dlatego oprócz filtra
     w adresie tnie się jeszcze wynik, niżej. */
  const odKiedy = start.cursorId ? null : od;

  const zebrane: Zwrot[] = [];
  /* Ile rekordów Allegro nam ODDAŁO — surowo, przed odsianiem progiem. Do
     porównania z `count` liczy się to, co przyszło, a nie to, co zatrzymaliśmy:
     próg `zwrotyOd` odrzuca rekordy CELOWO i nie jest żadną luką. */
  let pobrano = 0;
  let wszystkich: number | null = null;
  /* Czy lista skończyła się sama. `false` znaczy, że urwał ją bezpiecznik
     stron — i wtedy reszta zwrotów zostaje po tamtej stronie. */
  let komplet = false;
  try {
    for (let strona = 0; strona < MAKS_STRON; strona++) {
      const body = await query(urlListyZwrotow(apiUrl, odKiedy, strona * NA_STRONE, start.cursorId));
      const partia = tablica<Zwrot>(body, "customerReturns");
      if (strona === 0) wszystkich = liczba(body);
      pobrano += partia.length;
      /* Zwrot BEZ daty przepuszczamy — `createdAt` jest w schemacie opcjonalne,
         a cicha utrata zwrotu kosztuje więcej niż jeden rekord za progiem. */
      zebrane.push(...partia.filter((z) => typeof z?.id === "string"
        && !(od && z.createdAt && z.createdAt < od)));
      if (partia.length < NA_STRONE) { komplet = true; break; }
    }

    /* OGON, czyli czego ten przebieg NIE wziął.
       Bezpiecznik `MAKS_STRON` chronił konto przed zapętloną paginacją i robił
       to dobrze — ale robił to CICHO. Przebieg urwany na dziesiątej stronie
       kończył się sukcesem, kursor szedł naprzód i zwroty spoza tamtej granicy
       nie wracały już nigdy. Kolejka ustawia się według terminu ustawowego,
       więc niewidoczne wiersze były w większości tymi najbardziej spóźnionymi.

       Liczymy z `count`, a nie z „ile stron przeszliśmy": Allegro samo mówi,
       ile rekordów pasuje do zapytania. Lista domknięta własnym końcem nie ma
       ogona z definicji — nawet gdyby `count` mówił inaczej, bo między
       pierwszą a ostatnią stroną mógł dojść nowy zwrot. */
    const pozostalo = komplet ? 0
      : wszystkich === null ? null : Math.max(0, wszystkich - pobrano);

    const at = now().toISOString();
    /* Kursor liczymy z NAJPÓŹNIEJSZEJ daty, a nie z ostatniego elementu
       tablicy. Dokumentacja nie obiecuje porządku listy, a kursor wzięty
       z niewłaściwego końca przewinąłby nas wstecz przy każdym przebiegu. */
    const najnowszy = zebrane.reduce<Zwrot | null>(
      (a, z) => (!a || (z.createdAt ?? "") > (a.createdAt ?? "") ? z : a), null);

    let konto = 0;
    transaction(database, () => {
      konto = kontoKanalu(database, deps.accountId ?? config.allegro.clientId);
      for (const zwrot of zebrane) zapisz(database, zwrot, konto, at);

      /* `error_count` ZERUJE SIĘ na sukcesie, jak w skrzynce. Licznik, który
         tylko rośnie, po tygodniu mówi wyłącznie „kiedyś było źle". */
      database.prepare(`INSERT INTO allegro_zwroty_sync_state
        (id,cursor_id,cursor_at,last_success_at,last_attempt_at,last_error_code,
         error_count,next_attempt_at,pozostalo)
        VALUES(1,?,?,?,?,NULL,0,?,?) ON CONFLICT(id) DO UPDATE SET
        cursor_id=excluded.cursor_id, cursor_at=excluded.cursor_at,
        last_success_at=excluded.last_success_at, last_attempt_at=excluded.last_attempt_at,
        last_error_code=NULL, error_count=0, next_attempt_at=excluded.next_attempt_at,
        pozostalo=excluded.pozostalo`).run(
        najnowszy?.id ?? start.cursorId,
        najnowszy?.createdAt ?? start.cursorAt,
        at, at, new Date(Date.parse(at) + interval).toISOString(), pozostalo);
    })();

    /* ODŚWIEŻENIE ZNANYCH ZWROTÓW — przed trackingiem, bo dopiero ono przynosi
       numer listu zwrotom pobranym przed nadaniem paczki. Własny parasol:
       zepsuta strona odświeżenia nie ma prawa zabrać nowych zwrotów ani pytania
       o doręczenia. 429 idzie wyżej, bo limit jest wspólny dla całego konta. */
    try {
      await odswiezZnane(database, konto, query, apiUrl, od,
        new Set(zebrane.map((z) => z.id)), at);
    } catch (error) {
      if (error instanceof BladLimituAllegro) throw error;
      console.warn("[zwroty] odświeżenie znanych zwrotów nie doszło:",
        error instanceof Error ? error.message : error);
    }

    /* Tracking idzie PO transakcji, bo wychodzi do sieci: trzymanie otwartej
       transakcji SQLite na czas żądania HTTP blokowałoby drugi proces (worker)
       na tyle, ile trwa najwolniejszy przewoźnik. */
    await uzupelnijDoreczenia(database, paczkiDoSprawdzenia(database, konto),
      { query: deps.query, apiUrl });

    /* WYPŁATY W TYM SAMYM TAKCIE, nie w osobnym. To jest to samo pytanie co
       wyżej — „co się stało z tą sprawą po stronie Allegro" — zadane innej
       końcówce. Osobny rytm dokładałby kolejny chór na jednym adresie IP
       (nagłówek `services/takt.ts`).

       Własny parasol, jak przy odświeżaniu znanych: brak uprawnienia
       `allegro:api:payments:read` albo zepsuta końcówka płatności nie ma prawa
       zabrać ani nowych zwrotów, ani doręczeń. 429 idzie wyżej — limit jest
       wspólny dla całego konta. */
    /* LUSTRO ZWROTÓW PŁATNOŚCI PRZED PYTANIEM O OPERACJE. Jedno żądanie na
       przebieg zatrzaskuje to, co zobaczy, a lista pytań o płatność kurczy się
       o zwroty już rozliczone. Własny parasol z tego samego powodu co wyżej. */
    try {
      const lustro = await synchronizujZwrotyPlatnosci(
        database, konto, { query: deps.query, apiUrl });
      if (lustro.zatrzasniete) {
        console.log(`[zwroty] wypłata z listy zwrotów płatności przy ${lustro.zatrzasniete} zwrotach`);
      }
    } catch (error) {
      if (error instanceof BladLimituAllegro) throw error;
      console.warn("[zwroty] lista zwrotów płatności nie doszła:",
        error instanceof Error ? error.message : error);
    }

    try {
      const zatrzasniete = await uzupelnijWyplaty(
        database, zwrotyDoSprawdzeniaWyplaty(database, konto),
        { query: deps.query, apiUrl });
      if (zatrzasniete) {
        console.log(`[zwroty] wypłata potwierdzona przy ${zatrzasniete} zwrotach`);
      }
    } catch (error) {
      if (error instanceof BladLimituAllegro) throw error;
      console.warn("[zwroty] sprawdzenie wypłat nie doszło:",
        error instanceof Error ? error.message : error);
    }
  } catch (error) {
    const wait = error instanceof BladLimituAllegro
      ? Math.max(interval, error.poIluMs ?? interval * 2)
      : interval;
    const next = new Date(now().getTime() + wait).toISOString();
    const kod = error instanceof BladLimituAllegro ? 429 : kodHttp(error);
    database.prepare(`INSERT INTO allegro_zwroty_sync_state
      (id,error_count,last_attempt_at,last_error_code,next_attempt_at)
      VALUES(1,1,?,?,?) ON CONFLICT(id) DO UPDATE SET error_count=error_count+1,
      last_attempt_at=excluded.last_attempt_at,last_error_code=excluded.last_error_code,
      next_attempt_at=excluded.next_attempt_at`).run(now().toISOString(), kod, next);
    throw error;
  }
}

/**
 * Ile stron odświeżenia wolno przejść w jednym przebiegu.
 *
 * Bezpiecznik jak `MAKS_STRON`, tylko przy stronie dziesięć razy większej:
 * trzy tysiące otwartych zwrotów to więcej, niż firma ma w kolejce przez kwartał.
 */
const MAKS_STRON_ODSWIEZENIA = 3;

/**
 * Odświeża zwroty, które już mamy i które nie są zamknięte.
 *
 * KURSOR ODDAJE TYLKO NOWE. Zwrot pobrany przed nadaniem paczki nie
 * dostałby potem ani listu, ani terminu, ani `FINISHED`.
 *
 * OKNO OD NAJSTARSZEGO OTWARTEGO. Zwrot zamknięty u nas albo rozliczony
 * w Allegro nie ma już czego się dowiedzieć, a ciągnąłby okno w przeszłość.
 * Zwroty pobrane w tym samym przebiegu pomijamy — są świeże z definicji.
 *
 * ZAPISUJE WYŁĄCZNIE ZNANE. Lista w oknie oddaje też zwroty skasowane z bazy
 * przez `zwroty:sprzatnij`. Wstawienie ich z powrotem cofnęłoby
 * tamto sprzątanie po cichu, przy każdym takcie. Nowe zwroty przynosi kursor
 * i tylko on.
 */
async function odswiezZnane(
  database: Db, konto: number, query: (url: string) => Promise<unknown | null>,
  apiUrl: string, od: string | null, pobraneTeraz: Set<string>, at: string,
): Promise<number> {
  /* ZAMKNIĘTY, ALE NIEZAPŁACONY TEŻ SIĘ ODŚWIEŻA. Zwrot po
     korekcie czeka w DO ZWROTU na wyjście pieniędzy (`pieniadzeCzekaja`),
     a jedynym śladem pieniędzy oddanych ręką w Allegro jest status zwrotu.
     Bez odświeżania taki zwrot stałby w pracy do dnia automatu Allegro.
     Okno czternastu dni od zamknięcia: termin to siedem dni od paczki, więc
     starszy zwrot nie ma już czego czekać — a okno ciągnie zapytanie w tył. */
  const odKiedyZamkniete = new Date(Date.parse(at) - 14 * 86_400_000).toISOString();
  const otwarte = database.prepare(`SELECT external_id, created_at FROM zwrot_klienta
    WHERE channel_account_id = ? AND rozliczony_allegro_at IS NULL
      AND (zamkniety_at IS NULL
        OR (zamkniety_at >= ? AND zamkniecie_reczne_at IS NULL AND werdykt = 'przyjety' AND kwota_grosze > 0
            AND zwrot_pieniedzy_id IS NULL AND zwrot_pieniedzy_command_id IS NULL
            AND odmowa_kod IS NULL AND przelew_at IS NULL))`)
    .all(konto, odKiedyZamkniete) as Array<{ external_id: string; created_at: string }>;
  const doOdswiezenia = new Set(
    otwarte.map((z) => z.external_id).filter((id) => !pobraneTeraz.has(id)));
  if (!doOdswiezenia.size) return 0;

  /* Daty porównujemy jako tekst: Allegro oddaje ISO 8601 w UTC, a ta sama
     kolumna trzyma je dosłownie. Próg firmy obowiązuje i tutaj. */
  const najstarszy = otwarte.reduce(
    (a, z) => (z.created_at < a ? z.created_at : a), otwarte[0].created_at);
  const odKiedy = od && od > najstarszy ? od : najstarszy;

  const zebrane: Zwrot[] = [];
  for (let strona = 0; strona < MAKS_STRON_ODSWIEZENIA; strona++) {
    const partia = tablica<Zwrot>(
      await query(urlOdswiezeniaZwrotow(apiUrl, odKiedy, strona * ODSWIEZENIE_NA_STRONE)),
      "customerReturns");
    zebrane.push(...partia.filter((z) => typeof z?.id === "string" && doOdswiezenia.has(z.id)));
    if (partia.length < ODSWIEZENIE_NA_STRONE) break;
  }
  if (!zebrane.length) return 0;

  transaction(database, () => {
    for (const zwrot of zebrane) zapisz(database, zwrot, konto, at);
  })();
  return zebrane.length;
}

/**
 * Ile paczek pytamy w jednym przebiegu.
 *
 * Dwadzieścia numerów mieści się w jednym żądaniu, więc dwieście to dziesięć
 * wywołań na takt — dużo mniej, niż kosztuje samo pobranie strony zwrotów.
 * Próg istnieje na wypadek pierwszego przebiegu po wdrożeniu, gdy w drodze
 * jest cała zaległość naraz.
 */
export const TRACKING_NA_PRZEBIEG = 200;

/**
 * Które paczki warto odpytać u przewoźnika.
 *
 * ── Dlaczego to czyta BAZĘ, a nie świeżo pobranej strony ──────────────────
 * Synchronizacja chodzi po KURSORZE: `from` w `getCustomerReturns` znaczy
 * „zwroty utworzone PO tym zwrocie", więc raz zobaczony zwrot nigdy nie
 * wraca na listę. Świeża strona niesie tylko zwroty zgłoszone przed chwilą,
 * a takie nie są jeszcze doręczone.
 *
 * Lista czyta numer listu Z LĄDOWISKA: potrzebna jest para numer+przewoźnik
 * z KAŻDEJ paczki zwrotu, a model pracy trzyma tylko pierwszą.
 *
 * TYLKO TE W DRODZE — decyzja właściciela. Zwrot z zapisaną datą doręczenia
 * nie jest pytany drugi raz: data się nie zmieni, a każde żądanie to koszt
 * u Allegro. Zamknięte i odrzucone odpadają razem z nimi.
 *
 * NAJNOWSZE PIERWSZE, gdy zaległość nie mieści się w progu. Odwrotny porządek
 * oddawałby budżet paczkom, które stoją nierozstrzygnięte od miesięcy i
 * pewnie już nigdy nie dojadą — a nowe czekałyby za nimi w nieskończoność.
 */
export function paczkiDoSprawdzenia(
  database: Db, konto: number, limit = TRACKING_NA_PRZEBIEG,
): DoSprawdzenia[] {
  const wiersze = database.prepare(`
    SELECT z.id AS zwrot_id,
           json_extract(p.value, '$.carrierId') AS carrier_id,
           json_extract(p.value, '$.waybill')   AS waybill
      FROM zwrot_klienta z
      JOIN allegro_zwrot a ON a.id = z.external_id,
           json_each(json_extract(a.surowe_json, '$.parcels')) p
     WHERE z.channel_account_id = ?
       AND z.dostarczono_at IS NULL
       AND z.zamkniety_at IS NULL
       AND (z.werdykt IS NULL OR z.werdykt <> 'odrzucony')
       AND json_extract(p.value, '$.waybill')   IS NOT NULL
       AND json_extract(p.value, '$.carrierId') IS NOT NULL
     ORDER BY z.created_at DESC, z.id DESC, p.key ASC`)
    .all(konto) as Array<{ zwrot_id: number; carrier_id: string; waybill: string }>;

  /* Jedna paczka na zwrot — PIERWSZA z kompletem danych.
     `ORDER BY p.key` daje porządek tablicy z odpowiedzi Allegro. */
  const wynik: DoSprawdzenia[] = [];
  const juz = new Set<number>();
  for (const w of wiersze) {
    if (juz.has(w.zwrot_id)) continue;
    juz.add(w.zwrot_id);
    wynik.push({ zwrotId: Number(w.zwrot_id), carrierId: w.carrier_id, waybill: w.waybill });
    if (wynik.length >= limit) break;
  }
  return wynik;
}

/**
 * Lądowisko plus model pracy, jednym ruchem.
 *
 * DECYZJE BIURA SĄ NIETYKALNE. Ponowne pobranie uzupełnia pola z Allegro
 * i podnosi `synced_at`, ale nie rusza `werdykt*`, `kwota*`, `korekta*` ani
 * `wersja`. Pozycje są odbiciem Allegro; ocena hali wisi jednak na pozycji,
 * więc zostaje po kluczu naturalnym.
 */
/**
 * Jeden zwrot spod numeru listu przewozowego.
 *
 * Wołane WYŁĄCZNIE ze skanu etykiety, gdy lokalne szukanie nic nie znalazło:
 * paczka bywa u nas szybciej, niż zwrot doleci synchronizacją. Pytamy Allegro
 * o ten jeden numer filtrem `parcels.waybill`.
 *
 * KURSORA I STANU SYNCHRONIZACJI NIE RUSZA. To jest zapytanie punktowe, a nie
 * przebieg: przesunięcie kursora na podstawie zwrotu wyłowionego ze środka
 * historii kazałoby synchronizatorowi przeskoczyć wszystko, czego jeszcze nie
 * widział.
 *
 * Próg `zwrotyOd` obowiązuje tak samo jak w przebiegu — firma nie chce widzieć
 * zwrotów sprzed granicy, choćby przyjechały punktowo.
 */
export async function dociagnijZwrotPoLiscie(
  waybill: string, deps: ZwrotySyncDeps = {},
): Promise<number> {
  const database = deps.database ?? defaultDb();
  const query = deps.query ?? zapytajAllegro;
  const now = deps.now ?? (() => new Date());
  const apiUrl = deps.apiUrl ?? config.allegro.apiUrl;
  const od = deps.zwrotyOd !== undefined ? deps.zwrotyOd : config.allegro.zwrotyOd;
  const kod = (waybill ?? "").trim();
  if (!kod) return 0;

  const body = await query(urlListyZwrotow(apiUrl, null, 0, null, kod));
  const partia = tablica<Zwrot>(body, "customerReturns")
    .filter((z) => typeof z?.id === "string" && !(od && z.createdAt && z.createdAt < od));
  if (!partia.length) return 0;

  const at = now().toISOString();
  return transaction(database, () => {
    const konto = kontoKanalu(database, deps.accountId ?? config.allegro.clientId);
    for (const zwrot of partia) zapisz(database, zwrot, konto, at);
    return partia.length;
  })();
}

function zapisz(database: Db, zwrot: Zwrot, konto: number, at: string): void {
  const utworzono = zwrot.createdAt ?? at;
  database.prepare(`INSERT INTO allegro_zwrot(id,created_at,surowe_json,synced_at)
    VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET created_at=excluded.created_at,
    surowe_json=excluded.surowe_json, synced_at=excluded.synced_at`).run(
    zwrot.id, utworzono, JSON.stringify(oczyscSurowy(zwrot)), at);

  const paczka = pierwszaPaczka(zwrot.parcels);
  database.prepare(`INSERT INTO zwrot_klienta
    (channel_account_id,external_id,reference_number,order_id,created_at,paczka_at,
     kupujacy_login,przewoznik,waybill,rejection_code,rejection_reason,status_allegro,
     rozliczony_allegro_at,synced_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(channel_account_id, external_id) DO UPDATE SET
      reference_number=excluded.reference_number, order_id=excluded.order_id,
      created_at=excluded.created_at, paczka_at=excluded.paczka_at,
      kupujacy_login=excluded.kupujacy_login, przewoznik=excluded.przewoznik,
      -- NUMER LISTU NIE ZNIKA przy odświeżeniu (0.344.0). Allegro potrafi
      -- oddać zwrot bez tablicy parcels, zanim klient nada paczkę, i wtedy
      -- excluded.waybill jest puste. Nadpisanie skasowałoby numer, który
      -- operator ma na naklejce w ręku.
      waybill=COALESCE(excluded.waybill, zwrot_klienta.waybill),
      rejection_code=excluded.rejection_code, rejection_reason=excluded.rejection_reason,
      status_allegro=excluded.status_allegro,
      -- ZATRZASK ROZLICZENIA (0.345.0). status_allegro to wskaźnik TERAZ,
      -- a nie historia: zwrot rozliczony idzie dalej tą samą osią czasu,
      -- choćby na COMMISSION_REFUND_CLAIMED, który mówi o NASZEJ prowizji,
      -- nie o pieniądzach klienta. COALESCE trzyma PIERWSZĄ zobaczoną datę,
      -- więc raz stwierdzone rozliczenie już nie znika.
      rozliczony_allegro_at=COALESCE(
        zwrot_klienta.rozliczony_allegro_at, excluded.rozliczony_allegro_at),
      synced_at=excluded.synced_at`).run(
    konto, zwrot.id, zwrot.referenceNumber ?? null, zwrot.orderId ?? null,
    utworzono, paczka.data, zwrot.buyer?.login ?? null, paczka.przewoznik,
    paczka.waybill,
    zwrot.rejection?.code ?? null, zwrot.rejection?.reason ?? null,
    zwrot.status ?? null,
    STATUSY_ODDANE.has(String(zwrot.status ?? "")) ? at : null, at);

  const id = Number((database.prepare(
    "SELECT id FROM zwrot_klienta WHERE channel_account_id=? AND external_id=?",
  ).get(konto, zwrot.id) as { id: number }).id);

  /* UPSERT PO KLUCZU NATURALNYM, nie `DELETE` + `INSERT`. Kasowanie
     zmieniałoby `id` pozycji przy każdym przebiegu, więc potwierdzenie
     z otwartego panelu trafiałoby w cudzy wiersz. Z kluczem w kolumnie
     praca człowieka po prostu ZOSTAJE. */
  /* NUMER WYSTĄPIENIA. `CustomerReturnItem` w specyfikacji Allegro
     nie ma ŻADNEGO identyfikatora pozycji — są `offerId`, `quantity`, `name`,
     `price`, `url`, `reason` i `serialNumbers`. Ta sama oferta potrafi więc
     wystąpić w zwrocie dwa razy, a sam `offer_id|nazwa` sklejał je w jeden
     klucz: druga pozycja CICHO nadpisywała pierwszą przez `DO UPDATE`, więc
     zwrot gubił wiersz, a kwota liczyła się z jednej sztuki zamiast dwóch.

     Pierwsze wystąpienie zostaje przy kluczu bez przyrostka — inaczej każdy
     przebieg przekluczyłby wiersze zastane, a do klucza przywiązana jest praca
     człowieka: ocena, kartoteka i zaznaczenie do kwoty. */
  const licznik = new Map<string, number>();
  const widziane: string[] = [];
  for (const poz of zwrot.items ?? []) {
    const nazwa = poz.name ?? "";
    const para = `${poz.offerId ?? ""}|${nazwa}`;
    const n = (licznik.get(para) ?? 0) + 1;
    licznik.set(para, n);
    const klucz = n === 1 ? para : `${para}|#${n}`;
    widziane.push(klucz);
    database.prepare(`INSERT INTO zwrot_klienta_pozycja
      (zwrot_id,offer_id,nazwa,ilosc,cena_grosze,waluta,powod,powod_komentarz,url,klucz)
      VALUES (?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(zwrot_id, klucz) DO UPDATE SET
        offer_id=excluded.offer_id, ilosc=excluded.ilosc,
        cena_grosze=excluded.cena_grosze, waluta=excluded.waluta,
        powod=excluded.powod, powod_komentarz=excluded.powod_komentarz,
        url=excluded.url`).run(
      id, poz.offerId ?? null, nazwa, Number(poz.quantity ?? 0),
      naGrosze(poz.price?.amount), poz.price?.currency ?? "PLN",
      /* `userComment` to zdanie KLIENTA własnymi słowami, więc przechodzi przez
         dekoder; `reason.type` zostaje surowy, bo to kod z enumu Allegro. */
      poz.reason?.type ?? null, ludzkiZwrot(poz.reason?.userComment),
      poz.url ?? null, klucz);
  }

  /* Pozycja, której Allegro już nie oddaje, znika — ale dopiero teraz i tylko
     ona. Zwrot potrafi stracić pozycję, gdy klient wycofa część zgłoszenia.

     `zrodlo='allegro'` jest tu WARUNKIEM POPRAWNOŚCI, nie filtrem na zapas.
     Pozycji dopisanej przez biuro Allegro nie zna i nigdy nie
     odda, więc bez tego warunku każdy takt kasowałby ją razem z oceną hali
     i zaznaczeniem do kwoty. */
  const zostaja = widziane.length
    ? ` AND klucz NOT IN (${widziane.map(() => "?").join(",")})`
    : "";
  database.prepare(
    `DELETE FROM zwrot_klienta_pozycja
     WHERE zwrot_id=? AND zrodlo='allegro'${zostaja}`
  ).run(id, ...widziane);
}
