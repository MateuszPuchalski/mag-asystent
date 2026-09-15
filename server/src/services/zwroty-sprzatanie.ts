import { logEvent } from "./events.js";
import { transaction, type Db } from "../db/db.js";
import { STATUSY_ODDANE } from "./zwrot-pieniedzy.js";

/* ── Kasowanie zwrotów rozliczonych POZA aplikacją (0.340.0) ────────────────
   Zgłoszenie właściciela: „wywal zwroty rozliczone poza aplikacją".

   Po 0.339.0 taki zwrot schodzi z kolejki pracy do ZAMKNIĘTYCH. Właściciel
   chce iść dalej: jeżeli całą sprawę załatwiono w panelu Allegro, a u nas nie
   ma po niej ani jednego śladu, to ten wiersz nie opisuje niczego, co
   kiedykolwiek robiliśmy — i ma zniknąć z bazy.

   ── Co znaczy „POZA aplikacją" ─────────────────────────────────────────────
   Allegro mówi, że pieniądze wróciły (`FINISHED`, `FINISHED_APT`), a po naszej
   stronie nie ma:

     * zapisanego zwrotu płatności (`zwrot_pieniedzy_id`) — to MY go zleciliśmy,
     * notatki o przelewie (`przelew_at`) — to biuro zapisało, że oddało ręką,
     * numeru korekty — dokument stoi wtedy w księgach firmy,
     * ani jednej pozycji w koszyku — towar poszedł wtedy na dokument MM.

   KAŻDY Z TYCH ŚLADÓW ZATRZYMUJE KASOWANIE i to nie jest ostrożność na wyrost.
   Wiersz z przelewem bywa JEDYNYM dowodem, że klient dostał pieniądze (blizna
   0.269.0). A `kosz_pozycja.zwrot_pozycja_id` NIE MA klucza obcego — dodano ją
   `addColumn` — więc skasowanie zwrotu nie wywróciłoby zapisu, tylko zostawiło
   w pudle wiersz wskazujący na nieistniejącą pozycję. Po cichu.

   ── Czego to NIE robi ──────────────────────────────────────────────────────
   Nie rusza kursora synchronizacji. Różnica wobec `zwroty-reset`: tam celem
   było pobranie wszystkiego od nowa, tutaj — pozbycie się wierszy na dobre.
   Cofnięty kursor przywróciłby je przy najbliższym takcie, czyli skasowanie
   nie znaczyłoby nic.

   Nie rusza dziennika. `events` mówi, co się wydarzyło, i zostaje —  razem
   z wpisem o tym kasowaniu.                                                 */

const STATUSY = [...STATUSY_ODDANE];
const PYTAJNIKI = STATUSY.map(() => "?").join(",");

/** Zwrot bez ŻADNEJ pozycji w koszyku — warunek wspólny dla liczenia i kasowania. */
const BEZ_KOSZYKA = `NOT EXISTS (
  SELECT 1 FROM kosz_pozycja kp
    JOIN zwrot_klienta_pozycja p ON p.id = kp.zwrot_pozycja_id
   WHERE p.zwrot_id = z.id)`;

export interface PodsumowanieSprzatania {
  /** Zwroty do skasowania: rozliczone przez Allegro i bez śladu u nas. */
  doSkasowania: number;
  pozycji: number;
  /** Numery kilku pierwszych — na ekran, żeby człowiek wiedział, co znika. */
  numery: string[];
  /** Rozliczone przez Allegro, ale ZE śladem u nas — zostają, z powodem. */
  zostaja: {
    zNaszymZwrotemPlatnosci: number;
    zNotatkaOPrzelewie: number;
    zKorekta: number;
    wKoszyku: number;
  };
}

function licz(database: Db, warunek: string): number {
  const w = database.prepare(
    `SELECT COUNT(*) AS n FROM zwrot_klienta z
      WHERE z.status_allegro IN (${PYTAJNIKI}) AND ${warunek}`)
    .get(...(STATUSY as [])) as { n: number } | undefined;
  return Number(w?.n ?? 0);
}

/** Warunek „nie ma po tym zwrocie śladu w aplikacji". */
const BEZ_SLADU = `z.zwrot_pieniedzy_id IS NULL AND z.przelew_at IS NULL
  AND z.korekta_numer IS NULL AND ${BEZ_KOSZYKA}`;

/**
 * Co zniknie i co zostanie — bez jednego zapisu.
 *
 * Raport jest domyślnym trybem narzędzia: kasowanie jest nieodwracalne,
 * a liczba „zostają" mówi, ile spraw ma u nas własną historię mimo tego, że
 * pieniądze poszły przez Allegro.
 */
export function policzRozliczonePozaAplikacja(database: Db): PodsumowanieSprzatania {
  const kandydaci = database.prepare(
    `SELECT z.id, z.reference_number, z.external_id FROM zwrot_klienta z
      WHERE z.status_allegro IN (${PYTAJNIKI}) AND ${BEZ_SLADU} ORDER BY z.id`)
    .all(...(STATUSY as [])) as
    Array<{ id: number; reference_number: string | null; external_id: string }>;
  const idy = kandydaci.map((z) => Number(z.id));
  const pozycji = idy.length === 0 ? 0 : Number((database.prepare(
    `SELECT COUNT(*) AS n FROM zwrot_klienta_pozycja
      WHERE zwrot_id IN (${idy.map(() => "?").join(",")})`)
    .get(...(idy as [])) as { n: number }).n);

  return {
    doSkasowania: kandydaci.length,
    pozycji,
    numery: kandydaci.slice(0, 10).map((z) => z.reference_number ?? z.external_id),
    /* POWODY LICZONE OSOBNO, nie jedną różnicą. Zwrot bywa zatrzymany przez
       dwie rzeczy naraz, a człowiek ma wiedzieć, KTÓRA go trzyma — inaczej
       zdejmie jedną i zdziwi się, że wiersz dalej stoi. */
    zostaja: {
      zNaszymZwrotemPlatnosci: licz(database, "z.zwrot_pieniedzy_id IS NOT NULL"),
      zNotatkaOPrzelewie: licz(database, "z.przelew_at IS NOT NULL"),
      zKorekta: licz(database, "z.korekta_numer IS NOT NULL"),
      wKoszyku: licz(database, `NOT (${BEZ_KOSZYKA})`),
    },
  };
}

/**
 * Kasuje zwroty rozliczone poza aplikacją. Oddaje to, co skasował.
 *
 * KURSOR ZOSTAJE NIETKNIĘTY — inaczej najbliższy takt przywróciłby je
 * z Allegro i całe kasowanie nie znaczyłoby nic. Pojedynczy zwrot da się
 * mimo to ściągnąć z powrotem drogą „Poszukaj w Allegro", gdy okaże się
 * potrzebny do rozmowy z klientem.
 */
export function skasujRozliczonePozaAplikacja(
  database: Db, kto: { id: number | null; name: string },
): PodsumowanieSprzatania {
  const przed = policzRozliczonePozaAplikacja(database);
  if (przed.doSkasowania === 0) return przed;

  return transaction(database, () => {
    /* Pozycje i zdarzenia schodzą KASKADĄ (`ON DELETE CASCADE` przy
       `zwrot_id`). Wypisywanie ich tutaj drugi raz dałoby drugie miejsce,
       w którym trzeba pamiętać o nowej tabeli. */
    database.prepare(
      `DELETE FROM zwrot_klienta WHERE id IN (
         SELECT z.id FROM zwrot_klienta z
          WHERE z.status_allegro IN (${PYTAJNIKI}) AND ${BEZ_SLADU})`)
      .run(...(STATUSY as []));
    logEvent("zwroty_rozliczone_skasowane", kto.name, null, {
      zwrotow: przed.doSkasowania, pozycji: przed.pozycji,
      numery: przed.numery, zostaja: przed.zostaja,
    }, kto.id ?? undefined, database);
    return przed;
  })();
}
