import type { DatabaseSync } from "node:sqlite";
import { db as defaultDb } from "../db/db.js";
import { sprawaOtwarta } from "./statusy-spraw.js";
import { statusRozmowy } from "./conversations.js";

/* ── Towar jako trzeci mostek (@wydanie) ─────────────────────────────────────
   Numer zamówienia wiąże kolejki JEDNEGO zakupu, login — jednego klienta.
   Towar (`tw_id`) stał na dziewięciu ekranach i nie wiązał niczego: nie miał
   własnej karty ani odnośnika. A to w nim spotyka się magazyn z obsługą —
   „ten nóż wraca trzeci raz w tym miesiącu" widać dopiero, gdy zwroty,
   reklamacje i rozmowy o nim stoją obok stanu i dostaw.

   ODCZYT, NIE KOLEJKA. Przekrój nie ma statusu ani przycisków decyzji —
   decyzja zapada w sprawie, do której prowadzi wiersz. Piątej tabeli ze
   wspólnym statusem nie było i nie będzie (CLAUDE.md).

   OFERTY TOWARU to pamięć człowieka (`oferta_kartoteka`) oraz oferty,
   których sygnatura jest symbolem kartoteki — ta sama para dróg, którą
   `kartotekaOferty` idzie w drugą stronę. Oferty bez żadnej z nich nie
   wiemy, że są tym towarem, i przekrój tego nie udaje: liczby sprzedaży
   mówią wprost „z ofert powiązanych". */

export const OKNO_PRZEKROJU_DNI = 90;

export interface PrzekrojTowaru {
  twId: number;
  /** Oferty powiązane z kartoteką — z nich liczy się sprzedaż i sprawy. */
  oferty: Array<{ konto: number; ofertaId: string; nazwa: string | null }>;
  otwarteZwroty: Array<{ id: number; numer: string | null; at: string; ilosc: number }>;
  otwarteSprawy: Array<{ id: number; typ: "CLAIM" | "DISPUTE"; numer: string | null; at: string }>;
  otwarteRozmowy: Array<{ id: number; temat: string | null; at: string }>;
  okno: {
    dni: number;
    /** Sztuki sprzedane z ofert powiązanych, bez anulowanych zamówień. */
    sprzedanych: number;
    /** Sztuki w zwrotach z tą kartoteką. */
    zwroconych: number;
    reklamacji: number;
    /** `zwroconych / sprzedanych`; `null`, gdy sprzedaży w oknie nie znamy. */
    udzialZwrotow: number | null;
  };
}

type W = Record<string, unknown>;

export function przekrojTowaru(twId: number, database: DatabaseSync = defaultDb(), teraz = Date.now()): PrzekrojTowaru {
  const od = new Date(teraz - OKNO_PRZEKROJU_DNI * 86_400_000).toISOString();
  const symbol = (database.prepare("SELECT symbol FROM sgt_towar WHERE tw_id=?").get(twId) as { symbol?: string } | undefined)
    ?.symbol ?? null;

  const oferty = new Map<string, { konto: number; ofertaId: string; nazwa: string | null }>();
  for (const w of database.prepare(`
    SELECT k.channel_account_id AS konto, k.offer_id AS oferta, s.nazwa
      FROM oferta_kartoteka k
      LEFT JOIN offer_snapshot s ON s.channel_account_id = k.channel_account_id AND s.external_id = k.offer_id
     WHERE k.tw_id = ?
    UNION
    SELECT s.channel_account_id, s.external_id, s.nazwa FROM offer_snapshot s
     WHERE ? IS NOT NULL AND s.sku = ?`).all(twId, symbol, symbol) as W[]) {
    oferty.set(`${w.konto}|${w.oferta}`, { konto: Number(w.konto), ofertaId: String(w.oferta),
      nazwa: (w.nazwa as string) ?? null });
  }
  const pary = [...oferty.values()];
  /* Warunek na parę (konto, oferta) jako lista OR — ofert jednej kartoteki
     jest kilka, nie kilkaset. Pusta lista to warunek fałszywy, nie błąd SQL. */
  const naPary = (kolKonto: string, kolOferta: string) => pary.length
    ? `(${pary.map(() => `(${kolKonto} = ? AND ${kolOferta} = ?)`).join(" OR ")})` : "0";
  const argPary = pary.flatMap((p) => [p.konto, p.ofertaId]);

  const otwarteZwroty = (database.prepare(`
    SELECT z.id, z.reference_number AS numer, z.created_at AS at, SUM(p.ilosc) AS ilosc
      FROM zwrot_klienta_pozycja p JOIN zwrot_klienta z ON z.id = p.zwrot_id
     WHERE p.tw_id = ? AND z.zamkniety_at IS NULL
     GROUP BY z.id ORDER BY z.created_at DESC LIMIT 10`).all(twId) as W[])
    .map((w) => ({ id: Number(w.id), numer: (w.numer as string) ?? null, at: String(w.at), ilosc: Number(w.ilosc) }));

  const sprawy = database.prepare(`
    SELECT id, typ, reference_number AS numer, otwarto_at AS at, status_allegro AS status
      FROM reklamacja_klienta WHERE ${naPary("channel_account_id", "offer_id")}
     ORDER BY otwarto_at DESC`).all(...argPary) as W[];
  const otwarteSprawy = sprawy.filter((w) => sprawaOtwarta((w.status as string) ?? null)).slice(0, 10)
    .map((w) => ({ id: Number(w.id), typ: String(w.typ) === "DISPUTE" ? "DISPUTE" as const : "CLAIM" as const,
      numer: (w.numer as string) ?? null, at: String(w.at) }));

  /* Rozmowa jest „o towarze", gdy klient pisał spod jego oferty. Stan liczy
     ta sama funkcja co skrzynka — zapisana kolumna bywa nieświeża. */
  const otwarteRozmowy = (database.prepare(`
    SELECT c.id, c.subject AS temat, MAX(m.sent_at) AS at
      FROM message m JOIN conversation c ON c.id = m.conversation_id
     WHERE m.related_object_type = 'OFFER' AND ${naPary("c.channel_account_id", "m.related_object_id")}
     GROUP BY c.id ORDER BY at DESC LIMIT 40`).all(...argPary) as W[])
    .filter((w) => !["resolved", "closed", "spam"].includes(statusRozmowy(database, Number(w.id))))
    .slice(0, 10)
    .map((w) => ({ id: Number(w.id), temat: (w.temat as string) ?? null, at: String(w.at) }));

  const sprzedanych = Number((database.prepare(`
    SELECT COALESCE(SUM(p.ilosc), 0) AS n
      FROM zamowienie_klienta_pozycja p JOIN zamowienie_klienta z ON z.id = p.zamowienie_id
     WHERE z.kupiono_at >= ? AND COALESCE(z.status, '') <> 'CANCELLED'
       AND ${naPary("z.channel_account_id", "p.offer_id")}`).get(od, ...argPary) as { n: number }).n);
  const zwroconych = Number((database.prepare(`
    SELECT COALESCE(SUM(p.ilosc), 0) AS n
      FROM zwrot_klienta_pozycja p JOIN zwrot_klienta z ON z.id = p.zwrot_id
     WHERE p.tw_id = ? AND z.created_at >= ?`).get(twId, od) as { n: number }).n);
  const reklamacji = sprawy.filter((w) => String(w.typ) === "CLAIM" && String(w.at) >= od).length;

  return {
    twId, oferty: pary, otwarteZwroty, otwarteSprawy, otwarteRozmowy,
    okno: {
      dni: OKNO_PRZEKROJU_DNI, sprzedanych, zwroconych, reklamacji,
      udzialZwrotow: sprzedanych > 0 ? Number((zwroconych / sprzedanych).toFixed(2)) : null,
    },
  };
}
