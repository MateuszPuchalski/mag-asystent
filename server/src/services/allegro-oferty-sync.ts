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
   jednym strzale na sztukę i dokładałoby zdjęcia, których nie pobieramy.

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
 */
export function brakujaceOferty(database: Db, ile: number, teraz = new Date()): string[] {
  const prog = new Date(teraz.getTime() - SWIEZOSC_MS).toISOString();
  return (database.prepare(`SELECT m.related_object_id AS id
      FROM message m
      LEFT JOIN offer_snapshot o
        ON o.channel_account_id = m.channel_account_id
       AND o.external_id = m.related_object_id
     WHERE m.related_object_type = 'OFFER'
       AND m.related_object_id IS NOT NULL AND TRIM(m.related_object_id) <> ''
       AND (o.id IS NULL OR o.synced_at < ?)
     GROUP BY m.related_object_id
     ORDER BY MAX(m.sent_at) DESC
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
  database.prepare(`INSERT INTO offer_snapshot
    (channel_account_id,external_id,nazwa,sku,cena_grosze,waluta,status,synced_at)
    VALUES (?,?,?,?,?,?,?,?)
    ON CONFLICT(channel_account_id, external_id) DO UPDATE SET
      nazwa=excluded.nazwa, sku=excluded.sku, cena_grosze=excluded.cena_grosze,
      waluta=excluded.waluta, status=excluded.status, synced_at=excluded.synced_at`).run(
    konto, String(o.id), o.name ?? "", o.external?.id ?? null,
    kwota?.amount == null ? null : naGrosze(kwota.amount),
    kwota?.currency ?? null, o.publication?.status ?? null, at);
}
