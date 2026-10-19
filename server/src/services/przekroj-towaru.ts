import type { DatabaseSync } from "node:sqlite";
import { db as defaultDb } from "../db/db.js";
import { sprawaOtwarta } from "./statusy-spraw.js";
import { statusRozmowy } from "./conversations.js";
import { ofertyKartoteki } from "./dopasowanie-sku.js";
import { config } from "../config.js";

/* ── Towar jako trzeci mostek ───────────────────────────────────────────────
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
   `kartotekaOferty` idzie w drugą stronę. Liczy je `ofertyKartoteki`,
   wspólna z historią reklamacji, żeby przekrój i licznik „ten towar"
   znały te same oferty. Po ofertach idą sprawy i rozmowy, bo Allegro wiąże
   je z ofertą, nie z kartoteką.

   SPRZEDAŻ IDZIE Z SUBIEKTA, nie z ofert. Liczona z zamówień Allegro znała
   tylko oferty powiązane, a zwroty liczą się po `tw_id` ze wszystkich, więc
   udział zwrotów wychodził zawyżony przy każdym towarze wystawionym w kilku
   ofertach. Paragon i faktura wiedzą o każdej sprzedanej sztuce, także
   spoza Allegro. */

export const OKNO_PRZEKROJU_DNI = 90;

export interface PrzekrojTowaru {
  twId: number;
  /** Oferty powiązane z kartoteką — po nich idą sprawy i rozmowy. */
  oferty: Array<{ konto: number; ofertaId: string; nazwa: string | null }>;
  otwarteZwroty: Array<{ id: number; numer: string | null; at: string; ilosc: number }>;
  otwarteSprawy: Array<{ id: number; typ: "CLAIM" | "DISPUTE"; numer: string | null; at: string }>;
  otwarteRozmowy: Array<{ id: number; temat: string | null; at: string }>;
  okno: {
    /** Faktyczne okno: krótsze od `OKNO_PRZEKROJU_DNI`, gdy kopia sprzedaży sięga mniej. */
    dni: number;
    /** Sztuki z paragonów i faktur Subiekta, brutto, bez odjęcia korekt. */
    sprzedanych: number;
    /** Sztuki w zwrotach z tą kartoteką. */
    zwroconych: number;
    reklamacji: number;
    /** `zwroconych / sprzedanych`; `null`, gdy sprzedaży w oknie nie znamy. */
    udzialZwrotow: number | null;
  };
}

type W = Record<string, unknown>;

/**
 * Przekrój jednego towaru. `kopiaDni` to zasięg kopii dokumentów sprzedaży
 * (`DOK_SPRZEDAZ_DNI_WSTECZ`); parametrem, żeby test mógł go skrócić.
 */
export function przekrojTowaru(
  twId: number, database: DatabaseSync = defaultDb(), teraz = Date.now(),
  kopiaDni: number = config.mssql.fakturyDniWstecz,
): PrzekrojTowaru {
  /* Okno nie sięga dalej niż kopia. Dłuższe liczyłoby sprzedaż tylko z jej
     części, a zwroty i reklamacje z całości, i udział rósłby po cichu.
     Wszystkie trzy liczby stoją na tym samym oknie z tego samego powodu. */
  const dni = Math.max(0, Math.min(OKNO_PRZEKROJU_DNI, kopiaDni));
  const od = new Date(teraz - dni * 86_400_000).toISOString();
  const pary = ofertyKartoteki(database, twId);
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

  /* Sprzedaż BRUTTO: korekty nie mają pozycji w kopii (`pobierzFaktury`),
     a filtr po typie trzyma je z dala, nawet gdyby pozycje kiedyś weszły.
     Zwroty liczą się osobno, więc odjęcie korekt policzyłoby je dwa razy.

     Faktura do paragonu niesie towar paragonu drugi raz. Para wiąże się
     `dok_DoDokId` (`koryguje_dok_id`): struktura bazy mówi, że to faktura
     wskazuje paragon, ale na żywej parze tego nie sprawdzono
     (`docs/subiekt-gt-struktura.md`). Dlatego odpada FAKTURA związana
     z paragonem z kopii w którąkolwiek stronę. Obie strony opisują tę samą
     sprzedaż, a liczy się paragon, bo to on wydał towar.

     Paragon sprzed kopii nie ma drugiego egzemplarza, więc jego faktura się
     liczy. Bez kolumny odnośnika (`MSSQL_KOREKTA_COLUMN`) para jest
     nierozpoznawalna i faktura do paragonu liczy się podwójnie. */
  const sprzedanych = Number((database.prepare(`
    SELECT COALESCE(SUM(p.ilosc), 0) AS n
      FROM sgt_faktura_pozycja p JOIN sgt_faktura f ON f.dok_id = p.dok_id
     WHERE p.tw_id = ? AND f.data_wyst >= ? AND f.typ IN ('FS', 'PA')
       AND NOT (f.typ = 'FS' AND (
             EXISTS (SELECT 1 FROM sgt_faktura pa WHERE pa.dok_id = f.koryguje_dok_id AND pa.typ = 'PA')
          OR EXISTS (SELECT 1 FROM sgt_faktura pa WHERE pa.koryguje_dok_id = f.dok_id AND pa.typ = 'PA')))`)
    .get(twId, od.slice(0, 10)) as { n: number }).n);
  /* Zwroty po kartotece, w tym samym oknie co sprzedaż. Znamy je tylko
     z naszej kolejki zwrotów, a sprzedaż ze wszystkich kanałów Subiekta.
     Udział mówi więc raczej za mało niż za dużo. */
  const zwroconych = Number((database.prepare(`
    SELECT COALESCE(SUM(p.ilosc), 0) AS n
      FROM zwrot_klienta_pozycja p JOIN zwrot_klienta z ON z.id = p.zwrot_id
     WHERE p.tw_id = ? AND z.created_at >= ?`).get(twId, od) as { n: number }).n);
  const reklamacji = sprawy.filter((w) => String(w.typ) === "CLAIM" && String(w.at) >= od).length;

  return {
    twId, oferty: pary, otwarteZwroty, otwarteSprawy, otwarteRozmowy,
    okno: {
      dni, sprzedanych, zwroconych, reklamacji,
      udzialZwrotow: sprzedanych > 0 ? Number((zwroconych / sprzedanych).toFixed(2)) : null,
    },
  };
}
