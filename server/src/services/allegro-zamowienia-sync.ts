import { config } from "../config.js";
import { db as defaultDb, transaction, type Db } from "../db/db.js";
import { urlZamowienia, zapytajAllegro } from "../adapters/allegro.http.js";
import { BladLimituAllegro, BladOdpowiedziAllegro } from "../adapters/allegro.js";
import { kontoKanalu } from "./kanal-konto.js";
import { logEvent } from "./events.js";
import { oczyscSurowy } from "./allegro-oczyszczanie.js";
import { naGrosze } from "./allegro-zwroty-sync.js";

/* ── Uzupełnianie zamówień do zwrotów (0.152.0) ──────────────────────────────
   Zwrot niesie sam numer zamówienia. Decyzja potrzebuje jego treści i to
   z trzech powodów naraz:

     1. CO JESZCZE KLIENT KUPIŁ. Oddaje jedną rzecz z trzech — to jest
        kontekst, którego ekran do 0.151.0 nie miał wcale.
     2. KOSZT DOSTAWY. Bez niego wariant „bez wysyłki" był nieodróżnialny od
        pełnej kwoty, więc panel proponował samą sumę pozycji i mówił o tym
        wprost na ekranie.
     3. SKU SPRZEDAWCY. `lineItems[].offer.external.id` (schemat
        `OfferReference` w `docs/allegro/swagger.yaml`) to identyfikator
        oferty w systemie sprzedawcy — u tej firmy symbol z Subiekta. To jest
        mostek do kartoteki, a więc i do zdjęcia.

   JEDNO WYWOŁANIE NA ZAMÓWIENIE, nie na ofertę. `/sale/product-offers/{id}`
   dałoby ten sam SKU po jednym strzale na pozycję i nie dałoby ani kosztu
   dostawy, ani pozycji niezwracanych.

   Ten przebieg NIE chodzi po wszystkich zamówieniach konta — dociąga tylko
   te, do których prowadzi zwrot, i najwyżej `NA_PRZEBIEG` naraz. Zwrotów
   w pracy są dziesiątki, więc po kilku przebiegach nie zostaje nic do
   pobrania, a ticker milczy.                                                */

/**
 * Ile zamówień wolno dociągnąć w jednym przebiegu.
 *
 * Bezpiecznik przeciw wybuchowi przy pierwszym uruchomieniu: świeża baza po
 * pierwszej synchronizacji zwrotów ma ich dziewięćdziesiąt dni, a dziewięćdziesiąt
 * żądań w jednym ciągu z jednego adresu to sygnatura, po której Allegro
 * odcina konto (patrz nagłówek `services/takt.ts`).
 */
const NA_PRZEBIEG = 20;

/**
 * Na ile czekamy, zanim zapytamy o numer, którego Allegro nie zna.
 *
 * Siedem dni, bo tyle dzieli dwa jedyne sensowne wyjaśnienia 404. Zamówienie
 * sprzed lat nie wróci NIGDY i tydzień jest przy nim liczbą dowolnie małą.
 * Pomyłka w naszym mapowaniu naprawia się WYDANIEM, nie czekaniem, więc
 * krótszy odstęp niczego by nie przyspieszył — kosztowałby tylko ruch.
 *
 * Odstęp rośnie z liczbą prób (7, 14, 21, 28 dni), ale nie w nieskończoność:
 * numer ma wracać na tyle często, żeby dało się zauważyć, że jednak istnieje.
 */
const OKRES_NEGATYWU_MS = 7 * 86_400_000;
const MAKS_MNOZNIK = 4;

type Kwota = { amount?: string; currency?: string };
type Pozycja = {
  id?: string; quantity?: number; price?: Kwota; boughtAt?: string;
  offer?: { id?: string; name?: string; external?: { id?: string } | null } | null;
};
type Zamowienie = {
  id: string;
  status?: string;
  updatedAt?: string;
  buyer?: { login?: string } | null;
  delivery?: { cost?: Kwota; method?: { name?: string } | null } | null;
  /* Płatność i żądanie faktury (0.169.0). Z `payment` bierzemy TYP i moment
     zapłaty; identyfikatora ani kwoty nie — kwotę mamy już z `summary`.
     Z `invoice` bierzemy SAMĄ FLAGĘ `required`: `invoice.address` niesie
     ulicę i miasto, a adresy nie przechodzą przez mapowanie. */
  payment?: { id?: string; type?: string; finishedAt?: string } | null;
  invoice?: { required?: boolean } | null;
  summary?: { totalToPay?: Kwota } | null;
  lineItems?: Pozycja[];
};

export interface ZamowieniaSyncDeps {
  database?: Db;
  /* Cały klient, nie zwężona sygnatura: `blad404` jest drugim argumentem
     `zapytajAllegro`, a własna kopia kształtu opcji rozjechałaby się przy
     pierwszej nowej opcji. Wzór stoi w `allegro-rabaty-sync.ts`. */
  query?: typeof zapytajAllegro;
  now?: () => Date;
  apiUrl?: string;
  accountId?: string;
  naPrzebieg?: number;
  /**
   * Pomiń pamięć negatywu i zapytaj o WSZYSTKO, co brakuje.
   *
   * Wyłącznie dla ręcznego „dociągnij zamówienia" (`routes/zwroty.ts`).
   * Ten przycisk istnieje po to, żeby ktoś patrzący na produkcję rozstrzygnął,
   * czy problem jest w danych, czy w kodzie — a przycisk, który przez tydzień
   * cicho oddaje `pobrano: 0`, nie rozstrzyga niczego. Ticker chodzi bez tej
   * flagi, więc pętla i tak zostaje zamknięta.
   */
  ignorujBrak?: boolean;
}

/**
 * Numery zamówień do pobrania: brakujące ORAZ te bez ani jednego SKU.
 *
 * Do 0.153.1 warunkiem było wyłącznie `k.id IS NULL`, więc zamówienie
 * zapisane raz z pustymi SKU nie było odpytywane NIGDY — także po naprawieniu
 * mapowania po naszej stronie. To zamieniało jedną złą synchronizację
 * w trwały stan, którego nie dało się odkręcić inaczej niż ręcznie w bazie.
 *
 * Drugi warunek ma bezpiecznik czasowy: odświeżamy najwyżej raz na dobę.
 * Zamówienie, którego sprzedawca po prostu nie opisał SKU, nie ma się
 * odpytywać w kółko co dziesięć minut do końca świata.
 *
 * Od 0.166.0 numer prowadzi tu także z WIADOMOŚCI (`message.related_order_id`,
 * gałąź `relatesTo.order` z Allegro): rozmowa pokazuje zamówienie, którego
 * dotyczy, i bez tej unii pokazywałaby wyłącznie numer. Ten sam limit
 * i takt — zamówienia z rozmów są tak samo nieliczne jak te ze zwrotów.
 *
 * TRZECI warunek to pamięć negatywu (`zamowienie_klienta_brak`). Bez niego
 * numer, którego Allegro nie zna, nie dostawał wiersza NIGDY, więc `k.id IS
 * NULL` było prawdą na zawsze i ten sam zbiór ≤20 numerów wracał w KAŻDYM
 * przebiegu — 432 wywołania zakończone 404 w krótkim czasie, bez końca.
 *
 * `konto` jest PARAMETREM, a nie odczytem z `z.channel_account_id`, i to jest
 * cała gwarancja tej poprawki: negatyw odsiewa się tym samym kluczem, którym
 * się go pisze. Klucz filtra wzięty skądinąd niż klucz zapisu nie trafiałby
 * w nic i wyglądałoby to dokładnie tak, jak ta awaria — czyli wcale.
 */
export function brakujaceZamowienia(
  database: Db,
  konto: number,
  ile: number,
  teraz = new Date(),
  ignorujBrak = false,
): string[] {
  const doba = new Date(teraz.getTime() - 86_400_000).toISOString();
  return (database.prepare(`SELECT DISTINCT z.id
    FROM (
      SELECT order_id AS id, channel_account_id, created_at AS at FROM zwrot_klienta
      UNION ALL
      SELECT related_order_id, channel_account_id, sent_at FROM message
      UNION ALL
      /* Sprawy posprzedażowe (0.282.0). Do tego wydania reklamacja NIE BYŁA
         źródłem i to był cichy brak: sprawa niosła numer zamówienia,
         a zamówienie dociągało się tylko wtedy, gdy do tego samego numeru
         przypadkiem istniał zwrot albo wiadomość. Bez zamówienia nie ma daty
         zakupu, więc Copilot wypisywał ją w liście braków.

         Sortowanie malejące po dacie zostaje wspólne dla wszystkich trzech
         źródeł, a sufit przebiegu chroni limit 429 tak samo jak dotąd:
         reklamacje konkurują o ten sam budżet, nie dostają własnego.

         Backticków tu nie ma świadomie — blok stoi w literale szablonowym. */
      SELECT order_id, channel_account_id, otwarto_at FROM reklamacja_klienta
    ) z
    LEFT JOIN zamowienie_klienta k
      ON k.channel_account_id = z.channel_account_id AND k.external_id = z.id
    WHERE z.id IS NOT NULL AND z.id <> ''
      AND (
        k.id IS NULL
        OR (k.synced_at < ? AND NOT EXISTS (
              SELECT 1 FROM zamowienie_klienta_pozycja p
              WHERE p.zamowienie_id = k.id AND p.sku IS NOT NULL AND TRIM(p.sku) <> ''
            ))
      )
      AND (? OR NOT EXISTS (
            SELECT 1 FROM zamowienie_klienta_brak b
            WHERE b.channel_account_id = ? AND b.external_id = z.id
              AND b.ponow_po_at > ?
          ))
    ORDER BY z.at DESC
    LIMIT ?`).all(
      doba, ignorujBrak ? 1 : 0, konto, teraz.toISOString(), ile) as Array<{ id: string }>
  ).map((r) => r.id);
}

/**
 * Jeden przebieg. Sieć kończy się PRZED transakcją — jak wszędzie indziej.
 *
 * Porażka JEDNEGO zamówienia nie kończy przebiegu: zamówienie sprzed lat
 * bywa nieosiągalne, a jedno 404 nie ma prawa zabrać kontekstu pozostałym
 * dziewiętnastu. Limit z Allegro (429) przerywa jednak od razu — dalsze
 * żądania tylko pogłębiłyby przerwę.
 *
 * `blad404: true` jest tu NOWE i konieczne. Bez tej opcji adapter oddaje przy
 * 404 `null`, więc „Allegro nie zna tego numeru" było nieodróżnialne od pustej
 * odpowiedzi i nie zostawiało po sobie nic — ani wiersza, ani śladu.
 */
export async function uzupelnijZamowienia(deps: ZamowieniaSyncDeps = {}): Promise<number> {
  const database = deps.database ?? defaultDb();
  const query = deps.query ?? zapytajAllegro;
  const now = deps.now ?? (() => new Date());
  const apiUrl = deps.apiUrl ?? config.allegro.apiUrl;
  const ile = deps.naPrzebieg ?? NA_PRZEBIEG;

  /* Konto rozwiązujemy PRZED wyborem numerów, a nie dopiero w transakcji
     zapisu. Powód jest jeden: negatyw ma się odsiewać tym samym kluczem,
     którym się go pisze — patrz nagłówek `brakujaceZamowienia`. */
  const konto = kontoKanalu(database, deps.accountId ?? config.allegro.clientId);
  const doPobrania = brakujaceZamowienia(database, konto, ile, now(), deps.ignorujBrak);
  if (!doPobrania.length) return 0;

  const pobrane: Zamowienie[] = [];
  const brakujace: string[] = [];
  let limit: BladLimituAllegro | null = null;
  for (const id of doPobrania) {
    try {
      const body = (await query(urlZamowienia(apiUrl, id), { blad404: true })) as Zamowienie | null;
      if (body && typeof body.id === "string") pobrane.push(body);
    } catch (e) {
      /* 429 kończy przebieg, ale dopiero PO zapisaniu negatywów zebranych
         wcześniej — dlatego `break`, a nie `throw` w miejscu. Rzucenie stąd
         zostawiłoby tę pętlę żywą dokładnie w przypadku, który sama tworzy:
         404 podbijają ruch, ruch wywołuje 429, 429 kasuje pamięć braków
         i następny takt zaczyna od zera. */
      if (e instanceof BladLimituAllegro) { limit = e; break; }
      if (e instanceof BladOdpowiedziAllegro && e.status === 404) { brakujace.push(id); continue; }
      /* Timeout i 5xx NIE tworzą negatywu. One nie mówią „nie ma", tylko
         „nie wiadomo", a zapamiętany brak zabrałby zamówienie na tydzień
         z powodu jednej minuty bez internetu. */
      console.warn(`[allegro-zamowienia] ${id}: ${e instanceof Error ? e.message : e}`);
    }
  }

  /* Negatywy WŁASNĄ transakcją i PRZED zapisem zamówień. Wspólna transakcja
     znaczyłaby, że jedno wywrócone zamówienie wycofuje także pamięć braków,
     czyli że pętla wraca przy pierwszym błędzie mapowania. */
  if (brakujace.length) zapiszBraki(database, konto, brakujace, now());
  if (limit) throw limit;

  const at = now().toISOString();
  transaction(database, () => {
    for (const z of pobrane) zapisz(database, z, konto, at);
  })();
  return pobrane.length;
}

/**
 * Zapamiętanie braku: numer, o który pytaliśmy i którego Allegro nie zna.
 *
 * Odstęp rośnie z liczbą prób, więc `prob` trzeba ODCZYTAĆ przed zapisem —
 * `ON CONFLICT` nie policzyłby daty z kolumny, którą sam dopiero podbija.
 * To ≤20 odczytów po kluczu głównym raz na takt, czyli koszt, którego nie ma.
 *
 * Zdarzenie jest ZBIORCZE, jedno na przebieg. Nie dlatego, że tak taniej:
 * te 432 wywołania nie zostawiły w bazie ANI JEDNEGO śladu i właśnie dlatego
 * awarię widać było wyłącznie w portalu Allegro. Wiersz na numer zalewałby
 * `events` tym samym co `console.warn`, a jeden wiersz na takt wystarczy,
 * żeby odtworzyć przebieg.
 */
function zapiszBraki(database: Db, konto: number, numery: string[], teraz: Date): void {
  const at = teraz.toISOString();
  transaction(database, () => {
    const czytaj = database.prepare(
      "SELECT prob FROM zamowienie_klienta_brak WHERE channel_account_id=? AND external_id=?");
    const pisz = database.prepare(`INSERT INTO zamowienie_klienta_brak
      (channel_account_id,external_id,sprawdzono_at,ponow_po_at,prob)
      VALUES (?,?,?,?,?)
      ON CONFLICT(channel_account_id,external_id) DO UPDATE SET
        sprawdzono_at=excluded.sprawdzono_at,
        ponow_po_at=excluded.ponow_po_at,
        prob=excluded.prob`);

    const opis: Array<{ id: string; prob: number }> = [];
    for (const id of numery) {
      const byl = czytaj.get(konto, id) as { prob: number } | undefined;
      const prob = Number(byl?.prob ?? 0) + 1;
      const ponow = new Date(
        teraz.getTime() + OKRES_NEGATYWU_MS * Math.min(prob, MAKS_MNOZNIK)).toISOString();
      pisz.run(konto, id, at, ponow, prob);
      opis.push({ id, prob });
      console.warn(
        `[allegro-zamowienia] ${id}: Allegro nie zna tego numeru (404, próba ${prob}) `
        + `— nie pytamy ponownie przed ${ponow}`);
    }
    logEvent("allegro_zamowienie_brak", "system", null,
      { ile: opis.length, numery: opis }, null, database);
  })();
}

function zapisz(database: Db, z: Zamowienie, konto: number, at: string): void {
  database.prepare(`INSERT INTO allegro_zamowienie(id,surowe_json,synced_at)
    VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET
    surowe_json=excluded.surowe_json, synced_at=excluded.synced_at`).run(
    z.id, JSON.stringify(oczyscSurowy(z)), at);

  const waluta = z.summary?.totalToPay?.currency ?? z.delivery?.cost?.currency ?? "PLN";
  /* Data zakupu jest przy POZYCJI, nie przy zamówieniu — bierzemy najwcześniejszą.
     Zamówienie scalone z kilku zakupów miałoby inaczej datę przypadkową. */
  const kupiono = (z.lineItems ?? [])
    .map((p) => p.boughtAt).filter((d): d is string => Boolean(d)).sort()[0] ?? null;

  database.prepare(`INSERT INTO zamowienie_klienta
    (channel_account_id,external_id,status,kupujacy_login,dostawa_grosze,dostawa_metoda,
     platnosc_typ,platnosc_at,platnosc_id,faktura_zadana,
     suma_grosze,waluta,kupiono_at,zmieniono_at,synced_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(channel_account_id, external_id) DO UPDATE SET
      status=excluded.status, kupujacy_login=excluded.kupujacy_login,
      dostawa_grosze=excluded.dostawa_grosze, dostawa_metoda=excluded.dostawa_metoda,
      platnosc_typ=excluded.platnosc_typ, platnosc_at=excluded.platnosc_at,
      platnosc_id=excluded.platnosc_id,
      faktura_zadana=excluded.faktura_zadana,
      suma_grosze=excluded.suma_grosze, waluta=excluded.waluta,
      kupiono_at=excluded.kupiono_at, zmieniono_at=excluded.zmieniono_at,
      synced_at=excluded.synced_at`).run(
    konto, z.id, z.status ?? null, z.buyer?.login ?? null,
    z.delivery?.cost?.amount == null ? null : naGrosze(z.delivery.cost.amount),
    z.delivery?.method?.name ?? null,
    z.payment?.type ?? null, z.payment?.finishedAt ?? null,
    /* Identyfikator płatności (0.190.0) — bez niego `POST /payments/refunds`
       nie ma jak powstać, bo `payment.id` stoi w `required` schematu. */
    z.payment?.id ?? null,
    /* `null`, gdy Allegro nie przysłało `invoice` — to nie to samo, co
       „klient nie chciał faktury". Ekran ma prawo powiedzieć „nie wiadomo". */
    z.invoice?.required == null ? null : (z.invoice.required ? 1 : 0),
    z.summary?.totalToPay?.amount == null ? null : naGrosze(z.summary.totalToPay.amount),
    waluta, kupiono, z.updatedAt ?? null, at);

  const id = Number((database.prepare(
    "SELECT id FROM zamowienie_klienta WHERE channel_account_id=? AND external_id=?",
  ).get(konto, z.id) as { id: number }).id);

  /* Pozycje zamówienia są czystym odbiciem Allegro — nic ludzkiego na nich
     nie wisi, więc przepisujemy je w całości. To różnica wobec pozycji
     ZWROTU, gdzie ocena hali i wskazana kartoteka muszą przeżyć. */
  database.prepare("DELETE FROM zamowienie_klienta_pozycja WHERE zamowienie_id=?").run(id);
  for (const p of z.lineItems ?? []) {
    database.prepare(`INSERT INTO zamowienie_klienta_pozycja
      (zamowienie_id,external_id,offer_id,nazwa,sku,ilosc,cena_grosze,waluta)
      VALUES (?,?,?,?,?,?,?,?)`).run(
      id, p.id ?? null, p.offer?.id ?? null, p.offer?.name ?? "",
      p.offer?.external?.id ?? null, Number(p.quantity ?? 0),
      naGrosze(p.price?.amount), p.price?.currency ?? waluta);
  }

  /* Numer, który się pobrał, przestał być brakiem. Bez tego kasowania negatyw
     sprzed tygodnia przeżywałby prawdę i blokował dobowe odświeżanie zamówień
     bez ani jednego SKU. */
  database.prepare(
    "DELETE FROM zamowienie_klienta_brak WHERE channel_account_id=? AND external_id=?",
  ).run(konto, z.id);
}
