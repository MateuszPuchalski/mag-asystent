import { db } from "../db/db.js";
import { subiekt } from "../context.js";
import { config } from "../config.js";
import { dokumentyPozaWertis } from "./delivery.js";

/* ── „Przyjechało, ale jeszcze nie na półce" ─────────────────────────────────
   Magazynier nie zastaje towaru w regale i nie ma jak sprawdzić, czy to dlatego,
   że dopiero przyszedł i leży nierozłożony.

   Karta odpowiadała na to POZORNIE, i to jest gorsze od milczenia. Przy dostawie
   krajowej skutek magazynowy niesie sam dokument w Subiekcie — księgowany wprost
   na MAG — więc kafel „MAG · DOSTĘPNE" pokazuje 12 szt, kiedy sześć z nich stoi
   na palecie w strefie przyjęć. Liczby nie da się pogodzić z tym, co magazynier
   ma przed oczami, a karta nie mówi dlaczego.

   Kontener na MGP jest tu OD 0.22.0, odkąd rozkłada się tą samą ścieżką co
   dostawa krajowa. To nie dubluje kafla MGP: kafel mówi, ILE stoi w przyjęciach,
   a ten wiersz — NA KTÓRYM dokumencie i ile z tego nie ma jeszcze adresu. Druga
   liczba jest zarazem wejściem do pracy, pierwsza tylko stanem. */

/* Okno bierzemy Z KONFIGURACJI, a nie z własnej stałej. Wcześniej stało tu
   `14` z komentarzem „tyle samo, co lista w zakładce rozkładania" — czyli
   zgodności pilnowało zdanie, nie mechanizm. Zmiana `DOK_DNI_WSTECZ` na 30
   przestawiała listę dostaw, a ten wiersz zostawiała na czternastu dniach:
   karta mówiła wtedy „nic nie przyszło" o dokumencie, który wisiał obok
   w zakładce rozkładania. */

export interface WDostawie {
  dokId: number;
  typ: string;
  nrPelny: string;
  dataWyst: string;
  /** Ile z tego dokumentu jeszcze NIE odłożono. Zawsze > 0. */
  ilosc: number;
  /**
   * Symbol kontrahenta z dokumentu (`kh_Symbol`); `""` gdy dokument go nie ma.
   *
   * Ta sama wartość, którą niesie lista rozkładania — magazynier rozpoznaje
   * paletę w przyjęciach po dostawcy szybciej niż po numerze dokumentu, bo
   * dostawca stoi na opakowaniu, a numer FZ nie stoi nigdzie.
   */
  dostawca: string;
  /** Dokument w buforze SGT; rozkładanie i tak na niego nie czeka (D1). */
  wBuforze: boolean;
  /**
   * Status linii w module rozkładania: `null` gdy dokumentu jeszcze nikt nie
   * otwierał, inaczej `todo` / `partial` / `problem` / `skipped`.
   */
  status: string | null;
}

interface PostepLinii {
  ilosc_odlozona: number;
  status: string;
}

/**
 * Dostawy z ostatnich 14 dni, na których ten towar przyjechał i NIE został
 * jeszcze odłożony.
 *
 * `zostało = ilość z dokumentu − ilość odłożona`. Pozycje wyzerowane znikają,
 * bo pytanie brzmi „czego jeszcze nie ma na półce", a nie „co przyszło".
 *
 * Statusy `skipped` i `problem` ZOSTAJĄ na liście. Pominięta pozycja i pozycja
 * ze zgłoszonym wyjątkiem tak samo nie leżą w regale — a magazynier, który
 * właśnie jej szuka, ma prawo wiedzieć, że ktoś już się o nią potknął.
 */
export function nierozlozoneZDostaw(twId: number): WDostawie[] {
  const wszystkie = subiekt.getDeliveryPositionsForProduct(twId, config.mssql.dokDniWstecz);
  if (wszystkie.length === 0) return [];

  /* Dostawa rozłożona POZA WERTIS (stara aplikacja, ręczne odłożenie) wypada
     stąd tak samo, jak wypadła z listy rozkładania. Bez tego karta mówiłaby
     „w dostawie 6 szt" o towarze, który leży w regale — a postęp liczy się
     z `delivery_line`, więc taki dokument ma zawsze zero odłożone i NIGDY by
     się nie wyzerował. To jest dokładnie ta usterka, dla której powstał
     status `external`. */
  const poza = dokumentyPozaWertis();
  const pozycje = wszystkie.filter((p) => !poza.has(p.dok_id));
  if (pozycje.length === 0) return [];

  /* Postęp per dokument w JEDNYM zapytaniu, nie po jednym na dokument: karta
     odświeża się co 2 s z każdego otwartego ekranu. */
  const postep = new Map(
    (
      db()
        .prepare(
          `SELECT d.sgt_dok_id AS dokId, l.ilosc_odlozona, l.status
           FROM delivery d
           JOIN delivery_line l ON l.delivery_id = d.id
           WHERE l.tw_id = ?`
        )
        .all(twId) as unknown as Array<PostepLinii & { dokId: number }>
    ).map((r) => [r.dokId, r] as const)
  );

  return pozycje.flatMap((p) => {
    const l = postep.get(p.dok_id);
    const zostalo = p.ilosc - (l?.ilosc_odlozona ?? 0);
    // ujemne wychodzi przy odłożeniu większej ilości, niż stała na dokumencie
    // (INNA ILOŚĆ w górę) — to nie jest „minus na półce", tylko zero do zrobienia
    if (zostalo <= 0) return [];
    return [
      {
        dokId: p.dok_id,
        typ: p.typ,
        nrPelny: p.nr_pelny,
        dataWyst: p.data_wyst,
        ilosc: zostalo,
        dostawca: p.dostawca ?? "",
        wBuforze: !!p.w_buforze,
        status: l?.status ?? null,
      },
    ];
  });
}
