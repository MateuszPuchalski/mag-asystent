import { config } from "../config.js";
import { db as defaultDb, transaction, type Db } from "../db/db.js";
import { logEvent } from "./events.js";
import {
  TAGI_REKLAMACJI, tagiSprawy, tagiWszystkichSpraw, type TagSprawy,
} from "./tagi-spraw.js";
import { listaZwrotow, type WierszZwrotu } from "./zwroty.js";
import { kartaSprawy } from "./copilot-reklamacja.js";
import { kartotekaOferty } from "./dopasowanie-sku.js";
import { linkOferty, linkReklamacji, linkZamowienia } from "./allegro-linki.js";
import { zamowienieRozmowy, type Zamowienie } from "./zamowienia.js";
import { przesylkaZamowienia, type StanPrzesylkiZamowienia } from "./przesylka-zamowienia.js";
import { drogaZakupu, sprawyZakupu, type PrzystanekDrogi, type SprawaZakupu }
  from "./droga-klienta.js";
import { stanZdjeciaOferty, type StanZdjeciaOferty } from "./zdjecia-ofert.js";
import { STATUSY_KONCOWE } from "./statusy-spraw.js";

/* ── Reklamacje klienckie — model pracy biura (0.222.0) ──────────────────────
   TEN PLIK PROWADZI WYŁĄCZNIE REKLAMACJE (`typ = 'CLAIM'`) i od 0.245.0 musi
   to mówić KAŻDYM zapytaniem. Do 0.244.0 dyskusje nie docierały do bazy, bo
   odsiewał je synchronizator, więc zapytanie bez warunku było bezpieczne.
   Po zdjęciu tamtego filtru `reklamacja_klienta` trzyma oba rodzaje spraw
   i pominięcie warunku pokazałoby dyskusję w kolejce reklamacji — z pustym
   paskiem werdyktu i pustą kolumną terminu.

   To jest dokładnie blizna 0.121.0: „CLAIM miał tę samą plakietkę co zwykła
   dyskusja". Pilnuje tego strażnik w `dyskusje.test.ts`, który czyta ŹRÓDŁO
   tego pliku i wymaga warunku na `typ` przy każdym `FROM reklamacja_klienta`.
   Dyskusje prowadzi `services/dyskusje.ts`.

   ZEGAR CZYTAMY, NIE LICZYMY. `decisionDueDate` z Allegro jest terminem na
   uznanie albo odrzucenie reklamacji. Implementacja skasowana w 0.140.0
   liczyła ustawowe czternaście dni SAMA, bo komentarz obok mówił, że Allegro
   żadnego zegara nie oddaje — i było to nieprawdą już wtedy. Liczba wzięta
   z naszego kodu rozjeżdżałaby się z tą, którą widzi kupujący, a rozstrzyga
   jego.

   KUBEŁEK NIE JEST KOLUMNĄ. Wynika ze statusu Allegro i ze stanu rozmowy,
   więc liczy go ten plik. Zdenormalizowany rozjechałby się z pierwszym
   przebiegiem synchronizacji, który go zapomni.                            */

/** Awaria pracy z reklamacją; `kod` niesie status HTTP dla trasy. */
export class BladReklamacji extends Error {
  constructor(message: string, readonly kod = 400) {
    super(message);
    this.name = "BladReklamacji";
  }
}

/**
 * Konflikt 409 — panel dostaje ładunek i pokazuje, co się zmieniło.
 *
 * Zdanie jest PARAMETREM od 0.224.0, bo powodów jest kilka i każdy każe co
 * innego zrobić: cudza zmiana rekordu (odśwież), dopisek klienta albo doradcy
 * (przeczytaj i zdecyduj), zamknięta rozmowa (nie da się już nic wysłać).
 * Jedno zdanie na wszystkie trzy kazałoby agentowi zgadywać, na co patrzy.
 */
export class ReklamacjaConflict extends Error {
  constructor(
    readonly szczegoly: Record<string, unknown>,
    message = "Reklamacja zmieniła się, odkąd ją otworzyłeś — odśwież i spróbuj jeszcze raz",
  ) {
    super(message);
    this.name = "ReklamacjaConflict";
  }
}

/**
 * Kubełki kolejki reklamacji — jedno pytanie na kubełek (dekalog, punkt 5).
 *
 * `bez_ruchu` doszedł jako czwarty na zgłoszenie właściciela „w kolejce
 * pojawiają mi się stare reklamacje". Kubełek, a NIE ukrycie: sprawa martwa
 * ma zejść z pracy, ale zniknięcie z kolejki musi mieć widoczne uzasadnienie
 * i własny licznik — ta sama reguła co przy zwrotach rozliczonych (0.339.0).
 */
export type Kubelek = "decyzja" | "odpowiedz" | "zamknieta" | "bez_ruchu";

/**
 * Rodzaj sprawy posprzedażowej — rozróżnik kolumny `typ`.
 *
 * Allegro trzyma dyskusje i reklamacje pod jednym zasobem `/sale/issues`
 * i pod jedną przestrzenią identyfikatorów, więc trzyma je też jedna tabela.
 * Ten typ jest jedynym, co je w kodzie rozdziela — i dlatego stoi w sygnaturze
 * każdej funkcji, która sięga do tabeli po identyfikatorze.
 */
export type TypSprawy = "CLAIM" | "DISPUTE";

/** Nazwa rodzaju sprawy w zdaniu błędu; kod w komunikacie nie jest komunikatem. */
export const NAZWA_SPRAWY: Record<TypSprawy, string> = {
  CLAIM: "Reklamacja",
  DISPUTE: "Dyskusja",
};

export type Sygnal =
  | "termin"
  | "klient_czeka"
  | "doradca"
  | "czat_zamkniety"
  | "zwrot_wymagany"
  | "status_nieznany"
  /* ── Werdykt z panelu (przyrost trzeci) ──────────────────────────────────
     Trzy sygnały o LOSIE naszego werdyktu, bo `status_allegro` należy do
     Allegro i mówi o nim dopiero po synchronizacji. */
  /** Wysłany, a Allegro jeszcze nie pokazuje `CLAIM_*` — albo los niepewny. */
  | "werdykt_niepotwierdzony"
  /** Allegro odmówiło kodem; wolno spróbować raz jeszcze. */
  | "werdykt_nieudany"
  /** Uznana u nas, a nikt nie powiedział kupującemu, czy odsyłać towar. */
  | "towar_do_decyzji";

/** Losy próby werdyktu — te same cztery, co `reklamacja_outbox.status`. */
export type StatusWerdyktu = "sending" | "sent" | "send_uncertain" | "send_failed";

/** Losy, przy których werdykt UZNAJEMY za wydany: poszedł albo mógł pójść. */
const WERDYKT_WYDANY: readonly string[] = ["sent", "send_uncertain"];

/**
 * Statusy, które ZNAMY ze specyfikacji (`PostPurchaseIssueStatus`).
 *
 * Wartość spoza tej listy NIE JEST BŁĘDEM: nie wywraca przebiegu i nie znika
 * z ekranu, tylko zapala sygnał. To jest mechanizm weryfikacji listy na żywym
 * koncie, a nie ozdoba — poprzednia implementacja miała go i był dobry.
 */
export const STATUSY_ALLEGRO = [
  "DISPUTE_CLOSED", "DISPUTE_ONGOING", "DISPUTE_UNRESOLVED",
  "CLAIM_SUBMITTED", "CLAIM_ACCEPTED", "CLAIM_REJECTED",
] as const;

/**
 * Statusy końcowe — po nich biuro nie ma już decyzji do podjęcia.
 *
 * `DISPUTE_CLOSED` dołożony jako OSŁONA, nie jako naprawa, i różnica jest
 * istotna. Enum `PostPurchaseIssueStatus` jest JEDEN dla obu rodzajów spraw,
 * a `type` ma dwie wartości (`DISPUTE`, `CLAIM`), więc reklamacja nie powinna
 * nosić statusu dyskusji i prawdopodobnie żaden wiersz tego nie robi. Trzecia
 * wartość stała jednak w SQL-u doboru rozmów (`allegro-reklamacje-sync.ts`)
 * od 0.273.0, a dwie listy końcowe przepisane ręcznie w dwóch plikach to
 * jedna lista za dużo: przy następnej zmianie rozjadą się w ciszy.
 */
/* Lista zeszła do `statusy-spraw.ts`, bo spoiwo kolejek pyta o to samo.
   Re-eksport zostaje, żeby importy czytające ją stąd dalej działały. */
export { STATUSY_KONCOWE };

/**
 * Statusy, które POTWIERDZAJĄ nasz werdykt — węższe niż końcowe i to jest
 * świadome.
 *
 * `werdykt_niepotwierdzony` pyta „czy Allegro przyjęło TO, co wysłaliśmy".
 * `DISPUTE_CLOSED` nie odpowiada na to pytanie: mówi, że spór zamknięto,
 * a nie że uznano albo odrzucono reklamację. Jedna stała na oba znaczenia
 * gasiłaby sygnał bez pokrycia — czyli kłamała na ekranie.
 */
const POTWIERDZAJA_WERDYKT: readonly string[] = ["CLAIM_ACCEPTED", "CLAIM_REJECTED"];

/**
 * Werdykt po polsku — zdanie pisze SERWER, panel nie tłumaczy kodów. Kod
 * spoza mapy wraca goły (`werdyktNazwa` = kod), a nie znika: kolumna ma
 * `CHECK` z jedenastoma wartościami, więc to gałąź na nowy schemat Allegro.
 */
export const NAZWA_WERDYKTU: Record<string, string> = {
  ACCEPTED_REPAIR: "Uznana — naprawa",
  ACCEPTED_REFUND: "Uznana — zwrot pieniędzy",
  ACCEPTED_EXCHANGE: "Uznana — wymiana",
  ACCEPTED_PARTIAL_REFUND: "Uznana — częściowy zwrot pieniędzy",
  REJECTED_ADDITIONAL_REQUIREMENTS_NOT_COMPLETED: "Odrzucona — kupujący nie spełnił dodatkowych wymagań",
  REJECTED_PRODUCT_NOT_RETURNED: "Odrzucona — towar nie wrócił",
  REJECTED_PRODUCT_DAMAGED_BY_USER: "Odrzucona — uszkodzenie z winy użytkownika",
  REJECTED_PRODUCT_CONFORMS_TO_CONTRACT: "Odrzucona — towar zgodny z umową",
  REJECTED_MINOR_DEFECT: "Odrzucona — wada nieistotna",
  REJECTED_OTHER: "Odrzucona — inny powód",
  REJECTED_CLAIM_WITHDRAWN_BY_BUYER: "Odrzucona — kupujący wycofał reklamację",
};

/** Statusy ostatniej wiadomości, przy których ruch należy do nas. */
const CZEKA_NA_NAS = ["NEW", "BUYER_REPLIED"];

/** Ile dni przed terminem decyzji wiersz zapala się na czerwono. */
const PROG_TERMINU_DNI = 3;

/**
 * Ile dni PO terminie sprawa przestaje być pracą, a staje się archiwum.
 *
 * TRZYDZIEŚCI, i ta liczba ma być hojna. Termin decyzji minął, więc zegar
 * i tak już nic nie mierzy; jedyne, co ta liczba chroni, to sprawa, którą
 * biuro właśnie prowadzi mimo spóźnienia. Miesiąc wystarczy każdemu urlopowi.
 */
const PROG_BEZ_RUCHU_DNI = 30;

/**
 * Po ilu dniach milczenia „klient czeka" przestaje być prawdą (0.407.0).
 *
 * ZGŁOSZENIE WŁAŚCICIELA ZE ZRZUTEM: „widzę sporo reklamacji, które w naszej
 * aplikacji pokazuje, że klient czeka, a w Allegro są już dawno rozwiązane".
 * Na tamtym ekranie kubełek DO ODPOWIEDZI liczył dwadzieścia dziewięć spraw,
 * a pierwsza z nich wyglądała tak: reklamacja uznana 28 lipca, wymiana
 * zaproponowana, kupujący odpisał 1 sierpnia „Ok. Pozdrawiam." — i przez
 * czterdzieści dziewięć dni czekał w kolejce roboczej na odpowiedź, której
 * nikt nie miał mu dać.
 *
 * DLACZEGO ZEGAR, A NIE TREŚĆ. „Ok. Pozdrawiam." nie wymaga niczego, a „ale
 * przysłaliście znowu nie ten" wymaga wszystkiego — i z pola
 * `chat.lastMessage.status` nie da się ich odróżnić, bo oba są
 * `BUYER_REPLIED`. Odróżnia je za to CZAS: nikt nie czeka dwóch tygodni na
 * odpowiedź, której potrzebuje. Rozstrzygnięta sprawa sprzed dwóch tygodni to
 * grzeczność bez odpowiedzi, nie dług biura.
 *
 * CZTERNAŚCIE, nie trzydzieści jak przy `bezRuchu`. Tamten próg chroni sprawę
 * NIEROZSTRZYGNIĘTĄ, czyli taką, w której naprawdę zostało coś do zrobienia,
 * i dlatego ma być hojny. Tutaj werdykt już zapadł, więc jedyne, co próg
 * chroni, to dopisek kupującego PO decyzji — a na taki odpisuje się w dni,
 * nie w miesiące.
 *
 * SPRAWA NIE ZNIKA, tylko schodzi do ROZSTRZYGNIĘTYCH, a sygnał
 * `klient_czeka` zostaje przy wierszu niezależnie od kubełka (patrz
 * `sygnaly`). Biuro przeglądające tamten kubełek dalej widzi flagę — zmienia
 * się to, czy sprawa liczy się do pracy na dziś.
 */
const PROG_ODPOWIEDZI_DNI = 14;

const DZIEN_MS = 86_400_000;

export interface ZalacznikReklamacji {
  id: number;
  wiadomoscId: number | null;
  nazwa: string;
  /**
   * Czy warto próbować pokazać go na osi. PODPOWIEDŹ, nie prawda.
   *
   * `PostPurchaseIssueAttachment` ma DWA pola — `fileName` i `url` — więc ani
   * typu MIME, ani stanu `SAFE` nie znamy. Rozstrzygnąć da się to wyłącznie
   * po BAJTACH, a bajty ma dopiero trasa podglądu. Ta flaga decyduje o
   * UKŁADZIE (kafel czy przycisk), a bajty decydują o wydaniu: plik, którego
   * nazwa kłamie, dostaje 415 i zostaje przy pobieraniu.
   */
  podglad: boolean;
}

/**
 * Czy nazwa pliku obiecuje obraz, który przeglądarka narysuje.
 *
 * Cztery rozszerzenia z `TYPY_PODGLADU`: `jpeg`, `png`, `gif` i `webp`.
 * `bmp` i `tiff` przeglądarki rysują nierówno albo wcale, więc zostają przy
 * pobieraniu. `webp` doszedł razem z sygnaturą w `rozpoznajMime` — od tego
 * wydania tę samą podpowiedź czyta też skrzynka, gdy Allegro nie podało
 * `mimeType`, a tam zdjęcia z Androida bywają właśnie WebP. To nie jest
 * awaria, tylko odpowiedź; rozstrzygają i tak BAJTY na trasie podglądu.
 */
export const czyObrazZNazwy = (nazwa: string | null | undefined): boolean =>
  /\.(jpe?g|png|gif|webp)$/i.test((nazwa ?? "").trim());

export interface WiadomoscReklamacji {
  id: number;
  externalId: string;
  autorLogin: string | null;
  /** BUYER, SELLER, ADMIN, SYSTEM albo FULFILLMENT. Doradca Allegro to ADMIN. */
  autorRola: string | null;
  tresc: string;
  utworzonoAt: string | null;
  zalaczniki: ZalacznikReklamacji[];
}

export interface WierszReklamacji {
  id: number;
  externalId: string;
  numer: string | null;
  orderId: string | null;
  offerId: string | null;
  kupujacyLogin: string | null;
  prawo: string | null;
  powodTyp: string | null;
  powodOpis: string | null;
  temat: string | null;
  opis: string | null;
  oczekiwanie: string | null;
  oczekiwanaKwotaGrosze: number | null;
  waluta: string;
  statusAllegro: string | null;
  decyzjaDo: string | null;
  /** `null` znaczy „Allegro terminu nie podało" — to co innego niż „minął". */
  dniDoTerminu: number | null;
  poTerminie: boolean;
  zwrotWymagany: boolean | null;
  czatAktywny: boolean;
  wiadomosciIle: number;
  /** Czy rozmowę urwał NASZ bezpiecznik stron (0.273.0) — patrz `czat_urwany`. */
  czatUrwany: boolean;
  ostatniaWiadomoscStatus: string | null;
  ostatniaWiadomoscAt: string | null;
  otwartoAt: string;
  /* ── Kiedy to kupiono (0.282.0) ──────────────────────────────────────────
     DWA ŹRÓDŁA I JEDNA ETYKIETA BYŁABY KŁAMSTWEM. `zrodlo: "zamowienie"`
     znaczy `LineItem.boughtAt` z pełnego zamówienia — kanoniczna data zakupu.
     `zrodlo: "sprawa"` znaczy `checkoutForm.createdAt` z ładunku reklamacji,
     czyli moment złożenia koszyka; bywa wcześniejszy, gdy koszyk zbierano
     kilka dni. Ekran nazywa je różnie, bo to różne zegary — blizna 0.121.0
     wzięła się z nazwania jednego drugim. */
  kupionoAt: string | null;
  kupionoZrodlo: "zamowienie" | "sprawa" | null;
  /* ── WIEK ZAKUPU (0.413.0) ───────────────────────────────────────────────
     Ta sama zamiana, co przy terminie w 0.121.0: odjęcie jednej daty od
     drugiej w głowie to praca, którą kolumna ma zdjąć. Przy reklamacji ta
     liczba rozstrzyga więcej niż sama data — rękojmia biegnie dwa lata od
     wydania rzeczy (art. 568 k.c.), a „usterka wyszła w użyciu" po trzech
     dniach i po dwudziestu miesiącach to dwie różne sprawy.

     LICZYMY, NIE OCENIAMY: ekran podaje wiek, a nie werdykt „po rękojmi".
     Zegar bywa `sprawa` zamiast `zamowienie` (patrz `kupionoZrodlo`), a data
     wydania rzeczy jest jeszcze późniejsza od obu — wyrok z takiej podstawy
     byłby zgadywaniem pod formalnym pozorem. */
  dniOdZakupu: number | null;
  prowadzi: string | null;
  /** Tożsamość prowadzącego — po NIEJ liczy się filtr „Moje" (0.278.0). */
  prowadziId: number | null;
  prowadziAt: string | null;
  /** Tagi biura (0.279.0). Zawężają listę, NIGDY nie przestawiają kolejki. */
  tagi: TagSprawy[];
  notatka: string | null;
  /* ── Droga powrotna z notatki (0.280.0) ──────────────────────────────────
     Poprzedniej TREŚCI panel nie dostaje — wystarcza mu wiedza, że jest do
     czego wracać. Cofnięcie jest zamianą, więc drugie kliknięcie i tak
     przywraca stan sprzed pierwszego. */
  notatkaAt: string | null;
  notatkaPrzez: string | null;
  maPoprzedniaNotatke: boolean;
  /* ── Werdykt z panelu (przyrost trzeci) — NASZ, nie `statusAllegro` ───────
     `null` w `werdykt` przy `CLAIM_ACCEPTED` znaczy „rozstrzygnięte poza
     panelem" i to jest informacja, nie brak. */
  werdykt: string | null;
  werdyktNazwa: string | null;
  werdyktStatus: StatusWerdyktu | null;
  werdyktWiadomosc: string | null;
  werdyktKwotaGrosze: number | null;
  werdyktAt: string | null;
  werdyktPrzez: string | null;
  werdyktBlad: string | null;
  /** Krok „towar do odesłania?" — decyzja lokalna; `zwrotWymagany` ją potwierdza. */
  zwrotTowaru: "wymagany" | "niewymagany" | null;
  zwrotTowaruAt: string | null;
  /** `offer.quantity` — sufit częściowego zwrotu, gdy klient nie podał kwoty. */
  ilosc: number | null;
  wersja: number;
  kubelek: Kubelek;
  sygnaly: Sygnal[];
  /* Odnośniki do Allegro. `null` znaczy „nie ma czego linkować" i ekran
     pokazuje wtedy sam tekst, a nie odnośnik prowadzący donikąd. */
  link: string | null;
  linkZamowienia: string | null;
  linkOferty: string | null;
  /* ── Co widać na wierszu (0.223.0) ────────────────────────────────────────
     Reklamacja dotyczy JEDNEJ oferty, więc obraz jest tu tożsamością sprawy,
     a nie ozdobą: „pękła obudowa" przy zdjęciu kosiarki czyta się w biegu,
     a przy samym numerze wymaga otwarcia sprawy. */
  ofertaNazwa: string | null;
  /** Trzy stany, jak przy zwrocie od 0.214.0: `jest`, `brak`, `nieznane`. */
  ofertaZdjecie: StanZdjeciaOferty;
  /** Kartoteka POTWIERDZONA (`oferta_kartoteka`); propozycję liczy szczegół. */
  twId: number | null;
  twSymbol: string | null;
  /* ── SKĄD JEST TA SYGNATURA (0.403.0) ──────────────────────────────────────
     Paragon i dzisiejsze mapowanie oferty bywają RÓŻNE — to cała treść
     0.400.0. Do tego wydania panel dostawał wynik bez źródła, więc pisał
     „W09-0804" bez różnicy, czy to sygnatura z chwili zakupu, czy z półki.
     Agent czytający wiersz towaru ma prawo wiedzieć, czemu ufa. */
  twZParagonu: boolean;
}

type Wiersz = Record<string, unknown>;

const tekst = (v: unknown): string | null =>
  typeof v === "string" && v.trim() !== "" ? v : null;

/**
 * Dni do terminu decyzji — czysta arytmetyka, osobno od bazy.
 *
 * Ujemna liczba znaczy „po terminie". `null` na wejściu daje `null` na
 * wyjściu, bo brak terminu to brak liczby — a zero kłamałoby, że decyzja
 * przypada dziś.
 */
export function dniDoTerminu(termin: string | null, teraz = Date.now()): number | null {
  if (!termin) return null;
  const t = Date.parse(termin);
  if (!Number.isFinite(t)) return null;
  return Math.floor((t - teraz) / DZIEN_MS);
}

/**
 * Kubełek reklamacji — jedno pytanie na kubełek (dekalog, punkt 5).
 *
 * DO DECYZJI trzyma WSZYSTKO, co czeka na uznanie albo odrzucenie, także te
 * sprawy, w których klient właśnie coś dopisał. Obowiązek wobec terminu jest
 * jeden i to on rządzi kolejnością pracy; „klient czeka" jest przy takim
 * wierszu SYGNAŁEM, a nie osobną kolejką. Przeniesienie go do DO ODPOWIEDZI
 * zaniżyłoby licznik spraw z zegarem — czyli jedyną liczbę, dla której ten
 * ekran powstał.
 */
/**
 * Czy sprawa jest rozstrzygnięta — przez Allegro ALBO przez nas.
 *
 * Werdykt człowieka z panelu przebija wyliczenie ze statusu: po „WYŚLIJ
 * WERDYKT" sprawa ma zniknąć z DO DECYZJI od razu, a nie za takt
 * synchronizacji — inaczej dwie osoby przy dwóch biurkach widziałyby ją
 * jako otwartą jeszcze przez minutę. `send_uncertain` liczy się jak wydany:
 * żądanie mogło dojść, a drugiego strzału i tak nie oddamy.
 */
export const rozstrzygnieta = (w: {
  statusAllegro: string | null; werdyktStatus?: StatusWerdyktu | null;
}): boolean =>
  (STATUSY_KONCOWE as readonly string[]).includes(w.statusAllegro ?? "")
  || WERDYKT_WYDANY.includes(w.werdyktStatus ?? "");

/**
 * Sprawa BEZ RUCHU — nierozstrzygnięta, a zrobić się w niej nie da nic.
 *
 * KONIUNKCJA I OBIE CZĘŚCI SĄ POTRZEBNE. `chatActive: false` znaczy, że
 * Allegro nie przyjmie już wiadomości w tej sprawie (schemat: „Sending of new
 * messages for this issue is inactive"), więc rozmowy nie ma jak prowadzić.
 * Sam ten fakt nie wystarcza: sprawa z zamkniętym czatem i świeżym terminem
 * nadal czeka na WERDYKT, a werdykt nie jest wiadomością. Dopiero termin
 * przeterminowany o miesiąc mówi, że i tego nikt nie wyda.
 *
 * SPRAWA Z ŻYWYM CZATEM ZOSTAJE W DO DECYZJI NIEZALEŻNIE OD WIEKU. Da się
 * w niej odpisać, więc jest pracą — a kubełek, który chowa pracę, jest gorszy
 * od kolejki, która pokazuje za dużo.
 *
 * `decyzja_do IS NULL` liczy się jak termin miniony: przy reklamacji brak
 * terminu znaczy „Allegro go nie podało" (schemat dopuszcza `null` i mówi
 * wprost „Null for disputes"), a nie „termin jest odległy". Sprawa bez zegara
 * i bez czatu nie ma czym wrócić do pracy.
 */
const bezRuchu = (w: { czatAktywny: boolean; dniDoTerminu: number | null }): boolean =>
  !w.czatAktywny && (w.dniDoTerminu === null || w.dniDoTerminu < -PROG_BEZ_RUCHU_DNI);

/**
 * Ile dni milczy ostatnia wiadomość. `null` = nie wiadomo, czyli nie mierzymy.
 *
 * Brak daty czytamy jak świeżość, nie jak starość: sprawa bez znacznika czasu
 * ma zostać w kolejce roboczej, bo wycięcie jej stamtąd na podstawie braku
 * wiedzy byłoby schowaniem pracy.
 */
export function dniMilczenia(ostatniaAt: string | null, teraz = Date.now()): number | null {
  if (!ostatniaAt) return null;
  const t = Date.parse(ostatniaAt);
  if (!Number.isFinite(t)) return null;
  return Math.floor((teraz - t) / DZIEN_MS);
}

/**
 * Ile dni od zakupu. `null` = nie wiadomo, czyli nie mierzymy.
 *
 * ODWROTNY KIERUNEK NIŻ `dniDoTerminu` i dlatego OSOBNA funkcja, a nie ta sama
 * ze znakiem minus: tamta liczy, ile czasu ZOSTAŁO, ta — ile MINĘŁO. Jedna
 * funkcja na oba znaczenia kazałaby czytać liczbę ujemną raz jako „po
 * terminie", raz jako „kupione w przyszłości".
 *
 * Data z przyszłości daje zero, nie liczbę ujemną: zegar sprzedawcy bywa
 * przestawiony o kilka godzin, a „kupione −1 dnia temu" nie znaczy nic.
 */
export function dniOdZakupu(kupionoAt: string | null, teraz = Date.now()): number | null {
  if (!kupionoAt) return null;
  const t = Date.parse(kupionoAt);
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Math.floor((teraz - t) / DZIEN_MS));
}

/**
 * Czy „klient czeka" jest JESZCZE PRAWDĄ (0.407.0).
 *
 * JEDEN PREDYKAT, DWÓCH WOŁAJĄCYCH — kubełek i plakietka. Do tego wydania
 * każde z nich liczyło to samo po swojemu i oba były tak samo nieprawdziwe
 * po dwóch miesiącach. Gdyby reguła stała w dwóch miejscach, poprawka
 * jednego z nich zostawiłaby drugie kłamiące dalej.
 *
 * SPRAWA NIEROZSTRZYGNIĘTA CZEKA ZAWSZE, bez względu na wiek: obok niej stoi
 * termin decyzji, który i tak rządzi kolejnością pracy, a dopisek kupującego
 * jest wtedy częścią sprawy do rozstrzygnięcia, nie grzecznością po niej.
 */
export function klientCzeka(w: {
  statusAllegro: string | null;
  ostatniaWiadomoscStatus: string | null;
  ostatniaWiadomoscAt?: string | null;
  werdyktStatus?: StatusWerdyktu | null;
}, teraz = Date.now()): boolean {
  if (!CZEKA_NA_NAS.includes(w.ostatniaWiadomoscStatus ?? "")) return false;
  if (!rozstrzygnieta(w)) return true;
  const milczy = dniMilczenia(w.ostatniaWiadomoscAt ?? null, teraz);
  return milczy === null || milczy <= PROG_ODPOWIEDZI_DNI;
}

export function kubelek(w: {
  statusAllegro: string | null;
  ostatniaWiadomoscStatus: string | null;
  ostatniaWiadomoscAt?: string | null;
  czatAktywny: boolean;
  dniDoTerminu: number | null;
  werdyktStatus?: StatusWerdyktu | null;
}, teraz = Date.now()): Kubelek {
  if (!rozstrzygnieta(w)) return bezRuchu(w) ? "bez_ruchu" : "decyzja";
  /* Rozstrzygnięta, ale rozmowa trwa i ostatnie słowo było klienta. Werdykt
     zapadł, a człowiek po drugiej stronie nadal czeka na zdanie —
     DOPÓKI to czekanie jest prawdziwe, patrz `PROG_ODPOWIEDZI_DNI`. */
  if (w.czatAktywny && klientCzeka(w, teraz)) return "odpowiedz";
  return "zamknieta";
}

export function sygnaly(w: {
  statusAllegro: string | null;
  dniDoTerminu: number | null;
  ostatniaWiadomoscStatus: string | null;
  ostatniaWiadomoscAt?: string | null;
  czatAktywny: boolean;
  zwrotWymagany: boolean | null;
  werdykt?: string | null;
  werdyktStatus?: StatusWerdyktu | null;
  zwrotTowaru?: string | null;
}, teraz = Date.now()): Sygnal[] {
  const s: Sygnal[] = [];
  const otwarta = !rozstrzygnieta(w);
  if (otwarta && w.dniDoTerminu !== null && w.dniDoTerminu <= PROG_TERMINU_DNI) s.push("termin");
  /* Los naszego werdyktu. „Niepotwierdzony" trwa, dopóki `status_allegro`
     nie pokaże gałęzi końcowej — potwierdza synchronizacja, nie my. */
  const wydany = WERDYKT_WYDANY.includes(w.werdyktStatus ?? "");
  if (wydany && !POTWIERDZAJA_WERDYKT.includes(w.statusAllegro ?? "")) s.push("werdykt_niepotwierdzony");
  if (w.werdyktStatus === "send_failed") s.push("werdykt_nieudany");
  /* Uznana u nas, a stanowisko o towarze nie wyszło ani od nas, ani — sądząc
     po `returnRequired` — z Centrum Sprzedaży. Sygnał, nie kubełek: to jest
     drugi krok tej samej sprawy, a nie osobna kolejka. */
  if (wydany && (w.werdykt ?? "").startsWith("ACCEPTED") && !w.zwrotTowaru && w.zwrotWymagany === null) {
    s.push("towar_do_decyzji");
  }
  /* Ta sama reguła, co przy kubełku: po dwóch tygodniach milczenia w sprawie
     ROZSTRZYGNIĘTEJ plakietka kłamałaby tak samo jak kolejka. */
  if (klientCzeka(w, teraz)) s.push("klient_czeka");
  /* Doradca Allegro odpisał w 61 sprawach na 100 w sondzie — to jest przypadek
     typowy, nie brzegowy, i zmienia ton odpowiedzi: w rozmowie jest trzecia
     strona, która czyta wszystko. */
  if (w.ostatniaWiadomoscStatus === "ALLEGRO_ADVISOR_REPLIED") s.push("doradca");
  if (!w.czatAktywny) s.push("czat_zamkniety");
  if (w.zwrotWymagany === true) s.push("zwrot_wymagany");
  if (w.statusAllegro && !(STATUSY_ALLEGRO as readonly string[]).includes(w.statusAllegro)) {
    s.push("status_nieznany");
  }
  return s;
}

function zWiersza(w: Wiersz, teraz: number): WierszReklamacji {
  const statusAllegro = tekst(w.status_allegro);
  const decyzjaDo = tekst(w.decyzja_do);
  const dni = dniDoTerminu(decyzjaDo, teraz);
  const czatAktywny = Number(w.czat_aktywny ?? 1) === 1;
  const ostatnia = tekst(w.ostatnia_wiadomosc_status);
  const zwrotWymagany = w.zwrot_wymagany == null ? null : Number(w.zwrot_wymagany) === 1;
  const werdykt = tekst(w.werdykt);
  const werdyktStatus = tekst(w.werdykt_status) as StatusWerdyktu | null;
  const zwrotTowaru = tekst(w.zwrot_towaru) as "wymagany" | "niewymagany" | null;
  const kupiono = tekst(w.kupiono_at) ?? tekst(w.zamowienie_at);
  const rdzen = {
    statusAllegro, dniDoTerminu: dni, ostatniaWiadomoscStatus: ostatnia,
    ostatniaWiadomoscAt: tekst(w.ostatnia_wiadomosc_at),
    czatAktywny, zwrotWymagany, werdykt, werdyktStatus, zwrotTowaru,
  };
  return {
    id: Number(w.id),
    externalId: String(w.external_id),
    numer: tekst(w.reference_number),
    orderId: tekst(w.order_id),
    offerId: tekst(w.offer_id),
    kupujacyLogin: tekst(w.kupujacy_login),
    prawo: tekst(w.prawo),
    powodTyp: tekst(w.powod_typ),
    powodOpis: tekst(w.powod_opis),
    temat: tekst(w.temat),
    opis: tekst(w.opis),
    oczekiwanie: tekst(w.oczekiwanie),
    oczekiwanaKwotaGrosze: w.oczekiwana_kwota_grosze == null
      ? null : Number(w.oczekiwana_kwota_grosze),
    waluta: String(w.waluta ?? "PLN"),
    statusAllegro,
    decyzjaDo,
    dniDoTerminu: dni,
    poTerminie: dni !== null && dni < 0,
    zwrotWymagany,
    czatAktywny,
    wiadomosciIle: Number(w.wiadomosci_ile ?? 0),
    czatUrwany: Number(w.czat_urwany ?? 0) === 1,
    ostatniaWiadomoscStatus: ostatnia,
    ostatniaWiadomoscAt: tekst(w.ostatnia_wiadomosc_at),
    otwartoAt: String(w.otwarto_at),
    kupionoAt: kupiono,
    kupionoZrodlo: tekst(w.kupiono_at) ? "zamowienie"
      : tekst(w.zamowienie_at) ? "sprawa" : null,
    dniOdZakupu: dniOdZakupu(kupiono, teraz),
    prowadzi: tekst(w.prowadzi),
    prowadziId: w.prowadzi_user_id == null ? null : Number(w.prowadzi_user_id),
    prowadziAt: tekst(w.prowadzi_at),
    /* Puste, dopóki nie dołoży ich wołający. Tagi jadą OSOBNYM zapytaniem,
       bo kolejka bierze je jednym strzałem dla całej listy — zapytanie
       w mapowaniu wiersza dałoby jedno na sprawę. */
    tagi: [],
    notatka: tekst(w.notatka),
    notatkaAt: tekst(w.notatka_at),
    notatkaPrzez: tekst(w.notatka_przez),
    maPoprzedniaNotatke: tekst(w.notatka_poprzednia) !== null,
    werdykt,
    werdyktNazwa: werdykt ? (NAZWA_WERDYKTU[werdykt] ?? werdykt) : null,
    werdyktStatus,
    werdyktWiadomosc: tekst(w.werdykt_wiadomosc),
    werdyktKwotaGrosze: w.werdykt_kwota_grosze == null ? null : Number(w.werdykt_kwota_grosze),
    werdyktAt: tekst(w.werdykt_at),
    werdyktPrzez: tekst(w.werdykt_przez),
    werdyktBlad: tekst(w.werdykt_blad),
    zwrotTowaru,
    zwrotTowaruAt: tekst(w.zwrot_towaru_at),
    ilosc: w.ilosc == null ? null : Number(w.ilosc),
    wersja: Number(w.wersja ?? 1),
    kubelek: kubelek(rdzen, teraz),
    sygnaly: sygnaly(rdzen, teraz),
    /* W ADRESIE STOI UUID, nie numer czytelny (0.226.1). Sprawa ma własną
       stronę `/claims/{uuid}` i adresuje się identyfikatorem zasobu; numer
       `2585498/2026` jest dla CZŁOWIEKA i zostaje etykietą odnośnika. Do
       0.226.0 szło tu odwrotnie i kliknięcie dawało 404. */
    link: linkReklamacji(String(w.external_id)),
    linkZamowienia: linkZamowienia(tekst(w.order_id)),
    linkOferty: linkOferty(tekst(w.offer_id)),
    ofertaNazwa: tekst(w.oferta_nazwa),
    /* Trzy stany, nie dwa (blizna 0.214.0). NULL znaczy „jeszcze nie wiemy" —
       i to samo znaczy BRAK WIERSZA snapshotu przy złączeniu lewym, więc obie
       drogi schodzą się w jednej odpowiedzi. Pusty łańcuch znaczy co innego:
       „snapshot jest, Allegro zdjęcia tej oferty nie ma" — a tego nie naprawi
       żadna synchronizacja. Kafel mówi w każdym z tych przypadków co innego. */
    ofertaZdjecie: stanZdjeciaOferty(w.oferta_zdjecie as string | null | undefined),
    twId: w.tw_id == null ? null : Number(w.tw_id),
    twSymbol: tekst(w.tw_symbol),
    twZParagonu: false,
  };
}

/**
 * Cała kolejka jednym odczytem — od progu daty w górę.
 *
 * Reklamacji W PRACY są dziesiątki, nie tysiące, więc panel dostaje listę
 * w całości i filtruje kubełkiem u siebie — przełączenie kubełka nie kosztuje
 * wtedy ani jednego żądania. Ten sam wybór co przy zwrotach.
 *
 * TO ZDANIE BYŁO NIEPRAWDĄ OD 0.273.0 i stąd wziął się próg. Pełny przelot
 * listy dołożony w tamtym wydaniu zapisuje CAŁE archiwum konta, a to zapytanie
 * nie miało ani filtra statusu, ani okna czasowego, ani limitu — do panelu
 * jechała zawartość całej tabeli. Zgłoszenie właściciela brzmiało „w kolejce
 * pojawiają mi się stare reklamacje" i było opisem dokładnie tego.
 *
 * PORZĄDEK BIERZE SIĘ Z TERMINU DECYZJI, nie z daty wpływu: pytanie biura
 * brzmi „co się dziś przeterminuje", a nie „co przyszło pierwsze". Sprawy bez
 * terminu idą na koniec — nie mają zegara, więc nie mają pilności. Ten porządek
 * był drugą połową problemu: `decyzja_do ASC` stawia termin sprzed pół roku
 * NAD dzisiejszym, więc archiwum lądowało nie gdziekolwiek, tylko na górze.
 *
 * `od` to próg po `otwarto_at`; `null` znaczy „bez progu" i tak wchodzi
 * przełącznik „pokaż starsze" z panelu.
 */
/**
 * Symbol towaru z PARAGONU, nie z dzisiejszego mapowania oferty (0.400.0).
 *
 * Zgłoszenie właściciela: „symbol towaru w reklamacji powinno ściągać
 * z paragonu do danego zamówienia". Do 0.399.0 kolejka i szczegół brały
 * kartotekę z `oferta_kartoteka` — czyli z tego, na co oferta wskazuje DZIŚ.
 * Sprzedawca przepina sygnaturę oferty, gdy towar od jednego dostawcy się
 * wyczerpie, więc reklamacja sprzed miesiąca pokazywała część, której klient
 * nigdy nie dostał.
 *
 * PARAGON BIJE MAPOWANIE, i to jest świadome odwrócenie reguły „za pamięcią
 * stoi decyzja człowieka, więc bije automat". Tamta reguła rozstrzyga, czym
 * JEST oferta; tutaj pytanie brzmi, co klient DOSTAŁ — a to jest fakt
 * zapisany na pozycji zamówienia, nie wniosek. Gdy zamówienia nie mamy
 * pobranego albo pozycja nie niesie sygnatury, zostaje mapowanie jak dotąd.
 *
 * DWA TRAFIENIA TO NIE POWÓD DO WYBRANIA PIERWSZEGO — ta sama zasada, co
 * w `kartotekaPoSku`. Symbol miał być unikalny; skoro nie jest, wiersz zostaje
 * przy tym, co wiedział, a rozstrzyga człowiek przy otwartej sprawie.
 *
 * JEDNO ZAPYTANIE NA CAŁĄ KOLEJKĘ, nie jedno na wiersz: `listaReklamacji`
 * pilnuje tego wprost przy propozycjach kartoteki, a lista bywa
 * kilkusetwierszowa.
 */
function zParagonu(database: Db, skus: Array<string | null>): Map<string, { twId: number; symbol: string }> {
  const szukane = [...new Set(skus
    .map((s) => (s ?? "").trim())
    .filter((s) => s !== "")
    .map((s) => s.toLowerCase()))];
  const wynik = new Map<string, { twId: number; symbol: string }>();
  if (szukane.length === 0) return wynik;
  const luki = szukane.map(() => "?").join(",");
  const wiersze = database.prepare(
    `SELECT tw_id, symbol FROM sgt_towar
      WHERE LOWER(TRIM(symbol)) IN (${luki})`).all(...szukane) as
    Array<{ tw_id: number; symbol: string }>;
  const ile = new Map<string, number>();
  for (const w of wiersze) {
    const klucz = String(w.symbol).trim().toLowerCase();
    ile.set(klucz, (ile.get(klucz) ?? 0) + 1);
    wynik.set(klucz, { twId: Number(w.tw_id), symbol: String(w.symbol) });
  }
  /* Symbol trafiający w dwie kartoteki wypada — patrz preambuła. */
  for (const [klucz, n] of ile) if (n > 1) wynik.delete(klucz);
  return wynik;
}

/** Nadpisanie kartoteki wiersza sygnaturą z paragonu; brak trafienia nie rusza nic. */
function zParagonuNaWiersz(
  r: WierszReklamacji, sku: unknown, mapa: Map<string, { twId: number; symbol: string }>,
): void {
  const klucz = String(sku ?? "").trim().toLowerCase();
  if (klucz === "") return;
  const k = mapa.get(klucz);
  if (!k) return;
  r.twId = k.twId;
  r.twSymbol = k.symbol;
  r.twZParagonu = true;
}

export function listaReklamacji(
  database: Db = defaultDb(), teraz = Date.now(),
  od: string | null = config.allegro.reklamacjeOd,
): WierszReklamacji[] {
  /* Dwa złączenia LEWE po tej samej ofercie: snapshot Allegro (nazwa i adres
     zdjęcia) oraz potwierdzona kartoteka Subiekta. Oba po `channel_account_id`
     RAZEM z `offer_id` — identyfikator oferty jest unikalny w obrębie konta,
     nie globalnie, a dwa konta sprzedawcy to nie jest przypadek niemożliwy.

     Propozycji kartoteki tu NIE liczymy. `kartotekaOferty` chodzi po pamięci
     wskazań i po SKU, czyli kilka zapytań NA WIERSZ; kolejka ma pokazać, co
     wiadomo na pewno, a proponowanie kartoteki jest pracą przy jednej
     otwartej sprawie (szczegół). */
  const wiersze = database.prepare(`
    SELECT r.*, o.nazwa AS oferta_nazwa, o.primary_image_url AS oferta_zdjecie,
           k.tw_id, k.tw_symbol, zk.kupiono_at,
           /* ── SYGNATURA Z PARAGONU (0.400.0) ──────────────────────────────
              Zgłoszenie właściciela: „symbol towaru w reklamacji powinno
              ściągać z paragonu do danego zamówienia".

              Pozycja zamówienia niesie sygnaturę sprzedawcy Z CHWILI ZAKUPU —
              to jest paragon. Tabela oferta_kartoteka niesie DZISIEJSZE
              mapowanie oferty, a sprzedawca przepina sygnaturę, gdy towar od
              jednego dostawcy się wyczerpie (powód przy pamiecAktualna).
              Reklamacja dotyczy rzeczy, którą klient DOSTAŁ, więc pyta
              paragonu, nie dzisiejszej półki.

              Ograniczenie do jednej pozycji: ten sam numer oferty bywa na
              zamówieniu dwa razy, ale sygnaturę niesie tę samą.
              Backticków tu nie ma — blok stoi w literale szablonowym. */
           (SELECT zp.sku FROM zamowienie_klienta_pozycja zp
             WHERE zp.zamowienie_id = zk.id AND zp.offer_id = r.offer_id
             ORDER BY zp.id LIMIT 1) AS sku_paragonu
      FROM reklamacja_klienta r
      LEFT JOIN offer_snapshot o
        ON o.channel_account_id = r.channel_account_id AND o.external_id = r.offer_id
      LEFT JOIN oferta_kartoteka k
        ON k.channel_account_id = r.channel_account_id AND k.offer_id = r.offer_id
      /* Zamówienie po numerze z reklamacji — wzorzec ze złączenia faktur.
         Wiersz bywa go pozbawiony: kolejka dociągania zna sprawy dopiero od
         0.282.0, a Allegro odmawia 404 przy zamówieniach starszych niż jego
         własna retencja. Wtedy zostaje data z ładunku sprawy.
         Backticków tu nie ma — blok stoi w literale szablonowym. */
      LEFT JOIN zamowienie_klienta zk
        ON zk.channel_account_id = r.channel_account_id AND zk.external_id = r.order_id
     WHERE r.typ = 'CLAIM' AND (? IS NULL OR r.otwarto_at >= ?)
     ORDER BY r.decyzja_do IS NULL, r.decyzja_do ASC, r.otwarto_at DESC`)
    .all(od, od) as Wiersz[];
  const tagi = tagiWszystkichSpraw(database, TAGI_REKLAMACJI);
  /* Sygnatury z paragonów JEDNYM zapytaniem na całą kolejkę (0.400.0). */
  const zParagonow = zParagonu(database, wiersze.map((w) => (w as Wiersz).sku_paragonu as string | null));
  return wiersze.map((w) => {
    const r = zWiersza(w, teraz);
    r.tagi = tagi.get(r.id) ?? [];
    zParagonuNaWiersz(r, (w as Wiersz).sku_paragonu, zParagonow);
    return r;
  });
}

export function licznikiKubelkow(lista: WierszReklamacji[]): Record<Kubelek, number> {
  const l: Record<Kubelek, number> = { decyzja: 0, odpowiedz: 0, zamknieta: 0, bez_ruchu: 0 };
  for (const r of lista) l[r.kubelek] += 1;
  return l;
}

/** Ile spraw próg schował i czy któraś z nich to jeszcze praca. */
export interface ProgKolejki {
  /** Próg w ISO albo `null`, gdy go nie ma. Panel pisze z niego zdanie. */
  od: string | null;
  ukrytych: number;
  /**
   * Ile UKRYTYCH spraw ma jeszcze żywy obowiązek: nierozstrzygnięta i z terminem
   * decyzji w przyszłości.
   *
   * TO JEST CAŁY BEZPIECZNIK TEGO PROGU i dlatego liczy się osobno. Próg daty
   * jest narzędziem tępym: nie pyta, czy sprawa jest skończona, tylko kiedy
   * wpłynęła. Zwykle ta liczba będzie zerem, bo próg stoi kwartał wstecz —
   * ale dzień, w którym nie będzie, jest dokładnie tym dniem, dla którego ją
   * liczymy. Bez niej sprawa z żywym zegarem znikałaby po cichu, a to jest
   * gorsze niż kolejka pokazująca za dużo.
   */
  ukrytychZTerminem: number;
}

/**
 * Co próg schował — liczone w bazie, nie na liście.
 *
 * Liczenie na liście byłoby niemożliwe z definicji: lista to właśnie te
 * sprawy, które próg PRZEPUŚCIŁ. Stąd osobne zapytanie z warunkiem
 * zanegowanym.
 *
 * JEDNA FUNKCJA NA OBA EKRANY, z rodzajem sprawy w parametrze. Dyskusje mają
 * ten sam próg i tę samą tabelę; druga kopia tego zapytania rozjechałaby się
 * z pierwszą przy pierwszej poprawce. `ukrytychZTerminem` przy dyskusji wyjdzie
 * zerem z natury rzeczy — `decisionDueDate` jest wedle schematu „null for
 * disputes" — i to jest prawdziwa odpowiedź, a nie luka w liczeniu.
 */
export function progKolejki(
  database: Db = defaultDb(), teraz = Date.now(),
  od: string | null = config.allegro.reklamacjeOd,
  typ: TypSprawy = "CLAIM",
): ProgKolejki {
  if (!od) return { od: null, ukrytych: 0, ukrytychZTerminem: 0 };
  /* Listy statusów wchodzą do SQL-a ZE STAŁYCH, nie przepisane ręką. Druga
     kopia tych samych wartości rozjechałaby się z pierwszą przy najbliższej
     zmianie — dokładnie tak, jak rozjechały się listy końcowe w 0.273.0. */
  const koncowe = STATUSY_KONCOWE.map(() => "?").join(",");
  const wydane = WERDYKT_WYDANY.map(() => "?").join(",");
  const w = database.prepare(`
    SELECT COUNT(*) AS ile,
           SUM(CASE WHEN r.decyzja_do IS NOT NULL AND r.decyzja_do >= ?
                     AND COALESCE(r.status_allegro,'') NOT IN (${koncowe})
                     AND COALESCE(r.werdykt_status,'') NOT IN (${wydane})
                    THEN 1 ELSE 0 END) AS z_terminem
      FROM reklamacja_klienta r
     WHERE r.typ = ? AND r.otwarto_at < ?`)
    .get(new Date(teraz).toISOString(), ...STATUSY_KONCOWE, ...WERDYKT_WYDANY, typ, od) as Wiersz;
  return {
    od,
    ukrytych: Number(w?.ile ?? 0),
    ukrytychZTerminem: Number(w?.z_terminem ?? 0),
  };
}

/** Czat sprawy w kolejności czasu, z załącznikami przy wiadomościach. */
export function czatReklamacji(database: Db, reklamacjaId: number): WiadomoscReklamacji[] {
  const wiersze = database.prepare(`SELECT * FROM reklamacja_wiadomosc
    WHERE reklamacja_id=? ORDER BY utworzono_at IS NULL, utworzono_at ASC, id ASC`)
    .all(reklamacjaId) as Wiersz[];
  const zalaczniki = database.prepare(
    "SELECT id, wiadomosc_id, nazwa FROM reklamacja_zalacznik WHERE reklamacja_id=? ORDER BY id",
  ).all(reklamacjaId) as Wiersz[];
  return wiersze.map((w) => ({
    id: Number(w.id),
    externalId: String(w.external_id),
    autorLogin: tekst(w.autor_login),
    autorRola: tekst(w.autor_rola),
    tresc: String(w.tresc ?? ""),
    utworzonoAt: tekst(w.utworzono_at),
    zalaczniki: zalaczniki.filter((z) => Number(z.wiadomosc_id) === Number(w.id))
      .map((z) => ({
        id: Number(z.id), wiadomoscId: Number(z.wiadomosc_id), nazwa: String(z.nazwa ?? ""),
        podglad: czyObrazZNazwy(z.nazwa as string),
      })),
  }));
}

/** Załączniki samej sprawy — te spoza rozmowy. */
export function zalacznikiSprawy(database: Db, reklamacjaId: number): ZalacznikReklamacji[] {
  return (database.prepare(
    `SELECT id, wiadomosc_id, nazwa FROM reklamacja_zalacznik
      WHERE reklamacja_id=? AND wiadomosc_id IS NULL ORDER BY id`,
  ).all(reklamacjaId) as Wiersz[]).map((z) => ({
    id: Number(z.id), wiadomoscId: null, nazwa: String(z.nazwa ?? ""),
    podglad: czyObrazZNazwy(z.nazwa as string),
  }));
}

export interface RozmowaZakupu {
  id: number;
  temat: string | null;
  status: string;
  ostatniaAt: string | null;
}

export interface SzczegolReklamacji {
  reklamacja: WierszReklamacji;
  czat: WiadomoscReklamacji[];
  zalaczniki: ZalacznikReklamacji[];
  /** Zwroty tego samego zamówienia — mostek z 0.221.0, ta sama funkcja. */
  zwroty: WierszZwrotu[];
  /** Rozmowy o tym samym zakupie; po loginie kupującego NIE dobieramy. */
  rozmowy: RozmowaZakupu[];
  /** Dyskusje i inne reklamacje tego zakupu — bez tej sprawy (S1 spoiwa). */
  sprawy: SprawaZakupu[];
  /** Droga zakupu przez cztery kolejki, w kolejności czasu (S3 spoiwa). */
  droga: PrzystanekDrogi[];
  /** Zamówienie z pozycjami i cenami (0.393.0); `null` = jeszcze niepobrane. */
  zamowienie: Zamowienie | null;
  /** Co wiemy o paczce do klienta (0.393.0); `null` = nie ma zamówienia. */
  przesylka: StanPrzesylkiZamowienia | null;
  /** Kartoteka Subiekta wywiedziona z oferty, gdy reklamacja ją niesie. */
  kartoteka: ReturnType<typeof kartotekaOferty> | null;
  /* Karta faktów Copilota (0.275.0); `null`, gdy nikt jeszcze nie prosił.
     Jedzie razem ze szczegółem, bo jest CZYTANIEM sprawy, a nie osobnym
     ekranem — a drugie zapytanie przy każdym otwarciu byłoby kosztem bez
     zysku (spraw w pracy są dziesiątki). */
  karta: ReturnType<typeof kartaSprawy>;
  /* Ile razy TO SAMO już się zdarzyło (0.413.0) — patrz `historiaSprawy`. */
  historia: HistoriaSprawy;
}

/**
 * Co jeszcze wiemy o TYM ZAMÓWIENIU — zwroty i rozmowy.
 *
 * Wspólne dla reklamacji i dyskusji (0.245.0), bo obie sprawy wiszą przy
 * zamówieniu i obie odpowiadają na to samo pytanie biura: „czy ten klient
 * pisał już w tej sprawie gdzie indziej". Druga kopia tego mostka rozjechałaby
 * się z pierwszą przy pierwszym nowym polu — dokładnie tak, jak ostrzega
 * komentarz przy `szczegolReklamacji`.
 *
 * Zero nowych żądań do Allegro: numer zamówienia sprawa ma od pierwszej
 * synchronizacji, a wiadomości leżą już w naszej bazie. Grupujemy po rozmowie,
 * bo jeden zakup potrafi mieć kilka wątków.
 */
export function kontekstZamowienia(
  database: Db, konto: number, orderId: string | null, teraz: number,
  /* Sprawa, z której pytamy — wypada z rodzeństwa. Bez tego reklamacja
     pokazywałaby w bloku „inne sprawy tego zakupu" samą siebie. */
  pomin: number | null = null,
): {
  zwroty: WierszZwrotu[]; rozmowy: RozmowaZakupu[];
  /* Rodzeństwo posprzedażowe i droga zakupu (S1 i S3 spoiwa,
     `docs/obsluga-klienta-calosc.md`). Reklamacja i dyskusja leżą w JEDNEJ
     tabeli i do tego wydania nie widziały się nawzajem — dyskusja, która
     urosła w reklamację, była osobnym wierszem bez śladu po przejściu.
     To najważniejszy moment całej obsługi i nie zostawiał go nic. */
  sprawy: SprawaZakupu[]; droga: PrzystanekDrogi[];
  /* ── CO KLIENT KUPIŁ I ZA ILE (0.393.0) ──────────────────────────────────
     Zgłoszenie właściciela: „dodaj ceny produktów". Kolumna dowodów miała
     nazwę towaru i SKU, ale ani jednej kwoty — a przy reklamacji z żądaniem
     zwrotu pieniędzy to jest pierwsza liczba, której agent szuka.

     Odczyt jest ten sam, którym skrzynka pokazuje zamówienie przy rozmowie
     (`zamowienieRozmowy`), więc pozycje, kartoteki i zdjęcia liczą się raz
     i tak samo. `null` znaczy „zamówienia jeszcze nie pobraliśmy". */
  zamowienie: Zamowienie | null;
  /* Gdzie jest paczka (0.393.0) — ODCZYT z naszej bazy. Pytanie do Allegro
     idzie osobną trasą, na jawne kliknięcie: to dwa żądania na zamówienie. */
  przesylka: StanPrzesylkiZamowienia | null;
} {
  if (!orderId) {
    return { zwroty: [], rozmowy: [], sprawy: [], droga: [], zamowienie: null, przesylka: null };
  }
  const wiersz = database.prepare(
    "SELECT id FROM zamowienie_klienta WHERE channel_account_id=? AND external_id=?")
    .get(konto, orderId) as { id: number } | undefined;
  return {
    zamowienie: zamowienieRozmowy(konto, orderId, database),
    przesylka: wiersz ? przesylkaZamowienia(database, wiersz.id) : null,
    sprawy: sprawyZakupu(database, konto, orderId, pomin),
    droga: drogaZakupu(database, konto, orderId),
    zwroty: listaZwrotow(database, teraz, { channelAccountId: konto, orderId }),
    rozmowy: (database.prepare(`
      SELECT c.id, c.subject, c.status, MAX(m.sent_at) AS ostatnia
        FROM message m JOIN conversation c ON c.id = m.conversation_id
       WHERE m.related_order_id = ?
       GROUP BY c.id
       ORDER BY ostatnia DESC`).all(orderId) as Wiersz[]).map((r) => ({
      id: Number(r.id),
      temat: tekst(r.subject),
      status: String(r.status),
      ostatniaAt: tekst(r.ostatnia),
    })),
  };
}

/** Ślad w historii: ile spraw, ile skończyło się uznaniem, ile odmową. */
export interface SladHistorii {
  ile: number;
  uznanych: number;
  odrzuconych: number;
}

/**
 * Czy to się już zdarzało — przy TYM towarze i przy TYM kliencie (0.413.0).
 *
 * `null` znaczy „nie mamy po czym liczyć", nigdy „zero": sprawa bez
 * potwierdzonej kartoteki nie ma towaru, po którym szukać, a dyskusja bywa
 * bez loginu. Zero i brak wiedzy to dwie różne odpowiedzi — zasada
 * nadrzędna 9 projektu panelu (§27).
 */
export interface HistoriaSprawy {
  towar: SladHistorii | null;
  klient: SladHistorii | null;
}

/* Uznane i odrzucone liczymy z OBU źródeł naraz — status Allegro i nasz
   werdykt. Sprawa rozstrzygnięta w panelu ma `werdykt` na długo przed tym,
   nim synchronizacja przestawi `status_allegro`; liczenie po samym statusie
   gubiłoby dzisiejsze decyzje, czyli te najświeższe. */
const LICZNIKI_HISTORII = `
  COUNT(*) AS ile,
  SUM(CASE WHEN r.status_allegro = 'CLAIM_ACCEPTED'
             OR r.werdykt LIKE 'ACCEPTED%' THEN 1 ELSE 0 END) AS uznanych,
  SUM(CASE WHEN r.status_allegro = 'CLAIM_REJECTED'
             OR r.werdykt LIKE 'REJECTED%' THEN 1 ELSE 0 END) AS odrzuconych`;

const slad = (w: Wiersz | undefined): SladHistorii | null => {
  if (!w || Number(w.ile ?? 0) === 0) return null;
  return {
    ile: Number(w.ile),
    uznanych: Number(w.uznanych ?? 0),
    odrzuconych: Number(w.odrzuconych ?? 0),
  };
};

/**
 * Ile razy TO SAMO już się zdarzyło (0.413.0).
 *
 * Właściciel o cenach: „są kluczowe do szybkiego oceniania, czy warto
 * rozpatrywać reklamację". Cena mówi, ile kosztuje ustąpienie; te dwie liczby
 * mówią, czy w ogóle jest o co się spierać. Towar z pięcioma reklamacjami,
 * z których cztery uznaliśmy, to wada partii, a nie sprawa do rozstrzygania
 * od zera — a piąta odmowa temu samemu klientowi to inna rozmowa niż pierwsza.
 *
 * NASZA BAZA, ZERO ŻĄDAŃ DO ALLEGRO. Obie liczby stoją w `reklamacja_klienta`
 * od pierwszej synchronizacji; brakowało wyłącznie pytania o nie.
 *
 * TYLKO W SZCZEGÓLE, nigdy w kolejce: to dwa podzapytania na sprawę, a kolejka
 * czyta setki wierszy naraz. Na ekranie widać JEDNĄ sprawę i tam ta liczba
 * zmienia decyzję.
 *
 * TA SPRAWA WYPADA z obu liczników — inaczej każda reklamacja mówiłaby
 * o sobie „to już drugi raz przy tym towarze", licząc siebie.
 *
 * MIANOWNIKA TU NIE MA I NIE BĘDZIE, dopóki nie zmieni się import. „Trzy
 * reklamacje na czterysta sprzedanych" i „trzy na cztery" to dwie różne
 * sprawy, więc odsetek byłby liczbą znacznie lepszą od samego licznika —
 * tyle że nie da się go policzyć uczciwie. Sprzedaż stoi w `sgt_faktura`,
 * a ta tabela niesie OKNO `DOK_SPRZEDAZ_DNI_WSTECZ` (domyślnie 60 dni);
 * reklamacje sięgają lat. Iloraz dwóch liczb o różnych zakresach czasu jest
 * gorszy od braku ilorazu, bo wygląda na wynik. Odsetek wróci tu dopiero
 * z oknem sprzedaży obejmującym ten sam okres, co reklamacje.
 */
export function historiaSprawy(
  database: Db, konto: number, pomin: number,
  twId: number | null, login: string | null,
): HistoriaSprawy {
  /* Po KARTOTECE, nie po numerze oferty: ten sam towar bywa wystawiony
     w kilku ofertach, a reklamacje rozstrzyga rzecz, nie ogłoszenie. */
  const towar = twId === null ? null : slad(database.prepare(`
    SELECT ${LICZNIKI_HISTORII}
      FROM reklamacja_klienta r
      JOIN oferta_kartoteka k
        ON k.channel_account_id = r.channel_account_id AND k.offer_id = r.offer_id
     WHERE r.channel_account_id = ? AND r.typ = 'CLAIM'
       AND k.tw_id = ? AND r.id <> ?`).get(konto, twId, pomin) as Wiersz | undefined);
  const klient = login === null ? null : slad(database.prepare(`
    SELECT ${LICZNIKI_HISTORII}
      FROM reklamacja_klienta r
     WHERE r.channel_account_id = ? AND r.typ = 'CLAIM'
       AND r.kupujacy_login = ? COLLATE NOCASE AND r.id <> ?`).get(konto, login, pomin) as Wiersz | undefined);
  return { towar, klient };
}

/**
 * Wszystko o jednej sprawie — CZYSTY ODCZYT.
 *
 * Otwarcie reklamacji niczego nie mutuje (blizna 0.18.0). Rozmowa dociąga się
 * taktem synchronizacji, a nie wejściem na ekran: pobranie przy patrzeniu
 * byłoby zapisem, a przy okazji żądaniem do Allegro na każde kliknięcie
 * w wiersz kolejki.
 */
export function szczegolReklamacji(
  database: Db, id: number, teraz = Date.now(),
): SzczegolReklamacji {
  /* Skład wiersza jest TEN SAM, co w kolejce — `listaReklamacji` z filtrem po
     identyfikatorze. Druga funkcja składająca reklamację rozjechałaby się
     z pierwszą przy pierwszym nowym polu; dokładnie tak zrobiono przy zwrocie
     w rozmowie (0.221.0). */
  const w = database.prepare(`
    SELECT r.*, o.nazwa AS oferta_nazwa, o.primary_image_url AS oferta_zdjecie,
           k.tw_id, k.tw_symbol, zk.kupiono_at,
           /* ── SYGNATURA Z PARAGONU (0.400.0) ──────────────────────────────
              Zgłoszenie właściciela: „symbol towaru w reklamacji powinno
              ściągać z paragonu do danego zamówienia".

              Pozycja zamówienia niesie sygnaturę sprzedawcy Z CHWILI ZAKUPU —
              to jest paragon. Tabela oferta_kartoteka niesie DZISIEJSZE
              mapowanie oferty, a sprzedawca przepina sygnaturę, gdy towar od
              jednego dostawcy się wyczerpie (powód przy pamiecAktualna).
              Reklamacja dotyczy rzeczy, którą klient DOSTAŁ, więc pyta
              paragonu, nie dzisiejszej półki.

              Ograniczenie do jednej pozycji: ten sam numer oferty bywa na
              zamówieniu dwa razy, ale sygnaturę niesie tę samą.
              Backticków tu nie ma — blok stoi w literale szablonowym. */
           (SELECT zp.sku FROM zamowienie_klienta_pozycja zp
             WHERE zp.zamowienie_id = zk.id AND zp.offer_id = r.offer_id
             ORDER BY zp.id LIMIT 1) AS sku_paragonu
      FROM reklamacja_klienta r
      LEFT JOIN offer_snapshot o
        ON o.channel_account_id = r.channel_account_id AND o.external_id = r.offer_id
      LEFT JOIN oferta_kartoteka k
        ON k.channel_account_id = r.channel_account_id AND k.offer_id = r.offer_id
      /* Zamówienie po numerze z reklamacji — wzorzec ze złączenia faktur.
         Wiersz bywa go pozbawiony: kolejka dociągania zna sprawy dopiero od
         0.282.0, a Allegro odmawia 404 przy zamówieniach starszych niż jego
         własna retencja. Wtedy zostaje data z ładunku sprawy.
         Backticków tu nie ma — blok stoi w literale szablonowym. */
      LEFT JOIN zamowienie_klienta zk
        ON zk.channel_account_id = r.channel_account_id AND zk.external_id = r.order_id
     WHERE r.id=? AND r.typ = 'CLAIM'`).get(id) as Wiersz | undefined;
  /* Dyskusja pod tym identyfikatorem to dla TEGO ekranu brak, a nie sprawa
     bez werdyktu: `/api/reklamacje/7` przy dyskusji ma oddać 404, żeby nie
     dało się jej otworzyć ekranem, który obiecuje uznanie i odrzucenie. */
  if (!w) throw new BladReklamacji(`Reklamacja ${id} nie istnieje`, 404);
  const reklamacja = zWiersza(w, teraz);
  /* Sygnatura z paragonu bije dzisiejsze mapowanie oferty (0.400.0) — powód
     przy `zParagonu`. Szczegół idzie tą samą drogą co kolejka, bo dwa
     składania tej samej reklamacji rozjechałyby się przy pierwszym polu. */
  zParagonuNaWiersz(reklamacja, w.sku_paragonu,
    zParagonu(database, [w.sku_paragonu as string | null]));
  reklamacja.tagi = tagiSprawy(database, TAGI_REKLAMACJI, id);
  const konto = Number(w.channel_account_id);

  const { zwroty, rozmowy, sprawy, droga, zamowienie, przesylka } =
    kontekstZamowienia(database, konto, reklamacja.orderId, teraz, id);

  /* Kartoteka po ofercie — ten sam łańcuch co w skrzynce (pamięć wskazań,
     potem SKU ze snapshotu). Bez snapshotu `sku` jest `undefined` i ekran
     mówi „oferty jeszcze nie pobrano", a nie „oferta bez SKU". */
  let kartoteka: SzczegolReklamacji["kartoteka"] = null;
  if (reklamacja.offerId) {
    const snap = database.prepare(
      "SELECT sku FROM offer_snapshot WHERE channel_account_id=? AND external_id=?",
    ).get(konto, reklamacja.offerId) as { sku: string | null } | undefined;
    kartoteka = kartotekaOferty(database, konto, reklamacja.offerId,
      snap ? snap.sku : undefined);
  }

  return {
    reklamacja,
    czat: czatReklamacji(database, id),
    zalaczniki: zalacznikiSprawy(database, id),
    zwroty, rozmowy, sprawy, droga, zamowienie, przesylka, kartoteka,
    karta: kartaSprawy(database, id),
    historia: historiaSprawy(database, konto, id, reklamacja.twId, reklamacja.kupujacyLogin),
  };
}

/**
 * Wiersz do mutacji plus kontrola wersji. Wspólne dla obu zapisów niżej
 * ORAZ dla dyskusji (`services/dyskusje.ts`), stąd `typ` jako parametr.
 *
 * Warunek na `typ` stoi przy ZAPISIE, nie tylko przy odczycie, i to jest
 * sedno: bez niego trasa reklamacji przyjęłaby werdykt na dyskusji, której
 * Allegro werdyktu nie przyjmie („Not a valid operation for disputes"),
 * a trasa dyskusji poprosiłaby o zakończenie reklamacji, gdzie `END_REQUEST`
 * jest niedozwolone.
 *
 * Zdanie w błędzie mówi RODZAJ sprawy, nie samo „nie istnieje": agent, który
 * wkleił numer z drugiego ekranu, ma się dowiedzieć, że pomylił ekran,
 * a nie że sprawa zniknęła.
 */
export function doZapisu(
  database: Db, id: number, wersja: number | undefined, typ: TypSprawy = "CLAIM",
) {
  const w = database.prepare(
    "SELECT id, wersja, prowadzi, prowadzi_user_id FROM reklamacja_klienta WHERE id=? AND typ=?",
  ).get(id, typ) as
    { id: number; wersja: number; prowadzi: string | null; prowadzi_user_id: number | null }
    | undefined;
  if (!w) throw new BladReklamacji(`${NAZWA_SPRAWY[typ]} ${id} nie istnieje`, 404);
  if (wersja !== undefined && Number(w.wersja) !== Number(wersja)) {
    throw new ReklamacjaConflict({ wersja: Number(w.wersja), prowadzi: w.prowadzi });
  }
  return w;
}

/**
 * Kto prowadzi reklamację — ZNACZNIK, nie zamek.
 *
 * Reklamacja przed werdyktem nie ma ŻADNEGO zapisu, przy którym nazwisko
 * pojawiłoby się samo: nie ma szkicu jak rozmowa ani oceny towaru jak zwrot.
 * Dlatego jest jawny przycisk, a nie stempel przy okazji. Doktryna
 * `stempelProwadzi` z pytań — znacznik dla reszty biura, żeby dwie osoby nie
 * wzięły tej samej sprawy przy dwóch biurkach.
 *
 * Ponowne kliknięcie ZDEJMUJE znacznik. Bez tego jedyną drogą wyjścia
 * z pomyłkowego przejęcia byłby cudzy werdykt.
 *
 * ZDEJMOWANIE ROZSTRZYGA TOŻSAMOŚĆ, NIE IMIĘ (0.278.0). Do tego wydania
 * przełącznik porównywał łańcuchy, więc dwie osoby o tym samym imieniu
 * zdejmowały sobie znacznik nawzajem — po cichu, bo objawem jest cudza sprawa
 * we własnym kubełku. Wiersz zastany bez `prowadzi_user_id` (migracja nie
 * umiała dopasować imienia) traktujemy jako CUDZY: zabranie sprawy jest
 * odwracalne jednym kliknięciem, ciche zdjęcie cudzego znacznika nie.
 */
export function stempelProwadzi(
  database: Db, id: number, autor: { id: number; name: string }, wersja?: number,
): WierszReklamacji {
  return transaction(database, () => {
    const w = doZapisu(database, id, wersja);
    const zdejmuje = w.prowadzi_user_id !== null && Number(w.prowadzi_user_id) === autor.id;
    database.prepare(`UPDATE reklamacja_klienta
      SET prowadzi=?, prowadzi_user_id=?, prowadzi_at=?, wersja=wersja+1
      WHERE id=? AND typ='CLAIM'`).run(
      zdejmuje ? null : autor.name, zdejmuje ? null : autor.id,
      zdejmuje ? null : new Date().toISOString(), id);
    logEvent("reklamacja_prowadzi", autor.name, null, { id, zdjete: zdejmuje },
      autor.id, database);
    return zWiersza(
      database.prepare("SELECT * FROM reklamacja_klienta WHERE id=? AND typ='CLAIM'")
        .get(id) as Wiersz,
      Date.now());
  })();
}

/**
 * Notatka biura — nasze ustalenia, których Allegro nie zna.
 *
 * Do dziennika idzie DŁUGOŚĆ, nigdy treść: notatka bywa zdaniem o kliencie,
 * a `events` nie ma retencji i nie jest kasowane (§9 architektury).
 */
export function zapiszNotatke(
  database: Db, id: number, notatka: string | null,
  autor: { id: number; name: string }, wersja?: number,
): WierszReklamacji {
  return transaction(database, () => {
    doZapisu(database, id, wersja);
    pisanieNotatki(database, id, notatka, autor, "CLAIM", "reklamacja_notatka");
    return zWiersza(
      database.prepare("SELECT * FROM reklamacja_klienta WHERE id=? AND typ='CLAIM'")
        .get(id) as Wiersz,
      Date.now());
  })();
}

/**
 * Zapis notatki wspólny dla reklamacji i dyskusji (0.280.0).
 *
 * POPRZEDNIA TREŚĆ ZOSTAJE NA WIERSZU, żeby zmianę dało się cofnąć. Notatka
 * jest polem swobodnym, które nadpisuje ten, kto pisze ostatni — do tego
 * wydania nie było jak odzyskać zdania skasowanego przez pomyłkę.
 *
 * Nazwa zdarzenia jest PARAMETREM, a nie wyliczeniem z `typ`: ślad audytowy ma
 * mówić, z którego ekranu padło kliknięcie, i tę samą zasadę niesie
 * `stempelProwadziDyskusje` od 0.245.0.
 */
export function pisanieNotatki(
  database: Db, id: number, notatka: string | null,
  autor: { id: number; name: string }, typ: TypSprawy, zdarzenie: string,
): void {
  const wartosc = (notatka ?? "").trim() || null;
  const w = database.prepare(
    "SELECT notatka FROM reklamacja_klienta WHERE id=? AND typ=?")
    .get(id, typ) as { notatka: string | null } | undefined;
  database.prepare(`UPDATE reklamacja_klienta
    SET notatka=?, notatka_poprzednia=?, notatka_at=?, notatka_przez=?, notatka_user_id=?,
        wersja=wersja+1
    WHERE id=? AND typ=?`)
    .run(wartosc, w?.notatka ?? null, new Date().toISOString(), autor.name, autor.id, id, typ);
  /* Do dziennika idzie DŁUGOŚĆ, nigdy treść — ani bieżąca, ani poprzednia.
     `events` nie ma retencji (§9 architektury), a notatka bywa zdaniem
     o kliencie. */
  logEvent(zdarzenie, autor.name, null, { id, znakow: wartosc?.length ?? 0 },
    autor.id, database);
}

/**
 * Cofnięcie ZMIANY notatki — jeden szczebel, przez zamianę.
 *
 * Bieżąca treść ląduje w `notatka_poprzednia`, więc drugie kliknięcie wraca
 * tam, gdzie było. Tabela historii dla pola, którego nikt nie audytuje, byłaby
 * drugim miejscem na te same dane osobowe.
 *
 * `false` znaczy „nie ma do czego wracać" i NIE jest błędem: wiersz zastany
 * sprzed 0.280.0 nie zna swojej poprzedniej treści, bo nikt jej nie zapisywał.
 */
export function cofnijNotatkeSprawy(
  database: Db, id: number, autor: { id: number; name: string },
  typ: TypSprawy, zdarzenie: string,
): boolean {
  const w = database.prepare(
    "SELECT notatka, notatka_poprzednia FROM reklamacja_klienta WHERE id=? AND typ=?")
    .get(id, typ) as { notatka: string | null; notatka_poprzednia: string | null } | undefined;
  if (!w || w.notatka_poprzednia === null) return false;
  database.prepare(`UPDATE reklamacja_klienta
    SET notatka=?, notatka_poprzednia=?, notatka_at=?, notatka_przez=?, notatka_user_id=?,
        wersja=wersja+1
    WHERE id=? AND typ=?`)
    .run(w.notatka_poprzednia, w.notatka, new Date().toISOString(), autor.name, autor.id, id, typ);
  logEvent(zdarzenie, autor.name, null,
    { id, znakow: w.notatka_poprzednia.length }, autor.id, database);
  return true;
}

/** Cofnięcie zmiany notatki przy REKLAMACJI. */
export function cofnijNotatke(
  database: Db, id: number, autor: { id: number; name: string }, wersja?: number,
): WierszReklamacji {
  return transaction(database, () => {
    doZapisu(database, id, wersja);
    if (!cofnijNotatkeSprawy(database, id, autor, "CLAIM", "reklamacja_notatka_cofnieta")) {
      throw new BladReklamacji("Ta notatka nie ma poprzedniej wersji", 409);
    }
    return zWiersza(
      database.prepare("SELECT * FROM reklamacja_klienta WHERE id=? AND typ='CLAIM'")
        .get(id) as Wiersz,
      Date.now());
  })();
}

/**
 * Adres załącznika u Allegro.
 *
 * Trasa pobrania czyta go stąd, a nie z żądania — inaczej nasz serwer stałby
 * się bramką pod dowolny adres. Sam `pobierzZalacznik` sprawdza jeszcze host
 * i to są dwie niezależne zapory, bo obie kosztują jedną linijkę.
 */
export function adresZalacznika(
  database: Db, reklamacjaId: number, zalacznikId: number,
): { url: string; nazwa: string } {
  const z = database.prepare(
    "SELECT url, nazwa FROM reklamacja_zalacznik WHERE id=? AND reklamacja_id=?",
  ).get(zalacznikId, reklamacjaId) as { url: string; nazwa: string } | undefined;
  if (!z) throw new BladReklamacji("Nie ma takiego załącznika przy tej reklamacji", 404);
  return { url: z.url, nazwa: z.nazwa || "zalacznik" };
}
