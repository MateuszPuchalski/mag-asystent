import { db } from "../db/db.js";
import { config } from "../config.js";
import { subiekt } from "../context.js";

/* ── „Przyjechało, ale jeszcze nie na półce" ─────────────────────────────────
   Magazynier nie zastaje towaru w regale i nie ma jak sprawdzić, czy to dlatego,
   że dopiero przyszedł i leży nierozłożony.

   Karta odpowiadała na to POZORNIE, i to jest gorsze od milczenia. Przy dostawie
   krajowej skutek magazynowy niesie sam dokument w Subiekcie — księgowany wprost
   na MAG — więc kafel „MAG · DOSTĘPNE" pokazuje 12 szt, kiedy sześć z nich stoi
   na palecie w strefie przyjęć. Liczby nie da się pogodzić z tym, co magazynier
   ma przed oczami, a karta nie mówi dlaczego.

   Kontenera na MGP tu NIE MA i to jest decyzja: idzie osobnym torem (`putaway_*`,
   nie `delivery_*`), a jego towar widać na kaflu MGP z podpisem „do zasilenia
   MAG". Dołożenie go tutaj dublowałoby tę samą liczbę w dwóch miejscach ekranu. */

/** Ile dni wstecz szukamy dostaw — tyle samo, co lista w zakładce rozkładania. */
const OKNO_DNI = 14;

export interface WDostawie {
  dokId: number;
  typ: string;
  nrPelny: string;
  dataWyst: string;
  /** Ile z tego dokumentu jeszcze NIE odłożono. Zawsze > 0. */
  ilosc: number;
  /** Zbiorczy dokument zwrotów — leży na magazynie Zwroty, nie na MAG. */
  zwrot: boolean;
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
  const pozycje = subiekt.getDeliveryPositionsForProduct(twId, OKNO_DNI);
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
        zwrot: p.mag_id !== config.magId.MAG,
        wBuforze: !!p.w_buforze,
        status: l?.status ?? null,
      },
    ];
  });
}
