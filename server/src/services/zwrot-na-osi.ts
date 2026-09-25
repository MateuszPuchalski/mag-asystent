import type { DatabaseSync } from "node:sqlite";
import { ROZMOWA_ZAMOWIENIA } from "./droga-klienta.js";

/* ── Zwrot na osi rozmowy (0.502.0) ─────────────────────────────────────────
   Klient, który pisze „gdzie moje pieniądze", pyta o ZDARZENIE zwrotu:
   decyzję, korektę, przelew. Rozmowa pokazywała tylko BIEŻĄCY stan zwrotu
   w bloku obok, więc agent szedł do Zwrotów czytać oś tamtej sprawy.
   „Kontekst wchodzi za sprawą" (dekalog, punkt 2): kamienie milowe zwrotu
   stają na osi rozmowy i w faktach szkicu.

   TYLKO TO, CO DOTYCZY KLIENTA. Ocena towaru, kwota robocza, notatka biura
   i skład pozycji to nasza kuchnia — na osi rozmowy byłyby szumem, a w szkicu
   treścią, której klient nie powinien czytać. Cofnięcia wchodzą, bo decyzja
   bez swojego cofnięcia kłamałaby o stanie.

   WIĄZANIE PO NUMERZE ZAMÓWIENIA, przez tę samą relację co droga zakupu
   (`ROZMOWA_ZAMOWIENIA`), i po koncie rozmowy. Czysty odczyt. */

export const ZDARZENIA_ZWROTU_DLA_KLIENTA: ReadonlySet<string> = new Set([
  "werdykt", "werdykt_cofniety", "odmowa", "korekta", "korekta_cofnieta",
  "pieniadze", "przelew", "przelew_cofniety", "rabat",
]);

export interface ZdarzenieZwrotuRozmowy {
  id: number;
  zwrotId: number;
  numer: string | null;
  rodzaj: string;
  tresc: string | null;
  kiedy: string;
  kto: string | null;
}

export function zdarzeniaZwrotowRozmowy(database: DatabaseSync, conversationId: number): ZdarzenieZwrotuRozmowy[] {
  const rodzaje = [...ZDARZENIA_ZWROTU_DLA_KLIENTA];
  return (database.prepare(`
    SELECT e.id, e.zwrot_id, z.reference_number, e.rodzaj, e.tresc, e.kiedy_at, e.kto
      FROM zwrot_zdarzenie e
      JOIN zwrot_klienta z ON z.id = e.zwrot_id
      JOIN conversation c ON c.id = ? AND c.channel_account_id = z.channel_account_id
     WHERE z.order_id IN (SELECT rz.numer FROM ${ROZMOWA_ZAMOWIENIA} rz WHERE rz.conversation_id = ?)
       AND e.rodzaj IN (${rodzaje.map(() => "?").join(",")})
     ORDER BY e.kiedy_at, e.id`).all(conversationId, conversationId, ...rodzaje) as
    Array<Record<string, unknown>>).map((w) => ({
    id: Number(w.id),
    zwrotId: Number(w.zwrot_id),
    numer: (w.reference_number as string) ?? null,
    rodzaj: String(w.rodzaj),
    tresc: (w.tresc as string) ?? null,
    kiedy: String(w.kiedy_at),
    kto: (w.kto as string) ?? null,
  }));
}

/**
 * Zdanie dla szkicu Copilota: ostatnie trzy kamienie milowe, najnowszy na
 * końcu. Bez nazwisk biura — `kto` zostaje na osi dla agenta.
 */
export function faktZwrotu(zdarzenia: ZdarzenieZwrotuRozmowy[]): string | null {
  if (!zdarzenia.length) return null;
  const ostatnie = zdarzenia.slice(-3)
    .map((z) => `${z.kiedy.slice(0, 10)} ${z.tresc ?? z.rodzaj.replace(/_/g, " ")}`);
  return `Zwrot tego zamówienia${zdarzenia.at(-1)!.numer ? ` (${zdarzenia.at(-1)!.numer})` : ""},`
    + ` przebieg według naszego systemu: ${ostatnie.join("; ")}`;
}
