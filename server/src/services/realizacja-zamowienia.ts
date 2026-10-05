import { db as defaultDb, type Db } from "../db/db.js";
import type { SubiektAdapter } from "../adapters/subiekt.js";
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

  /* Powód odmowy idzie do zdania, bo bez niego model dopisze własny. */
  const powod = s.status === "CANCELLED" || (s.realizacja !== null && BEZ_WYSYLKI.has(s.realizacja))
    ? "zamówienie nie czeka na wysyłkę"
    : s.realizacja === WYSLANE
      ? "sprzedawca oznaczył paczkę jako wysłaną, a numeru przesyłki jeszcze nie widać; napisz, że paczka wyszła"
    : !oplacone ? "płatność niezakończona"
      : termin === null ? "brak terminu nadania"
        : termin < dzis ? "termin nadania minął, napisz, że sprawdzamy w magazynie, bez daty"
          : s.braki?.length ? "brakuje towaru na stanie, terminu nie podawaj"
            : null;
  const wyslemyDzis = powod === null && termin === dzis;
  const werdykt = wyslemyDzis
    ? "WERDYKT: paczka wychodzi dziś; gdy klient pyta o wysyłkę, napisz, że wyślemy ją dziś"
    : powod === null
      ? `WERDYKT: podaj termin nadania; wyślemy najpóźniej ${termin}`
      : `WERDYKT: nie obiecuj wysyłki dziś (${powod})`;

  return { zdanie: `Realizacja zamówienia: ${czesci.join("; ")}. ${werdykt}`, wyslemyDzis };
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
