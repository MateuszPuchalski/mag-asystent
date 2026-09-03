import { config } from "../config.js";
import { db as defaultDb, transaction, type Db } from "../db/db.js";
import { urlListyZwrotow, zapytajAllegro } from "../adapters/allegro.http.js";
import { BladLimituAllegro, BladOdpowiedziAllegro } from "../adapters/allegro.js";
import { kontoKanalu } from "./kanal-konto.js";
import { stanZwrotow } from "./allegro-zwroty-sync-state.js";
import { oczyscSurowy } from "./allegro-oczyszczanie.js";

/* ── Synchronizator zwrotów klienckich (0.150.0) ─────────────────────────────
   Kształt pól pochodzi z OFICJALNEJ specyfikacji OpenAPI Allegro (modele
   `CustomerReturn`, `CustomerReturnItem`, `CustomerReturnReturnParcel`,
   `CustomerReturnRejection`), nie z pamięci i nie z kodu sprzed 0.138.0.
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

   OD 0.152.0 DOTYCZY TO TAKŻE LĄDOWISKA. Do 0.151.0 `surowe_json` trzymało
   odpowiedź dosłownie, więc IBAN i telefon nadawcy jednak lądowały w bazie —
   wbrew zdaniu z polityki danych, które mówiło „nie pobieramy". Teraz
   przechodzą przez `oczyscSurowy`: wartość znika, klucz zostaje, kształt
   nadal da się obejrzeć.

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
  /* Oś czasu zwrotu po stronie Allegro (0.164.0). Zwykły `string`, bo schemat
     wymienia jedenaście wartości słownie i nie zamyka ich enumem — nieznana
     wartość ma przejść dalej, a nie wywrócić przebieg. */
  status?: string;
};

/* Kod bierze się z KLASY błędu, nie z jego zdania — ta sama poprawka co
   w skrzynce w 0.149.0. */
const kodHttp = (error: unknown): number | null =>
  error instanceof BladOdpowiedziAllegro ? error.status : null;

/**
 * Ile stron wolno przejść w jednym przebiegu.
 *
 * BEZPIECZNIK, nie limit poprawnościowy: to jest blizna 0.127.0 postawiona
 * na głowie. Tam rejestr czytał PIERWSZĄ stronę i gubił resztę po cichu;
 * tu chodzimy dalej, dopóki Allegro oddaje pełne strony, ale nie w
 * nieskończoność — zapętlona paginacja biłaby w konto aż do blokady.
 * Dziesięć stron to tysiąc zwrotów na przebieg, czyli więcej, niż firma
 * dostaje w kwartale.
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
 * Najwcześniejsza paczka: jej data i przewoźnik.
 *
 * `data` na NULL znaczy „towar jeszcze nie wrócił". Przewoźnik idzie z TEJ
 * SAMEJ paczki, co data — inaczej zwrot w dwóch przesyłkach pokazywałby datę
 * jednej, a firmę drugiej.
 */
function pierwszaPaczka(paczki: Paczka[] | undefined):
  { data: string | null; przewoznik: string | null } {
  const zDatami = (paczki ?? []).filter((p) => Boolean(p.createdAt))
    .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  const p = zDatami[0];
  return { data: p?.createdAt ?? null, przewoznik: p?.carrierId ?? null };
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

     Ale PRÓG to nie to samo co dawne okno względne (0.152.0). Okno było
     wyłącznie oszczędnością pierwszego pobrania; próg jest granicą tego, co
     firma w ogóle chce widzieć, więc obowiązuje ZAWSZE — także wtedy, gdy
     kursor już stoi i zapytanie nie niesie żadnej daty. Dlatego oprócz filtra
     w adresie tnie się jeszcze wynik, niżej. */
  const odKiedy = start.cursorId ? null : od;

  const zebrane: Zwrot[] = [];
  try {
    for (let strona = 0; strona < MAKS_STRON; strona++) {
      const body = await query(urlListyZwrotow(apiUrl, odKiedy, strona * NA_STRONE, start.cursorId));
      const partia = tablica<Zwrot>(body, "customerReturns");
      /* Zwrot BEZ daty przepuszczamy — `createdAt` jest w schemacie opcjonalne,
         a cicha utrata zwrotu kosztuje więcej niż jeden rekord za progiem. */
      zebrane.push(...partia.filter((z) => typeof z?.id === "string"
        && !(od && z.createdAt && z.createdAt < od)));
      if (partia.length < NA_STRONE) break;
    }

    const at = now().toISOString();
    /* Kursor liczymy z NAJPÓŹNIEJSZEJ daty, a nie z ostatniego elementu
       tablicy. Dokumentacja nie obiecuje porządku listy, a kursor wzięty
       z niewłaściwego końca przewinąłby nas wstecz przy każdym przebiegu. */
    const najnowszy = zebrane.reduce<Zwrot | null>(
      (a, z) => (!a || (z.createdAt ?? "") > (a.createdAt ?? "") ? z : a), null);

    transaction(database, () => {
      const konto = kontoKanalu(database, deps.accountId ?? config.allegro.clientId);
      for (const zwrot of zebrane) zapisz(database, zwrot, konto, at);

      /* `error_count` ZERUJE SIĘ na sukcesie — ta sama poprawka co w skrzynce
         w 0.147.0. Licznik, który tylko rośnie, po tygodniu mówi wyłącznie
         „kiedyś było źle". */
      database.prepare(`INSERT INTO allegro_zwroty_sync_state
        (id,cursor_id,cursor_at,last_success_at,last_attempt_at,last_error_code,
         error_count,next_attempt_at)
        VALUES(1,?,?,?,?,NULL,0,?) ON CONFLICT(id) DO UPDATE SET
        cursor_id=excluded.cursor_id, cursor_at=excluded.cursor_at,
        last_success_at=excluded.last_success_at, last_attempt_at=excluded.last_attempt_at,
        last_error_code=NULL, error_count=0, next_attempt_at=excluded.next_attempt_at`).run(
        najnowszy?.id ?? start.cursorId,
        najnowszy?.createdAt ?? start.cursorAt,
        at, at, new Date(Date.parse(at) + interval).toISOString());
    })();
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
 * Lądowisko plus model pracy, jednym ruchem.
 *
 * DECYZJE BIURA SĄ NIETYKALNE. Ponowne pobranie uzupełnia pola z Allegro
 * i podnosi `synced_at`, ale nie rusza `werdykt*`, `kwota*`, `korekta*` ani
 * `wersja` — to jest blizna 0.128.0 („drugi przebieg nie robi duplikatów")
 * rozszerzona o pracę człowieka. Pozycje przepisujemy w całości, bo są
 * odbiciem Allegro; ocena hali wisi jednak na pozycji, więc wraca po
 * kluczu naturalnym zamiast zginąć razem z wierszem.
 */
/**
 * Jeden zwrot spod numeru listu przewozowego (0.163.0).
 *
 * Wołane WYŁĄCZNIE ze skanu etykiety, gdy lokalne szukanie nic nie znalazło:
 * paczka bywa u nas szybciej, niż zwrot doleci synchronizacją. Pytamy Allegro
 * o ten jeden numer filtrem `parcels.waybill`.
 *
 * KURSORA I STANU SYNCHRONIZACJI NIE RUSZA. To jest zapytanie punktowe, a nie
 * przebieg: przesunięcie kursora na podstawie zwrotu wyłowionego ze środka
 * historii kazałoby synchronizatorowi przeskoczyć wszystko, czego jeszcze nie
 * widział. Blizna 0.127.0 mówi o tym samym gatunku cichej straty.
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
     kupujacy_login,przewoznik,rejection_code,rejection_reason,status_allegro,synced_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(channel_account_id, external_id) DO UPDATE SET
      reference_number=excluded.reference_number, order_id=excluded.order_id,
      created_at=excluded.created_at, paczka_at=excluded.paczka_at,
      kupujacy_login=excluded.kupujacy_login, przewoznik=excluded.przewoznik,
      rejection_code=excluded.rejection_code, rejection_reason=excluded.rejection_reason,
      status_allegro=excluded.status_allegro,
      synced_at=excluded.synced_at`).run(
    konto, zwrot.id, zwrot.referenceNumber ?? null, zwrot.orderId ?? null,
    utworzono, paczka.data, zwrot.buyer?.login ?? null, paczka.przewoznik,
    zwrot.rejection?.code ?? null, zwrot.rejection?.reason ?? null,
    zwrot.status ?? null, at);

  const id = Number((database.prepare(
    "SELECT id FROM zwrot_klienta WHERE channel_account_id=? AND external_id=?",
  ).get(konto, zwrot.id) as { id: number }).id);

  /* UPSERT PO KLUCZU NATURALNYM, nie `DELETE` + `INSERT`.
     Do 0.153.1 pozycje kasowało się i wstawiało od nowa, a pracę człowieka
     odtwarzało z mapy po `offer_id|nazwa`. Kosztowało to dwie rzeczy naraz:
     `id` pozycji zmieniało się przy każdym przebiegu, więc potwierdzenie
     wysłane z otwartego panelu trafiało w cudzy wiersz albo w „nie
     znaleziono"; a dwie pozycje o tej samej nazwie bez `offer_id` sklejały
     się w jeden klucz mapy i jedna traciła ocenę.

     Teraz klucz jest kolumną, a praca człowieka po prostu ZOSTAJE — nie
     trzeba jej nigdzie odkładać ani oddawać. */
  /* NUMER WYSTĄPIENIA (0.162.1). `CustomerReturnItem` w specyfikacji Allegro
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
      poz.reason?.type ?? null, poz.reason?.userComment ?? null,
      poz.url ?? null, klucz);
  }

  /* Pozycja, której Allegro już nie oddaje, znika — ale dopiero teraz i tylko
     ona. Zwrot potrafi stracić pozycję, gdy klient wycofa część zgłoszenia.

     `zrodlo='allegro'` jest tu WARUNKIEM POPRAWNOŚCI, nie filtrem na zapas
     (0.184.0). Pozycji dopisanej przez biuro Allegro nie zna i nigdy nie
     odda, więc bez tego warunku każdy takt kasowałby ją razem z oceną hali
     i zaznaczeniem do kwoty. Po cichu: nic nie wygląda na zepsute, dopóki
     ktoś nie policzy pieniędzy. */
  const zostaja = widziane.length
    ? ` AND klucz NOT IN (${widziane.map(() => "?").join(",")})`
    : "";
  database.prepare(
    `DELETE FROM zwrot_klienta_pozycja
     WHERE zwrot_id=? AND zrodlo='allegro'${zostaja}`
  ).run(id, ...widziane);
}
