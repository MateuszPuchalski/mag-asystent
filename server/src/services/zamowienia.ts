import { db as defaultDb, type Db } from "../db/db.js";
import { linkZamowienia } from "./allegro-linki.js";
import { kartotekaOferty } from "./dopasowanie-sku.js";

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
  /** Ile sztuk KUPIONO. Nie mylić z `wracaIlosc` — to była cała pomyłka niżej. */
  ilosc: number;
  cenaGrosze: number;
  waluta: string;
  zwracana: boolean;
  /**
   * Kartoteka Subiekta za pozycją (0.214.0): pamięć wskazań tej oferty, a bez
   * niej SKU sprzedawcy z pozycji. `null` = nie ma czego pokazać. Zdanie
   * `twZrodlo` pisze `dopasowanie-sku.ts`, panel go nie układa (§4.3).
   *
   * Zdjęcie oferty NIE ma tu flagi, inaczej niż `OfertaRozmowy.maZdjecie`:
   * pozycja niesie `offerId`, a hak obrazów w panelu pamięta negatyw — jedno
   * 404 na ofertę i sesję, tak samo jak przy pozycji zwrotu.
   */
  twId: number | null;
  twSymbol: string | null;
  twZrodlo: string | null;
  /**
   * Ile sztuk WRACA (0.176.0). Plakietka „wraca" stała dotąd obok liczby
   * kupionych sztuk i czytało się to jako „wracają dwie" przy zwrocie jednej.
   * Zgłosił to właściciel: „w tym zamówieniu wracała jedna sztuka".
   */
  wracaIlosc: number;
}

export interface Zamowienie {
  externalId: string;
  status: string | null;
  kupujacyLogin: string | null;
  dostawaGrosze: number | null;
  dostawaMetoda: string | null;
  /** `ONLINE`, `CASH_ON_DELIVERY`, … — surowo, bo Allegro nie zamyka listy. */
  platnoscTyp: string | null;
  platnoscAt: string | null;
  /** `null` znaczy „nie wiadomo", nie „paragon". */
  fakturaZadana: boolean | null;
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
 * ILE WRACA liczy WOŁAJĄCY: tylko zwrot zna sztuki, a rozmowa nie wie tego
 * wcale i zostaje przy domyślnym zerze. Funkcja oddaje LICZBĘ, nie „tak/nie" —
 * `zwracana` da się z liczby wyprowadzić, odwrotnie nie.
 */
export type KartotekaPozycji = Pick<PozycjaZamowienia, "twId" | "twSymbol" | "twZrodlo">;
const BEZ_KARTOTEKI: KartotekaPozycji = { twId: null, twSymbol: null, twZrodlo: null };

export function naZamowienie(
  zam: Wiersz, pozycje: Wiersz[], wraca: (p: Wiersz) => number = () => 0,
  /* Kartotekę dokłada WOŁAJĄCY, jak sztuki zwrotu: zwrot ma własne wiązanie
     pozycji z towarem (`zwroty.ts`), rozmowa bierze mostek po ofercie. */
  kartoteka: (p: Wiersz) => KartotekaPozycji = () => BEZ_KARTOTEKI,
): Zamowienie {
  return {
    externalId: String(zam.external_id),
    status: (zam.status as string) ?? null,
    kupujacyLogin: (zam.kupujacy_login as string) ?? null,
    dostawaGrosze: zam.dostawa_grosze == null ? null : Number(zam.dostawa_grosze),
    dostawaMetoda: (zam.dostawa_metoda as string) ?? null,
    platnoscTyp: (zam.platnosc_typ as string) ?? null,
    platnoscAt: (zam.platnosc_at as string) ?? null,
    fakturaZadana: zam.faktura_zadana == null ? null : Boolean(Number(zam.faktura_zadana)),
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
      zwracana: wraca(p) > 0,
      wracaIlosc: wraca(p),
      ...kartoteka(p),
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
  /* Ten sam mostek, co dla oferty rozmowy: pamięć wskazań bije SKU, a puste
     SKU to „bez kartoteki", nie „oferty nie pobrano" — pozycja zamówienia
     ZAWSZE ma już swoje SKU z formularza zakupu, więc nie ma na co czekać. */
  return naZamowienie(zam, pozycje, () => 0, (p) => {
    const k = kartotekaOferty(database, konto, (p.offer_id as string) ?? null, String(p.sku ?? ""));
    return k.twId === null ? BEZ_KARTOTEKI : { twId: k.twId, twSymbol: k.symbol, twZrodlo: k.zrodlo };
  });
}
