import { config } from "../config.js";
import { db as defaultDb, type Db } from "../db/db.js";
import { dopasujPoSku, skuPozycji, type Dopasowanie } from "./dopasowanie-sku.js";
import { linkZamowienia, linkZwrotu } from "./allegro-linki.js";
import { logEvent } from "./events.js";

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
  /** Odnośnik do oferty — jedyny link udokumentowany w specyfikacji. */
  url: string | null;
  /** Kartoteka POTWIERDZONA przez człowieka; bez niej nie ma zdjęcia. */
  twId: number | null;
  twSymbol: string | null;
  twZrodlo: string | null;
  /** Propozycja automatu — pokazywana obok, nigdy zamiast potwierdzonej. */
  propozycja: Dopasowanie | null;
}

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
  /**
   * Kwota PEŁNA: pozycje plus koszt dostawy. `null`, dopóki zamówienia nie
   * pobrano — do 0.151.0 ekran nie umiał jej policzyć wcale i mówił o tym
   * wprost, bo koszt dostawy stoi przy zamówieniu, nie przy zwrocie.
   */
  kwotaPelnaGrosze: number | null;
  waluta: string;
  /** Odnośniki do panelu Allegro; `null` = nie ma czego linkować. */
  linkZwrotu: string | null;
  zamowienie: Zamowienie | null;
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

function zloz(
  z: Wiersz, pozycje: PozycjaZwrotu[], zamowienie: Zamowienie | null, teraz: number,
): WierszZwrotu {
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
  const suma = sumaPozycji(pozycje);
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
    sumaPozycjiGrosze: suma,
    /* Kwota pełna = pozycje + dostawa. Bez zamówienia zostaje `null`, a nie
       suma pozycji udająca całość — do 0.151.0 ekran musiał o tym pisać
       zdanie, bo koszt dostawy stoi przy zamówieniu, nie przy zwrocie. */
    kwotaPelnaGrosze: zamowienie ? suma + (zamowienie.dostawaGrosze ?? 0) : null,
    waluta: pozycje[0]?.waluta ?? zamowienie?.waluta ?? "PLN",
    linkZwrotu: linkZwrotu((z.reference_number as string) ?? (z.external_id as string)),
    zamowienie,
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
  const zamowienia = database.prepare(
    "SELECT * FROM zamowienie_klienta"
  ).all() as Wiersz[];
  const pozZam = database.prepare(
    "SELECT * FROM zamowienie_klienta_pozycja ORDER BY id ASC"
  ).all() as Wiersz[];

  const zamWgKlucza = new Map<string, Wiersz>();
  for (const k of zamowienia) zamWgKlucza.set(`${k.channel_account_id}|${k.external_id}`, k);
  const pozWgZam = new Map<number, Wiersz[]>();
  for (const p of pozZam) {
    const l = pozWgZam.get(Number(p.zamowienie_id)) ?? [];
    l.push(p);
    pozWgZam.set(Number(p.zamowienie_id), l);
  }

  const wgZwrotu = new Map<number, Wiersz[]>();
  for (const p of pozycje) {
    const lista = wgZwrotu.get(Number(p.zwrot_id)) ?? [];
    lista.push(p);
    wgZwrotu.set(Number(p.zwrot_id), lista);
  }

  return zwroty
    .map((z) => {
      const surowe = wgZwrotu.get(Number(z.id)) ?? [];
      const zam = zamWgKlucza.get(`${z.channel_account_id}|${z.order_id}`) ?? null;
      const pozZamowienia = zam ? pozWgZam.get(Number(zam.id)) ?? [] : [];
      const wracajace = new Set(surowe.map((p) => (p.offer_id as string) ?? ""));

      const zlozone: PozycjaZwrotu[] = surowe.map((p) => {
        const twId = p.tw_id == null ? null : Number(p.tw_id);
        /* Propozycję liczymy TYLKO tam, gdzie kartoteki jeszcze nie ma.
           Podpowiadanie obok potwierdzonego wyboru byłoby podważaniem
           decyzji człowieka, a §4.3 stawia ją wyżej niż wynik automatu. */
        const sku = twId === null
          ? skuPozycji(database, Number(z.channel_account_id),
              (z.order_id as string) ?? null, (p.offer_id as string) ?? null)
          : null;
        return {
          id: Number(p.id),
          offerId: (p.offer_id as string) ?? null,
          nazwa: String(p.nazwa),
          ilosc: Number(p.ilosc),
          cenaGrosze: Number(p.cena_grosze),
          waluta: String(p.waluta),
          powod: (p.powod as string) ?? null,
          powodKomentarz: (p.powod_komentarz as string) ?? null,
          ocena: (p.ocena as string) ?? null,
          url: (p.url as string) ?? null,
          twId,
          twSymbol: (p.tw_symbol as string) ?? null,
          twZrodlo: (p.tw_zrodlo as string) ?? null,
          propozycja: twId === null ? dopasujPoSku(database, sku) : null,
        };
      });

      const zamowienie: Zamowienie | null = zam ? {
        externalId: String(zam.external_id),
        status: (zam.status as string) ?? null,
        kupujacyLogin: (zam.kupujacy_login as string) ?? null,
        dostawaGrosze: zam.dostawa_grosze == null ? null : Number(zam.dostawa_grosze),
        dostawaMetoda: (zam.dostawa_metoda as string) ?? null,
        sumaGrosze: zam.suma_grosze == null ? null : Number(zam.suma_grosze),
        waluta: String(zam.waluta ?? "PLN"),
        kupionoAt: (zam.kupiono_at as string) ?? null,
        link: linkZamowienia(String(zam.external_id)),
        pozycje: pozZamowienia.map((p) => ({
          offerId: (p.offer_id as string) ?? null,
          nazwa: String(p.nazwa),
          sku: (p.sku as string) ?? null,
          ilosc: Number(p.ilosc),
          cenaGrosze: Number(p.cena_grosze),
          waluta: String(p.waluta),
          /* Które pozycje wracają — to jest cały powód, dla którego panel
             pokazuje CAŁE zamówienie, a nie same zwracane sztuki. */
          zwracana: wracajace.has((p.offer_id as string) ?? ""),
        })),
      } : null;

      return zloz(z, zlozone, zamowienie, teraz);
    })
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

/**
 * Potwierdzenie kartoteki dla pozycji zwrotu.
 *
 * PIERWSZY ZAPIS tego ekranu. Do 0.151.0 zwroty wyłącznie czytały, a licznik
 * tras zapisu w `routes/zwroty.test.ts` stał na zerze i był umową — tak jak
 * licznik `method:` w `biuro.test.ts` dla panelu magazynu.
 *
 * Zapisuje ŹRÓDŁO razem z wyborem. `sku` znaczy „agent zatwierdził propozycję
 * automatu", `reczne` — „wskazał sam". Projekt panelu §4.3 żąda, żeby wybór
 * człowieka nie udawał faktu z Allegro; tu obowiązuje to w obie strony, bo
 * bez źródła nie da się później odróżnić, komu wierzyć.
 *
 * `twId === null` ZDEJMUJE powiązanie — to jest droga wyjścia z błędnego
 * potwierdzenia, a nie brak funkcji.
 */
export function potwierdzKartoteke(
  database: Db,
  pozycjaId: number,
  twId: number | null,
  zrodlo: "sku" | "reczne",
  kto: { id: number; name: string },
  teraz = new Date(),
): { twId: number | null; twSymbol: string | null; twZrodlo: string | null } {
  const pozycja = database.prepare(
    "SELECT id, zwrot_id FROM zwrot_klienta_pozycja WHERE id=?"
  ).get(pozycjaId) as { id: number; zwrot_id: number } | undefined;
  if (!pozycja) throw new Error("Nie znaleziono pozycji zwrotu");

  if (twId === null) {
    database.prepare(`UPDATE zwrot_klienta_pozycja
      SET tw_id=NULL, tw_symbol=NULL, tw_zrodlo=NULL, tw_at=?, tw_przez=? WHERE id=?`)
      .run(teraz.toISOString(), kto.name, pozycjaId);
    logEvent("zwrot_kartoteka_zdjeta", kto.name, null,
      { pozycjaId, zwrotId: pozycja.zwrot_id }, undefined, database);
    return { twId: null, twSymbol: null, twZrodlo: null };
  }

  /* Symbol bierzemy z KARTOTEKI, nie z żądania. Panel mógłby przysłać dowolny
     napis, a snapshot ma przeżyć skasowanie read-modelu przy imporcie —
     kłamliwy snapshot byłby gorszy od jego braku. */
  const towar = database.prepare("SELECT tw_id, symbol FROM sgt_towar WHERE tw_id=?")
    .get(twId) as { tw_id: number; symbol: string } | undefined;
  if (!towar) throw new Error("Nie znaleziono towaru");

  database.prepare(`UPDATE zwrot_klienta_pozycja
    SET tw_id=?, tw_symbol=?, tw_zrodlo=?, tw_at=?, tw_przez=? WHERE id=?`)
    .run(towar.tw_id, towar.symbol, zrodlo, teraz.toISOString(), kto.name, pozycjaId);

  /* Audyt idzie tą samą bazą co mutacja — inaczej zdarzenie mogłoby przeżyć
     wycofaną transakcję (wzorzec z `services/wysylka.ts`). */
  logEvent("zwrot_kartoteka", kto.name, towar.tw_id,
    { pozycjaId, zwrotId: pozycja.zwrot_id, symbol: towar.symbol, zrodlo },
    kto.id, database);

  database.prepare(`INSERT INTO zwrot_zdarzenie(zwrot_id,rodzaj,tresc,dane_json,kiedy_at,kto,kto_user_id)
    VALUES (?,?,?,?,?,?,?)`).run(
    pozycja.zwrot_id, "kartoteka",
    `Wskazano kartotekę ${towar.symbol}`,
    JSON.stringify({ pozycjaId, twId: towar.tw_id, zrodlo }),
    teraz.toISOString(), kto.name, kto.id);

  return { twId: towar.tw_id, twSymbol: towar.symbol, twZrodlo: zrodlo };
}
