import { db as defaultDb, type Db } from "../db/db.js";
import { linkZamowienia } from "./allegro-linki.js";
import { kartotekaOferty } from "./dopasowanie-sku.js";
import { stanZdjeciaOferty, type StanZdjeciaOferty } from "./zdjecia-ofert.js";

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
   * Kartoteka Subiekta za pozycją (0.215.0): pamięć wskazań tej oferty, a bez
   * niej SKU sprzedawcy z pozycji. `null` = nie ma czego pokazać. Zdanie
   * `twZrodlo` pisze `dopasowanie-sku.ts`, panel go nie układa (§4.3).
   *
   */
  twId: number | null;
  twSymbol: string | null;
  twZrodlo: string | null;
  /**
   * Co wiadomo o zdjęciu OFERTY tej pozycji (0.217.0).
   *
   * Do 0.216.0 stan tu nie jechał — z uzasadnieniem, że pozycja niesie
   * `offerId`, a hak obrazów pamięta negatyw, więc to najwyżej jedno 404 na
   * ofertę i sesję. Rachunek się zgadzał, ale mierzył nie to co trzeba:
   * kosztem nie były żądania, tylko ZDANIE NA EKRANIE. Bez stanu kafel pisze
   * „bez zdjęcia" zarówno wtedy, gdy Allegro obrazu nie ma, jak i wtedy, gdy
   * po prostu jeszcze o niego nie pytaliśmy — a to jest dokładnie ta pomyłka,
   * którą 0.214.0 naprawiło przy pozycji zwrotu (blizna: właściciel przysłał
   * zrzut oferty, która na Allegro zdjęcie miała).
   *
   * Przy okazji znika też tamto 404, ale to skutek uboczny, nie powód.
   */
  ofertaZdjecie: StanZdjeciaOferty;
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
  /* Stan zdjęcia oferty tą samą drogą i z tego samego powodu: zwrot ma mapę
     snapshotów na całą kolejkę, rozmowa pyta o jedno zamówienie. Domyślne
     „nieznane" jest uczciwe — wołający, który nie sprawdził, nie ma prawa
     powiedzieć „Allegro nie ma obrazu". */
  zdjecie: (p: Wiersz) => StanZdjeciaOferty = () => "nieznane",
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
      ofertaZdjecie: zdjecie(p),
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
  /* Snapshoty pozycji JEDNYM zapytaniem, nie po jednym na wiersz: zamówienie
     ma dwie–pięć pozycji, ale zapytanie na pozycję to wzorzec, który przy
     kolejce zwrotów kosztowałby setki odczytów. */
  const obrazy = new Map<string, string | null>();
  for (const o of database.prepare(
    "SELECT external_id AS id, primary_image_url AS url FROM offer_snapshot WHERE channel_account_id=?",
  ).all(konto) as Array<{ id: string; url: string | null }>) {
    obrazy.set(o.id, o.url);
  }
  return naZamowienie(zam, pozycje, () => 0, (p) => {
    const k = kartotekaOferty(database, konto, (p.offer_id as string) ?? null, String(p.sku ?? ""));
    return k.twId === null ? BEZ_KARTOTEKI : { twId: k.twId, twSymbol: k.symbol, twZrodlo: k.zrodlo };
  }, (p) => {
    const oferta = (p.offer_id as string) ?? "";
    /* Bez numeru oferty nie ma o co pytać — i to NIE jest „brak zdjęcia". */
    return oferta === "" ? "nieznane" : stanZdjeciaOferty(obrazy.get(oferta));
  });
}

/* ── Paczki jednego klienta: co on w ogóle u nas kupił (0.365.0) ─────────────
   Zgłoszenie właściciela: „kupujący może mieć wiele paczek kupionych
   w historii sklepu, więc muszę mieć możliwość wybrania paczki".

   Rejestracja paczki nieodebranej pytała o numer zamówienia jak o rzecz
   OCZYWISTĄ — a przy nieodebranej to jedyna rzecz, której operator nie ma.
   Karton wraca bez zgłoszenia i bez kopii z Allegro; pod ręką jest naklejka
   i login z wiadomości. Numer zamówienia trzeba było więc wyklikać w panelu
   Allegro i przepisać ręcznie, do pola, które nic nie podpowiada.

   Ta funkcja odpowiada na pytanie zadawane w tamtym momencie: „co ten klient
   od nas dostał". Wynik jest LEKKI i świadomie inny niż `Zamowienie`: do
   wskazania paczki wystarczy data, kwota i zawartość w jednej linijce.
   Kartoteki, zdjęcia ofert i mostki po SKU są tam potrzebne przy wycenie,
   a nie przy pytaniu „to ta czy tamta".                                      */

export interface PaczkaKlienta {
  /** Numer zamówienia z Allegro — to on wchodzi do rejestracji. */
  orderId: string;
  kupionoAt: string | null;
  sumaGrosze: number | null;
  waluta: string;
  pozycji: number;
  /** Zawartość w jednej linijce: „Sekator ×1 · Wąż 20 m ×2". */
  zawartosc: string;
  /**
   * Zwrot dla tego zamówienia JUŻ ISTNIEJE.
   *
   * Nie blokuje wyboru i nie ma blokować: jedno zamówienie bywa dwiema
   * paczkami, a klient potrafi nie odebrać drugiej po zwrocie pierwszej.
   * Ale to jest ostrzeżenie, którego operator sam by nie miał — a bez niego
   * najłatwiejsza pomyłka przy tym ekranie to zarejestrowanie drugi raz
   * tego samego.
   */
  maZwrot: boolean;
}

/**
 * Zamówienia tego kupującego, od najnowszego. Pusta lista znaczy „nic nie wiem".
 *
 * PORÓWNANIE BEZ WIELKOŚCI LITER, bo login przyjeżdża przeklejony z wiadomości,
 * a Allegro pokazuje go raz tak, raz inaczej. Dopasowanie jest DOKŁADNE:
 * fragment loginu wskazywałby cudze zakupy, a to jest ekran, z którego wychodzi
 * się z czyimś numerem zamówienia w ręku.
 */
export function paczkiKlienta(
  konto: number, login: string, database: Db = defaultDb(), limit = 20,
): PaczkaKlienta[] {
  const szukany = (login ?? "").trim();
  if (!szukany) return [];

  const zamowienia = database.prepare(
    `SELECT id, external_id, kupiono_at, suma_grosze, waluta
       FROM zamowienie_klienta
      WHERE channel_account_id = ? AND lower(kupujacy_login) = lower(?)
      /* Najnowsze pierwsze, a bez daty na końcu: zamówienie bez daty zakupu
         jest niedokończonym zapisem synchronizacji, nie świeżym zakupem.
         Bez odwrotnych apostrofów w tym komentarzu — zamknęłyby szablon. */
      ORDER BY kupiono_at IS NULL, kupiono_at DESC, id DESC
      LIMIT ?`).all(konto, szukany, Math.max(1, limit)) as Array<{
    id: number; external_id: string; kupiono_at: string | null;
    suma_grosze: number | null; waluta: string;
  }>;
  if (!zamowienia.length) return [];

  const znaki = zamowienia.map(() => "?").join(",");
  /* Pozycje i zwroty JEDNYM zapytaniem każde — wzorzec z `listaZwrotow`.
     Zapytanie na zamówienie wygląda niewinnie przy jednym kliencie i psuje
     się dokładnie wtedy, gdy ktoś ma ich trzydzieści. */
  const pozycje = database.prepare(
    `SELECT zamowienie_id, nazwa, ilosc FROM zamowienie_klienta_pozycja
      WHERE zamowienie_id IN (${znaki}) ORDER BY id`)
    .all(...zamowienia.map((z) => z.id)) as Array<{
    zamowienie_id: number; nazwa: string; ilosc: number;
  }>;
  const wgZamowienia = new Map<number, Array<{ nazwa: string; ilosc: number }>>();
  for (const p of pozycje) {
    const lista = wgZamowienia.get(Number(p.zamowienie_id)) ?? [];
    lista.push({ nazwa: String(p.nazwa), ilosc: Number(p.ilosc) });
    wgZamowienia.set(Number(p.zamowienie_id), lista);
  }

  const zeZwrotem = new Set((database.prepare(
    `SELECT DISTINCT order_id FROM zwrot_klienta
      WHERE channel_account_id = ? AND order_id IN (${znaki})`)
    .all(konto, ...zamowienia.map((z) => z.external_id)) as Array<{ order_id: string }>)
    .map((z) => String(z.order_id)));

  return zamowienia.map((z) => {
    const poz = wgZamowienia.get(Number(z.id)) ?? [];
    return {
      orderId: String(z.external_id),
      kupionoAt: z.kupiono_at ?? null,
      sumaGrosze: z.suma_grosze == null ? null : Number(z.suma_grosze),
      waluta: String(z.waluta ?? "PLN"),
      pozycji: poz.length,
      /* Trzy pozycje i ogon liczbą: linijka ma się zmieścić w wierszu listy,
         a czwarta nazwa i tak niczego nie rozstrzyga przy wyborze paczki. */
      zawartosc: poz.slice(0, 3).map((p) => `${p.nazwa} ×${p.ilosc}`).join(" · ")
        + (poz.length > 3 ? ` · +${poz.length - 3}` : ""),
      maZwrot: zeZwrotem.has(String(z.external_id)),
    };
  });
}
