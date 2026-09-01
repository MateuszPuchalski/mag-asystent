import { config } from "../config.js";
import { db as defaultDb, type Db } from "../db/db.js";

/* ── Kubełki zwrotów (0.150.0) ───────────────────────────────────────────────
   Panel zwrotów jest KOLEJKĄ BRAMEK, nie rejestrem. Rejestr każe najpierw
   znaleźć zwrot, potem wybrać akcję z menu — dwa kliknięcia przed
   jakąkolwiek decyzją. Kubełek niesie dokładnie jedno pytanie, więc operator
   nie wybiera, co zrobić, tylko odpowiada.

   KUBEŁKA NIE MA W KOLUMNIE. Wynika z faktów: werdyktu, ocen pozycji, kwoty
   i numeru korekty. Zdenormalizowany rozjechałby się z nimi przy pierwszym
   zapisie, który go zapomni — a wtedy ekran pokazywałby pracę, której nie
   ma, albo chował tę, która jest.

   Kolejność w kubełku bierze się z ZEGARA USTAWOWEGO, nie z daty wpływu.
   To blizna 0.121.0: ustawowy termin jest osobnym bytem i steruje
   kolejnością pracy. Zwrot z dwoma dniami zapasu stoi nad wczorajszym.    */

export type Kubelek = "decyzja" | "ocena" | "zwrot" | "korekta" | "zamkniety" | "odrzucony";

export type Sygnal = "termin" | "brak_dowodu" | "odrzucony_w_allegro";

export interface PozycjaZwrotu {
  id: number;
  offerId: string | null;
  nazwa: string;
  ilosc: number;
  cenaGrosze: number;
  waluta: string;
  powod: string | null;
  powodKomentarz: string | null;
  ocena: string | null;
}

export interface WierszZwrotu {
  id: number;
  externalId: string;
  numer: string | null;
  orderId: string | null;
  utworzono: string;
  paczkaAt: string | null;
  kubelek: Kubelek;
  sygnaly: Sygnal[];
  terminAt: string;
  dniDoTerminu: number;
  sumaPozycjiGrosze: number;
  waluta: string;
  werdykt: string | null;
  kwotaGrosze: number | null;
  kwotaWariant: string | null;
  korektaNumer: string | null;
  rejectionCode: string | null;
  wersja: number;
  pozycje: PozycjaZwrotu[];
}

/** Ile dni przed terminem wiersz zapala się na czerwono. */
const PROG_TERMINU_DNI = 3;

type Wiersz = Record<string, unknown>;

/**
 * Termin ustawowy zwrotu pieniędzy.
 *
 * `[WERYFIKUJ]` Liczymy go od `createdAt` zwrotu, bo to najbliższy moment,
 * jaki Allegro nam podaje. Ustawa liczy czternaście dni od OTRZYMANIA
 * oświadczenia o odstąpieniu, a te dwa momenty nie muszą być tym samym.
 * Błąd idzie w stronę bezpieczną — nasz termin wypada nie później niż
 * ustawowy — ale zanim ktoś oprze na tym spór, trzeba to sprawdzić.
 */
export function terminZwrotu(utworzono: string, dni = config.allegro.zwrotTerminDni): string {
  return new Date(Date.parse(utworzono) + dni * 86_400_000).toISOString();
}

/** Pełne dni do terminu; ujemne znaczy „po terminie". */
export function dniDoTerminu(terminAt: string, teraz = Date.now()): number {
  return Math.floor((Date.parse(terminAt) - teraz) / 86_400_000);
}

/**
 * Kubełek wyliczony z faktów.
 *
 * Kolejność warunków jest UMOWĄ: stany końcowe rozstrzygają pierwsze, bo
 * zwrot zamknięty nie ma prawa wrócić do kolejki pracy tylko dlatego, że
 * któraś pozycja została bez oceny.
 */
export function kubelekZwrotu(z: {
  rejectionCode: string | null; werdykt: string | null; zamknietyAt: string | null;
  kwotaGrosze: number | null; korektaNumer: string | null;
  pozycje: Array<{ ocena: string | null }>;
}): Kubelek {
  if (z.zamknietyAt) return "zamkniety";
  if (z.werdykt === "odrzucony" || z.rejectionCode) return "odrzucony";
  if (z.werdykt !== "przyjety") return "decyzja";
  /* Pusta lista pozycji NIE jest „ocenione wszystko": zwrot bez pozycji nie
     ma czego wycenić, więc zostaje przy ocenie, gdzie człowiek to zobaczy. */
  if (!z.pozycje.length || z.pozycje.some((p) => !p.ocena)) return "ocena";
  if (z.kwotaGrosze === null) return "zwrot";
  if (!z.korektaNumer) return "korekta";
  return "zamkniety";
}

/**
 * Sygnały — jedyne trzy rzeczy, które każą przeczytać wiersz.
 *
 * Wszystko inne wiersz mówi bez czytania. Czwartego sygnału z projektu,
 * „rozjazd" (klient zgłosił inną liczbę sztuk, niż wróciła), tu jeszcze
 * nie ma: liczbę zwróconą zna dopiero ocena hali, która wchodzi w 0.151.0.
 * Reguła bez danych zapalałaby się na ślepo albo nigdy — obie wersje uczą
 * operatora ignorować kolor.
 */
export function sygnalyZwrotu(z: {
  kubelek: Kubelek; dni: number; paczkaAt: string | null; rejectionCode: string | null;
}): Sygnal[] {
  const s: Sygnal[] = [];
  /* Stany końcowe nie mają terminu do pilnowania — czerwień na nich uczyłaby
     przewijać czerwone wiersze. */
  const wPracy = z.kubelek !== "zamkniety" && z.kubelek !== "odrzucony";
  if (wPracy && z.dni <= PROG_TERMINU_DNI) s.push("termin");
  if (wPracy && !z.paczkaAt) s.push("brak_dowodu");
  /* Odrzucone w panelu Allegro, nie u nas. Bez tego biuro drugi raz
     rozstrzygałoby sprawę, którą ktoś już zamknął gdzie indziej. */
  if (z.rejectionCode) s.push("odrzucony_w_allegro");
  return s;
}

/**
 * Propozycja kwoty: suma pozycji.
 *
 * To NIE jest jeszcze „kwota pełna". Koszt dostawy nie przyjeżdża ze
 * zwrotem — Allegro trzyma go przy zamówieniu (`/order/checkout-forms`)
 * i przy inicjowaniu zwrotu płatności (`delivery.value`). Do czasu, aż
 * panel zacznie dociągać zamówienie, wariant „bez wysyłki" byłby
 * nieodróżnialny od pełnego, czyli byłby kłamstwem na przycisku.
 */
export function sumaPozycji(pozycje: Array<{ cenaGrosze: number; ilosc: number }>): number {
  return pozycje.reduce((s, p) => s + Math.round(p.cenaGrosze * p.ilosc), 0);
}

function zloz(z: Wiersz, pozycje: PozycjaZwrotu[], teraz: number): WierszZwrotu {
  const utworzono = String(z.created_at);
  const terminAt = terminZwrotu(utworzono);
  const dni = dniDoTerminu(terminAt, teraz);
  const rejectionCode = (z.rejection_code as string) ?? null;
  const kubelek = kubelekZwrotu({
    rejectionCode,
    werdykt: (z.werdykt as string) ?? null,
    zamknietyAt: (z.zamkniety_at as string) ?? null,
    kwotaGrosze: z.kwota_grosze == null ? null : Number(z.kwota_grosze),
    korektaNumer: (z.korekta_numer as string) ?? null,
    pozycje,
  });
  return {
    id: Number(z.id),
    externalId: String(z.external_id),
    numer: (z.reference_number as string) ?? null,
    orderId: (z.order_id as string) ?? null,
    utworzono,
    paczkaAt: (z.paczka_at as string) ?? null,
    kubelek,
    sygnaly: sygnalyZwrotu({ kubelek, dni, paczkaAt: (z.paczka_at as string) ?? null, rejectionCode }),
    terminAt,
    dniDoTerminu: dni,
    sumaPozycjiGrosze: sumaPozycji(pozycje),
    waluta: pozycje[0]?.waluta ?? "PLN",
    werdykt: (z.werdykt as string) ?? null,
    kwotaGrosze: z.kwota_grosze == null ? null : Number(z.kwota_grosze),
    kwotaWariant: (z.kwota_wariant as string) ?? null,
    korektaNumer: (z.korekta_numer as string) ?? null,
    rejectionCode,
    wersja: Number(z.wersja ?? 1),
    pozycje,
  };
}

/**
 * Cała kolejka, jednym zapytaniem plus jednym na pozycje.
 *
 * Zwrotów w pracy są dziesiątki, nie tysiące, więc stronicowanie po stronie
 * serwera kupiłoby złożoność bez zysku. Panel filtruje kubełkiem u siebie
 * i dzięki temu przełączenie kubełka jest natychmiastowe — a to jest
 * dokładnie ten koszt, który miał zniknąć.
 */
export function listaZwrotow(database: Db = defaultDb(), teraz = Date.now()): WierszZwrotu[] {
  const zwroty = database.prepare(
    "SELECT * FROM zwrot_klienta ORDER BY created_at ASC"
  ).all() as Wiersz[];
  const pozycje = database.prepare(
    "SELECT * FROM zwrot_klienta_pozycja ORDER BY id ASC"
  ).all() as Wiersz[];

  const wgZwrotu = new Map<number, PozycjaZwrotu[]>();
  for (const p of pozycje) {
    const lista = wgZwrotu.get(Number(p.zwrot_id)) ?? [];
    lista.push({
      id: Number(p.id),
      offerId: (p.offer_id as string) ?? null,
      nazwa: String(p.nazwa),
      ilosc: Number(p.ilosc),
      cenaGrosze: Number(p.cena_grosze),
      waluta: String(p.waluta),
      powod: (p.powod as string) ?? null,
      powodKomentarz: (p.powod_komentarz as string) ?? null,
      ocena: (p.ocena as string) ?? null,
    });
    wgZwrotu.set(Number(p.zwrot_id), lista);
  }

  return zwroty
    .map((z) => zloz(z, wgZwrotu.get(Number(z.id)) ?? [], teraz))
    /* Najkrótszy termin na górze — to jest cała reguła kolejności i jedyna,
       jakiej ten ekran potrzebuje. */
    .sort((a, b) => a.dniDoTerminu - b.dniDoTerminu);
}

/** Ile pracy stoi w każdym kubełku — liczby przy zakładkach kolejki. */
export function licznikiKubelkow(zwroty: WierszZwrotu[]): Record<Kubelek, number> {
  const puste: Record<Kubelek, number> = {
    decyzja: 0, ocena: 0, zwrot: 0, korekta: 0, zamkniety: 0, odrzucony: 0,
  };
  for (const z of zwroty) puste[z.kubelek]++;
  return puste;
}

/** Oś jednego zwrotu — wpisy wiszą przy źródle (blizna 0.130.0). */
export function osZwrotu(database: Db, zwrotId: number) {
  return database.prepare(
    "SELECT rodzaj, tresc, dane_json, kiedy_at, kto FROM zwrot_zdarzenie WHERE zwrot_id=? ORDER BY kiedy_at ASC, id ASC"
  ).all(zwrotId);
}
