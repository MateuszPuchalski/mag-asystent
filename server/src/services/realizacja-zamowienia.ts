import { db as defaultDb, type Db } from "../db/db.js";
import type { SubiektAdapter } from "../adapters/subiekt.js";
import { config } from "../config.js";
import { dataLokalna } from "../czas.js";
import { dokumentySprzedazyZamowienia, type DokumentZamowienia } from "./faktury.js";
import { kartotekaOferty } from "./dopasowanie-sku.js";
import { buildProductCard } from "./stock.js";

/* ── Realizacja zamówienia: czy paczka wyjdzie dziś ──────────────────────────
   Klient pyta „czy paczka wyjdzie dziś?". Zanim paczka ma numer, szkic znał
   wyłącznie zdanie „Allegro nie ma numeru przesyłki", więc odpowiadał
   „sprawdzamy". Właściciel: gdy wysyłka przypada tego samego dnia, szkic ma
   napisać, że wyślemy dziś.

   ŹRÓDŁA, każde z innej strony zamówienia:
   - `status` formularza — oś PŁATNOŚCI. `FILLED_IN` znaczy, że dane mogą się
     jeszcze zmienić, więc wysyłki nie obiecujemy.
   - `delivery.time.dispatch.to` — najpóźniejsze nadanie z formularza
     zamówienia; schemat mówi tylko, że te daty idą do przewoźnika. To jedyne
     pole zamówienia o terminie NADANIA.
   - `fulfillment.status` — status ustawiany przez SPRZEDAWCĘ (u nas
     Sellasist). Opisuje, nie rozstrzyga: jego automat bywa wyłączony.
   - dokument sprzedaży z Subiekta z numerem zamówienia — magazyn je obsłużył.
   - stan pozycji w kartotece — tylko bez dokumentu, bo po wydaniu towar już
     zszedł ze stanu i zero na półce niczego wtedy nie znaczy.
   - lustro Sellasist (`sellasist-sync.ts`) — status realizacji nadany przez
     firmę, braki do skompletowania i ETYKIETA PRZEWOŹNIKA. Etykieta to
     paczka spakowana: wydrukowana dziś znaczy, że wychodzi dziś, zanim
     numer dojdzie do Allegro. Brak Sellasist niczego nie zmienia w regułach.

   „DZIŚ" TO TERMIN NADANIA PRZYPADAJĄCY DZIŚ na zegarze magazynu. Godziny
   odjazdu kuriera nie znamy, a właściciel jej nie podał. Termin, który minął,
   nie dostaje obietnicy: paczka powinna już wyjść, więc to sprawa dla
   człowieka, nie dla zdania „wyślemy dziś".

   CZYSTY ODCZYT. Odświeżenie zamówienia z Allegro robi `ulozSzkic`, nie ten
   plik — ta sama zasada co przy przesyłce.                                  */

/** Status sprzedawcy słowami. Wartości spoza listy idą surowo, nie zgadujemy. */
const REALIZACJA_SLOWAMI: Record<string, string> = {
  NEW: "nowe",
  PROCESSING: "w realizacji",
  READY_FOR_SHIPMENT: "gotowe do wysyłki",
  READY_FOR_PICKUP: "gotowe do odbioru osobistego",
  SENT: "wysłane",
  PICKED_UP: "odebrane",
  CANCELLED: "anulowane",
  SUSPENDED: "wstrzymane",
  RETURNED: "zwrócone",
};

/** Statusy sprzedawcy, przy których „wyślemy dziś" byłoby nieprawdą. */
const BEZ_WYSYLKI = new Set(["CANCELLED", "SUSPENDED", "RETURNED", "READY_FOR_PICKUP", "PICKED_UP"]);

/* `SENT` bez numeru przesyłki to paczka, która już wyszła, a numer jeszcze
   nie doszedł z Allegro. Obietnica „wyślemy dziś" byłaby wtedy nieprawdą
   w drugą stronę, więc ma własny powód, nie wspólny z anulowaniem. */
const WYSLANE = "SENT";

export interface BrakPozycji { nazwa: string; potrzeba: number; jest: number }

/** Co wie Sellasist o tym zamówieniu; `null`, gdy integracji nie ma albo lustro go nie zna. */
export interface RealizacjaSellasist {
  status: string | null;
  /** Pierwsza etykieta przewoźnika, ISO UTC — paczka spakowana. */
  etykietaAt: string | null;
  /** Pozycje z `quantityMissing` > 0: tego magazyn nie ma czym skompletować. */
  braki: BrakPozycji[];
}

export interface StanRealizacji {
  /** `CheckoutFormStatus`: `BOUGHT`, `FILLED_IN`, `READY_FOR_PROCESSING`, `CANCELLED`. */
  status: string | null;
  /** `CheckoutFormFulfillmentStatus`, ustawiany przez sprzedawcę. */
  realizacja: string | null;
  platnoscTyp: string | null;
  platnoscAt: string | null;
  nadanieDo: string | null;
  /** Paczka ma numer albo doręczenie — wtedy mówi fakt o przesyłce, nie ten. */
  nadana: boolean;
  dokumenty: DokumentZamowienia[];
  /** `null`: nie sprawdzaliśmy, bo dokument już jest albo pozycji brak w kartotece. */
  braki: BrakPozycji[] | null;
  /** Bez integracji pole jest puste, a reguły werdyktu się nie zmieniają. */
  sellasist?: RealizacjaSellasist | null;
}

export interface OcenaRealizacji {
  zdanie: string;
  wyslemyDzis: boolean;
}

/**
 * Zdanie o realizacji dla szkicu i werdykt „wyślemy dziś". `null`, gdy paczka
 * już ma numer: wtedy odpowiada fakt o przesyłce, a drugi fakt o tym samym
 * mógłby mu przeczyć.
 */
export function ocenRealizacji(s: StanRealizacji, teraz: Date): OcenaRealizacji | null {
  if (s.nadana) return null;
  const dzis = dataLokalna(teraz.toISOString());
  const czesci: string[] = [];

  const oplacone = s.status === "READY_FOR_PROCESSING";
  if (s.status === "CANCELLED") czesci.push("zakup anulowany");
  else if (!oplacone) czesci.push("płatność niezakończona, dane zamówienia mogą się jeszcze zmienić");
  else if (s.platnoscTyp === "CASH_ON_DELIVERY") czesci.push("płatność przy odbiorze");
  else if (s.platnoscAt) czesci.push(`opłacone ${dataLokalna(s.platnoscAt)}`);
  else czesci.push("opłacone");

  if (s.realizacja) {
    czesci.push(`status u sprzedawcy: ${REALIZACJA_SLOWAMI[s.realizacja] ?? s.realizacja}`);
  }

  const termin = s.nadanieDo ? dataLokalna(s.nadanieDo) : null;
  if (termin === null) czesci.push("Allegro nie podało terminu nadania");
  else if (termin === dzis) czesci.push(`termin nadania według Allegro: dziś (${termin})`);
  else if (termin < dzis) czesci.push(`termin nadania według Allegro minął ${termin}`);
  else czesci.push(`termin nadania według Allegro: najpóźniej ${termin}`);

  if (s.dokumenty.length) {
    const d = s.dokumenty[s.dokumenty.length - 1];
    czesci.push(`dokument sprzedaży w Subiekcie wystawiony ${d.data}, magazyn obsłużył zamówienie`);
  }
  if (s.braki?.length) {
    czesci.push(`brak na stanie: ${s.braki.map((b) => `${b.nazwa} (potrzeba ${b.potrzeba}, jest ${b.jest})`).join(", ")}`);
  }
  const sa = s.sellasist ?? null;
  const etykieta = sa?.etykietaAt ? dataLokalna(sa.etykietaAt) : null;
  if (sa?.status) czesci.push(`status w Sellasist: ${sa.status}`);
  if (etykieta) czesci.push(`etykieta przewoźnika wydrukowana w Sellasist ${etykieta === dzis ? "dziś" : etykieta}`);
  if (sa?.braki.length) {
    czesci.push(`brak do skompletowania według Sellasist: ${sa.braki.map((b) => `${b.nazwa} (potrzeba ${b.potrzeba}, `
      + `jest ${b.jest})`).join(", ")}`);
  }
  const braki = Boolean(s.braki?.length || sa?.braki.length);

  /* Powód odmowy idzie do zdania, bo bez niego model dopisze własny.
     ETYKIETA Z WCZORAJ to paczka spakowana, która czeka na kuriera albo już
     pojechała, a numer nie doszedł do Allegro. „Wyślemy dziś" byłoby wtedy
     nieprawdą w drugą stronę, jak przy `SENT`. */
  const powod = s.status === "CANCELLED" || (s.realizacja !== null && BEZ_WYSYLKI.has(s.realizacja))
    ? "zamówienie nie czeka na wysyłkę"
    : etykieta !== null && etykieta < dzis
      ? `paczka spakowana ${etykieta}; napisz, że paczka wyszła albo czeka na kuriera, a numer przesyłki pojawi się `
        + "w Allegro"
    /* Etykieta z dziś obiecuje wysyłkę tylko przy komplecie i opłaceniu:
       etykietę drukuje się też przed zbieraniem, więc brak towaru przy niej
       znaczy paczkę, która dziś nie wyjdzie. */
    : etykieta === dzis
      ? (braki ? "brakuje towaru na stanie, terminu nie podawaj" : !oplacone ? "płatność niezakończona" : null)
    : s.realizacja === WYSLANE
      ? "sprzedawca oznaczył paczkę jako wysłaną, a numeru przesyłki jeszcze nie widać; napisz, że paczka wyszła"
    : !oplacone ? "płatność niezakończona"
      : termin === null ? "brak terminu nadania"
        : termin < dzis ? "termin nadania minął, napisz, że sprawdzamy w magazynie, bez daty"
          : braki ? "brakuje towaru na stanie, terminu nie podawaj"
            : null;
  /* Etykieta wydrukowana dziś przesądza bez terminu z Allegro: paczka jest
     spakowana, a kurier odbiera ją tego samego dnia. */
  const wyslemyDzis = powod === null && (termin === dzis || etykieta === dzis);
  const werdykt = wyslemyDzis
    ? "WERDYKT: paczka wychodzi dziś; gdy klient pyta o wysyłkę, napisz, że wyślemy ją dziś"
    : powod === null
      ? `WERDYKT: podaj termin nadania; wyślemy najpóźniej ${termin}`
      : `WERDYKT: nie obiecuj wysyłki dziś (${powod})`;

  return { zdanie: `Realizacja zamówienia: ${czesci.join("; ")}. ${werdykt}`, wyslemyDzis };
}

/**
 * Oryginał zamówienia z lustra Sellasist. Kopia (dosyłka) odpada: pytanie
 * „czy wyjdzie dziś" dotyczy zamówienia klienta, a nie drugiej paczki.
 *
 * ŚWIEŻY STATUS POMYŁKI TO NIE BRAK DLA KLIENTA. Pakowanie złapało pomyłkę
 * zbierania i towar właśnie się donosi (fakt właściciela). Braki z tej
 * chwili zdjęłyby obietnicę paczce, która wyjdzie za kwadrans, a nazwa
 * statusu („Brak podczas pakowania") w szkicu brzmiałaby jak brak towaru.
 *
 * Tylko wejście z bieżącej doby magazynu. Właściciel mówi „zwykle”, nie
 * „zawsze”: zamówienie, które stoi w tym statusie od wczoraj, ma prawdziwy
 * brak, więc szkic znowu widzi status i braki.
 */
export function realizacjaSellasist(
  database: Db, externalId: string, statusyPomylka: readonly number[] = config.sellasist.statusyPomylka,
  teraz = new Date(),
): RealizacjaSellasist | null {
  const z = database.prepare(`SELECT id, status_id, status_nazwa, status_at, spakowano_at FROM sellasist_zamowienie
      WHERE external_id = ? AND skopiowane_z IS NULL ORDER BY id LIMIT 1`).get(externalId) as
    Record<string, unknown> | undefined;
  if (!z) return null;
  const etykietaAt = z.spakowano_at == null ? null : String(z.spakowano_at);
  const swiezy = z.status_at != null && dataLokalna(String(z.status_at)) === dataLokalna(teraz.toISOString());
  if (z.status_id != null && statusyPomylka.includes(Number(z.status_id)) && swiezy) {
    return { status: null, etykietaAt, braki: [] };
  }
  const braki = (database.prepare(`SELECT nazwa, symbol, ilosc, brakuje FROM sellasist_pozycja
      WHERE zamowienie_id = ? AND brakuje > 0 ORDER BY koszyk_id`).all(Number(z.id)) as Array<Record<string, unknown>>)
    .map((p) => ({ nazwa: String(p.nazwa ?? p.symbol ?? "pozycja"), potrzeba: Number(p.ilosc),
      jest: Math.max(0, Number(p.ilosc) - Number(p.brakuje)) }));
  return {
    status: z.status_nazwa == null ? null : String(z.status_nazwa),
    etykietaAt,
    braki,
  };
}

/**
 * Stan realizacji jednego zamówienia — CZYSTY ODCZYT z bazy i kartoteki.
 * `nadana` bierze wołający z faktu o przesyłce, żeby oba fakty stały na tym
 * samym odczycie.
 */
export function stanRealizacji(
  zamowienieId: number, nadana: boolean, subiekt: SubiektAdapter, database: Db = defaultDb(),
): StanRealizacji | null {
  const z = database.prepare(`SELECT channel_account_id, external_id, status, realizacja_status,
      platnosc_typ, platnosc_at, nadanie_do, kupiono_at FROM zamowienie_klienta WHERE id=?`)
    .get(zamowienieId) as Record<string, unknown> | undefined;
  if (!z) return null;
  const tekst = (v: unknown) => (v == null || String(v) === "" ? null : String(v));
  const dokumenty = dokumentySprzedazyZamowienia(String(z.external_id), tekst(z.kupiono_at), database);

  let braki: BrakPozycji[] | null = null;
  if (!nadana && dokumenty.length === 0) {
    const pozycje = database.prepare(`SELECT offer_id, sku, nazwa, ilosc FROM zamowienie_klienta_pozycja
        WHERE zamowienie_id=? ORDER BY id`).all(zamowienieId) as Array<Record<string, unknown>>;
    const konto = Number(z.channel_account_id);
    for (const p of pozycje) {
      const k = kartotekaOferty(database, konto, tekst(p.offer_id), String(p.sku ?? ""));
      if (k.twId === null) continue;
      const karta = buildProductCard(subiekt, k.twId);
      if (!karta) continue;
      braki ??= [];
      const potrzeba = Number(p.ilosc);
      if (karta.mag.avail < potrzeba) {
        braki.push({ nazwa: String(p.nazwa), potrzeba, jest: Math.max(0, karta.mag.avail) });
      }
    }
  }

  return {
    sellasist: realizacjaSellasist(database, String(z.external_id)),
    status: tekst(z.status),
    realizacja: tekst(z.realizacja_status),
    platnoscTyp: tekst(z.platnosc_typ),
    platnoscAt: tekst(z.platnosc_at),
    nadanieDo: tekst(z.nadanie_do),
    nadana,
    dokumenty,
    braki,
  };
}
