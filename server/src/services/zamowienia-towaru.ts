import { subiekt } from "../context.js";
import { zrealWiarygodne } from "../adapters/subiekt.mssql.js";

/* ── „Nie ma go, ale jest zamówiony" ─────────────────────────────────────────
   Druga połowa pytania, którego pierwszą połowę zamknął `dostawy-towaru.ts`.
   Tamta sekcja mówi „towar przyjechał i stoi na palecie"; ta mówi „towar
   jeszcze nie przyjechał, ale ktoś go zamówił u dostawcy".

   Karta udawała, że to potrafi: kafel MGP miał podpis „zam. u dostawcy: N",
   tyle że importer produkcyjny wpisywał tam zero NA SZTYWNO, bo „zamówione" nie
   ma w Subiekcie prostej kolumny — pochodzi z dokumentów ZD. Napis nie pokazał
   się ani razu na prawdziwych danych. Widać go było wyłącznie w trybie demo,
   gdzie seed czytał tę liczbę z arkusza — czyli funkcja działała dokładnie tam,
   gdzie nikt jej nie potrzebował.

   ZK (zamówienie OD KLIENTA) celowo tu nie wchodzi. To ruch w drugą stronę
   i pokrywa go rezerwacja na kaflu MAG; wciągnięcie go do sekcji o nazwie
   „zamówione u dostawcy" pomyliłoby dwa przeciwne kierunki. */

export interface ZamowioneUDostawcy {
  dokId: number;
  nrPelny: string;
  dataWyst: string;
  /** Termin realizacji; `null` gdy baza go nie udostępnia. */
  termin: string | null;
  dostawca: string;
  /** Zamówione minus zrealizowane. Zawsze > 0. */
  ilosc: number;
  /**
   * `true`, gdy ilości nie dało się pomniejszyć o już odebraną część (brak
   * kolumny w `dok_Pozycja`). Liczba jest wtedy GÓRNYM oszacowaniem i karta
   * musi to powiedzieć — cicha nieprawda kazałaby magazynierowi liczyć na
   * towar, którego nikt już nie wyśle.
   */
  szacunek: boolean;
}

/** Zamówienie bez terminu ląduje na końcu, nie na początku. */
const KONIEC_LISTY = "9999-12-31";

/**
 * Otwarte zamówienia do dostawcy, na których stoi ten towar i które NIE zostały
 * jeszcze w całości zrealizowane.
 *
 * `zostało = zamówione − zrealizowane`. Pozycje wyzerowane znikają, bo pytanie
 * brzmi „czego jeszcze nie ma", a nie „co zamówiono" — ta sama reguła, co
 * w `nierozlozoneZDostaw`.
 *
 * Sortowanie idzie po TERMINIE, nie po dacie wystawienia: magazyniera
 * interesuje „kiedy będzie", a nie „kiedy zamówiono".
 */
export function zamowioneUDostawcy(twId: number): ZamowioneUDostawcy[] {
  const szacunek = !zrealWiarygodne();

  return subiekt
    .getOrdersForProduct(twId)
    .flatMap((z) => {
      // ujemne wychodzi przy dostawie większej niż zamówienie — to nie jest
      // „minus w drodze", tylko zero do czekania
      const zostalo = z.ilosc - z.zreal;
      if (zostalo <= 0) return [];
      return [
        {
          dokId: z.dok_id,
          nrPelny: z.nr_pelny,
          dataWyst: z.data_wyst,
          termin: z.termin || null,
          dostawca: z.dostawca ?? "",
          ilosc: zostalo,
          szacunek,
        },
      ];
    })
    .sort(
      (a, b) =>
        (a.termin ?? KONIEC_LISTY).localeCompare(b.termin ?? KONIEC_LISTY) ||
        a.dataWyst.localeCompare(b.dataWyst) ||
        a.dokId - b.dokId
    );
}
