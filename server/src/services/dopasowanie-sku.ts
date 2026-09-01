import type { Db } from "../db/db.js";

/* ── Mostek oferta → kartoteka (0.152.0) ─────────────────────────────────────
   Do 0.151.0 nie istniał ŻADEN sposób, żeby z oferty Allegro dojść do
   kartoteki Subiekta. Projekt panelu §28 nazywał to wprost: „Kartoteka
   wywiedziona z oferty — NASTĘPNE, czeka na dostęp do dokumentacji Allegro".
   Dokumentacja przyszła w 0.151.0 (`docs/allegro/swagger.yaml`), a w niej
   `OfferReference.external` — „The ID of the offer in the external system",
   czyli identyfikator, który sprzedawca sam wpisał przy ofercie.

   BEZ TEGO MOSTKA NIE MA ZDJĘCIA: `zdjecie_cache` i `zdjecie_wlasne` są
   kluczowane po `tw_id`, więc pozycja bez kartoteki nie ma czym pokazać
   obrazu.

   DOPASOWANIE JEST PROPOZYCJĄ, NIE FAKTEM. Projekt §4.3 żąda, żeby kartoteka
   wskazana przez agenta nie udawała faktu z Allegro; wybór automatu tym
   bardziej. §11.3 każe pokazywać źródło i poziom pewności. Dlatego ta funkcja
   niczego nie zapisuje — liczy się przy odczycie, a do bazy trafia dopiero
   potwierdzenie człowieka.

   PO NAZWIE NIE DOPASOWUJEMY NIGDY. `routes/products.ts` opisuje, dlaczego
   furtka na literówki nie może otwierać karty sama: prowadzi do CUDZEJ
   kartoteki, a stąd na halę idzie zadanie o cudzym towarze.                 */

export type PewnoscDopasowania = "brak" | "sku" | "niejednoznaczne";

export interface Dopasowanie {
  pewnosc: PewnoscDopasowania;
  twId: number | null;
  symbol: string | null;
  /** Zdanie dla ekranu — §11.3 żąda widocznego źródła, nie samej wartości. */
  zrodlo: string;
}

const BRAK: Dopasowanie = {
  pewnosc: "brak", twId: null, symbol: null, zrodlo: "SKU oferty nie wskazuje kartoteki",
};

/**
 * Kartoteka wskazana przez SKU oferty.
 *
 * Porównanie idzie po `symbol COLLATE NOCASE` — indeks na tej kolacji już
 * istnieje, a firma wpisuje symbole raz wielkimi, raz małymi literami.
 * Białe znaki po bokach obcinamy, bo pole w Allegro wypełnia człowiek.
 *
 * Dwa trafienia to NIE jest powód do wybrania pierwszego. Symbol miał być
 * unikalny; skoro nie jest, rozstrzyga człowiek.
 */
export function dopasujPoSku(database: Db, sku: string | null | undefined): Dopasowanie {
  const szukane = (sku ?? "").trim();
  if (!szukane) return BRAK;

  const trafienia = database.prepare(
    "SELECT tw_id, symbol FROM sgt_towar WHERE symbol = ? COLLATE NOCASE LIMIT 2"
  ).all(szukane) as Array<{ tw_id: number; symbol: string }>;

  if (trafienia.length === 0) {
    return { ...BRAK, zrodlo: `Kartoteki o symbolu „${szukane}" nie ma` };
  }
  if (trafienia.length > 1) {
    return {
      pewnosc: "niejednoznaczne", twId: null, symbol: null,
      zrodlo: `Symbol „${szukane}" ma więcej niż jedną kartotekę — wskaż ją`,
    };
  }
  return {
    pewnosc: "sku", twId: Number(trafienia[0].tw_id), symbol: trafienia[0].symbol,
    zrodlo: `SKU oferty „${szukane}"`,
  };
}

/**
 * SKU pozycji zwrotu — z zamówienia, po numerze oferty.
 *
 * Zwrot NIE niesie SKU; niesie go dopiero zamówienie
 * (`lineItems[].offer.external.id`). Stąd to złączenie zamiast pola.
 */
export function skuPozycji(
  database: Db, channelAccountId: number, orderId: string | null, offerId: string | null,
): string | null {
  if (!orderId || !offerId) return null;
  const w = database.prepare(`SELECT p.sku AS sku
    FROM zamowienie_klienta k
    JOIN zamowienie_klienta_pozycja p ON p.zamowienie_id = k.id
    WHERE k.channel_account_id = ? AND k.external_id = ? AND p.offer_id = ?
    LIMIT 1`).get(channelAccountId, orderId, offerId) as { sku: string | null } | undefined;
  return w?.sku ?? null;
}
