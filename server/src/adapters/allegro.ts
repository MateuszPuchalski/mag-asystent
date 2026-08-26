import { config } from "../config.js";
import { WERSJA } from "../wersja.js";
import { HttpAllegroAdapter } from "./allegro.http.js";
import { DevAllegroAdapter } from "./allegro.dev.js";

/* ── Allegro — kontrakt adaptera (zwroty klienckie, Etap 1) ──────────────────
   Pierwsza integracja HTTP wychodząca w tym serwerze. Ten plik trzyma WYŁĄCZNIE
   kontrakt i typy domenowe — spolszczone i wąskie: tylko pola, których serwis
   zwrotów faktycznie używa. Pełną odpowiedź API zwrot niesie obok w `surowe`
   (ląduje w `zwrot.surowe_json` — diagnoza dziś, paliwo korekty w Etapie 2).

   Implementacje, ten sam podział co Sfera (sfera.ts / sfera.sql.ts / sfera.dev.ts):
     • allegro.http.ts — prawdziwe API (fetch, Bearer z services/allegro-token.ts)
     • allegro.dev.ts  — fikcyjne zwroty zestrojone z seedem scenariuszy
       (S67–S69); zero sieci, działa w testach i demo                          */

export interface PaczkaZwrotu {
  /** Numer nadania przesyłki zwrotnej. */
  waybill: string | null;
  /**
   * Numer przewoźnika FIZYCZNIE doręczającego — bywa INNY niż `waybill`
   * (przekazanie paczki między przewoźnikami). Etykieta, którą magazyn widzi
   * u drzwi, nosi właśnie ten numer, dlatego skan pyta o oba.
   */
  transportingWaybill: string | null;
  przewoznik: string | null;
}

export interface PozycjaZwrotuAllegro {
  offerId: string | null;
  nazwa: string;
  /**
   * Sygnatura sprzedawcy z zamówienia (`offer.external.id`) — zwykle symbol
   * kartoteki nadany przez integrację sprzedażową. Zwrot jej NIE niesie;
   * serwis dokleja ją z `zamowienie()` po `offerId`.
   */
  externalId: string | null;
  ilosc: number;
  powod: string | null;
  powodOpis: string | null;
}

export interface ZwrotAllegro {
  id: string;
  orderId: string | null;
  /** referenceNumber — numer zwrotu, który widzi klient i panel sprzedawcy. */
  referencja: string | null;
  status: string | null;
  utworzono: string | null;
  kupujacyLogin: string | null;
  /** Identyfikator kupującego — jedyny pewny klucz do wątku wiadomości. */
  kupujacyId: string | null;
  kupujacyEmail: string | null;
  pozycje: PozycjaZwrotuAllegro[];
  paczki: PaczkaZwrotu[];
  /** Pełna odpowiedź API — do `zwrot.surowe_json`, nigdy do logiki. */
  surowe: unknown;
}

export interface PozycjaZamowieniaAllegro {
  offerId: string | null;
  nazwa: string;
  externalId: string | null;
  ilosc: number;
}

export interface ZamowienieAllegro {
  id: string;
  kupujacyLogin: string | null;
  kupujacyId: string | null;
  kupujacyEmail: string | null;
  pozycje: PozycjaZamowieniaAllegro[];
}

export interface WiadomoscAllegro {
  id: string;
  /** Kto napisał: `kupujacy` albo `my` (sprzedawca). */
  odKupujacego: boolean;
  autor: string | null;
  tresc: string;
  at: string | null;
  /** Ile załączników niesie wiadomość — treści plików nie pobieramy. */
  zalacznikow: number;
}

export interface WatekAllegro {
  threadId: string;
  interlokutor: string | null;
  wiadomosci: WiadomoscAllegro[];
}

/**
 * Dyskusja albo reklamacja klienta z Allegro (`/sale/issues`, Etap 6).
 * Sam ODCZYT: sprawa toczy się w panelu Allegro, my ją tylko pokazujemy,
 * żeby biuro wiedziało o zgłoszeniu bez logowania się do panelu co godzinę.
 */
export interface DyskusjaAllegro {
  id: string;
  /** DISCUSSION | CLAIM — rozmowa czy formalna reklamacja. */
  typ: string | null;
  status: string | null;
  temat: string | null;
  kupujacyLogin: string | null;
  orderId: string | null;
  utworzono: string | null;
}

/**
 * Nagłówek wątku z listy Centrum wiadomości (`/messaging/threads`).
 *
 * Sama lista — BEZ wiadomości. Pobranie treści to osobne zapytanie na wątek,
 * więc synchronizacja pytań schodzi listą w dół i czyta tylko te rozmowy,
 * które są świeższe niż to, co już znamy.
 */
export interface WatekNaglowek {
  threadId: string;
  /** Zamaskowany rozmówca (`client:44300444`) — Allegro loginu tu nie podaje. */
  interlokutor: string | null;
  ostatniaWiadomoscAt: string | null;
  /** Flaga `read` z listy; `null` gdy zasób jej nie niesie ([WERYFIKUJ]). */
  przeczytany: boolean | null;
  /** Oferta, której wątek dotyczy — gdy Allegro ją podaje (bywa pusta). */
  ofertaId: string | null;
  ofertaTytul: string | null;
}

/**
 * Nasza oferta z `/sale/offers` — kontekst doboru części i ŹRÓDŁO LINKU,
 * który klient dostaje w odpowiedzi. Bez tego szkic mówiłby „mamy to
 * w ofercie" i kazał klientowi szukać samemu.
 */
export interface OfertaAllegro {
  offerId: string;
  nazwa: string;
  /** Cena z walutą, gotowa do wklejenia w zdanie („39,90 PLN"); null gdy brak. */
  cena: string | null;
  /** `offer.external.id` — symbol kartoteki nadany przez integrację sprzedażową. */
  externalId: string | null;
  dostepnych: number | null;
  /** Adres aukcji — składamy go MY, API go nie zwraca. */
  url: string;
}

/** Czym rozpoznajemy kupującego w liście wątków. */
export interface KupujacyRef {
  login: string | null;
  id: string | null;
}

/**
 * Wynik szukania wątku — z licznikami, nie samym `null`.
 *
 * „Nie znalazłem" ma dwie zupełnie różne przyczyny: klient naprawdę nie pisał
 * albo rozmowa jest starsza niż to, co przejrzeliśmy. Bez tych liczb ekran
 * nie umiałby ich rozróżnić, a właśnie na tym poległa pierwsza wersja.
 */
export interface SzukanieWatku {
  watek: WatekAllegro | null;
  przejrzanych: number;
  /** Data ostatniej wiadomości w najstarszym przejrzanym wątku. */
  najstarszaData: string | null;
  /** Czy lista wątków się skończyła (przejrzano wszystko, co konto ma). */
  wyczerpano: boolean;
}

export interface AllegroAdapter {
  /**
   * Zwroty, których KTÓRAKOLWIEK paczka nosi ten numer — po `parcels.waybill`
   * ORAZ `parcels.transportingWaybill`. Zero wyników to poprawna odpowiedź
   * (etykieta spoza Allegro), nie błąd.
   */
  szukajZwrotowPoWaybill(waybill: string): Promise<ZwrotAllegro[]>;
  /**
   * Zwroty zarejestrowane przez klientów od danej chwili (`createdAt.gte`),
   * najświeższe naprzód — paliwo tickera zapowiedzi (Etap 4). `odKiedy` null
   * znaczy „bez granicy": bierz, ile paginacja pozwoli.
   */
  listaZwrotowKlienta(odKiedy: string | null): Promise<ZwrotAllegro[]>;
  /**
   * Dyskusje i reklamacje klientów (`/sale/issues`) — na żądanie, bez zapisu
   * u nas: jedno miejsce prawdy to panel Allegro (Etap 6).
   */
  listaDyskusji(): Promise<DyskusjaAllegro[]>;
  /** Szczegół zwrotu po id; `null` gdy nie istnieje. */
  zwrot(id: string): Promise<ZwrotAllegro | null>;
  /** Zamówienie (checkout-form) — źródło `externalId` pozycji; `null` gdy brak. */
  zamowienie(orderId: string): Promise<ZamowienieAllegro | null>;
  /**
   * Wątek Centrum wiadomości z danym kupującym.
   *
   * Czytane NA ŻĄDANIE i NIE zapisywane u nas: to prywatna rozmowa z klientem,
   * która ma jedno miejsce prawdy — Allegro. Kopia w naszej bazie starzałaby
   * się po pierwszej odpowiedzi i mnożyła dane osobowe bez potrzeby.
   *
   * `odKiedy` (ISO) ogranicza przeszukiwanie: lista wątków jest posortowana od
   * najnowszej rozmowy, więc schodzimy tylko do rozmów z okolic zwrotu.
   */
  watekKupujacego(kto: KupujacyRef, odKiedy: string | null): Promise<SzukanieWatku>;

  /* ── Pytania klientów (0.80.0) ─────────────────────────────────────────────
     Wątki są tu ŹRÓDŁEM PRACY, nie ciekawostką przy zwrocie, więc czytamy je
     inaczej: listą od najświeższej i tylko do znanej daty. Snapshot pytania
     zostaje u nas (rejestr naszej pracy), pełna rozmowa dalej mieszka
     w Allegro i czyta się ją na kliknięcie.                                  */

  /**
   * Nagłówki wątków od najświeższego. `odKiedy` (ISO) zatrzymuje schodzenie,
   * gdy lista zejdzie poniżej tej daty — null znaczy „bez granicy", wtedy
   * hamuje dopiero `maxStron`.
   */
  listaWatkow(odKiedy: string | null, maxStron?: number): Promise<WatekNaglowek[]>;
  /**
   * Wiadomości jednego wątku, od najstarszej.
   *
   * `rozmowca` to login kupującego z nagłówka wątku i jest tu POTRZEBNY, a nie
   * pomocniczy: Allegro nie zawsze podaje `author.role` przy wiadomości, a bez
   * roli jedyne, po czym da się poznać stronę rozmowy, jest właśnie login.
   * Pominięty (albo `null`) znaczy „nie wiem" — wtedy wiadomość bez roli liczy
   * się jako NASZA, bo pomyłka w tę stronę tylko chowa pytanie, a w drugą
   * kazałaby nam odpisywać na własne zdania.
   */
  wiadomosciWatku(threadId: string, rozmowca?: string | null): Promise<WiadomoscAllegro[]>;
  /** Wysyła naszą odpowiedź do wątku. */
  wyslijWiadomosc(threadId: string, tekst: string): Promise<void>;
  /** Odhacza wątek jako przeczytany — żeby panel Allegro nie świecił po naszej odpowiedzi. */
  oznaczPrzeczytany(threadId: string): Promise<void>;
  /** Nasze aktywne oferty pasujące do frazy — linki do wklejenia w odpowiedź. */
  szukajOfert(fraza: string): Promise<OfertaAllegro[]>;
}

/**
 * Maksymalna długość wiadomości w Centrum wiadomości.
 *
 * Allegro tnie dłuższe albo odrzuca żądanie — a odrzucenie PO kliknięciu
 * „wyślij" znaczy, że biuro myśli, że odpowiedziało. Sprawdzamy więc u siebie,
 * zanim cokolwiek poleci. Wartość ostrożna; [WERYFIKUJ] na sandboxie.
 */
export const LIMIT_WIADOMOSCI = 2000;

/**
 * User-Agent do KAŻDEGO żądania (auth i API) — Allegro wymaga go wprost,
 * a brak prawidłowego nagłówka grozi zablokowaniem klucza. Wartość
 * wygenerowaną na developer.allegro.pl wkleja się w `ALLEGRO_USER_AGENT`;
 * fallback identyfikuje nas nazwą i wersją, nigdy domyślnym „node".
 */
export function allegroUserAgent(): string {
  return config.allegro.userAgent || `WERTIS/${WERSJA}`;
}

/**
 * Tryb faktycznie użyty: jawny `ALLEGRO_MODE` wygrywa, puste wynika
 * z `SGT_MODE` — ten sam wzorzec co `sferaMode`.
 */
export function allegroTryb(): "dev" | "http" {
  if (config.allegro.mode) return config.allegro.mode;
  return config.sgtMode === "mssql" ? "http" : "dev";
}

let _adapter: AllegroAdapter | null = null;

/**
 * Adapter wg konfiguracji — leniwie i raz: implementacja http trzyma stan
 * odświeżania tokena, a dev — nic, więc singleton niczego nie komplikuje.
 * Import dynamiczny nie jest tu potrzebny (oba moduły są lekkie), ale
 * wybór MUSI być leniwy, bo testy przestawiają config po imporcie modułów.
 */
export function allegroAdapter(): AllegroAdapter {
  if (_adapter) return _adapter;
  _adapter = allegroTryb() === "http" ? new HttpAllegroAdapter() : new DevAllegroAdapter();
  return _adapter;
}

/** Testy przestawiają tryb w locie — po zmianie configu adapter składa się od nowa. */
export function zresetujAdapterAllegro(): void {
  _adapter = null;
}
