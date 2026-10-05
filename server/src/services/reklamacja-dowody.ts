import type { Db } from "../db/db.js";

/* ── Dowody biura i reklamacja u dostawcy — ODCZYT ───────────────────────────
   Liść bez importu `reklamacje.ts`: szczegół sprawy czyta stąd przy każdym
   otwarciu, a moduł zapisu importuje `reklamacje.ts` po `doZapisu`. Odczyt
   i zapis w jednym pliku zamknęłyby cykl modułów, a klasa błędu użyta przed
   inicjalizacją wywraca start bez czytelnego zdania.

   DOWÓD TO SWOBODNY WPIS BIURA, NIE LISTA KROKÓW (decyzja właściciela). Biuro
   pisze, co widać na zdjęciu, czego brakuje i co ustaliło. Sztywna lista
   kroków pasowałaby do jednej sprawy na dziesięć, a resztę zmuszałaby do
   zaznaczania pól, które nic nie znaczą.

   REKLAMACJA U DOSTAWCY to NOWY rekord, nie stan sprawy klienta. Wadę
   fabryczną uznajemy klientowi, sztuka wraca do nas, a my zgłaszamy ją
   dostawcy. Ten drugi spór ma własnego rozmówcę, własny numer i własny wynik,
   więc nie dzieli wersji z rekordem, przy którym pisze się odpowiedź do
   kupującego.                                                               */

/** Najwięcej znaków jednego dowodu. Akapit, nie elaborat; dłuższy tekst to notatka. */
export const LIMIT_DOWODU = 2000;

/** Najwięcej znaków symbolu dostawcy i numeru jego reklamacji. */
export const LIMIT_DOSTAWCY = 120;
export const LIMIT_NR_U_DOSTAWCY = 80;

/** Wynik reklamacji u dostawcy; `null` znaczy „jeszcze nie odpowiedział". */
export const WYNIKI_U_DOSTAWCY = ["uznal", "odrzucil"] as const;
export type WynikUDostawcy = (typeof WYNIKI_U_DOSTAWCY)[number];

export interface DowodReklamacji {
  id: number;
  tresc: string;
  /** Zdjęcie klienta, którego dotyczy wpis. Etykietę `Z1`, `Z2` liczy panel. */
  zalacznikId: number | null;
  autor: string | null;
  utworzonoAt: string;
}

export interface ReklamacjaUDostawcy {
  dostawca: string;
  nrUDostawcy: string | null;
  zgloszonoAt: string;
  wynik: WynikUDostawcy | null;
  wynikAt: string | null;
  /** Kto zgłosił sprawę dostawcy; późniejsze zmiany stoją w dzienniku. */
  autor: string | null;
  /** Wersja TEGO rekordu, nie sprawy klienta; 0 w zapisie znaczy „zakładam". */
  wersja: number;
}

type Wiersz = Record<string, unknown>;

const tekst = (v: unknown): string | null =>
  typeof v === "string" && v.trim() !== "" ? v : null;

/** Dowody sprawy od najstarszego: biuro czyta je jak rozmowę, z góry na dół. */
export function dowodyReklamacji(database: Db, reklamacjaId: number): DowodReklamacji[] {
  return (database.prepare(
    `SELECT id, tresc, zalacznik_id, autor, utworzono_at FROM reklamacja_dowod
      WHERE reklamacja_id = ? ORDER BY id`,
  ).all(reklamacjaId) as Wiersz[]).map((w) => ({
    id: Number(w.id),
    tresc: String(w.tresc ?? ""),
    zalacznikId: w.zalacznik_id == null ? null : Number(w.zalacznik_id),
    autor: tekst(w.autor),
    utworzonoAt: String(w.utworzono_at),
  }));
}

/** Reklamacja u dostawcy albo `null`, gdy biuro jej jeszcze nie zgłosiło. */
export function uDostawcyReklamacji(database: Db, reklamacjaId: number): ReklamacjaUDostawcy | null {
  const w = database.prepare(
    `SELECT dostawca, nr_u_dostawcy, zgloszono_at, wynik, wynik_at, autor, wersja
       FROM reklamacja_u_dostawcy WHERE reklamacja_id = ?`,
  ).get(reklamacjaId) as Wiersz | undefined;
  if (!w) return null;
  return {
    dostawca: String(w.dostawca ?? ""),
    nrUDostawcy: tekst(w.nr_u_dostawcy),
    zgloszonoAt: String(w.zgloszono_at),
    wynik: (tekst(w.wynik) as WynikUDostawcy | null),
    wynikAt: tekst(w.wynik_at),
    autor: tekst(w.autor),
    wersja: Number(w.wersja ?? 1),
  };
}
