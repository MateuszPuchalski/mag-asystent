import { config } from "../config.js";
import { db as defaultDb, transaction, type Db } from "../db/db.js";
import { urlZamowienia, zapytajAllegro } from "../adapters/allegro.http.js";
import { BladLimituAllegro } from "../adapters/allegro.js";
import { kontoKanalu } from "./kanal-konto.js";
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
  summary?: { totalToPay?: Kwota } | null;
  lineItems?: Pozycja[];
};

export interface ZamowieniaSyncDeps {
  database?: Db;
  query?: (url: string) => Promise<unknown | null>;
  now?: () => Date;
  apiUrl?: string;
  accountId?: string;
  naPrzebieg?: number;
}

/** Numery zamówień, do których prowadzi zwrot, a których jeszcze nie mamy. */
export function brakujaceZamowienia(database: Db, ile: number): string[] {
  return (database.prepare(`SELECT DISTINCT z.order_id AS id
    FROM zwrot_klienta z
    LEFT JOIN zamowienie_klienta k
      ON k.channel_account_id = z.channel_account_id AND k.external_id = z.order_id
    WHERE z.order_id IS NOT NULL AND z.order_id <> '' AND k.id IS NULL
    ORDER BY z.created_at DESC
    LIMIT ?`).all(ile) as Array<{ id: string }>).map((r) => r.id);
}

/**
 * Jeden przebieg. Sieć kończy się PRZED transakcją — jak wszędzie indziej.
 *
 * Porażka JEDNEGO zamówienia nie kończy przebiegu: zamówienie sprzed lat
 * bywa nieosiągalne, a jedno 404 nie ma prawa zabrać kontekstu pozostałym
 * dziewiętnastu. Limit z Allegro (429) przerywa jednak od razu — dalsze
 * żądania tylko pogłębiłyby przerwę.
 */
export async function uzupelnijZamowienia(deps: ZamowieniaSyncDeps = {}): Promise<number> {
  const database = deps.database ?? defaultDb();
  const query = deps.query ?? zapytajAllegro;
  const now = deps.now ?? (() => new Date());
  const apiUrl = deps.apiUrl ?? config.allegro.apiUrl;
  const ile = deps.naPrzebieg ?? NA_PRZEBIEG;

  const doPobrania = brakujaceZamowienia(database, ile);
  if (!doPobrania.length) return 0;

  const pobrane: Zamowienie[] = [];
  for (const id of doPobrania) {
    try {
      const body = (await query(urlZamowienia(apiUrl, id))) as Zamowienie | null;
      if (body && typeof body.id === "string") pobrane.push(body);
    } catch (e) {
      if (e instanceof BladLimituAllegro) throw e;
      console.warn(`[allegro-zamowienia] ${id}: ${e instanceof Error ? e.message : e}`);
    }
  }

  const at = now().toISOString();
  transaction(database, () => {
    const konto = kontoKanalu(database, deps.accountId ?? config.allegro.clientId);
    for (const z of pobrane) zapisz(database, z, konto, at);
  })();
  return pobrane.length;
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
     suma_grosze,waluta,kupiono_at,zmieniono_at,synced_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(channel_account_id, external_id) DO UPDATE SET
      status=excluded.status, kupujacy_login=excluded.kupujacy_login,
      dostawa_grosze=excluded.dostawa_grosze, dostawa_metoda=excluded.dostawa_metoda,
      suma_grosze=excluded.suma_grosze, waluta=excluded.waluta,
      kupiono_at=excluded.kupiono_at, zmieniono_at=excluded.zmieniono_at,
      synced_at=excluded.synced_at`).run(
    konto, z.id, z.status ?? null, z.buyer?.login ?? null,
    z.delivery?.cost?.amount == null ? null : naGrosze(z.delivery.cost.amount),
    z.delivery?.method?.name ?? null,
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
}
