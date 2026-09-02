import type { Db } from "../db/db.js";

/* ── Mostek oferta → kartoteka (0.152.0, przebudowany w 0.154.0) ─────────────
   Bez tego mostka pozycja zwrotu nie ma zdjęcia: `zdjecie_cache`
   i `zdjecie_wlasne` są kluczowane po `tw_id`.

   Łańcuch ma pięć ogniw i do 0.153.1 KAŻDE zerwane wyglądało na ekranie tak
   samo — „Bez kartoteki". Operator nie miał jak odróżnić „sprzedawca nie
   wypełnił SKU" od „zamówienia jeszcze nie pobrano" od „kod ma błąd". Dlatego
   `Dopasowanie` niesie teraz POWÓD, a nie tylko wynik.

   DOPASOWANIE JEST PROPOZYCJĄ, NIE FAKTEM. Projekt panelu §4.3 żąda, żeby
   kartoteka wskazana przez agenta nie udawała faktu z Allegro; wybór automatu
   tym bardziej. §11.3 każe pokazywać źródło i poziom pewności. Ta funkcja
   niczego nie zapisuje — liczy się przy odczycie.

   PO NAZWIE NIE SZUKAMY W KARTOTECE NIGDY. `routes/products.ts` opisuje,
   dlaczego furtka na literówki nie może otwierać karty sama: przeszukuje
   trzy i pół tysiąca kartotek i prowadzi do CUDZEJ. Dopasowanie po nazwie
   W OBRĘBIE JEDNEGO ZNANEGO ZAMÓWIENIA to co innego — zbiór ma dwie do
   pięciu pozycji i wszystkie pochodzą z tej samej transakcji.             */

export type PewnoscDopasowania =
  | "brak"
  | "sku"
  | "pamiec"
  | "jedyna_pozycja"
  | "nazwa_w_zamowieniu"
  | "niejednoznaczne";

/** Które ogniwo pękło. Ekran zamienia to na zdanie, panel — na licznik. */
export type PowodBraku =
  | "brak_zamowienia_w_zwrocie"
  | "zamowienie_niepobrane"
  | "oferty_nie_ma_w_zamowieniu"
  | "oferta_bez_sku"
  | "sku_nie_trafia"
  | "symbol_zdublowany"
  /* Skrzynka (0.179.0): snapshotu oferty jeszcze nie ma, więc SKU nie ma
     skąd wziąć. To stan PRZEJŚCIOWY — takt `allegro-oferty` dociągnie go
     w kilka minut — i ekran ma powiedzieć to, zamiast milczeć jak przy
     ofercie bez SKU, która nie naprawi się sama. */
  | "oferta_niepobrana"
  | null;

export interface Dopasowanie {
  pewnosc: PewnoscDopasowania;
  twId: number | null;
  symbol: string | null;
  /** Zdanie dla ekranu — §11.3 żąda widocznego źródła, nie samej wartości. */
  zrodlo: string;
  powod: PowodBraku;
  /**
   * Po której kolumnie trafiło złączenie z pozycją zamówienia.
   *
   * To NIE jest ozdoba, tylko odpowiedź na pytanie, którego nie rozstrzyga
   * ani specyfikacja, ani sonda — patrz `dopasujPozycjeZamowienia`.
   */
  poKolumnie: "offer_id" | "external_id" | null;
}

const brak = (powod: PowodBraku, zrodlo: string): Dopasowanie =>
  ({ pewnosc: "brak", twId: null, symbol: null, zrodlo, powod, poKolumnie: null });

interface PozycjaZamowienia {
  id: number;
  offer_id: string | null;
  external_id: string | null;
  nazwa: string;
  sku: string | null;
}

/**
 * Pozycja zamówienia odpowiadająca pozycji zwrotu.
 *
 * ZŁĄCZENIE IDZIE PO OBU KOLUMNACH, i to jest świadome. Specyfikacja Allegro
 * nie rozstrzyga, czy `CustomerReturnItem.offerId` należy do tej samej
 * przestrzeni co `CheckoutFormLineItem.offer.id`:
 *
 *   - przykład `offerId` to UUID, a `offer.id` jest wszędzie numeryczny,
 *   - w tym samym schemacie `url` kończy się numerem oferty, więc gdyby
 *     `offerId` nim był, przykład URL-a kończyłby się na nim,
 *   - UUID-owy kształt pokrywa się z `lineItems[].id`, czyli z przestrzenią
 *     POZYCJI zamówienia.
 *
 * Ale to są PRZYKŁADY, a `docs/allegro/README.md` ostrzega, że bywają
 * niezgodne ze schematem — oba pola są `type: string` bez `format`. Sonda też
 * tego nie rozstrzygnie: `services/ksztalt.ts` pokazuje wartości wyłącznie
 * dla pól słownikowych.
 *
 * Zamiast zgadywać, pytamy o obie kolumny i zapisujemy, która trafiła.
 * Poprawne pod każdym odczytem, a przy okazji odpowiada na to pytanie danymi
 * z produkcji zamiast domysłem.
 */
export function dopasujPozycjeZamowienia(
  database: Db,
  channelAccountId: number,
  orderId: string | null,
  offerId: string | null,
  nazwa: string,
): { pozycja: PozycjaZamowienia | null; poKolumnie: Dopasowanie["poKolumnie"];
     pewnosc: PewnoscDopasowania; pusteZamowienie: boolean } {
  const pozycje = database.prepare(`SELECT p.id, p.offer_id, p.external_id, p.nazwa, p.sku
    FROM zamowienie_klienta k
    JOIN zamowienie_klienta_pozycja p ON p.zamowienie_id = k.id
    WHERE k.channel_account_id = ? AND k.external_id = ?`)
    .all(channelAccountId, orderId) as unknown as PozycjaZamowienia[];

  if (!pozycje.length) {
    return { pozycja: null, poKolumnie: null, pewnosc: "brak", pusteZamowienie: true };
  }
  if (offerId) {
    const poOfercie = pozycje.filter((p) => p.offer_id === offerId);
    if (poOfercie.length === 1) {
      return { pozycja: poOfercie[0], poKolumnie: "offer_id", pewnosc: "sku", pusteZamowienie: false };
    }
    const poPozycji = pozycje.filter((p) => p.external_id === offerId);
    if (poPozycji.length === 1) {
      return { pozycja: poPozycji[0], poKolumnie: "external_id", pewnosc: "sku", pusteZamowienie: false };
    }
  }
  /* Zapas pierwszy: zamówienie z JEDNĄ pozycją nie ma czego mylić. */
  if (pozycje.length === 1) {
    return { pozycja: pozycje[0], poKolumnie: null, pewnosc: "jedyna_pozycja", pusteZamowienie: false };
  }
  /* Zapas drugi: dokładnie jedna pozycja tego zamówienia o zgodnej nazwie. */
  const poNazwie = pozycje.filter(
    (p) => p.nazwa.trim().toLowerCase() === nazwa.trim().toLowerCase());
  if (poNazwie.length === 1) {
    return { pozycja: poNazwie[0], poKolumnie: null, pewnosc: "nazwa_w_zamowieniu", pusteZamowienie: false };
  }
  return { pozycja: null, poKolumnie: null, pewnosc: "brak", pusteZamowienie: false };
}

/**
 * Kartoteka wskazana przez SKU.
 *
 * Trim po OBU stronach porównania. Do 0.153.1 trimowaliśmy tylko SKU;
 * `subiekt.mssql.ts` nie trimuje `tw_Symbol` przy imporcie (`mag_Symbol` tuż
 * obok — trimuje), więc symbol z białym znakiem na końcu nie trafiał nigdy.
 *
 * Dwa trafienia to NIE powód do wybrania pierwszego. Symbol miał być
 * unikalny; skoro nie jest, rozstrzyga człowiek.
 */
export function kartotekaPoSku(database: Db, sku: string | null | undefined) {
  const szukane = (sku ?? "").trim();
  if (!szukane) return { stan: "puste" as const, twId: null, symbol: null };
  const trafienia = database.prepare(
    "SELECT tw_id, symbol FROM sgt_towar WHERE TRIM(symbol) = ? COLLATE NOCASE LIMIT 2"
  ).all(szukane) as Array<{ tw_id: number; symbol: string }>;
  if (trafienia.length === 0) return { stan: "brak" as const, twId: null, symbol: null };
  if (trafienia.length > 1) return { stan: "wiele" as const, twId: null, symbol: null };
  return { stan: "jedno" as const, twId: Number(trafienia[0].tw_id), symbol: trafienia[0].symbol };
}

/** Wcześniejsze wskazanie tej samej oferty — pamięć wzorowana na `ean_alias`. */
export function zPamieci(database: Db, channelAccountId: number, offerId: string | null) {
  if (!offerId) return null;
  return (database.prepare(
    `SELECT tw_id, tw_symbol, wskazano_przez FROM oferta_kartoteka
     WHERE channel_account_id=? AND offer_id=?`
  ).get(channelAccountId, offerId) as
    { tw_id: number; tw_symbol: string; wskazano_przez: string } | undefined) ?? null;
}

/**
 * Propozycja kartoteki dla pozycji zwrotu — z powodem, gdy jej nie ma.
 *
 * Kolejność jest kolejnością pewności: pamięć wcześniejszego wskazania bije
 * automat, bo za nią stoi decyzja człowieka.
 */
export function zaproponujKartoteke(
  database: Db,
  { channelAccountId, orderId, offerId, nazwa }: {
    channelAccountId: number; orderId: string | null;
    offerId: string | null; nazwa: string;
  },
): Dopasowanie {
  const pamiec = zPamieci(database, channelAccountId, offerId);
  if (pamiec) {
    return {
      pewnosc: "pamiec", twId: pamiec.tw_id, symbol: pamiec.tw_symbol,
      zrodlo: `Wskazane wcześniej przez: ${pamiec.wskazano_przez}`,
      powod: null, poKolumnie: null,
    };
  }

  if (!orderId) return brak("brak_zamowienia_w_zwrocie", "Zwrot bez numeru zamówienia");

  const t = dopasujPozycjeZamowienia(database, channelAccountId, orderId, offerId, nazwa);
  if (t.pusteZamowienie) {
    return brak("zamowienie_niepobrane", "Zamówienia jeszcze nie pobrano");
  }
  if (!t.pozycja) {
    return brak("oferty_nie_ma_w_zamowieniu", "Tej oferty nie ma w pobranym zamówieniu");
  }

  const sku = (t.pozycja.sku ?? "").trim();
  if (!sku) return brak("oferta_bez_sku", "Oferta bez SKU w Allegro (pole „sygnatura”)");

  const k = kartotekaPoSku(database, sku);
  if (k.stan === "brak") {
    return brak("sku_nie_trafia", `Kartoteki o symbolu „${sku}" nie ma`);
  }
  if (k.stan === "wiele") {
    return {
      pewnosc: "niejednoznaczne", twId: null, symbol: null,
      zrodlo: `Symbol „${sku}" ma więcej niż jedną kartotekę — wskaż ją`,
      powod: "symbol_zdublowany", poKolumnie: t.poKolumnie,
    };
  }

  const jak = t.pewnosc === "sku"
    ? `SKU oferty „${sku}"`
    : t.pewnosc === "jedyna_pozycja"
      ? `SKU „${sku}" z jedynej pozycji zamówienia`
      : `SKU „${sku}" z pozycji zamówienia o tej samej nazwie`;
  return {
    pewnosc: t.pewnosc, twId: k.twId, symbol: k.symbol,
    zrodlo: jak, powod: null, poKolumnie: t.poKolumnie,
  };
}

/**
 * Kartoteka dla oferty ze SKRZYNKI — bez zamówienia.
 *
 * `zaproponujKartoteke` obok wymaga numeru zamówienia i przy jego braku mówi
 * „Zwrot bez numeru zamówienia". W skrzynce to zdanie byłoby nieprawdziwe
 * dwa razy: nie ma tam zwrotu, a pytanie pada zwykle PRZED zakupem, więc
 * zamówienia nie ma i mieć nie będzie. Zostają dwa ogniwa łańcucha, które
 * pytania sprzed zakupu dotyczą: pamięć wskazań i SKU ze snapshotu oferty.
 *
 * Kolejność jest ta sama i z tego samego powodu: za pamięcią stoi decyzja
 * człowieka, więc bije automat.
 */
export function kartotekaOferty(
  database: Db,
  channelAccountId: number,
  offerId: string | null,
  sku: string | null | undefined,
): Dopasowanie {
  const pamiec = zPamieci(database, channelAccountId, offerId);
  if (pamiec) {
    return {
      pewnosc: "pamiec", twId: pamiec.tw_id, symbol: pamiec.tw_symbol,
      zrodlo: `Wskazane wcześniej przez: ${pamiec.wskazano_przez}`,
      powod: null, poKolumnie: null,
    };
  }

  /* `undefined` znaczy „nie mamy snapshotu", a `""` — „mamy snapshot, ale
     sprzedawca nie wypełnił sygnatury". Pierwsze naprawi się samo, drugie
     wymaga człowieka, więc ekran nie ma prawa pokazać tego samego zdania. */
  if (sku === undefined || sku === null) {
    return brak("oferta_niepobrana", "Oferty jeszcze nie pobrano z Allegro");
  }

  const szukane = sku.trim();
  if (!szukane) return brak("oferta_bez_sku", "Oferta bez SKU w Allegro (pole „sygnatura”)");

  const k = kartotekaPoSku(database, szukane);
  if (k.stan === "brak") return brak("sku_nie_trafia", `Kartoteki o symbolu „${szukane}" nie ma`);
  if (k.stan === "wiele") {
    return {
      pewnosc: "niejednoznaczne", twId: null, symbol: null,
      zrodlo: `Symbol „${szukane}" ma więcej niż jedną kartotekę — wskaż ją`,
      powod: "symbol_zdublowany", poKolumnie: null,
    };
  }
  return {
    pewnosc: "sku", twId: k.twId, symbol: k.symbol,
    zrodlo: `SKU oferty „${szukane}"`, powod: null, poKolumnie: null,
  };
}
