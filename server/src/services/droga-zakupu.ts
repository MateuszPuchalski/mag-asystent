import { db as defaultDb, type Db } from "../db/db.js";
import { linkZamowienia } from "./allegro-linki.js";
import { ROZMOWA_ZAMOWIENIA, type PrzystanekDrogi, type SprawaZakupu } from "./droga-klienta.js";
import type { StanPrzesylkiZamowienia } from "./przesylka-zamowienia.js";
import {
  kontekstZamowienia, najnowszaReklamacjaZamowienia, type SzczegolReklamacji,
} from "./reklamacje.js";
import type { Zamowienie } from "./zamowienia.js";

/* Ten plik jest osobny, bo `reklamacje.ts` importuje `droga-klienta.ts`:
   składanie drogi w `droga-klienta.ts` zrobiłoby z tego cykl importów. */

/** Odpowiedź `GET /api/obsluga/droga/:orderId` — całość drogi jednego zakupu. */
export interface DrogaZakupuOdpowiedz {
  orderId: string;
  linkZamowienia: string | null;
  zamowienie: Zamowienie | null;
  przesylka: StanPrzesylkiZamowienia | null;
  droga: PrzystanekDrogi[];
  /** Wszystkie sprawy posprzedażowe zakupu; nic nie jest pomijane. */
  sprawy: SprawaZakupu[];
  /** Najnowsza reklamacja w tym samym kształcie co na ekranie reklamacji. */
  reklamacja: SzczegolReklamacji["reklamacja"] | null;
}

/**
 * Konto, na którym leży to zamówienie — z pierwszego źródła, które je zna.
 *
 * Numer zamówienia przyjeżdża z URL-a, bez konta, a każdy odczyt drogi pyta
 * o konto (cudze zakupy nie mają prawa wejść na ekran). Kolejność: samo
 * zamówienie, potem sprawy posprzedażowe, zwroty i rozmowy, bo tak dużo
 * zakupów ma wiersz w którejś z tych tabel, nawet bez pobranego zamówienia.
 * `null` = nigdzie go nie znamy.
 */
export function kontoZamowienia(database: Db, orderId: string): number | null {
  const zapytania = [
    "SELECT channel_account_id AS konto FROM zamowienie_klienta WHERE external_id = ?",
    "SELECT channel_account_id AS konto FROM reklamacja_klienta WHERE typ = 'CLAIM' AND order_id = ?",
    "SELECT channel_account_id AS konto FROM zwrot_klienta WHERE order_id = ?",
    `SELECT c.channel_account_id AS konto
       FROM ${ROZMOWA_ZAMOWIENIA} rz JOIN conversation c ON c.id = rz.conversation_id
      WHERE rz.numer = ?`,
  ];
  for (const sql of zapytania) {
    const w = database.prepare(`${sql} ORDER BY 1 LIMIT 1`).get(orderId) as
      { konto: number } | undefined;
    if (w) return Number(w.konto);
  }
  return null;
}

/**
 * Droga jednego zakupu przez wszystkie kolejki — CZYSTY ODCZYT.
 *
 * Bez `pomin`, bo pytamy o zakup, nie o sprawę: żadna ze spraw nie jest tu
 * „tą, z której patrzymy". Zero żądań do Allegro i zero zapisów; otwarcie
 * ekranu niczego nie mutuje. `null` = zamówienie nieznane w naszej bazie.
 */
export function drogaZamowienia(
  orderId: string, teraz = Date.now(), database: Db = defaultDb(),
): DrogaZakupuOdpowiedz | null {
  const konto = kontoZamowienia(database, orderId);
  if (konto === null) return null;
  const { zamowienie, przesylka, droga, sprawy } =
    kontekstZamowienia(database, konto, orderId, teraz);
  return {
    orderId,
    linkZamowienia: linkZamowienia(orderId),
    zamowienie, przesylka, droga, sprawy,
    reklamacja: najnowszaReklamacjaZamowienia(database, konto, orderId, teraz),
  };
}
