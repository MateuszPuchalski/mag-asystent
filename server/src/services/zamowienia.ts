import { db as defaultDb, type Db } from "../db/db.js";
import { linkZamowienia } from "./allegro-linki.js";

/* ── Zamówienie klienta jako DTO (0.166.0) ──────────────────────────────────
   Do 0.165.0 mapowanie wiersza `zamowienie_klienta` na kształt dla panelu
   stało inline w `zwroty.ts`. Rozmowa od 0.166.0 pokazuje to samo zamówienie
   (z `message.related_order_id`), a dwa mapowania jednego wiersza
   rozjechałyby się przy pierwszym nowym polu — dlatego jedno, tutaj.        */

/** Pozycja zamówienia; `zwracana` mówi, które z nich wracają do nas. */
export interface PozycjaZamowienia {
  offerId: string | null;
  nazwa: string;
  sku: string | null;
  ilosc: number;
  cenaGrosze: number;
  waluta: string;
  zwracana: boolean;
}

export interface Zamowienie {
  externalId: string;
  status: string | null;
  kupujacyLogin: string | null;
  dostawaGrosze: number | null;
  dostawaMetoda: string | null;
  sumaGrosze: number | null;
  waluta: string;
  kupionoAt: string | null;
  link: string | null;
  pozycje: PozycjaZamowienia[];
}

type Wiersz = Record<string, unknown>;

/**
 * Wiersz `zamowienie_klienta` + jego pozycje → `Zamowienie`.
 *
 * `zwracana` liczy WOŁAJĄCY: tylko zwrot wie, które pozycje wracają, a rozmowa
 * nie wie tego wcale i zostaje przy domyślnym „żadna".
 */
export function naZamowienie(
  zam: Wiersz, pozycje: Wiersz[], zwracana: (p: Wiersz) => boolean = () => false,
): Zamowienie {
  return {
    externalId: String(zam.external_id),
    status: (zam.status as string) ?? null,
    kupujacyLogin: (zam.kupujacy_login as string) ?? null,
    dostawaGrosze: zam.dostawa_grosze == null ? null : Number(zam.dostawa_grosze),
    dostawaMetoda: (zam.dostawa_metoda as string) ?? null,
    sumaGrosze: zam.suma_grosze == null ? null : Number(zam.suma_grosze),
    waluta: String(zam.waluta ?? "PLN"),
    kupionoAt: (zam.kupiono_at as string) ?? null,
    link: linkZamowienia(String(zam.external_id)),
    pozycje: pozycje.map((p) => ({
      offerId: (p.offer_id as string) ?? null,
      nazwa: String(p.nazwa),
      sku: (p.sku as string) ?? null,
      ilosc: Number(p.ilosc),
      cenaGrosze: Number(p.cena_grosze),
      waluta: String(p.waluta),
      zwracana: zwracana(p),
    })),
  };
}

/**
 * Jedno zamówienie po numerze z Allegro, gdy ticker już je dociągnął.
 *
 * `null` znaczy „jeszcze niepobrane", nie „nie istnieje" — rozróżnienie
 * robi wołający, bo on wie, skąd ma numer. Odczyt niczego nie zapisuje:
 * dociąganie należy do `uzupelnijZamowienia`, nie do otwarcia ekranu.
 */
export function zamowienieRozmowy(
  konto: number, externalId: string, database: Db = defaultDb(),
): Zamowienie | null {
  const zam = database.prepare(
    "SELECT * FROM zamowienie_klienta WHERE channel_account_id=? AND external_id=?",
  ).get(konto, externalId) as Wiersz | undefined;
  if (!zam) return null;
  const pozycje = database.prepare(
    "SELECT * FROM zamowienie_klienta_pozycja WHERE zamowienie_id=? ORDER BY id",
  ).all(Number(zam.id)) as Wiersz[];
  return naZamowienie(zam, pozycje);
}
