import { db as defaultDb, type Db } from "../db/db.js";
import { kartotekaOferty, type Dopasowanie } from "./dopasowanie-sku.js";

/* ── Której oferty dotyczy rozmowa: jedna reguła dla panelu i Copilota ───────
   Pytają o to dwa miejsca: prawa kolumna panelu (`osRozmowy`) i fakty szkicu
   Copilota (`kontekstSzkicu`). Każde miało własną kopię reguły, a kopia
   Copilota znała dwa źródła z trzech. Zrzut właściciela: panel pokazywał
   ofertę i kartotekę „z zamówienia”, a szkic pisał, że fakty nie mówią, co
   klient kupił. Dwie kopie jednej reguły rozjechały się po cichu, więc
   reguła stoi raz, tutaj.

   Trzy źródła, od najmocniejszego:
   1. wskazanie ręczne agenta, bo człowiek widział więcej niż parser;
   2. numer oferty dołączony przez Allegro do wiadomości, najpierw KLIENTA;
   3. jedyna pozycja zamówienia rozmowy, bo jedna pozycja nie ma czego mylić.
   Przy kilku pozycjach oferty nie ma: rozstrzyga człowiek przyciskiem przy
   pozycji, a automat nie zgaduje.                                            */

/** Oferta wskazana RĘCZNIE przez agenta — wybór człowieka, nie fakt z Allegro. */
export interface OfertaWskazana { ofertaId: string; autor: string }

export function ofertaWskazana(conversationId: number, database: Db = defaultDb()): OfertaWskazana | null {
  const w = database.prepare(`SELECT payload FROM conversation_event
    WHERE conversation_id=? AND event_type='offer_linked_manually'
    ORDER BY id DESC LIMIT 1`).get(conversationId) as { payload: string | null } | undefined;
  if (!w?.payload) return null;
  const p = JSON.parse(w.payload) as { ofertaId?: string; autor?: string };
  return p.ofertaId ? { ofertaId: p.ofertaId, autor: p.autor ?? "agent" } : null;
}

export type ZrodloOfertyRozmowy = "wiadomosc" | "reczne" | "zamowienie";

export interface WybranaOferta { konto: number; ofertaId: string; zrodlo: ZrodloOfertyRozmowy }

/** Pozycja zamówienia w tym zakresie, którego reguła potrzebuje. */
type Pozycja = { offerId: string | null; sku: string | null };

/**
 * Oferta rozmowy według trzech źródeł z nagłówka. Czysty odczyt.
 *
 * Pozycje podaje wołający, bo obaj mają już zamówienie rozmowy w ręku,
 * a drugi odczyt tego samego zamówienia mógłby trafić na inny stan.
 * `null` albo pusta lista to „zamówienia nie ma albo jeszcze go nie pobrano”.
 */
export function wybierzOferteRozmowy(
  conversationId: number, pozycje: readonly Pozycja[] | null | undefined, database: Db = defaultDb(),
): WybranaOferta | null {
  const r = database.prepare("SELECT channel_account_id AS konto FROM conversation WHERE id=?")
    .get(conversationId) as { konto: number } | undefined;
  if (!r) throw new Error("Nie znaleziono rozmowy");
  const konto = Number(r.konto);

  const reczna = ofertaWskazana(conversationId, database);
  if (reczna) return { konto, ofertaId: reczna.ofertaId, zrodlo: "reczne" };

  /* Numer z najnowszej wiadomości KLIENTA, a gdy klient go nie podał — z
     najnowszej naszej. Najnowszej PO CZASIE, bo `id` starych wierszy nie
     rośnie z czasem. */
  const m = database.prepare(`SELECT related_object_id AS oferta, channel_account_id AS konto FROM message
    WHERE conversation_id=? AND related_object_type='OFFER' AND related_object_id IS NOT NULL
    ORDER BY (direction='incoming') DESC, sent_at DESC, id DESC LIMIT 1`)
    .get(conversationId) as { oferta: string; konto: number } | undefined;
  if (m) return { konto: Number(m.konto), ofertaId: String(m.oferta), zrodlo: "wiadomosc" };

  const jedyna = pozycje?.length === 1 && pozycje[0].offerId ? pozycje[0] : null;
  return jedyna ? { konto, ofertaId: String(jedyna.offerId), zrodlo: "zamowienie" } : null;
}

/**
 * Kartoteka oferty rozmowy. `snapshot` to wiersz `offer_snapshot` albo
 * `null`, gdy go jeszcze nie ma.
 *
 * SKU z pozycji zamówienia o tym numerze oferty to zapas na czas, gdy
 * snapshotu jeszcze nie ma. Pozycja ma SKU od razu, z formularza zakupu,
 * więc kartoteka nie musi czekać na takt ofert. Zapas dotyczy każdego
 * z trzech źródeł, bo wskazanie ręczne bywa kliknięciem przy pozycji.
 */
export function kartotekaOfertyRozmowy(
  database: Db, o: WybranaOferta, snapshot: { sku: string | null } | null,
  pozycje: readonly Pozycja[] | null | undefined,
): Dopasowanie {
  const zapas = pozycje?.find((p) => p.offerId === o.ofertaId)?.sku ?? null;
  /* `undefined` znaczy dla `kartotekaOferty` „snapshotu nie ma”, a `""` —
     „sprzedawca nie wypełnił sygnatury”. To dwa różne zdania na ekranie. */
  return kartotekaOferty(database, o.konto, o.ofertaId, snapshot ? snapshot.sku : (zapas ?? undefined));
}
