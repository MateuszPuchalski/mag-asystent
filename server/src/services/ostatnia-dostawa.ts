import { config } from "../config.js";
import type { Db } from "../db/db.js";
import { etykietyDostaw } from "../adapters/typy-dokumentow.js";

/* ── Od kogo przyszedł towar, który klient reklamuje ─────────────────────────
   Wadę fabryczną reklamujemy u dostawcy, więc przy reklamacji pierwsze pytanie
   biura brzmi „kto nam to sprzedał". Karta towaru tego nie mówi: jej
   `wDostawie` pokazuje wyłącznie dostawy jeszcze nierozłożone.

   DWA ŹRÓDŁA, BO KAŻDE MA LUKĘ. Read-model `sgt_dokument` trzyma okno importu
   (`DOK_DNI_WSTECZ`) i otwarte dostawy, a archiwum `delivery` trzyma tylko
   dokumenty otwarte w WERTIS, za to bez końca. Ten sam dokument bywa w obu
   i to nie szkodzi: pytamy o jeden, najnowszy.

   PIERWSZEŃSTWO MA DOSTAWA SPRZED ZAKUPU. Klient dostał sztukę z partii, która
   leżała na półce w dniu zakupu, a nie z tej, która przyszła tydzień później.
   Gdy takiej nie znamy, oddajemy najnowszą w ogóle i mówimy to flagą — ekran
   nie ma prawa podać jednej za drugą.

   `null` znaczy „nie wiemy", nigdy „nie było dostawcy". Liść bez importu
   `reklamacje.ts`, żeby szczegół sprawy mógł go wołać bez cyklu modułów.    */

export interface OstatniaDostawa {
  /** Symbol kontrahenta z Subiekta (`kh_Symbol`); pełnej nazwy nie importujemy. */
  dostawca: string;
  /** Data dokumentu dostawy, jak stoi w Subiekcie. */
  data: string;
  /**
   * Numer faktury DOSTAWCY (`nr_oryg`), nie nasz numer FZ. Reklamację
   * u dostawcy zgłasza się na jego dokument, bo naszego numeru on nie zna.
   * `null`, gdy biuro nie uzupełniło pola w Subiekcie.
   */
  numer: string | null;
  /** Czy to dostawa z dnia zakupu albo wcześniejsza — partia, z której klient dostał sztukę. */
  przedZakupem: boolean;
}

type Wiersz = { dostawca: string; data: string; numer: string | null };

function najnowsza(database: Db, twId: number, doDnia: string | null): Wiersz | undefined {
  /* Filtry read-modelu są TE SAME, co przy liście dostaw do rozłożenia
     (`getDeliveryPositionsForProduct`): typ dokumentu dostawy i magazyn skutku.
     Inny filtr pokazałby dostawcę z dokumentu, którego nie ma na żadnej
     liście rozkładania. Archiwum już przeszło ten filtr przy otwarciu. */
  const etykiety = etykietyDostaw();
  const luki = etykiety.map(() => "?").join(",");
  return database.prepare(`
    SELECT dostawca, data, numer FROM (
      SELECT TRIM(COALESCE(d.dostawca, '')) AS dostawca, COALESCE(d.data_wyst, '') AS data,
             d.nr_oryg AS numer, d.dok_id AS dok
        FROM sgt_pozycja p JOIN sgt_dokument d ON d.dok_id = p.dok_id
       WHERE p.tw_id = ? AND d.typ IN (${luki}) AND d.mag_id IN (?, ?)
      UNION ALL
      SELECT TRIM(COALESCE(dl.dostawca, '')), COALESCE(dl.data_dok, ''),
             dl.nr_oryg, dl.sgt_dok_id
        FROM delivery_line l JOIN delivery dl ON dl.id = l.delivery_id
       WHERE l.tw_id = ?)
     WHERE dostawca <> '' AND data <> '' AND (? IS NULL OR substr(data, 1, 10) <= ?)
     ORDER BY data DESC, dok DESC
     LIMIT 1`).get(twId, ...etykiety, config.magId.MAG, config.magId.MGP, twId, doDnia, doDnia) as
    Wiersz | undefined;
}

/**
 * Ostatnia dostawa towaru `twId` — najpierw ta z dnia zakupu albo wcześniejsza,
 * potem najnowsza w ogóle. Czysty odczyt z naszej bazy, zero żądań do Subiekta.
 */
export function ostatniaDostawa(
  database: Db, twId: number | null, kupionoAt: string | null,
): OstatniaDostawa | null {
  if (twId === null) return null;
  /* Porównujemy DNI, nie chwile: dokument dostawy ma samą datę, a zakup
     godzinę. Dostawa z dnia zakupu liczy się jako „przed", bo rano leżała
     już na półce częściej, niż nie. */
  const dzien = kupionoAt && /^\d{4}-\d{2}-\d{2}/.test(kupionoAt) ? kupionoAt.slice(0, 10) : null;
  const przed = dzien === null ? undefined : najnowsza(database, twId, dzien);
  const w = przed ?? najnowsza(database, twId, null);
  if (!w) return null;
  const numer = typeof w.numer === "string" && w.numer.trim() !== "" ? w.numer.trim() : null;
  return { dostawca: w.dostawca, data: w.data, numer, przedZakupem: przed !== undefined };
}
