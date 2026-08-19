/* ── Typy odpowiedzi REST — LUSTRO android/core/.../net/Dtos.kt ─────────────
   Zmieniasz typ tu → sprawdź tam (i odwrotnie); rozjazd kończy się błędem
   deserializacji na kolektorze, nie w kompilatorze.                          */

export interface StockView {
  stan: number;       // stan SGT
  rez: number;        // rezerwacje
  avail: number;      // dostępne (stan - rez)
  pendingIn: number;  // ⏳ w drodze z kolejki (MM przychodzące)
  pendingOut: number; // ⏳ w kolejce (MM wychodzące)
  effective: number;  // stan skorygowany o kolejkę
}

/**
 * Zmiana lokalizacji czekająca w kolejce — pojedynczy kod, nie całe pole.
 * `pending` = worker to jeszcze zrobi; `error` = nie zrobi bez PONÓW.
 */
export interface PendingLocChange {
  code: string;
  kind: "add" | "remove";
  status: "pending" | "error";
  /** Zadanie kolejki — kolektor prowadzi z chipa prosto do PONÓW. */
  queueId: number;
}

import type { MagazynStan } from "./services/magazyny.js";
import type { WDostawie } from "./services/dostawy-towaru.js";
import type { Notatka } from "./services/notatki.js";
import type { ZamowioneUDostawcy } from "./services/zamowienia-towaru.js";

export interface ProductCard {
  id: number;
  sym: string;
  name: string;
  ean: string;
  unit: string;
  desc: string;
  /** Lokalizacje POTWIERDZONE — to, co naprawdę jest w Subiekcie. */
  locs: string[];
  /** Zmiany czekające w kolejce; `locs` celowo ich nie zawiera. */
  pendingLocs: PendingLocChange[];
  mag: StockView;
  mgp: StockView;
  /** Strefa zwrotów od klientów (magazyn Zwroty). */
  zwroty: StockView;
  /**
   * Pozostałe magazyny firmy — bez trójki z rolami i bez ukrytych w ustawieniach.
   * Do lipca 2026 karta znała wyłącznie MAG/MGP/Zwroty, więc „gdzie ten towar
   * jeszcze leży" było pytaniem bez odpowiedzi.
   */
  magazyny: MagazynStan[];
  /**
   * Przyjechało na dokumencie, ale jeszcze nie odłożone. Puste = wszystko, co
   * przyszło, leży już w regale.
   *
   * Odpowiada na pytanie, którego karta wcześniej nie zamykała: „stan mówi 12,
   * a półka jest pusta — gdzie to jest?". Przy dostawie krajowej towar figuruje
   * na MAG od chwili zaksięgowania dokumentu, więc kafel stanu nie odróżnia
   * „leży w regale" od „stoi na palecie w przyjęciach".
   */
  wDostawie: WDostawie[];
  /**
   * Otwarte zamówienia u dostawcy. Puste = nic nie jest w drodze.
   *
   * Druga połowa pytania „nie ma tego na półce": `wDostawie` mówi „przyjechało,
   * poszukaj w przyjęciach", to pole mówi „nie ma i trzeba poczekać". Zastąpiło
   * pole `ordered`, które importer produkcyjny wypełniał zerem na sztywno.
   */
  zamowione: ZamowioneUDostawcy[];
  /** Zamienniki wyczytane z `desc` — patrz `services/zamienniki.ts`. */
  zamienniki: Zamienniki;
  /**
   * Podpowiedź przeslotowania z danych o zbiórkach (`services/zbiorki.ts`).
   * Obecne TYLKO gdy towar jest w górnych 15% rotacji, a jego adres pickingowy
   * leży POZA strefą złotą — czyli gdy jest co zrobić. Pole addytywne: stare
   * APK je ignorują (`ignoreUnknownKeys`).
   */
  zlotaStrefa?: { zbiorekNaDzien: number; poziomy: string };
}

/**
 * Zamienniki z opisu kartoteki, rozstrzygnięte kartoteką.
 *
 * `znane` to nasze towary — w nie da się kliknąć i przejść na ich kartę;
 * `obce` to numery OEM i katalogi innych producentów, których u siebie nie
 * mamy. Obcych jest zwykle więcej niż znanych (w całej kartotece 2304 tokeny,
 * z czego 478 nasze), ale zostają na karcie, bo to one idą w rozmowę
 * z dostawcą.
 */
export interface Zamienniki {
  znane: ProductRow[];
  obce: string[];
}

export interface ProductRow {
  id: number;
  sym: string;
  name: string;
  ean: string;
  mag: number;
  mgp: number;
  locs: string[];
  /**
   * Wypełniane WYŁĄCZNIE przy liście zawartości regału: czy ten towar właśnie
   * na tę półkę jedzie, czy z niej schodzi. W wynikach wyszukiwania `null` —
   * tam pytanie „której półki?" nie ma sensu.
   */
  pendingHere?: "add" | "remove" | "error" | null;
}

/* ── Rozkładanie faktur zakupu (redesign v2.0) ──────────────────────────────
   Jednostką pracy jest dokument. Rozkładanie zapisuje wyłącznie lokalizację
   (D1) — bez MM i bez zależności od bufora SGT. Kontener z MGP idzie tą samą
   ścieżką; stan przenosi się osobno (`services/przesuniecie.ts`).           */

export interface DeliveryDocument {
  dokId: number;
  typ: string;
  nrPelny: string;
  dataWyst: string;
  dostawca: string;
  /** Identyfikator kontrahenta z Subiekta; `null`, gdy dokument nie ma płatnika. */
  khId: number | null;
  /**
   * Ile NIEROZWIĄZANYCH wyjątków wisi na tym dokumencie (0.57.0).
   *
   * Pasek postępu tego nie powie i powiedzieć nie może: wyjątek liczy się jako
   * pozycja domknięta (D8). Bez tej liczby dostawa z trzema reklamacjami
   * wygląda w biurze dokładnie jak bezproblemowa.
   */
  wyjatkiOtwarte: number;
  /**
   * Czy ten dostawca ma wgrane logo (0.56.0).
   *
   * Flaga, a nie „spróbuj i zobacz": lista dwudziestu dokumentów pytałaby
   * inaczej o dwadzieścia obrazów, z których większość nie istnieje. Ten sam
   * błąd przy zdjęciach kartotek dał 355 wpisów 404 na tysiąc w dzienniku
   * produkcyjnym i przykrył nimi pięć prawdziwych odmów.
   */
  maLogo: boolean;
  positions: number;
  /** Dokument w buforze SGT — nadal można na nim pracować (D1). */
  wBuforze: boolean;
  /**
   * Dokument księgowany POZA halą (kontener na MGP). Rozkłada się tak samo, ale
   * zostaje po nim przesunięcie stanu — i to jest jedyna rzecz, którą warto
   * powiedzieć PRZED wejściem w dokument.
   *
   * Boolean, a nie `magId`: identyfikatory magazynów siedzą w konfiguracji
   * serwera i kolektor nie ma ich skąd znać.
   */
  wPrzyjeciach: boolean;
  linesTotal: number;
  linesDone: number;
  status: string | null;
}

export interface DeliveryLineView {
  id: number;
  twId: number;
  sym: string;
  name: string;
  qtyDoc: number;
  qtyDone: number;
  /**
   * Jednostka z kartoteki (`szt.`, `kpl.`, `par`). Pusta = kartoteka jej nie
   * ma; kolektor podstawia wtedy „szt.".
   *
   * Do 0.51.0 tego pola nie było i kolektor wpisywał „szt" na sztywno
   * w dwunastu miejscach — komplet z dokumentu czytało się więc jako sztuki.
   */
  unit: string;
  locExpected: string | null;
  locActual: string | null;
  status: string;
  /**
   * Stan na hali i w przyjęciach — SUROWY, bez korekty o kolejkę i rezerwacje.
   *
   * Przy półce pytanie brzmi „czy tego już tam coś leży", więc liczy się to,
   * co stoi fizycznie. Uwaga przy dostawie krajowej: towar figuruje na MAG od
   * ZAKSIĘGOWANIA dokumentu, więc `stanMag` zawiera już to, co magazynier
   * niesie w rękach — kolektor mówi o tym wprost na ekranie.
   */
  stanMag: number;
  stanMgp: number;
  /** Litera alejki (nagłówek sekcji listy) albo null przy braku lokalizacji. */
  aisle: string | null;
}

export interface DeliveryView {
  id: number;
  dokId: number;
  nrPelny: string;
  dostawca: string;
  dataWyst: string;
  status: string;
  /** `problems` ⊂ `done` — linie wyjęte z rutyny przez zgłoszony wyjątek (D8). */
  progress: { total: number; done: number; remaining: number; problems: number };
  /**
   * Przesyłka — pytana RAZ na dostawę, więc kolektor musi wiedzieć, czy już
   * pytał. Trzymanie tego wyłącznie w pamięci ekranu znaczyłoby, że restart
   * aplikacji pyta drugi raz o to samo.
   */
  nrPrzesylki: string | null;
  /** `tak` / `nie` / null (nie pytano) — trzy stany, nie dwa. */
  kurierProtokol: string | null;
  /**
   * Notatki biura do tego dokumentu (0.43.0), od najstarszej.
   *
   * Jadą z widokiem dostawy, a nie osobnym żądaniem: pytanie o dosłany brak
   * ma stać przed oczami TAM, gdzie rozkłada się towar, i od pierwszej klatki.
   * Notatka bez odpowiedzi blokuje domknięcie dostawy — także to samoczynne
   * po ostatniej pozycji.
   */
  notatki: Notatka[];
  /**
   * Magazyn skutku, snapshotowany przy otwarciu — ale TYLKO gdy nie jest halą.
   * `null` znaczy wprost „nie ma czego przesuwać", więc kolektor nie musi znać
   * identyfikatorów z konfiguracji serwera, żeby ukryć skrót „PRZESUŃ".
   */
  sourceMagId: number | null;
  lines: DeliveryLineView[];
}

/** Kandydat przy niejednoznacznym kodzie kreskowym (D7). */
export interface EanCandidate {
  twId: number;
  sym: string;
  name: string;
  inDocument: boolean;
  qtyDoc: number | null;
  /** Jednostka z kartoteki — kandydat pokazuje ilość z dokumentu. */
  unit: string;
  locExpected: string | null;
}

/** Wynik skanu towaru w kontekście dostawy. */
export type ScanResolution =
  | { kind: "line"; line: DeliveryLineView }
  | { kind: "conflict"; code: string; candidates: EanCandidate[] }
  | { kind: "off_document"; code: string; twId: number; sym: string; name: string }
  | { kind: "unknown"; code: string };

/* ── Faza 2: wyjątki (D8) ───────────────────────────────────────────────── */

/**
 * Kategoria niezgodności. Pięć pierwszych to lista z firmowego formularza
 * „Niezgodność w dostawie" — tylko je wolno zgłosić. Pięć kolejnych zostało po
 * wyjątkach sprzed 0.21.0: są w bazie, więc muszą mieć nazwę, ale formularz
 * ich nie zna.
 */
export type ProblemType =
  | "wrong_item"
  | "missing_item"
  | "damaged"
  | "qty_mismatch"
  | "extra_item"
  | "qty_short"
  | "qty_over"
  | "no_space"
  | "unknown_barcode"
  | "ean_conflict";

export interface ProblemView {
  id: number;
  deliveryId: number | null;
  lineId: number | null;
  typ: string;
  /** Etykieta typu po polsku — żeby klient nie musiał trzymać własnego słownika. */
  typLabel: string;
  qty: number | null;
  /** Numer katalogowy artykułu spoza dokumentu (`wrong_item`, `extra_item`). */
  symObcy: string | null;
  /** Ile miało przyjść tego, co zamówiono, a nie dostarczono (`wrong_item`). */
  zamiastIlosc: number | null;
  /** Ilość z dokumentu w chwili zgłoszenia — snapshot, nie odczyt na żywo. */
  qtyDok: number | null;
  opis: string | null;
  hasPhoto: boolean;
  createdAt: string;
  createdBy: string | null;
  resolvedAt: string | null;
  resolvedNote: string | null;
  /** Kontekst do listy „nierozwiązane" — bez wchodzenia w dostawę. */
  docNumber: string | null;
  sym: string | null;
  name: string | null;
  /** Jednostka z kartoteki — wyjątek niesie ilość, więc musi ją podpisać. */
  unit: string;
}

/** Wybór operatora przy skanie innej półki niż oczekiwana (§4.3). */
export type LocApplyAction = "add" | "replace";
