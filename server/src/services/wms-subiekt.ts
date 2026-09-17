import { db, type Db } from "../db/db.js";
import { config } from "../config.js";
import { command, move, type Actor } from "./wms.js";
import { logEvent } from "./events.js";

/* ── Granica WMS ↔ Subiekt (0.381.0) ─────────────────────────────────────────
   WMS scalony z `codex/robust-wms` trzyma własną prawdę o zapasie: `wms_stock`
   z rozbiciem na miejsca i `wms_movement` jako dziennik. Nie pisał jednak do
   Subiekta i NIE ROZLICZAŁ SIĘ Z NIM — `reconcile.ts` nie znał ani jednej
   tabeli `wms_`, a karta towaru nie czytała `wms_stock`.

   Znaczyło to stan magazynowy w dwóch miejscach naraz, bez pomiaru różnicy
   między nimi. Ten moduł jest brakującą granicą i robi dokładnie dwie rzeczy:
   zasiewa zapas ze stanu Subiekta i mierzy rozjazd. Decyzję o tym, co zrobić
   z rozjazdem, zostawia człowiekowi — korekta stanu jest dokumentem księgowym.

   Właścicielem sumy zostaje Subiekt. WERTIS trzyma jej rozbicie na miejsca.
   Uzasadnienie tej granicy stoi w `docs/wms-strategia.md` §3, a projekt
   zasiewu i niezmienników w `docs/wms-projekt.md` §4 i §11.

   JEDEN MAGAZYN, nie wszystkie. `wms_bin` nie ma kolumny magazynu, więc cały
   WMS opisuje dziś magazyn MAG — tak samo czyta go `wms-analytics.ts`.
   Rozliczenie obejmuje więc MAG i tylko MAG; wielomagazynowość wymaga
   najpierw kolumny przy miejscu i jest osobną pracą.                         */

/**
 * Miejsce na zapas jeszcze nieprzypisany do półki.
 *
 * Bez niego zasiew wymagałby policzenia całego magazynu przed startem, czyli
 * tygodnia postoju — a niezmiennik „suma z półek równa się stanowi Subiekta”
 * byłby czerwony od pierwszego dnia i przez to martwy.
 *
 * Kod pasuje do wzorca adresu z `wms.ts` (wielkie litery i myślnik), więc
 * przechodzi tą samą walidacją co półka. Tryb `reserve` jest tu istotny:
 * przydział pod zamówienie bierze wyłącznie z miejsc `pick`, więc z miejsca
 * nieznanego nikt nie pobierze pod zbiórkę. Wyjść z niego można tylko
 * przesunięciem, czyli wtedy, gdy człowiek zobaczył towar na półce.
 */
export const BIN_NIEZNANE = "NIEZNANE";

/** Powód rozjazdu — mówi, CO z nim zrobić, a nie tylko że jest. */
export type PowodRozjazdu =
  /** Stan w Subiekcie jest ułamkiem, a `wms_stock.on_hand` trzyma liczby całkowite. */
  | "ulamek"
  /** WMS ma więcej niż Subiekt — nadmiar, którego zasiew nie tknie. */
  | "wms_wiecej"
  /** WMS ma mniej niż Subiekt — brakującą część dosypuje zasiew. */
  | "wms_mniej";

export interface RozjazdZapasu {
  twId: number;
  symbol: string | null;
  subiekt: number;
  wms: number;
  /** Zawsze `subiekt - wms`; dodatnia znaczy „w WMS brakuje”. */
  roznica: number;
  powod: PowodRozjazdu;
}

const SQL_ROZJAZD = `
  WITH kartoteki AS (
    SELECT tw_id FROM sgt_stan WHERE mag_id = ? AND stan <> 0
    UNION
    SELECT tw_id FROM wms_stock GROUP BY tw_id HAVING sum(on_hand) <> 0
  ),
  subiekt AS (SELECT tw_id, stan FROM sgt_stan WHERE mag_id = ?),
  magazyn AS (SELECT tw_id, sum(on_hand) AS ile FROM wms_stock GROUP BY tw_id)
  SELECT k.tw_id AS twId, t.symbol AS symbol,
         coalesce(s.stan, 0) AS subiekt, coalesce(m.ile, 0) AS wms
  FROM kartoteki k
  LEFT JOIN subiekt s ON s.tw_id = k.tw_id
  LEFT JOIN magazyn m ON m.tw_id = k.tw_id
  LEFT JOIN sgt_towar t ON t.tw_id = k.tw_id
  WHERE coalesce(s.stan, 0) <> coalesce(m.ile, 0)
  ORDER BY abs(coalesce(s.stan, 0) - coalesce(m.ile, 0)) DESC, k.tw_id`;

/**
 * Rozjazd między sumą z miejsc a stanem Subiekta, kartoteka po kartotece.
 *
 * Pusta lista znaczy zgodność. Ułamek jest osobnym powodem, a nie milczącym
 * zaokrągleniem: `wms_stock.on_hand` jest liczbą całkowitą, więc kartoteka
 * sprzedawana na metry nie da się zasiać bez decyzji o jednostce.
 */
export function rozjazdyZapasu(database: Db = db()): RozjazdZapasu[] {
  const mag = config.magId.MAG;
  const wiersze = database.prepare(SQL_ROZJAZD).all(mag, mag) as {
    twId: number; symbol: string | null; subiekt: number; wms: number;
  }[];
  return wiersze.map((w) => ({
    ...w,
    roznica: w.subiekt - w.wms,
    powod: !Number.isInteger(w.subiekt)
      ? "ulamek"
      : w.wms > w.subiekt
        ? "wms_wiecej"
        : "wms_mniej",
  }));
}

export interface PostepZasiewu {
  /** Sztuki stojące jeszcze w miejscu nieznanym. */
  nieznane: number;
  /** Sztuki mające prawdziwy adres. */
  polki: number;
  /** Kartoteki, których cały zapas siedzi w miejscu nieznanym. */
  kartotekNieznane: number;
  /** Kartoteki mające zapas pod jakimkolwiek prawdziwym adresem. */
  kartotekPolki: number;
}

/**
 * Postęp wdrożenia, a NIE rozjazd.
 *
 * Zapas w miejscu nieznanym jest stanem normalnym pierwszego dnia i maleje
 * w tempie pracy hali. Mieszanie go z rozjazdem zrobiłoby z raportu listę
 * czerwonych wierszy na starcie — a raport czerwony od początku przestaje być
 * czytany, co `reconcile.ts` mówi wprost w swoim komentarzu.
 */
export function postepZasiewu(database: Db = db()): PostepZasiewu {
  const w = database
    .prepare(
      `SELECT
         coalesce(sum(CASE WHEN bin = ? THEN on_hand END), 0) AS nieznane,
         coalesce(sum(CASE WHEN bin <> ? THEN on_hand END), 0) AS polki,
         count(DISTINCT CASE WHEN bin <> ? AND on_hand > 0 THEN tw_id END) AS kartotekPolki
       FROM wms_stock`,
    )
    .get(BIN_NIEZNANE, BIN_NIEZNANE, BIN_NIEZNANE) as {
    nieznane: number; polki: number; kartotekPolki: number;
  };
  const tylkoNieznane = database
    .prepare(
      `SELECT count(*) AS ile FROM (
         SELECT tw_id FROM wms_stock WHERE on_hand > 0
         GROUP BY tw_id HAVING sum(CASE WHEN bin <> ? THEN on_hand ELSE 0 END) = 0)`,
    )
    .get(BIN_NIEZNANE) as { ile: number };
  return { ...w, kartotekNieznane: tylkoNieznane.ile };
}

export interface WynikZasiewu {
  /** Kartoteki, którym dosypano brakującą część. */
  zasiane: number;
  /** Suma dosypanych sztuk. */
  sztuk: number;
  /** Rozjazdy, których zasiew NIE tknął — z powodem przy każdym. */
  pominiete: RozjazdZapasu[];
}

/**
 * Zasiew: dosyp do miejsca nieznanego tyle, ile brakuje do stanu Subiekta.
 *
 * IDEMPOTENTNY Z ARYTMETYKI, nie z klucza. Liczy różnicę i dosypuje brakującą
 * część, więc drugi przebieg na niezmienionych danych nie robi nic. Klucz
 * `command` daje transakcję i zapis w dzienniku poleceń, a nie ochronę przed
 * powtórzeniem — tę daje samo porównanie.
 *
 * NADMIARU NIE ZDEJMUJE. Gdy WMS ma więcej niż Subiekt, ktoś policzył półkę
 * albo Subiekt wydał towar, którego hala jeszcze nie ruszyła. Obie sytuacje
 * są decyzją człowieka, a nie odejmowaniem w skrypcie — dlatego wracają
 * w `pominiete`.
 */
export function zasiew(actor: Actor, klucz: string): WynikZasiewu {
  const rozjazdy = rozjazdyZapasu();
  const doZasiewu = rozjazdy.filter((r) => r.powod === "wms_mniej");
  const pominiete = rozjazdy.filter((r) => r.powod !== "wms_mniej");
  const wynik = command(klucz, actor, "wms-zasiew", { kartotek: doZasiewu.length }, () => {
    let sztuk = 0;
    for (const r of doZasiewu) {
      move(actor, r.twId, BIN_NIEZNANE, r.roznica, 0, "receive",
        `Zasiew ze stanu Subiekta (magazyn ${config.magId.MAG})`);
      sztuk += r.roznica;
    }
    return { zasiane: doZasiewu.length, sztuk, pominiete };
  });
  /* Dziennik zdarzeń dostaje JEDEN wpis na przebieg, nie na kartotekę: ruchy
     per kartoteka leżą już w `wms_movement`, a `events` ma powiedzieć, że
     ktoś uruchomił zasiew i z jakim wynikiem. */
  logEvent("wms_zasiew", actor.name, null, {
    zasiane: wynik.zasiane, sztuk: wynik.sztuk, pominietych: pominiete.length,
  });
  return wynik;
}
