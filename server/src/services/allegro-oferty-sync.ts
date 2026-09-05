import { config } from "../config.js";
import { db as defaultDb, transaction, type Db } from "../db/db.js";
import { urlOfertSprzedawcy, zapytajAllegro } from "../adapters/allegro.http.js";
import { BladLimituAllegro } from "../adapters/allegro.js";
import { kontoKanalu } from "./kanal-konto.js";
import { naGrosze } from "./allegro-zwroty-sync.js";

/* ── Uzupełnianie ofert do rozmów (0.178.0) ──────────────────────────────────
   Pytanie zadane pod ofertą niesie SAM NUMER (`relatesTo.offer.id`). Do
   0.177.1 panel ten numer pokazywał i na tym kończył, więc agent szedł po
   tytuł do panelu Allegro — czyli tam, gdzie `panel-obslugi-klienta.md` §25
   obiecuje nie zaglądać. Mail powiadamiający z Allegro ma tytuł, cenę
   i zdjęcie w bloku „Wiadomość dotyczy"; panel miał mniej niż powiadomienie,
   od którego zaczynała się cała ta skrzynka.

   Tytuł znaliśmy dotąd WYŁĄCZNIE z pozycji zamówienia o tym numerze oferty
   (`services/skrzynka.ts`). To działa po zakupie i nie działa wcale przy
   pytaniu SPRZED zakupu — a takie właśnie przychodzi pod ofertą.

   JEDNO ŻĄDANIE NA PARTIĘ, nie na ofertę: `offer.id` w `/sale/offers` jest
   tablicą (`docs/allegro/swagger.yaml`), więc dwadzieścia numerów kosztuje
   jedno wywołanie. `/sale/product-offers/{id}` obok dałoby ten sam tytuł po
   jednym strzale na sztukę.

   ZDJĘCIE LISTINGOWE OD 0.211.0. `OfferListingDto.primaryImage.url` jedzie
   w TEJ SAMEJ odpowiedzi i do 0.210.0 wypadało przy mapowaniu — specyfikacja
   opisuje to pole jako „The image used as a thumbnail on the listings".
   Wzięcie go nie kosztuje żądania, uprawnienia ani limitu; kosztowało wyłącznie
   decyzję, którą właściciel podjął w 0.211.0 (patrz `schema.sql`).

   Ten przebieg nie chodzi po ofertach konta — dociąga wyłącznie te, na które
   wskazuje wiadomość, i najwyżej `NA_PRZEBIEG` naraz.                       */

/**
 * Ile ofert wolno dociągnąć w jednym przebiegu.
 *
 * Tyle samo, co przy zamówieniach, i z tego samego powodu: pierwszy przebieg
 * na koncie z historią skrzynki ma do nadrobienia wszystko naraz, a długi ciąg
 * żądań z jednego adresu to sygnatura, po której Allegro odcina konto (patrz
 * nagłówek `services/takt.ts`). Partia mieści się w JEDNYM żądaniu, więc limit
 * dwudziestu numerów to jedno wywołanie na przebieg.
 */
const NA_PRZEBIEG = 20;

/**
 * Jak długo snapshot jest świeży. Tytuł oferty zmienia się rzadko, a cena
 * bywa poprawiana co kilka dni — doba jest kompromisem między nieaktualną
 * ceną na ekranie a odpytywaniem tych samych ofert w kółko.
 */
const SWIEZOSC_MS = 86_400_000;

type Oferta = {
  id?: string;
  name?: string;
  sellingMode?: { price?: { amount?: string; currency?: string } | null } | null;
  external?: { id?: string } | null;
  publication?: { status?: string } | null;
  primaryImage?: { url?: string } | null;
};
type Odpowiedz = { offers?: Oferta[] };

export interface OfertySyncDeps {
  database?: Db;
  query?: (url: string) => Promise<unknown | null>;
  now?: () => Date;
  apiUrl?: string;
  accountId?: string;
  naPrzebieg?: number;
}

/**
 * Numery ofert do pobrania: te bez snapshotu ORAZ te ze snapshotem starszym
 * niż doba.
 *
 * Warunek świeżości ma tę samą blizna-genezę, co przy zamówieniach (0.153.1):
 * sam `IS NULL` zamieniłby jedno nieudane pobranie w stan trwały, którego nie
 * da się odkręcić inaczej niż ręcznie w bazie.
 *
 * Kolejność od najnowszej wiadomości: gdy do nadrobienia jest więcej ofert niż
 * partia, agent najpierw dostaje tytuły przy rozmowach, które ma dziś na
 * ekranie, a nie przy najstarszych w historii.
 *
 * ── DWA ŹRÓDŁA NUMERÓW OD 0.211.0 ─────────────────────────────────────────
 * Do 0.210.0 przebieg chodził wyłącznie po ofertach WSKAZANYCH W WIADOMOŚCI,
 * bo snapshot służył jednej rzeczy: tytułowi przy rozmowie. Od 0.211.0 niesie
 * też adres zdjęcia listingowego, a zdjęcie jest potrzebne również przy
 * ZWROCIE — czyli tam, gdzie rozmowy nie ma wcale.
 *
 * Drugie źródło to `zamowienie_klienta_pozycja.offer_id`, czyli
 * `lineItems[].offer.id` ze specyfikacji zamówienia. Bierzemy TĘ kolumnę,
 * a nie `offerId` z pozycji zwrotu, bo tamta należy do przestrzeni, której
 * wciąż nie znamy (`[WERYFIKUJ]` w `docs/allegro-ksztalt.md`) — pytanie
 * Allegro takim numerem kosztowałoby żądania i nie oddawałoby nic.
 *
 * WIADOMOŚCI IDĄ PIERWSZE i to jest cała rola `rzad` w sortowaniu. Partia ma
 * dwadzieścia miejsc; gdy do nadrobienia jest więcej, agent patrzący na
 * rozmowę ma dostać tytuł przed zdjęciem przy zwrocie sprzed miesiąca.
 */
export function brakujaceOferty(database: Db, ile: number, teraz = new Date()): string[] {
  const prog = new Date(teraz.getTime() - SWIEZOSC_MS).toISOString();
  return (database.prepare(`
    WITH zrodla AS (
      SELECT m.channel_account_id AS konto, m.related_object_id AS id,
             0 AS rzad, MAX(m.sent_at) AS kiedy
        FROM message m
       WHERE m.related_object_type = 'OFFER'
         AND m.related_object_id IS NOT NULL AND TRIM(m.related_object_id) <> ''
       GROUP BY m.channel_account_id, m.related_object_id
      UNION ALL
      SELECT z.channel_account_id AS konto, p.offer_id AS id,
             1 AS rzad, MAX(COALESCE(z.kupiono_at, z.synced_at)) AS kiedy
        FROM zamowienie_klienta_pozycja p
        JOIN zamowienie_klienta z ON z.id = p.zamowienie_id
       WHERE p.offer_id IS NOT NULL AND TRIM(p.offer_id) <> ''
       GROUP BY z.channel_account_id, p.offer_id
    )
    SELECT s.id AS id
      FROM zrodla s
      LEFT JOIN offer_snapshot o
        ON o.channel_account_id = s.konto AND o.external_id = s.id
     WHERE o.id IS NULL OR o.synced_at < ?
     GROUP BY s.id
     ORDER BY MIN(s.rzad), MAX(s.kiedy) DESC
     LIMIT ?`).all(prog, ile) as Array<{ id: string }>).map((r) => r.id);
}

/**
 * Jeden przebieg. Sieć kończy się PRZED transakcją — jak wszędzie indziej.
 *
 * Oferta, której Allegro nie oddało, NIE jest błędem przebiegu: numer sprzed
 * lat bywa nieosiągalny, a lista zwraca po prostu mniej pozycji, niż o ile
 * pytaliśmy. Zapisujemy to, co przyszło; reszta wróci do kolejki w następnym
 * przebiegu i najwyżej zostanie w panelu gołym numerem, czyli tym, co było.
 */
export async function uzupelnijOferty(deps: OfertySyncDeps = {}): Promise<number> {
  const database = deps.database ?? defaultDb();
  const query = deps.query ?? zapytajAllegro;
  const now = deps.now ?? (() => new Date());
  const apiUrl = deps.apiUrl ?? config.allegro.apiUrl;
  const ile = deps.naPrzebieg ?? NA_PRZEBIEG;

  const doPobrania = brakujaceOferty(database, ile, now());
  if (!doPobrania.length) return 0;

  let pobrane: Oferta[] = [];
  try {
    const body = (await query(urlOfertSprzedawcy(apiUrl, doPobrania))) as Odpowiedz | null;
    pobrane = (body?.offers ?? []).filter((o): o is Oferta => typeof o?.id === "string");
  } catch (e) {
    /* Limit z Allegro przerywa przebieg — dalsze żądania pogłębiłyby przerwę.
       Każdy inny błąd zostaje ostrzeżeniem: brak tytułu cofa panel do stanu
       sprzed tego wydania, więc nie ma za co zatrzymywać taktu. */
    if (e instanceof BladLimituAllegro) throw e;
    console.warn(`[allegro-oferty] ${e instanceof Error ? e.message : e}`);
    return 0;
  }

  const at = now().toISOString();
  transaction(database, () => {
    const konto = kontoKanalu(database, deps.accountId ?? config.allegro.clientId);
    for (const o of pobrane) zapisz(database, o, konto, at);
  })();
  return pobrane.length;
}

function zapisz(database: Db, o: Oferta, konto: number, at: string): void {
  const kwota = o.sellingMode?.price;
  /* Pusty adres schodzi na `NULL`. `""` w tej kolumnie znaczyłoby „mamy adres
     długości zero" i cache poszedłby po niego do sieci. */
  const obraz = (o.primaryImage?.url ?? "").trim() || null;
  database.prepare(`INSERT INTO offer_snapshot
    (channel_account_id,external_id,nazwa,sku,cena_grosze,waluta,status,primary_image_url,synced_at)
    VALUES (?,?,?,?,?,?,?,?,?)
    ON CONFLICT(channel_account_id, external_id) DO UPDATE SET
      nazwa=excluded.nazwa, sku=excluded.sku, cena_grosze=excluded.cena_grosze,
      waluta=excluded.waluta, status=excluded.status,
      primary_image_url=excluded.primary_image_url, synced_at=excluded.synced_at`).run(
    konto, String(o.id), o.name ?? "", o.external?.id ?? null,
    kwota?.amount == null ? null : naGrosze(kwota.amount),
    kwota?.currency ?? null, o.publication?.status ?? null, obraz, at);
}
