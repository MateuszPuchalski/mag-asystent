import { config, type Config } from "../config.js";
import { lokalnyNaUtc } from "../czas.js";
import { retryAfterMs } from "./allegro.js";
import { BladLimitu } from "./limit.js";

/* ── Sellasist — połączenie HTTP i mapowanie ─────────────────────────────────
   Sellasist to system, przez który przechodzą zamówienia firmy: etykiety,
   statusy realizacji, koszyki. Ten plik jest JEDYNYM miejscem, które z nim
   rozmawia. Serwisy dostają tu nasze typy, nigdy surowego JSON-a.

   KSZTAŁT Z PLIKU, NIE Z PAMIĘCI. Każde pole niżej stoi w schemacie
   `docs/sellasist/api.yaml` (wersja w `docs/sellasist/README.md`). To, co
   schemat zostawia otwarte (strefa dat, format `deadline`, który numer
   zamówienia niesie `external_id`), rozstrzyga `npm run sellasist:sonda`,
   a nie test z fixturą pisaną ręką.

   PRYWATNOŚĆ STOI W MAPOWANIU. Zamówienie Sellasist niesie adres z faktury,
   adres dostawy, e-mail, NIP i telefon. Mapowanie bierze z kupującego
   WYŁĄCZNIE login z serwisu, bo to klucz klienta (zasada w CLAUDE.md).
   Adresów nie czyta wcale, więc nie ma ich czym zapisać.

   Klucz idzie nagłówkiem `apiKey` (`securitySchemes` w specyfikacji). Nie
   trafia do żadnego komunikatu błędu ani logu. */

const TIMEOUT_MS = 15_000;

/** Integracja działa tylko z parą konto i klucz; połowę zatrzymuje `bledyKonfiguracji`. */
export function sellasistWlaczony(c: Config = config): boolean {
  return Boolean(c.sellasist.konto && c.sellasist.apiKey);
}

/** Adres API: `https://{konto}.sellasist.pl/api/v1` (`servers` w specyfikacji). */
export function apiUrlSellasist(c: Config = config): string {
  return (c.sellasist.apiUrl || `https://${c.sellasist.konto}.sellasist.pl/api/v1`).replace(/\/+$/, "");
}

/** Odmowa Sellasist z kodem HTTP. Zdanie jest STAŁE: treść odpowiedzi bywa czymkolwiek. */
export class BladSellasist extends Error {
  constructor(komunikat: string, public readonly kod: number | null) {
    super(komunikat);
  }
}

/** Sellasist prosi o przerwę (429, „Rate Limiter" w specyfikacji). */
export class BladLimituSellasist extends BladLimitu {}

export type ZapytanieSellasist = (sciezka: string, opcje?: { metoda?: "POST" | "PUT"; body?: unknown }) =>
  Promise<unknown | null>;

/**
 * Jedno wyjście do sieci. 404 oddaje `null`: przy odczycie „nie ma" jest
 * odpowiedzią, a zamówienie skasowane w Sellasist ma zniknąć z lustra.
 * Żądanie bez ciała nie deklaruje typu treści (reguła klienta HTTP).
 */
export const zapytajSellasist: ZapytanieSellasist = async (sciezka, opcje = {}) => {
  const url = `${apiUrlSellasist()}${sciezka}`;
  let odp: Response;
  try {
    odp = await fetch(url, {
      method: opcje.metoda ?? "GET",
      headers: {
        accept: "application/json",
        apiKey: config.sellasist.apiKey,
        ...(opcje.body === undefined ? {} : { "content-type": "application/json" }),
      },
      body: opcje.body === undefined ? undefined : JSON.stringify(opcje.body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    /* Bez `e.message`: błąd sieci niesie pełny adres, a w nim nazwę konta. */
    throw new BladSellasist("Brak połączenia z Sellasist — sprawdź internet na serwerze.", null);
  }
  if (odp.status === 404) return null;
  if (odp.status === 401 || odp.status === 403) {
    throw new BladSellasist(
      `Sellasist odrzucił klucz API (${odp.status}) — wygeneruj nowy w Sellasist ` +
        "(Integracje > Klucze API) i wpisz go do SELLASIST_API_KEY.", odp.status);
  }
  if (odp.status === 429) {
    const poIluMs = retryAfterMs(odp.headers.get("retry-after"), Date.now());
    throw new BladLimituSellasist(
      "Sellasist prosi o przerwę (429) — za dużo zapytań w krótkim czasie." +
        (poIluMs !== null ? ` Spróbuj za ${Math.ceil(poIluMs / 1000)} s.` : ""), poIluMs);
  }
  if (!odp.ok) throw new BladSellasist(`Sellasist odpowiedział błędem (${odp.status}).`, odp.status);
  const tekst = await odp.text();
  if (tekst.trim() === "") return null;
  try {
    return JSON.parse(tekst);
  } catch {
    throw new BladSellasist("Sellasist oddał odpowiedź, która nie jest JSON-em.", odp.status);
  }
};

/* ── Ścieżki ─────────────────────────────────────────────────────────────── */

const q = encodeURIComponent;

/** Najwięcej, ile lista oddaje naraz (`limit` przy `GET /orders`: „maksymalnie 100"). */
export const STRONA = 100;

/**
 * Dziennik zmian zamówień od chwili, rosnąco. To jedyna droga do zmian:
 * webhooków Sellasist nie ma, a `GET /orders` filtruje po dacie ZŁOŻENIA,
 * nie zmiany. Data idzie czasem konta, jak wszystkie daty Sellasist.
 */
export function sciezkaDziennika(odStempel: string, offset: number): string {
  return `/orders_logs?date_from=${q(odStempel)}&sort=asc&limit=${STRONA}&offset=${Math.max(0, Math.trunc(offset))}`;
}

export const sciezkaZamowienia = (id: number): string => `/orders/${Math.trunc(id)}`;

/** Zamówienia Sellasist po numerze ze źródła — dla Allegro to numer formularza zakupu. */
export const sciezkaZamowienPoNumerze = (externalId: string): string =>
  `/orders?external_id=${q(externalId)}&limit=${STRONA}`;

/**
 * Zamówienia kupującego złożone od chwili. `external_user` przyjmuje login
 * z serwisu (opis parametru). Kopię zamówienia dla dosyłki widać tylko tak:
 * filtra po `copied_order_id` lista nie ma.
 */
export const sciezkaZamowienKupujacego = (login: string, odStempel: string): string =>
  `/orders?external_user=${q(login)}&date_from=${q(odStempel)}&limit=${STRONA}`;

/** Listy przewozowe zamówienia — jedyne miejsce z datą utworzenia etykiety. */
export const sciezkaPrzesylek = (zamowienieId: number): string =>
  `/ordersshipments?order_id=${Math.trunc(zamowienieId)}&limit=${STRONA}`;

export const SCIEZKA_NOTATEK = "/notes";
export const SCIEZKA_STATUSOW = "/statuses";

/* ── Mapowanie ───────────────────────────────────────────────────────────── */

type Obiekt = Record<string, unknown>;
const obiekt = (v: unknown): Obiekt | null =>
  v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Obiekt) : null;
const tekst = (v: unknown): string | null => {
  const s = v == null ? "" : String(v).trim();
  return s === "" ? null : s;
};
const liczba = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const calkowita = (v: unknown): number | null => {
  const n = liczba(v);
  return n !== null && Number.isInteger(n) && n > 0 ? n : null;
};

/** Lista z odpowiedzi. Schemat mówi „tablica”; cokolwiek innego to brak wierszy, nie zgadywanie. */
export const lista = (v: unknown): Obiekt[] =>
  Array.isArray(v) ? v.map(obiekt).filter((o): o is Obiekt => o !== null) : [];

/**
 * Data Sellasist w UTC. Pełny stempel idzie przez strefę magazynu; sama data
 * (`deadline` bywa dniem) zostaje dniem. Data z jawną strefą idzie wprost.
 */
export function dataSellasist(v: unknown): string | null {
  const s = tekst(v);
  if (!s || s.startsWith("0000")) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const lokalny = lokalnyNaUtc(s);
  if (lokalny) return lokalny;
  const ms = Date.parse(s);
  return Number.isFinite(ms) && /[zZ]|[+-]\d{2}:?\d{2}$/.test(s) ? new Date(ms).toISOString() : null;
}

/**
 * Przewoźnik Sellasist na `carrierId` Allegro, którym pytamy o tracking.
 * Szczegół zamówienia podaje tylko NAZWĘ usługi (`shipments[].service`),
 * a wewnętrzny kod (`service_internal`) wyłącznie przy zapisie. Nieznana
 * nazwa daje `OTHER`: takiej paczki nie śledzimy, ale numer zostaje.
 */
export function przewoznikAllegro(usluga: string | null): string {
  const u = (usluga ?? "").toLowerCase();
  const reguly: Array<[RegExp, string]> = [
    [/inpost|paczkomat/, "INPOST"], [/dpd/, "DPD"], [/gls/, "GLS"], [/dhl/, "DHL"],
    [/ups/, "UPS"], [/fedex/, "FEDEX"], [/poczta|pocztex/, "POCZTA_POLSKA"],
    [/allegro|one ?box|one ?kurier/, "ALLEGRO"],
  ];
  return reguly.find(([r]) => r.test(u))?.[1] ?? "OTHER";
}

export interface PozycjaSellasist {
  /** `carts[].id` — ten sam numer co „ID Koszyka" w eksporcie zbiórek. */
  koszykId: number;
  symbol: string | null;
  ean: string | null;
  nazwa: string | null;
  ilosc: number;
  /** `quantityMissing`: ilość brakująca do skompletowania. */
  brakuje: number;
}

export interface PrzesylkaSellasist {
  waybill: string;
  /** Nazwa usługi z Sellasist, np. „InPost Paczkomaty". */
  usluga: string | null;
  /** `carrierId` Allegro wyliczony z nazwy; `OTHER`, gdy nazwa nieznana. */
  przewoznik: string;
}

export interface ZamowienieSellasist {
  id: number;
  /** `external_data.external_id` — numer zamówienia w źródle. */
  externalId: string | null;
  /** `external_data.external_login` — login kupującego w serwisie. */
  login: string | null;
  zrodlo: string | null;
  statusId: number | null;
  statusNazwa: string | null;
  statusAt: string | null;
  termin: string | null;
  utworzonoAt: string | null;
  /** `copied_order_id` kopii; kopię Sellasist robi m.in. pod dosyłkę. */
  skopiowaneZ: number | null;
  pozycje: PozycjaSellasist[];
  przesylki: PrzesylkaSellasist[];
}

/**
 * Numery z `shipments[]` szczegółu. `tracking_number` paczki wielopaczkowej
 * to numery „połączone przecinkami" (opis pola), więc dzielimy je.
 */
function przesylkiZamowienia(z: Obiekt): PrzesylkaSellasist[] {
  const wynik = new Map<string, PrzesylkaSellasist>();
  for (const s of lista(z.shipments)) {
    const usluga = tekst(s.service);
    for (const n of String(s.tracking_number ?? "").split(",")) {
      const waybill = n.trim();
      if (waybill && waybill.length <= 64 && !wynik.has(waybill)) {
        wynik.set(waybill, { waybill, usluga, przewoznik: przewoznikAllegro(usluga) });
      }
    }
  }
  return [...wynik.values()];
}

/** Szczegół zamówienia (`GET /orders/{order_id}`) na nasz typ. `null`, gdy brak `id`. */
export function mapujZamowienie(v: unknown): ZamowienieSellasist | null {
  const z = obiekt(v);
  const id = calkowita(z?.id);
  if (!z || id === null) return null;
  const zew = obiekt(z.external_data);
  const status = obiekt(z.status);
  const kopia = tekst(z.is_copied);
  return {
    id,
    externalId: tekst(zew?.external_id),
    login: tekst(zew?.external_login),
    zrodlo: tekst(z.source),
    statusId: calkowita(status?.id),
    statusNazwa: tekst(status?.name),
    statusAt: dataSellasist(z.last_status_change),
    termin: dataSellasist(z.deadline),
    utworzonoAt: dataSellasist(z.date),
    /* `is_copied` jest w schemacie tekstem; „0" i puste znaczą oryginał. */
    skopiowaneZ: kopia && kopia !== "0" ? calkowita(z.copied_order_id) : null,
    pozycje: lista(z.carts).flatMap((c): PozycjaSellasist[] => {
      const koszykId = calkowita(c.id);
      if (koszykId === null) return [];
      return [{
        koszykId, symbol: tekst(c.symbol), ean: tekst(c.ean), nazwa: tekst(c.name),
        ilosc: liczba(c.quantity) ?? 0, brakuje: Math.max(0, liczba(c.quantityMissing) ?? 0),
      }];
    }),
    przesylki: przesylkiZamowienia(z),
  };
}

/** Skrót z listy (`GET /orders`): numer, numer w źródle i data złożenia. */
export interface SkrotZamowienia { id: number; utworzonoAt: string | null }

export function mapujListeZamowien(v: unknown): SkrotZamowienia[] {
  return lista(v).flatMap((z) => {
    const id = calkowita(z.id);
    return id === null ? [] : [{ id, utworzonoAt: dataSellasist(z.date) }];
  });
}

/** List przewozowy z `GET /ordersshipments`. Pole `file` (PDF etykiety) pomijamy. */
export interface ListPrzewozowy { waybill: string; utworzonoAt: string | null }

export function mapujListyPrzewozowe(v: unknown): ListPrzewozowy[] {
  return lista(v).flatMap((s) => {
    const waybill = tekst(s.tracking_number);
    return waybill && waybill.length <= 64 ? [{ waybill, utworzonoAt: dataSellasist(s.created_date) }] : [];
  });
}

export interface WpisDziennika {
  id: number;
  zamowienieId: number;
  tag: string | null;
  /**
   * `object_id`, „powiązany identyfikator". Przy `order_status_change`
   * czytamy go jako status, w który weszło zamówienie; potwierdza to sonda.
   */
  obiekt: number | null;
  at: string | null;
}

/**
 * Wpisy dziennika BEZ `user_id`. Kto zebrał albo spakował paczkę, to
 * monitoring pracowniczy (art. 22² KP), a liczba zbiórek na dzień go nie
 * potrzebuje. Ta sama zasada co przy `pominiecia_dzien` w `schema.sql`.
 */
export function mapujDziennik(v: unknown): WpisDziennika[] {
  return lista(v).flatMap((w) => {
    const id = calkowita(w.id);
    const zamowienieId = calkowita(w.order_id);
    if (id === null || zamowienieId === null) return [];
    return [{
      id, zamowienieId, tag: tekst(w.operation_tag), obiekt: calkowita(w.object_id),
      at: dataSellasist(w.date),
    }];
  });
}
