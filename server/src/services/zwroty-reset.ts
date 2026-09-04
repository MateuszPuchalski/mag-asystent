import { logEvent } from "./events.js";
import { transaction, type Db } from "../db/db.js";

/* ── Czyszczenie zwrotów przed ponownym pobraniem (0.199.0) ─────────────────
   Zgłoszenie właściciela: „naklikałem testowo i niektóre zwroty zostały
   niepoprawnie obsłużone". Potrzebny jest czysty stan, a nie prostowanie
   pojedynczych decyzji ręką.

   Trzy rzeczy, których to NIE robi, i każda z innego powodu:

   1. **Nie rusza pamięci oferta→kartoteka.** Automat wiąże po sygnaturze i po
      tej pamięci; skasowanie jej kosztowałoby ponowne wskazywanie kartotek
      przy zwrotach, które z testowym klikaniem nie miały nic wspólnego.
   2. **Nie rusza zamkniętych koszyków ani zadań `mm`.** Zamknięty koszyk
      pojechał na halę z wystawionym papierem, a zadanie w kolejce ma własny
      ładunek i nie zależy od wiersza zwrotu. Kasowanie ich stąd rozjechałoby
      papier z zawartością.
   3. **Nie kasuje dziennika.** `events` jest zapisem tego, co się wydarzyło —
      także tego testowego klikania. Historii się nie przepisuje.

   SAMO SKASOWANIE WIERSZY NIE WYSTARCZY. Synchronizacja chodzi na kursorze
   (`allegro_zwroty_sync_state.cursor_id`): Allegro oddaje zwroty utworzone PO
   nim. Bez cofnięcia kursora skasowane zwroty nie wróciłyby nigdy, a ekran
   pokazywałby pustkę wyglądającą na awarię Allegro.                          */

export interface PodsumowanieZwrotow {
  zwrotow: number;
  pozycji: number;
  /** Zwroty założone u nas (`zrodlo='nieodebrana'`) — te NIE wrócą z Allegro. */
  wlasnych: number;
  /** Zwroty z zapisanym zwrotem płatności — bramka, nie licznik. */
  zOddanymiPieniedzmi: number;
  koszykiOtwarte: number;
  pozycjiWKoszykachOtwartych: number;
  /** Zostają nietknięte; liczba jest po to, żeby człowiek wiedział, co zostaje. */
  koszykiZamkniete: number;
  zadaniaMmWKolejce: number;
}

/** Otwarty koszyk zwrotów złożony u nas — ten sam warunek co w `kosze-zwrotow.ts`. */
const OTWARTE_KOSZYKI =
  "SELECT id FROM kosz WHERE status='otwarty' AND mm_dok_id IS NULL AND rodzaj='zwroty'";

function licz(database: Db, sql: string, ...args: unknown[]): number {
  const w = database.prepare(sql).get(...(args as [])) as { n: number } | undefined;
  return Number(w?.n ?? 0);
}

/**
 * Co leży w bazie — bez jednego zapisu.
 *
 * Raport jest domyślnym trybem narzędzia, bo kasowanie zwrotów jest
 * nieodwracalne, a liczba w kolumnie „własne" bywa niespodzianką: zwroty
 * z paczek nieodebranych zakłada BIURO, więc Allegro ich nie odda.
 */
export function policzZwroty(database: Db): PodsumowanieZwrotow {
  return {
    zwrotow: licz(database, "SELECT COUNT(*) AS n FROM zwrot_klienta"),
    pozycji: licz(database, "SELECT COUNT(*) AS n FROM zwrot_klienta_pozycja"),
    wlasnych: licz(database, "SELECT COUNT(*) AS n FROM zwrot_klienta WHERE zrodlo='nieodebrana'"),
    zOddanymiPieniedzmi: licz(database,
      "SELECT COUNT(*) AS n FROM zwrot_klienta WHERE zwrot_pieniedzy_id IS NOT NULL"),
    koszykiOtwarte: licz(database, `SELECT COUNT(*) AS n FROM (${OTWARTE_KOSZYKI})`),
    pozycjiWKoszykachOtwartych: licz(database,
      `SELECT COUNT(*) AS n FROM kosz_pozycja WHERE kosz_id IN (${OTWARTE_KOSZYKI})`),
    koszykiZamkniete: licz(database,
      "SELECT COUNT(*) AS n FROM kosz WHERE status<>'otwarty' AND rodzaj='zwroty'"),
    zadaniaMmWKolejce: licz(database,
      "SELECT COUNT(*) AS n FROM sfera_queue WHERE type='mm' AND status='pending'"),
  };
}

/**
 * Kasuje zwroty i cofa kursor synchronizacji. Oddaje to, co skasował.
 *
 * Zapis o oddanych pieniądzach ZATRZYMUJE całość. Właściciel może wiedzieć,
 * że żaden testowy klik tam nie doszedł — ale „wiem, że nie" i „sprawdziłem,
 * że nie" to dwie różne rzeczy, a różnica kosztuje jedyny ślad po przelewie
 * do klienta. Świadome pominięcie bramki wymaga `mimoPieniedzy`.
 */
export function wyczyscZwroty(
  database: Db,
  kto: { id: number | null; name: string },
  opcje: { mimoPieniedzy?: boolean } = {},
): PodsumowanieZwrotow {
  const przed = policzZwroty(database);
  if (przed.zOddanymiPieniedzmi > 0 && !opcje.mimoPieniedzy) {
    const numery = (database.prepare(
      `SELECT reference_number, external_id FROM zwrot_klienta
        WHERE zwrot_pieniedzy_id IS NOT NULL LIMIT 10`).all() as
      Array<{ reference_number: string | null; external_id: string }>)
      .map((z) => z.reference_number ?? z.external_id);
    throw new Error(
      `${przed.zOddanymiPieniedzmi} zwrot(ów) ma zapisany zwrot płatności — pieniądze wyszły ` +
      `do klienta, a ten wiersz jest jedynym śladem. Nie kasuję: ${numery.join(", ")}. ` +
      "Świadome skasowanie wymaga flagi --mimo-pieniedzy.");
  }

  return transaction(database, () => {
    database.prepare(`DELETE FROM kosz_pozycja WHERE kosz_id IN (${OTWARTE_KOSZYKI})`).run();
    database.prepare(`DELETE FROM kosz WHERE id IN (${OTWARTE_KOSZYKI})`).run();
    /* Pozycje i zdarzenia zwrotu schodzą KASKADĄ (`ON DELETE CASCADE`,
       `PRAGMA foreign_keys = ON` w db.ts). Wypisywanie ich tutaj drugi raz
       dałoby dwa miejsca, w których trzeba pamiętać o nowej tabeli. */
    database.prepare("DELETE FROM zwrot_klienta").run();
    /* Kursor do zera, inaczej Allegro odda już tylko zwroty nowsze niż ostatni
       widziany — czyli nic. Wiersz kasujemy w całości: `stanZwrotow` czyta go
       z domyślnymi wartościami, gdy go nie ma. */
    database.prepare("DELETE FROM allegro_zwroty_sync_state").run();

    logEvent("zwroty_wyczyszczone", kto.name, null, {
      zwrotow: przed.zwrotow, pozycji: przed.pozycji, wlasnych: przed.wlasnych,
      koszykiOtwarte: przed.koszykiOtwarte,
      pozycjiWKoszykach: przed.pozycjiWKoszykachOtwartych,
      kursorCofniety: true,
    }, kto.id ?? undefined, database);
    return przed;
  })();
}
