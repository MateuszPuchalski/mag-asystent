import { config } from "../config.js";
import { db as defaultDb, type Db, transaction } from "../db/db.js";
import { zaproponujKartoteke, type Dopasowanie } from "./dopasowanie-sku.js";
import { stanRabatu, type StanRabatu } from "./rabaty.js";
import { linkZwrotu } from "./allegro-linki.js";
import { iloscLiczona } from "./ilosc-zwrotu.js";
import { naZamowienie, type Zamowienie } from "./zamowienia.js";
import { logEvent } from "./events.js";
import type { FakturaZwrotu } from "./faktury.js";
import { dolozDoKosza, wypuscGotoweKoszyki, zamknietyKoszPozycji, zdejmijZKosza }
  from "./kosze-zwrotow.js";
import { STATUSY_ODDANE } from "./zwrot-pieniedzy.js";
import { zapiszSkladRecznie, type SkladPozycji } from "./komplety.js";
import { odsunZwPrzedRecznym, zakolejkujZw } from "./zw-automat.js";
import { stanZdjeciaOferty, type StanZdjeciaOferty } from "./zdjecia-ofert.js";
import { ROZMOWA_ZAMOWIENIA } from "./droga-klienta.js";

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

export type Sygnal = "termin" | "brak_dowodu" | "odrzucony_w_allegro"
  | "pieniadze_niepotwierdzone" | "pieniadze_poza_panelem" | "kwota_nieaktualna"
  | "rozjazd_ilosci" | "przelew_czeka" | "drugi_zwrot";

/**
 * Zwrot tego samego zamówienia z DRUGIEGO źródła (0.493.0).
 *
 * Decyzja właściciela: klient, którego paczka wróciła nieodebrana, bywa, że
 * zgłasza potem odstąpienie w Allegro. Synchronizacja zakłada wtedy drugi
 * zwrot tego samego zamówienia, obok przyjętej przez biuro paczki. Dwa zwroty
 * to dwie kwoty do oddania za jeden towar — worker nie wystawi drugiego ZW,
 * ale pieniądze pilnuje już tylko człowiek.
 *
 * TYLKO RÓŻNE ŹRÓDŁA. Dwa zwroty z Allegro na jedno zamówienie to zwykły
 * zwrot w dwóch paczkach, każdy z własnymi pozycjami — ostrzeżenie świeciłoby
 * na nich bez powodu i uczyło je przewijać.
 */
export interface DrugiZwrot {
  id: number;
  /** Numer do przeczytania — bez naszego przedrostka `nieodebrana:`. */
  numer: string;
  zrodlo: string;
}

export interface PozycjaZwrotu {
  id: number;
  /**
   * Ile sztuk naprawdę wróciło. `null` = nikt jeszcze nie liczył (0.212.0).
   *
   * `ilosc` obok niesie DEKLARACJĘ klienta i nadpisuje ją synchronizator.
   */
  iloscZwrocona: number | null;
  /** `allegro` = ze zgłoszenia klienta, `biuro` = dopisana u nas (0.184.0). */
  zrodlo: string;
  offerId: string | null;
  /**
   * Numer oferty wzięty z POZYCJI ZAMÓWIENIA (0.213.0), nie z pozycji zwrotu.
   *
   * `offerId` wyżej należy do przestrzeni, której nie znamy; ten jest
   * `lineItems[].offer.id` ze specyfikacji. `null` znaczy „nie ma zamówienia
   * albo pozycja się z niczym nie związała".
   */
  ofertaZamowienia: string | null;
  /**
   * Co wiadomo o zdjęciu tej oferty (0.214.0).
   *
   * `nieznane` znaczy „jeszcze nie pytaliśmy Allegro" ALBO „nie ma numeru
   * oferty" — w obu wypadkach ekran nie ma prawa powiedzieć „bez zdjęcia",
   * bo to nieprawda. `brak` znaczy: pytaliśmy, Allegro nie podało obrazu.
   */
  ofertaZdjecie: StanZdjeciaOferty;
  nazwa: string;
  ilosc: number;
  cenaGrosze: number;
  waluta: string;
  powod: string | null;
  powodKomentarz: string | null;
  ocena: string | null;
  /** Czy pozycja leży już w koszyku zwrotów, czyli na dokumencie MM. */
  wKoszyku: boolean;
  /** Odnośnik do oferty — jedyny link udokumentowany w specyfikacji. */
  url: string | null;
  /** Kartoteka POTWIERDZONA przez człowieka; bez niej nie ma zdjęcia. */
  twId: number | null;
  twSymbol: string | null;
  twZrodlo: string | null;
  /** SKU sprzedawcy z pozycji ZAMÓWIENIA — zwrot własnego SKU nie niesie. */
  sku: string | null;
  /** EAN z kartoteki Subiekta. Allegro EAN-u nie podaje przy zwrocie wcale. */
  ean: string | null;
  /** Ile MNIEJ oddajemy za tę pozycję i DLACZEGO (0.170.0). */
  potracenieGrosze: number | null;
  potraceniePowod: string | null;
  /** Propozycja automatu — pokazywana obok, nigdy zamiast potwierdzonej. */
  propozycja: Dopasowanie | null;
  /** Rabat transakcyjny: czy wniosek o zwrot prowizji już jest (0.164.0). */
  rabat: StanRabatu;
}

/* `Zamowienie` i `PozycjaZamowienia` mieszkają od 0.166.0 w `zamowienia.ts`,
   bo to samo zamówienie pokazuje też rozmowa. Re-eksport trzyma stare importy. */
export type { PozycjaZamowienia, Zamowienie } from "./zamowienia.js";

export interface WierszZwrotu {
  id: number;
  externalId: string;
  numer: string | null;
  orderId: string | null;
  utworzono: string;
  paczkaAt: string | null;
  /** Kiedy paczka DOTARŁA do nas — z trackingu przewoźnika (0.187.0). */
  dostarczonoAt: string | null;
  /** Ostatni kod przewoźnika: `NOTICE_LEFT`, `ISSUE`, `RETURNED`… */
  przesylkaStatus: string | null;
  /**
   * Ostatni status zwrotu po stronie Allegro (0.339.0).
   *
   * Do 0.338.0 czytały go wyłącznie sygnały, z surowego wiersza. Od kiedy
   * rozstrzyga o KUBEŁKU, musi być widoczny tam, gdzie widać kubełek —
   * inaczej zwrot znika z kolejki bez zdania, które to tłumaczy.
   */
  statusAllegro: string | null;
  kubelek: Kubelek;
  /**
   * Kwota ustalona, a pieniądze jeszcze nie wyszły (0.476.0). Trzyma zwrot
   * w DO ZWROTU także po korekcie — powód przy `pieniadzeCzekaja`.
   */
  pieniadzeCzekaja: boolean;
  sygnaly: Sygnal[];
  /** `null`, dopóki paczka nie wróciła — zegar obsługi jeszcze nie ruszył. */
  terminAt: string | null;
  dniDoTerminu: number | null;
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
  /**
   * Powód odmowy wpisany przez biuro (0.210.0).
   *
   * Do tego wydania zapisywał się do `werdykt_powod` i NIKT go nie czytał —
   * ani panel, ani nic innego. Ekran obiecywał przy nim „zobaczy go klient",
   * a nie widział go nawet operator, który go wpisał.
   */
  werdyktPowod: string | null;
  kwotaGrosze: number | null;
  kwotaWariant: string | null;
  korektaNumer: string | null;
  /**
   * `subiekt` = automat znalazł dokument, `reczne` = człowiek przepisał,
   * `sfera` = ZW wystawił worker Sfery (0.349.0).
   */
  korektaZrodlo: string | null;
  /**
   * Zadanie automatycznego ZW (0.349.0) — `null`, gdy nie zlecono żadnego.
   * Panel mówi po nim, czy numer przyjdzie sam, czy biuro ma wystawić ZW ręką.
   */
  zw: { status: string; numer: string | null; blad: string | null } | null;
  rejectionCode: string | null;
  /** `allegro` albo `nieodebrana` — paczka, której klient nie odebrał. */
  zrodlo: string;
  /* PROWADZĄCEGO I TAGÓW W TYM DTO JUŻ NIE MA (0.370.0) — patrz komentarz
     przy trasach zwrotów. Kolumny `prowadzi*` zostają w tabeli: przebudowa
     dla trzech nieużywanych kolumn niesie więcej ryzyka, niż kupuje, a wiersz
     bez nich niczego nie traci. */
  /** Notatka biura — od 0.313.0 dopisywana przy KAŻDYM zwrocie, nie tylko
      przy paczce nieodebranej. */
  notatka: string | null;
  notatkaAt: string | null;
  notatkaPrzez: string | null;
  /** Czy jest dokąd wracać cofnięciem (§25a.5). */
  maPoprzedniaNotatke: boolean;
  /** Login kupującego prosto ze zwrotu — nie wymaga pobranego zamówienia. */
  kupujacyLogin: string | null;
  /**
   * Nazwa odbiorcy Z NAKLEJKI (0.367.0).
   *
   * Paczki nadaje klient albo kurier, więc numeru listu z wracającego kartonu
   * nasz system NIGDY nie widział — pierwszy skan takiej paczki musi chybić.
   * Uchwytem zostaje to, co jeszcze jest na naklejce: nazwa odbiorcy.
   *
   * W CSV jej NIE MA, tak samo jak numeru listu: plik na dysku jest zapisem
   * trwalszym niż baza, a decyzja właściciela dotyczyła szukania na ekranie,
   * nie wynoszenia danych osobowych do arkusza.
   */
  odbiorcaNazwa: string | null;
  /** `INPOST`, `DPD`, `UNKNOWN`… — surowo, bo Allegro nie zamyka listy. */
  przewoznik: string | null;
  /**
   * Numer listu przewozowego paczki zwrotnej (0.344.0).
   *
   * Decyzja właściciela zdjęła politykę 0.163.0: „zapisuj numery paczek".
   * Numer z naklejki jest tym, co operator trzyma w ręku przy kartonie —
   * ma więc stać tam, gdzie się na niego patrzy. Do 0.343.0 żył wyłącznie
   * w kopii odpowiedzi Allegro i panel nie mógł go pokazać ani przefiltrować.
   *
   * W CSV go NIE MA i to zostaje: plik na dysku jest zapisem trwalszym niż
   * baza, a tamta część polityki nie była przedmiotem decyzji.
   */
  waybill: string | null;
  /**
   * Kiedy Allegro PIERWSZY RAZ powiedziało, że pieniądze wróciły (0.345.0).
   *
   * `status_allegro` to wskaźnik TERAZ, nie historia: zwrot rozliczony idzie
   * dalej tą samą osią czasu. Ten zatrzask trzyma fakt, a nie chwilowy stan.
   */
  rozliczonyAllegroAt: string | null;
  /** Rozmowy o TYM zakupie; puste znaczy „Allegro nic nie powiązało". */
  rozmowy: RozmowaZwrotu[];
  /** Zwrot tego zamówienia z drugiego źródła; `null` = nie ma (0.493.0). */
  drugiZwrot: DrugiZwrot | null;
  /** Dokument sprzedaży z Subiekta — snapshot numeru, nie odczyt na żywo. */
  faktura: FakturaZwrotu;
  wersja: number;
  pozycje: PozycjaZwrotu[];
}

/**
 * Rozmowa z klientem o tym samym zakupie (0.169.0).
 *
 * Mostkiem jest `message.related_order_id`, mapowany od 0.166.0 z gałęzi
 * `relatesTo.order`. Nie ma tu ani jednego nowego żądania do Allegro: numer
 * zamówienia zwrot ma od zawsze, a wiadomości leżą już w naszej bazie.
 *
 * NUMER ZAMÓWIENIA, NIE LOGIN, i to jest wybór zakresu, nie zakaz. Karta
 * zwrotu pokazuje rozmowy o TYM zakupie; wszystkie rozmowy kupującego niesie
 * historia klienta (`klient-historia.ts`), która od 24 września 2026 chodzi
 * też po loginie. Blizna 0.56.6 brała `client:44300444` za maskę — to był
 * login kupującego bez konta (`docs/allegro-ksztalt.md`).
 */
export interface RozmowaZwrotu {
  id: number;
  temat: string | null;
  status: string;
  ostatniaAt: string | null;
  /** Ostatnia prawdziwa wiadomość w wątku, do 280 znaków — bez naszej autoodpowiedzi (0.486.1). */
  ostatniaTresc: string | null;
  /** Czy to ostatnie słowo napisał klient, czyli wątek czeka na nas. */
  odKlienta: boolean;
}

/** Ile dni przed terminem wiersz zapala się na czerwono. */
const PROG_TERMINU_DNI = 3;

type Wiersz = Record<string, unknown>;

/**
 * Od kiedy biegnie zegar obsługi zwrotu (0.339.0).
 *
 * OD PACZKI U NAS, nie od zgłoszenia klienta. Regulamin Allegro daje siedem
 * dni od OTRZYMANIA zwrotu, a nie od jego zadeklarowania — i tym zegarem
 * właściciel kazał ustawiać kolejność pracy, bo to po nim Allegro rozlicza
 * sprzedawcę. Do 0.338.0 liczyliśmy czternaście dni od `createdAt`, czyli
 * termin ustawowy na oddanie pieniędzy.
 *
 * TA SAMA REGUŁA CO PRZY SYGNALE „BRAK DOWODU" (0.187.0), i to jest celowe:
 * dwie definicje „paczka wróciła" rozjechałyby się przy pierwszej poprawce
 * jednej z nich, a wtedy wiersz świeciłby terminem, mówiąc jednocześnie, że
 * paczki nie ma. Doręczenie z trackingu; a gdy trackingu NIE MA wcale,
 * zostaje data nadania — lepszy zegar z nadania niż jego brak.
 *
 * `null` znaczy: PACZKA JESZCZE NIE WRÓCIŁA, więc nie ma czego obsługiwać
 * i zegar nie ruszył. Wymyślony termin dla paczki w drodze kazałby gonić
 * pracę, której nie da się wykonać.
 */
export function poczatekTerminu(z: {
  dostarczonoAt: string | null; paczkaAt: string | null; przesylkaStatus: string | null;
}): string | null {
  if (z.dostarczonoAt) return z.dostarczonoAt;
  if (z.przesylkaStatus == null && z.paczkaAt) return z.paczkaAt;
  return null;
}

/** Termin obsługi — `null`, dopóki paczka nie wróciła. */
export function terminZwrotu(
  poczatek: string | null, dni = config.allegro.zwrotTerminDni,
): string | null {
  if (!poczatek) return null;
  return new Date(Date.parse(poczatek) + dni * 86_400_000).toISOString();
}

/** Pełne dni do terminu; ujemne znaczy „po terminie", `null` — zegar nie ruszył. */
export function dniDoTerminu(terminAt: string | null, teraz = Date.now()): number | null {
  if (!terminAt) return null;
  return Math.floor((Date.parse(terminAt) - teraz) / 86_400_000);
}

/**
 * Czy zwrot czeka jeszcze na wyjście pieniędzy (0.476.0).
 *
 * Przegląd zwrotów z 23 września: automatyczny ZW zamyka zwrot minutę po
 * zapisie kwoty, a zamknięty zwrot schodzi z kolejki. Pieniądze biuro oddaje
 * ręką w Allegro — więc jeśli nikt nie pamiętał, ósmego dnia Allegro oddawało
 * całość samo, a potrącenie za uszkodzenie przepadało. Nic w kolejce o tym
 * nie mówiło.
 *
 * ROZLICZONE jest to, po czym jest ślad: nasze polecenie zwrotu, odmowa,
 * zapisany przelew albo potwierdzenie z Allegro. Kwota zero nie ma czego
 * oddać.
 *
 * OKNO, NIE WIECZNOŚĆ. Zamówienie opłacone w Allegro czeka do dnia po naszym
 * terminie — potem Allegro oddaje samo, wg właściciela „ósmego dnia".
 * Pobranie Allegro nie oddaje wcale, więc czeka tyle, ile stary zwrot bez
 * decyzji (`ZWROT_WYGASA_DNI`). Bez okna wróciłaby do pracy cała historia
 * sprzed tej reguły.
 */
export function pieniadzeCzekaja(z: {
  werdykt: string | null; rejectionCode: string | null; kwotaGrosze: number | null;
  statusAllegro?: string | null; rozliczonyAllegroAt?: string | null;
  /** Nasze polecenie zwrotu w Allegro — identyfikator albo sam `commandId`. */
  zlecono?: boolean;
  odmowaKod?: string | null; przelewAt?: string | null;
  platnoscTyp?: string | null; terminAt?: string | null; utworzono?: string | null;
  /** `allegro` albo `nieodebrana` (0.493.0). */
  zrodlo?: string | null;
}, teraz = Date.now(), wygasaDni = config.allegro.zwrotWygasaDni): boolean {
  if (z.werdykt !== "przyjety" || z.rejectionCode) return false;
  if (z.kwotaGrosze === null || z.kwotaGrosze <= 0) return false;
  if (z.rozliczonyAllegroAt || STATUSY_ODDANE.has(String(z.statusAllegro ?? ""))) return false;
  if (z.zlecono || z.odmowaKod || z.przelewAt) return false;
  /* PACZKA NIEODEBRANA CZEKA BEZ TERMINU (0.493.0). „Ósmego dnia Allegro
     oddaje samo" dotyczy zwrotu klienta, a tej paczki Allegro nie zna.
     Z terminem zamknięty korektą, niezapłacony zwrot wychodził z kolejki
     dzień po terminie — pieniądze nie szły nigdy i nikt by tego nie
     zobaczył. Czeka więc, aż zobaczymy wypłatę, zlecenie albo przelew. */
  if (z.zrodlo === "nieodebrana") return true;
  if (z.platnoscTyp === "CASH_ON_DELIVERY") {
    return Boolean(z.utworzono) && teraz - Date.parse(String(z.utworzono)) <= wygasaDni * 86_400_000;
  }
  if (!z.terminAt) return false;
  return teraz <= Date.parse(z.terminAt) + DZIEN_AUTOMATU_ALLEGRO_MS;
}

/** Allegro oddaje samo dzień po naszym terminie — „ósmego dnia" (właściciel). */
const DZIEN_AUTOMATU_ALLEGRO_MS = 86_400_000;

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
  /** Ostatni status zwrotu po stronie Allegro (0.339.0). */
  statusAllegro?: string | null;
  /** Kiedy Allegro PIERWSZY RAZ powiedziało, że pieniądze wróciły (0.345.0). */
  rozliczonyAllegroAt?: string | null;
  /** Data zgłoszenia i źródło — do reguły wieku (0.452.0). */
  utworzono?: string | null;
  zrodlo?: string | null;
  /** Wynik `pieniadzeCzekaja` — liczony raz, przez wołającego (0.476.0). */
  pieniadzeCzekaja?: boolean;
}, teraz = Date.now(), wygasaDni = config.allegro.zwrotWygasaDni): Kubelek {
  /* ZAMKNIĘCIE NIE ZDEJMUJE NIEZAPŁACONEGO ZWROTU (0.476.0). Korekta
     zamyka zwrot w bazie — ręką albo automatem ZW minutę po kwocie — ale
     pieniądze wychodzą zwykle później. Taki zwrot wraca do DO ZWROTU i stoi
     tam, dopóki Allegro nie pokaże, że pieniądze wyszły, albo nie minie
     dzień, w którym oddaje samo. Powód przy `pieniadzeCzekaja`. */
  if (z.zamknietyAt) return z.pieniadzeCzekaja ? "zwrot" : "zamkniety";
  if (z.werdykt === "odrzucony" || z.rejectionCode) return "odrzucony";
  /* ALLEGRO ROZLICZYŁO — SPRAWA ZAMKNIĘTA (0.339.0). Zgłoszenie właściciela:
     „pokazuje za dużo zwrotów do procesowania, pokazuje zwroty, za które
     pieniądze zostały już zwrócone".

     Ze SCHEMATU `CustomerReturn.status`: `FINISHED` to „the payment has been
     refunded, return process is finished", `FINISHED_APT` to to samo ręką
     Allegro Protect. Do 0.338.0 kubełek liczył się z pięciu naszych faktów
     i tego statusu nie czytał wcale — zwrot rozliczony w panelu Allegro albo
     przez Allegro Protect stał u nas w DO DECYZJI i pytał „przyjąć czy
     odrzucić?", choć pieniądze dawno były u klienta. Pytanie bez treści,
     na zawsze, przy każdym takim zwrocie.

     DECYZJA WŁAŚCICIELA: całkiem z kolejki. Zdejmuje to z pracy także zwroty
     bez naszej korekty i bez oceny towaru — dlatego wychodzą one w raporcie
     rekoncyliacji (`zwrot_rozliczony_bez_korekty`), a nie w ciszy.

     ODMOWA ROZSTRZYGA WCZEŚNIEJ, linijkę wyżej. Oba stany są końcowe, więc
     żaden nie chowa pracy — ale „odrzucony" niesie POWÓD, a „zamknięty" mówi
     tylko, że sprawy nie ma. Przy wyborze między dwoma prawdami wygrywa ta,
     która więcej tłumaczy. */
  /* ZATRZASK, NIE WSKAŹNIK (0.345.0). `status_allegro` mówi, co jest TERAZ,
     a nie co było: zwrot rozliczony idzie dalej tą samą osią czasu — choćby
     na `COMMISSION_REFUND_CLAIMED`, który dotyczy NASZEJ prowizji, a nie
     pieniędzy klienta. Wskaźnik przestawał wtedy pokazywać rozliczenie
     i kubełek wypychał taki zwrot z powrotem do kolejki pracy.

     Zgłoszenie właściciela: „nadal pokazuje paczki, do których został już
     stwierdzony zwrot" — a wypychał je NASZ WŁASNY automat rabatów (0.320.0),
     składający wniosek zaraz po zaciągnięciu odstąpienia.

     Wskaźnik czytamy DALEJ, obok zatrzasku: pierwsze spojrzenie na świeżo
     zsynchronizowany zwrot bywa wcześniejsze niż zapis zatrzasku, a dwa
     źródła tej samej prawdy nie kłócą się — oba mówią „pieniądze wróciły". */
  /* PACZKI NIEODEBRANEJ WYPŁATA NIE ZAMYKA (0.493.0). Zwrot z Allegro po
     wypłacie wychodzi z pracy decyzją z 0.339.0, a braki łapie rekoncyliacja.
     Nieodebraną biuro przyjmuje po to, żeby zrobić ZW i odłożyć towar —
     a pieniądze bywają oddane wcześniej, ręką w Allegro. Zamknięcie po
     wypłacie zdejmowałoby taką paczkę z kolejki w pierwszym takcie po
     przyjęciu, zanim ktokolwiek ją oceni. Wypłata dalej zdejmuje czekanie
     na pieniądze, więc po korekcie zwrot się zamyka. */
  if ((z.rozliczonyAllegroAt || STATUSY_ODDANE.has(String(z.statusAllegro ?? "")))
      && (z.zrodlo ?? "allegro") !== "nieodebrana") {
    return "zamkniety";
  }
  /* ── STARY ZWROT BEZ DECYZJI JEST ROZLICZONY (0.452.0) ─────────────────
     Wywiad z właścicielem: „Do decyzji" liczyło 743 sprawy, „głównie stare".
     Zatrzask z 0.426.0 łapie tylko wypłatę z obciążeniem `REFUND_CHARGE`,
     a reszta starych zwrotów stała w kolejce na zawsze.

     Fakt, na którym stoi reguła, podał właściciel: sprzedawca ma siedem dni,
     a ósmego dnia Allegro oddaje pieniądze samo. Po `wygasaDni` od zgłoszenia
     pytanie „przyjąć czy odrzucić?" nie ma już treści — pieniądze są
     u klienta tak czy inaczej.

     TYLKO BEZ DECYZJI. Zwrot przyjęty czeka dalej na ocenę, kwotę albo
     korektę — to praca z dokumentem w Subiekcie, której Allegro za nas nie
     zrobi. TYLKO ZE ZGŁOSZENIA: paczki nieodebranej Allegro nie zna, więc
     niczego za nas nie oddaje.

     LICZONE, NIE ZAPISANE. Kubełek wynika z faktów przy każdym odczycie,
     więc zmiana progu w `ZWROT_WYGASA_DNI` działa od razu i w obie strony.
     Zapis w bazie byłby decyzją bez człowieka, której nie dałoby się cofnąć. */
  if (!z.werdykt && z.utworzono && (z.zrodlo ?? "allegro") !== "nieodebrana"
      && teraz - Date.parse(z.utworzono) > wygasaDni * 86_400_000) {
    return "zamkniety";
  }
  if (z.werdykt !== "przyjety") return "decyzja";
  /* Pusta lista pozycji NIE jest „ocenione wszystko": zwrot bez pozycji nie
     ma czego wycenić, więc zostaje przy ocenie, gdzie człowiek to zobaczy. */
  if (!z.pozycje.length || z.pozycje.some((p) => !p.ocena)) return "ocena";
  if (z.kwotaGrosze === null) return "zwrot";
  if (!z.korektaNumer) return "korekta";
  return z.pieniadzeCzekaja ? "zwrot" : "zamkniety";
}

/**
 * Ile dni czekamy na potwierdzenie przelewu, zanim zapalimy sygnał.
 *
 * Allegro przestawia `CustomerReturn.status` na `FINISHED` dopiero po
 * rozliczeniu płatności, a nie w chwili przyjęcia polecenia. Trzy dni, bo
 * przelew zlecony w piątek ma mieć prawo potwierdzić się w poniedziałek —
 * sygnał krzyczący przez weekend nauczyłby operatora przewijać go dalej.
 */
const PROG_POTWIERDZENIA_DNI = 3;

/**
 * Sygnały — jedyne rzeczy, które każą przeczytać wiersz.
 *
 * Wszystko inne wiersz mówi bez czytania. Sygnału „rozjazd" (klient zgłosił
 * inną liczbę sztuk, niż wróciła) tu nadal nie ma: liczbę zwróconą zna
 * dopiero ocena hali. Reguła bez danych zapalałaby się na ślepo albo nigdy —
 * obie wersje uczą operatora ignorować kolor.
 *
 * DWA SYGNAŁY O PIENIĄDZACH SĄ OSOBNE, BO MÓWIĄ COŚ INNEGO. Jeden mówi
 * „wysłaliśmy i nie wiemy", drugi „nie wysyłaliśmy, a poszło". Zwinięte
 * w jeden kolor kazałyby operatorowi otwierać wiersz, żeby dowiedzieć się,
 * w którą stronę patrzeć.
 */
export function sygnalyZwrotu(z: {
  kubelek: Kubelek; dni: number | null; paczkaAt: string | null;
  dostarczonoAt: string | null; przesylkaStatus: string | null;
  rejectionCode: string | null;
  /* Kiedy TO MY zleciliśmy przelew; `null` = nie zleciliśmy go z panelu. */
  pieniadzeAt: string | null;
  /* Ostatni status zwrotu po stronie Allegro — nasze jedyne potwierdzenie. */
  statusAllegro: string | null;
  /** Czy zapisana kwota rozjechała się z pozycjami (0.210.0). */
  kwotaRozjazd?: boolean;
  /** Czy któraś pozycja wróciła w innej liczbie, niż klient zgłosił (0.212.0). */
  rozjazdIlosci?: boolean;
  /** Forma płatności zamówienia; pobranie oddaje się przelewem (0.269.0). */
  platnoscTyp?: string | null;
  /** Kiedy biuro zapisało, że przelew poszedł; `null` = nie ma śladu. */
  przelewAt?: string | null;
  /** Czy kwota jest już ustalona — bez niej nie ma czego oddawać. */
  kwotaUstalona?: boolean;
  /** Czy zwrot został przyjęty; odmowa nie prosi o pieniądze. */
  przyjety?: boolean;
  /** Czy to zamówienie ma zwrot z drugiego źródła (0.493.0). */
  drugiZwrot?: boolean;
}, teraz = Date.now()): Sygnal[] {
  const s: Sygnal[] = [];
  /* Stany końcowe nie mają terminu do pilnowania — czerwień na nich uczyłaby
     przewijać czerwone wiersze. */
  const wPracy = z.kubelek !== "zamkniety" && z.kubelek !== "odrzucony";
  /* `null` = paczka jeszcze nie wróciła, więc zegar nie ruszył (0.339.0).
     Sygnał terminu na paczce w drodze kazałby gonić pracę, której nie da się
     wykonać — od tego jest `brak_dowodu` linijkę niżej. */
  if (wPracy && z.dni !== null && z.dni <= PROG_TERMINU_DNI) s.push("termin");
  /* Dowodem jest DORĘCZENIE, nie nadanie (0.187.0). Do 0.186.0 sygnał gasł,
     gdy klient nadał paczkę — a paczka w drodze nie jest paczką u nas. Zwrot
     doręczony i ten jadący od tygodnia wyglądały w kolejce identycznie.

     Gdy trackingu nie ma (przewoźnik nie odpowiada, brak numeru), zostaje
     dawne kryterium: lepszy sygnał z daty nadania niż jego brak. */
  const wrocila = z.dostarczonoAt != null
    || (z.przesylkaStatus == null && Boolean(z.paczkaAt));
  if (wPracy && !wrocila) s.push("brak_dowodu");
  /* Odrzucone w panelu Allegro, nie u nas. Bez tego biuro drugi raz
     rozstrzygałoby sprawę, którą ktoś już zamknął gdzie indziej. */
  if (z.rejectionCode) s.push("odrzucony_w_allegro");

  const oddane = STATUSY_ODDANE.has(String(z.statusAllegro ?? ""));
  /* PRZELEW BEZ POTWIERDZENIA. Do tego wydania status płatności zapisywał się
     RAZ, z odpowiedzi na `POST /payments/refunds`, i nikt go już nie czytał:
     przelew, który Allegro odrzuciło godzinę później, wyglądał u nas
     dokładnie jak udany. Potwierdzeniem jest status zwrotu, bo `GET` po
     identyfikatorze zwrotu płatności w specyfikacji NIE ISTNIEJE — sprawdzone
     w `docs/allegro/swagger.yaml`, jest tam samo `POST /payments/refunds`.

     Ten jeden sygnał obowiązuje TAKŻE na zwrocie zamkniętym. Wszystkie
     pozostałe gasną na stanach końcowych, bo mówią o pracy do zrobienia —
     a ten mówi o pieniądzach, które mogły nie wyjść. Zwrot zamyka się zaraz
     po korekcie, czyli zwykle ZANIM Allegro potwierdzi przelew; gaszenie go
     razem z resztą wyciszyłoby go dokładnie wtedy, gdy zaczyna być prawdziwy. */
  if (z.pieniadzeAt && !oddane
      && teraz - Date.parse(z.pieniadzeAt) > PROG_POTWIERDZENIA_DNI * 86_400_000) {
    s.push("pieniadze_niepotwierdzone");
  }
  /* PIENIĄDZE POSZŁY POZA PANELEM. Allegro mówi, że płatność jest oddana,
     a u nas nie ma po niej śladu — ktoś oddał ją ręką w panelu Allegro albo
     zrobiło to Allegro Protect. Sygnał chroni przed DRUGIM przelewem: bez
     niego zwrot stoi w kubełku „do zwrotu" i prosi o pieniądze, które klient
     już ma.

     Tylko na zwrocie w pracy. Na zamkniętych zapaliłby się na całej
     historii sprzed tego panelu — a tam nie ma już czego zapłacić drugi raz. */
  if (wPracy && oddane && !z.pieniadzeAt) s.push("pieniadze_poza_panelem");
  /* POBRANIE CZEKA NA PRZELEW (0.269.0). Allegro tych pieniędzy nie trzymało,
     więc przycisk ODDAJ PIENIĄDZE jest zamknięty z definicji — a zwrot zamyka
     się korektą i schodzi z kolejki. Bez tego sygnału jedynym śladem po
     niewykonanej wypłacie był brak wyciągu bankowego, czyli nic.

     Świeci TAKŻE na zwrocie zamkniętym, z tego samego powodu co
     niepotwierdzony przelew: pieniądze wychodzą zwykle po korekcie, więc
     gaszenie sygnału razem z kubełkiem wyciszałoby go w chwili, w której
     zaczyna być prawdziwy. Gaśnie dopiero, gdy biuro zapisze przelew. */
  if (z.platnoscTyp === "CASH_ON_DELIVERY" && z.przyjety && z.kwotaUstalona
      && !z.przelewAt && !oddane) {
    s.push("przelew_czeka");
  }
  /* DRUGI ZWROT TEGO ZAMÓWIENIA (0.493.0). Tylko w pracy: gdy oba są
     zamknięte, pieniądze są już rozstrzygnięte, a świecący sygnał na
     historii uczyłby go nie czytać. Świeci na OBU wierszach, bo każdy
     z nich może być tym, który ktoś zaraz wypłaci. */
  if (wPracy && z.drugiZwrot) s.push("drugi_zwrot");
  /* KWOTA ROZJECHANA Z POZYCJAMI. Świeci także na zwrocie ZAMKNIĘTYM, z tego
     samego powodu co niepotwierdzony przelew: mówi o pieniądzach, które mogły
     wyjść w złej wysokości, a zwrot zamyka się zaraz po korekcie. Gaśnie
     dopiero wtedy, gdy ktoś kwotę poprawi — drabina cofania z 0.202.0 daje
     na to drogę nawet po zamknięciu. */
  if (z.kwotaRozjazd) s.push("kwota_nieaktualna");
  /* ROZJAZD ILOŚCI (0.212.0). Do 0.211.0 tego sygnału nie było, bo nie było
     DANYCH: liczbę zwróconą znała tylko paczka, nie baza, a reguła bez danych
     zapala się na ślepo albo nigdy. Teraz liczy ją biuro przy rozpakowaniu,
     więc sygnał ma z czego świecić.

     Świeci także na zwrocie zamkniętym: mówi, że wypłata poszła za inną liczbę
     sztuk, niż klient zgłosił — a to jest zdanie, którego szuka się po fakcie,
     przy reklamacji. */
  if (z.rozjazdIlosci) s.push("rozjazd_ilosci");
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

/**
 * Czy zapisana kwota nadal zgadza się z pozycjami (0.210.0).
 *
 * KWOTA JEST MIGAWKĄ, A POZYCJE ŻYJĄ DALEJ. Synchronizator przy każdym takcie
 * nadpisuje `ilosc` i `cena_grosze` pozycji z Allegro, a zapisanej
 * `kwota_grosze` nie dotyka nic — do tego wydania nikt jej po zapisie nie
 * porównywał. Zwrot, którego klient poprawił po wycenie, wypłacał kwotę
 * sprzed poprawki. Cicho, bo obie liczby leżały w bazie zgodne ze sobą
 * w chwili zapisu.
 *
 * Liczymy TĄ SAMĄ arytmetyką co `zapiszKwote`: zaznaczone pozycje minus
 * potrącenia, plus zapisany koszt dostawy. Inna dałaby fałszywy alarm przy
 * pierwszej różnicy zaokrąglenia.
 *
 * `w_zwrocie` JEST zaznaczeniem i przeżywa synchronizację, więc pozycja
 * dołożona przez Allegro po wycenie ma tam zero i sumy nie rusza. Tego
 * przypadku ten sygnał NIE łapie — nie da się odróżnić pozycji dołożonej
 * później od świadomie odznaczonej, bo pozycja nie ma daty dopisania.
 */
export function kwotaRozjechana(
  z: { kwota_grosze: unknown; kwota_dostawa_grosze: unknown },
  surowe: Array<{ w_zwrocie: unknown; cena_grosze: unknown; ilosc: unknown;
    ilosc_zwrocona?: unknown; potracenie_grosze: unknown }>,
): boolean {
  if (z.kwota_grosze == null) return false;
  const zPozycji = surowe
    .filter((p) => Number(p.w_zwrocie) === 1)
    .reduce((sum, p) => sum
      + Math.round(Number(p.cena_grosze) * iloscLiczona(p))
      - Number(p.potracenie_grosze ?? 0), 0);
  return zPozycji + Number(z.kwota_dostawa_grosze ?? 0) !== Number(z.kwota_grosze);
}

function zloz(
  z: Wiersz, pozycje: PozycjaZwrotu[], zamowienie: Zamowienie | null, teraz: number,
  rozmowy: RozmowaZwrotu[] = [],
  /* Surowe wiersze pozycji obok złożonych: sygnał rozjazdu kwoty liczy się
     z `w_zwrocie`, `cena_grosze` i `potracenie_grosze`, a DTO pozycji nie
     niesie zaznaczenia — i nie ma powodu, żeby zaczęło. */
  surowe: Wiersz[] = [],
  drugiZwrot: DrugiZwrot | null = null,
): WierszZwrotu {
  const utworzono = String(z.created_at);
  const terminAt = terminZwrotu(poczatekTerminu({
    dostarczonoAt: (z.dostarczono_at as string) ?? null,
    paczkaAt: (z.paczka_at as string) ?? null,
    przesylkaStatus: (z.przesylka_status as string) ?? null,
  }));
  const dni = dniDoTerminu(terminAt, teraz);
  const rejectionCode = (z.rejection_code as string) ?? null;
  const czeka = pieniadzeCzekaja({
    werdykt: (z.werdykt as string) ?? null, rejectionCode,
    kwotaGrosze: z.kwota_grosze == null ? null : Number(z.kwota_grosze),
    statusAllegro: (z.status_allegro as string) ?? null,
    rozliczonyAllegroAt: (z.rozliczony_allegro_at as string) ?? null,
    zlecono: Boolean(z.zwrot_pieniedzy_id || z.zwrot_pieniedzy_command_id),
    odmowaKod: (z.odmowa_kod as string) ?? null,
    przelewAt: (z.przelew_at as string) ?? null,
    platnoscTyp: zamowienie?.platnoscTyp ?? null,
    terminAt, utworzono, zrodlo: String(z.zrodlo ?? "allegro"),
  }, teraz);
  const kubelek = kubelekZwrotu({
    rejectionCode,
    werdykt: (z.werdykt as string) ?? null,
    zamknietyAt: (z.zamkniety_at as string) ?? null,
    kwotaGrosze: z.kwota_grosze == null ? null : Number(z.kwota_grosze),
    korektaNumer: (z.korekta_numer as string) ?? null,
    pozycje,
    statusAllegro: (z.status_allegro as string) ?? null,
    rozliczonyAllegroAt: (z.rozliczony_allegro_at as string) ?? null,
    utworzono,
    zrodlo: String(z.zrodlo ?? "allegro"),
    pieniadzeCzekaja: czeka,
  }, teraz);
  const suma = sumaPozycji(pozycje);
  return {
    id: Number(z.id),
    externalId: String(z.external_id),
    numer: (z.reference_number as string) ?? null,
    orderId: (z.order_id as string) ?? null,
    utworzono,
    paczkaAt: (z.paczka_at as string) ?? null,
    dostarczonoAt: (z.dostarczono_at as string) ?? null,
    przesylkaStatus: (z.przesylka_status as string) ?? null,
    statusAllegro: (z.status_allegro as string) ?? null,
    kubelek,
    pieniadzeCzekaja: czeka,
    sygnaly: sygnalyZwrotu({
      kubelek, dni, paczkaAt: (z.paczka_at as string) ?? null,
      dostarczonoAt: (z.dostarczono_at as string) ?? null,
      przesylkaStatus: (z.przesylka_status as string) ?? null, rejectionCode,
      pieniadzeAt: (z.zwrot_pieniedzy_at as string) ?? null,
      statusAllegro: (z.status_allegro as string) ?? null,
      kwotaRozjazd: kwotaRozjechana(z as never, surowe as never),
      rozjazdIlosci: surowe.some(
        (p) => p.ilosc_zwrocona != null && Number(p.ilosc_zwrocona) !== Number(p.ilosc)),
      platnoscTyp: zamowienie?.platnoscTyp ?? null,
      przelewAt: (z.przelew_at as string) ?? null,
      kwotaUstalona: z.kwota_grosze != null,
      przyjety: z.werdykt === "przyjety",
      drugiZwrot: drugiZwrot !== null,
    }, teraz),
    terminAt,
    dniDoTerminu: dni,
    sumaPozycjiGrosze: suma,
    /* Kwota pełna = pozycje + dostawa. Bez zamówienia zostaje `null`, a nie
       suma pozycji udająca całość — do 0.151.0 ekran musiał o tym pisać
       zdanie, bo koszt dostawy stoi przy zamówieniu, nie przy zwrocie. */
    kwotaPelnaGrosze: zamowienie ? suma + (zamowienie.dostawaGrosze ?? 0) : null,
    waluta: pozycje[0]?.waluta ?? zamowienie?.waluta ?? "PLN",
    /* Paczka nieodebrana nie ma zwrotu w Allegro, więc nie ma czego otwierać —
       link prowadziłby w 404 i kosztował zaufanie do całego ekranu. */
    linkZwrotu: String(z.zrodlo ?? "allegro") === "nieodebrana"
      ? null
      : linkZwrotu((z.reference_number as string) ?? (z.external_id as string),
        (z.created_at as string) ?? null),
    zamowienie,
    werdykt: (z.werdykt as string) ?? null,
    werdyktPowod: (z.werdykt_powod as string) ?? null,
    kwotaGrosze: z.kwota_grosze == null ? null : Number(z.kwota_grosze),
    kwotaWariant: (z.kwota_wariant as string) ?? null,
    korektaNumer: (z.korekta_numer as string) ?? null,
    korektaZrodlo: (z.korekta_zrodlo as string) ?? null,
    zw: z.zw_status == null ? null : {
      status: String(z.zw_status),
      numer: (z.zw_numer as string) ?? null,
      blad: (z.zw_blad as string) ?? null,
    },
    rejectionCode,
    drugiZwrot,
    zrodlo: String(z.zrodlo ?? "allegro"),
    notatka: (z.notatka as string) ?? null,
    notatkaAt: (z.notatka_at as string) ?? null,
    notatkaPrzez: (z.notatka_przez as string) ?? null,
    maPoprzedniaNotatke: ((z.notatka_poprzednia as string) ?? null) !== null,
    /* ZWROT ALBO JEGO ZAMÓWIENIE (0.177.0). Login siedzi w OBU odpowiedziach
       Allegro — `CustomerReturn.buyer.login` i `checkout-forms.buyer.login` —
       i oba synchronizatory go mapują. Ekran czytał wyłącznie pierwszy, więc
       zwrot bez `buyer` (albo zaciągnięty przed 0.164.0, gdy mapowania tam
       jeszcze nie było) nie pokazywał kupującego wcale, choć jego zamówienie
       leżało obok z wypełnioną kolumną. To ten sam człowiek: zamówienie jest
       tym, którego zwrot dotyczy.

       Zysk nie kończy się na ekranie — po tym polu idzie też kolumna
       „Kupujacy" w eksporcie CSV. */
    kupujacyLogin: (z.kupujacy_login as string) ?? zamowienie?.kupujacyLogin ?? null,
    /* Ten sam fallback i z tego samego powodu co przy loginie: kolumna zwrotu
       jest pierwsza, bo przy paczce nieodebranej wpisał ją człowiek patrzący
       na naklejkę, a zamówienia często nie ma wcale. */
    odbiorcaNazwa: (z.odbiorca_nazwa as string) ?? zamowienie?.odbiorcaNazwa ?? null,
    przewoznik: (z.przewoznik as string) ?? null,
    waybill: (z.waybill as string) ?? null,
    rozliczonyAllegroAt: (z.rozliczony_allegro_at as string) ?? null,
    rozmowy,
    /* Snapshot z kolumn zwrotu, a nie złączenie z `sgt_faktura`: read-model
       czyści się przy każdym imporcie i dokument wypada z okna po dwóch
       miesiącach — numer musi przeżyć własne źródło. */
    faktura: {
      dokId: z.faktura_dok_id == null ? null : Number(z.faktura_dok_id),
      numer: (z.faktura_numer as string) ?? null,
      typ: (z.faktura_typ as string) ?? null,
      zrodlo: (z.faktura_zrodlo as "numer" | "reczne") ?? null,
      at: (z.faktura_at as string) ?? null,
      przez: (z.faktura_przez as string) ?? null,
    },
    wersja: Number(z.wersja ?? 1),
    pozycje,
  };
}

/* EKSPORTU CSV JUŻ NIE MA (0.370.0). Właściciel wskazał go wprost jako
   niepotrzebny przy prośbie „uprość panel zwrotów do wymaganego minimum".

   Nie jest to sama oszczędność miejsca na ekranie: plik wynosił loginy
   kupujących na dysk, czyli poza politykę danych zwrotów, i właśnie
   dlatego zostawiał ślad `zwroty_eksport`. Rzecz, której nikt nie używa,
   a która wynosi dane osobowe, jest samym kosztem.

   Gdyby wróciła: numeru listu i nazwy odbiorcy w pliku nie było i nie ma
   mieć — plik na dysku jest zapisem trwalszym niż baza. */

/**
 * Cała kolejka, jednym zapytaniem plus jednym na pozycje.
 *
 * Zwrotów w pracy są dziesiątki, nie tysiące, więc stronicowanie po stronie
 * serwera kupiłoby złożoność bez zysku. Panel filtruje kubełkiem u siebie
 * i dzięki temu przełączenie kubełka jest natychmiastowe — a to jest
 * dokładnie ten koszt, który miał zniknąć.
 */
/** Zawężenie listy: zwroty JEDNEGO zamówienia albo JEDEN zwrot. */
export type FiltrZwrotow =
  | { channelAccountId: number; orderId: string }
  | { id: number };

export function listaZwrotow(
  database: Db = defaultDb(), teraz = Date.now(),
  /* Zwroty JEDNEGO zamówienia (0.221.0) — dla bloku zwrotu przy rozmowie.
     Ten sam skład wiersza, co w kolejce zwrotów: druga funkcja składająca
     zwrot rozjechałaby się z pierwszą przy pierwszym nowym polu.

     JEDEN ZWROT (audyt zwrotów, 15 września 2026) — dla szczegółu. Do tego
     wydania trasa szczegółu budowała CAŁĄ historię zwrotów, żeby wyjąć z niej
     jeden wiersz, razem z propozycją kartoteki i stanem rabatu dla każdej
     pozycji każdego zwrotu. Szczegół odświeża się po każdym zapisie, więc
     płacił to każdy klawisz. Filtr zawęża też odczyty słownikowe niżej. */
  filtr: FiltrZwrotow | null = null,
): WierszZwrotu[] {
  const znaki = (n: number) => Array.from({ length: n }, () => "?").join(",");
  /* Stan zadania ZW (0.349.0) złączeniem, nie osobnym zapytaniem na zwrot:
     zadanie jest co najwyżej jedno i wskazuje je kolumna zwrotu. Aliasy z
     przedrostkiem `zw_`, żeby nie zasłoniły kolumn zwrotu o tych samych nazwach. */
  const ZWROTY_Z_ZW = `SELECT z.*, q.status AS zw_status, q.sgt_doc_number AS zw_numer,
      q.error_msg AS zw_blad
    FROM zwrot_klienta z
    LEFT JOIN sfera_queue q ON q.id = z.korekta_queue_id AND q.type = 'zw'`;
  const zwroty = (filtr === null
    ? database.prepare(`${ZWROTY_Z_ZW} ORDER BY z.created_at ASC`).all()
    : "id" in filtr
      ? database.prepare(`${ZWROTY_Z_ZW} WHERE z.id=?`).all(filtr.id)
      : database.prepare(`${ZWROTY_Z_ZW} WHERE z.channel_account_id=? AND z.order_id=?
          ORDER BY z.created_at ASC`).all(filtr.channelAccountId, filtr.orderId)) as Wiersz[];
  const idyZwrotow = zwroty.map((z) => Number(z.id));
  /* ZWROTY TYCH SAMYCH ZAMÓWIEŃ, do sygnału `drugi_zwrot` (0.493.0). Pełna
     kolejka ma je już w pamięci. Szczegół jednego zwrotu pyta o jedno
     zamówienie — jego drugi zwrot zwykle nie przeszedł filtra. */
  type ZwrotZamowienia = { id: number; zrodlo: string; numer: string };
  const wgZamowienia = new Map<string, ZwrotZamowienia[]>();
  const klucz = (konto: unknown, zam: unknown) => `${konto}|${zam}`;
  const zamowieniaZwrotow = [...new Set(zwroty.filter((z) => z.order_id != null)
    .map((z) => klucz(z.channel_account_id, z.order_id)))];
  const rodzenstwo = (filtr === null ? zwroty : zamowieniaZwrotow.length === 0 ? [] : database.prepare(
    `SELECT id, channel_account_id, order_id, zrodlo, reference_number, external_id
       FROM zwrot_klienta WHERE order_id IN (${znaki(zamowieniaZwrotow.length)})`)
    .all(...zamowieniaZwrotow.map((k) => k.slice(k.indexOf("|") + 1)))) as Wiersz[];
  for (const r of rodzenstwo) {
    if (r.order_id == null) continue;
    const k = klucz(r.channel_account_id, r.order_id);
    const lista = wgZamowienia.get(k) ?? [];
    lista.push({ id: Number(r.id), zrodlo: String(r.zrodlo ?? "allegro"),
      numer: String(r.reference_number ?? r.external_id).replace(/^nieodebrana:/, "") });
    wgZamowienia.set(k, lista);
  }
  const drugiZwrotDla = (z: Wiersz): DrugiZwrot | null => {
    if (z.order_id == null) return null;
    const wlasne = String(z.zrodlo ?? "allegro");
    return (wgZamowienia.get(klucz(z.channel_account_id, z.order_id)) ?? [])
      .find((r) => r.id !== Number(z.id) && r.zrodlo !== wlasne) ?? null;
  };
  const pozycje = (filtr === null
    ? database.prepare("SELECT * FROM zwrot_klienta_pozycja ORDER BY id ASC").all()
    : idyZwrotow.length
      ? database.prepare(`SELECT * FROM zwrot_klienta_pozycja
          WHERE zwrot_id IN (${znaki(idyZwrotow.length)}) ORDER BY id ASC`).all(...idyZwrotow)
      : []) as Wiersz[];
  const idyPozycji = pozycje.map((p) => Number(p.id));
  /* Które pozycje leżą już w koszyku zwrotów (0.192.0). Osobne zapytanie,
     nie złączenie: `listaZwrotow` czyta całe tabele naraz i dokładanie
     `LEFT JOIN` do jednej z nich rozjechałoby ten wzorzec bez zysku. */
  const wKoszyku = new Set(((filtr === null
    ? database.prepare(
      "SELECT zwrot_pozycja_id AS id FROM kosz_pozycja WHERE zwrot_pozycja_id IS NOT NULL").all()
    : idyPozycji.length
      ? database.prepare(`SELECT zwrot_pozycja_id AS id FROM kosz_pozycja
          WHERE zwrot_pozycja_id IN (${znaki(idyPozycji.length)})`).all(...idyPozycji)
      : []) as Array<{ id: number }>).map((k) => Number(k.id)));
  /* Przy filtrze tylko zamówienia, do których prowadzą zwroty. Para konto plus
     numer, bo przestrzeń numerów nie jest wspólna dla kont (§15.1). */
  const pary = [...new Map(zwroty.filter((z) => z.order_id)
    .map((z) => [`${z.channel_account_id}|${z.order_id}`, z] as const)).values()];
  const zamowienia = (filtr === null
    ? database.prepare("SELECT * FROM zamowienie_klienta").all()
    : pary.flatMap((z) => database.prepare(
        "SELECT * FROM zamowienie_klienta WHERE channel_account_id=? AND external_id=?")
        .all(Number(z.channel_account_id), String(z.order_id)))) as Wiersz[];
  const idyZamowien = zamowienia.map((k) => Number(k.id));
  const pozZam = (filtr === null
    ? database.prepare("SELECT * FROM zamowienie_klienta_pozycja ORDER BY id ASC").all()
    : idyZamowien.length
      ? database.prepare(`SELECT * FROM zamowienie_klienta_pozycja
          WHERE zamowienie_id IN (${znaki(idyZamowien.length)}) ORDER BY id ASC`)
        .all(...idyZamowien)
      : []) as Wiersz[];

  /* Stan zdjęcia oferty (0.214.0). JEDNO zapytanie na całą kolejkę, jak przy
     zamówieniach wyżej — snapshotów jest tyle, co ofert, a `LEFT JOIN` na
     wiersz pozycji ciągnąłby je po jednym. Ekran ma tu powiedzieć trzy różne
     rzeczy, więc niesie stan, a nie samo „jest/nie ma". */
  const zdjeciaOfert = new Map<string, string | null>();
  for (const o of database.prepare(
    "SELECT channel_account_id AS konto, external_id AS id, primary_image_url AS url FROM offer_snapshot",
  ).all() as Array<{ konto: number; id: string; url: string | null }>) {
    zdjeciaOfert.set(`${o.konto}|${o.id}`, o.url);
  }

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

  /* EAN bierze się z KARTOTEKI, bo Allegro go przy zwrocie nie podaje w ogóle
     (jest tylko przy One Fulfillment, którego ta firma nie używa). Jedno
     zapytanie na całą kolejkę, nie jedno na pozycję. */
  const eanWgTw = new Map<number, string>();
  /* Przy filtrze tylko kartoteki pozycji tych zwrotów, nie cały słownik EAN-ów. */
  const twIdy = [...new Set(pozycje.filter((p) => p.tw_id != null).map((p) => Number(p.tw_id)))];
  for (const t of (filtr === null
    ? database.prepare("SELECT tw_id, ean FROM sgt_towar WHERE ean IS NOT NULL AND ean <> ''").all()
    : twIdy.length
      ? database.prepare(`SELECT tw_id, ean FROM sgt_towar WHERE ean IS NOT NULL AND ean <> ''
          AND tw_id IN (${znaki(twIdy.length)})`).all(...twIdy)
      : []) as Wiersz[]) {
    eanWgTw.set(Number(t.tw_id), String(t.ean));
  }

  /* Rozmowy o tym zakupie. Grupujemy po numerze zamówienia, bo jeden zakup
     potrafi mieć kilka wątków — dlatego lista, a nie kolumna `conversation_id`
     przy zwrocie, która mieści jedną. Przy filtrze tylko numery tych zwrotów. */
  const rozmowyWgZam = new Map<string, RozmowaZwrotu[]>();
  const numery = [...new Set(zwroty.filter((z) => z.order_id).map((z) => String(z.order_id)))];
  const rozmowy = filtr !== null && !numery.length ? [] : database.prepare(`
    SELECT rz.numer AS zam, c.id, c.subject, c.status,
           (SELECT MAX(x.sent_at) FROM message x WHERE x.conversation_id = c.id) AS ostatnia,
           /* OSTATNIE SŁOWO W WĄTKU (0.486.1) — do nagłówka zwrotu. Zgłoszenie
              właściciela: „potrzebuję więcej informacji o kliencie w nagłówku,
              szczególnie jeśli jest konwersacja o tym zwrocie". Temat i data
              nie mówią, czy klient czeka na nas. Pomijamy naszą automatyczną
              odpowiedź: echo „dziękujemy za kontakt" udawałoby odpisanie.
              Podzapytanie idzie po indeksie (conversation_id, sent_at). */
           (SELECT substr(x.body, 1, 280) FROM message x
             WHERE x.conversation_id = c.id AND x.auto_odpowiedz = 0
             ORDER BY x.sent_at DESC LIMIT 1) AS tresc,
           (SELECT x.direction FROM message x
             WHERE x.conversation_id = c.id AND x.auto_odpowiedz = 0
             ORDER BY x.sent_at DESC LIMIT 1) AS kierunek
      FROM ${ROZMOWA_ZAMOWIENIA} rz JOIN conversation c ON c.id = rz.conversation_id
      /* Konto rozmowy musi być kontem zwrotu (@wydanie) — do tego wydania
         zapytanie go nie sprawdzało. Numery Allegro to UUID, więc zderzenie
         kont jest czysto teoretyczne; reszta mostka filtruje i ta część też. */
      JOIN zwrot_klienta zk ON zk.order_id = rz.numer AND zk.channel_account_id = c.channel_account_id
     WHERE 1=1
       ${filtr === null ? "" : `AND rz.numer IN (${znaki(numery.length)})`}
     GROUP BY rz.numer, c.id
     ORDER BY ostatnia DESC`).all(...(filtr === null ? [] : numery));
  for (const r of rozmowy as Wiersz[]) {
    const klucz = String(r.zam);
    const lista = rozmowyWgZam.get(klucz) ?? [];
    lista.push({
      id: Number(r.id),
      temat: (r.subject as string) ?? null,
      status: String(r.status),
      ostatniaAt: (r.ostatnia as string) ?? null,
      ostatniaTresc: (r.tresc as string) ?? null,
      /* „Czeka na nas" = ostatnie prawdziwe słowo należy do klienta. */
      odKlienta: r.kierunek === "incoming",
    });
    rozmowyWgZam.set(klucz, lista);
  }

  return zwroty
    .map((z) => {
      const surowe = wgZwrotu.get(Number(z.id)) ?? [];
      const zam = zamWgKlucza.get(`${z.channel_account_id}|${z.order_id}`) ?? null;
      const pozZamowienia = zam ? pozWgZam.get(Number(zam.id)) ?? [] : [];
      /* SZTUKI, nie sam fakt (0.176.0). Ta sama oferta bywa w zwrocie w kilku
         wierszach (`klucz` z przyrostkiem), więc sztuki się SUMUJĄ — inaczej
         „wraca 1" przy dwóch wierszach po jednej sztuce byłoby nieprawdą. */
      const wracajace = new Map<string, number>();
      for (const p of surowe) {
        const k = (p.offer_id as string) ?? "";
        if (!k) continue;
        wracajace.set(k, (wracajace.get(k) ?? 0) + Number(p.ilosc ?? 0));
      }

      /* SKU sprzedawcy niesie POZYCJA ZAMÓWIENIA — pozycja zwrotu ma w
         specyfikacji samo `offerId`, bez zagnieżdżonej oferty. Dopasowanie
         po obu kolumnach z tego samego powodu co niżej przy plakietce WRACA. */
      const skuWgOferty = new Map<string, string>();
      for (const pz of pozZamowienia) {
        const sku = (pz.sku as string) ?? "";
        if (!sku) continue;
        for (const k of [pz.offer_id, pz.external_id]) {
          if (k) skuWgOferty.set(String(k), sku);
        }
      }

      /* ── NUMER OFERTY DO ZDJĘCIA (0.213.0) ──────────────────────────────
         `PozycjaZwrotu.offerId` do zdjęcia się NIE NADAJE i mówi o tym cały
         akapit niżej: nie wiadomo, czy to numer oferty, czy identyfikator
         pozycji zamówienia (`[WERYFIKUJ]` w `docs/allegro-ksztalt.md`).
         Pytanie CDN-u tym identyfikatorem trafiałoby raz w dziesięć.

         `zamowienie_klienta_pozycja.offer_id` dwuznaczności nie ma: to
         `lineItems[].offer.id` ze specyfikacji zamówienia. Przechodzimy więc
         przez pozycję ZAMÓWIENIA — tą samą drogą i tym samym dopasowaniem po
         obu kolumnach, którym wyżej idzie SKU. Druga, własna reguła
         dopasowania rozjechałaby się z tamtą przy pierwszej poprawce. */
      const ofertaWgKlucza = new Map<string, string>();
      for (const pz of pozZamowienia) {
        const oferta = (pz.offer_id as string) ?? "";
        if (!oferta) continue;
        for (const k of [pz.offer_id, pz.external_id]) {
          if (k) ofertaWgKlucza.set(String(k), oferta);
        }
      }

      const zlozone: PozycjaZwrotu[] = surowe.map((p) => {
        const twId = p.tw_id == null ? null : Number(p.tw_id);
        const oferta = ofertaWgKlucza.get(String(p.offer_id ?? "")) ?? null;
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
          /* Czy ta pozycja jest na dokumencie MM (0.192.0). Ocena „na stan"
             dokłada ją do koszyka, ale pozycja BEZ KARTOTEKI wejść nie może —
             MM przesuwa stany kartotek. Ekran ma to powiedzieć wprost, bo
             cicha strata kończy się kartonem na hali z towarem spoza
             dokumentu. */
          wKoszyku: wKoszyku.has(Number(p.id)),
          url: (p.url as string) ?? null,
          twId,
          twSymbol: (p.tw_symbol as string) ?? null,
          twZrodlo: (p.tw_zrodlo as string) ?? null,
          sku: skuWgOferty.get(String(p.offer_id ?? "")) ?? null,
          /* Numer oferty NADAJĄCY SIĘ do zapytania o zdjęcie — patrz wyżej. */
          ofertaZamowienia: oferta,
          /* Bez numeru oferty nie ma o co pytać i to NIE jest „brak zdjęcia" —
             stan zostaje nieznany, a kafel mówi wtedy o braku POWIĄZANIA. */
          ofertaZdjecie: oferta === null ? "nieznane"
            : stanZdjeciaOferty(zdjeciaOfert.get(`${z.channel_account_id}|${oferta}`)),
          ean: twId === null ? null : eanWgTw.get(twId) ?? null,
          zrodlo: String(p.zrodlo ?? "allegro"),
          /* Ile NAPRAWDĘ wróciło; `null` = nikt jeszcze nie liczył (0.212.0). */
          iloscZwrocona: p.ilosc_zwrocona == null ? null : Number(p.ilosc_zwrocona),
          potracenieGrosze: p.potracenie_grosze == null ? null : Number(p.potracenie_grosze),
          potraceniePowod: (p.potracenie_powod as string) ?? null,
          /* Propozycję liczymy TYLKO tam, gdzie kartoteki jeszcze nie ma.
             Podpowiadanie obok potwierdzonego wyboru byłoby podważaniem
             decyzji człowieka, a §4.3 stawia ją wyżej niż wynik automatu. */
          propozycja: twId === null ? zaproponujKartoteke(database, {
            channelAccountId: Number(z.channel_account_id),
            orderId: (z.order_id as string) ?? null,
            offerId: (p.offer_id as string) ?? null,
            nazwa: String(p.nazwa),
          }) : null,
          /* Rabat liczy się dla KAŻDEJ pozycji, także rozstrzygniętej: wniosek
             o prowizję żyje własnym rytmem po stronie Allegro i bywa złożony
             długo po tym, jak zwrot zszedł z biurka. */
          rabat: stanRabatu(database, Number(p.id)),
        };
      });

      /* Które pozycje wracają — to jest cały powód, dla którego panel
         pokazuje CAŁE zamówienie, a nie same zwracane sztuki.

         Sprawdzamy OBIE kolumny z tego samego powodu co złączenie
         w `dopasowanie-sku.ts`: nie wiadomo, czy `offerId` ze zwrotu to
         numer oferty, czy identyfikator pozycji zamówienia. Do 0.153.1
         porównanie szło po jednej i przy rozjeździe ŻADNA pozycja nie
         dostawała plakietki WRACA — co samo w sobie było objawem. */
      const zamowienie = zam ? naZamowienie(zam, pozZamowienia, (p) =>
        wracajace.get((p.offer_id as string) ?? "")
          ?? wracajace.get((p.external_id as string) ?? "")
          ?? 0,
      /* Kartoteki przy pozycji ZAMÓWIENIA nie dokładamy i to jest decyzja:
         kolumna dowodów mówi, co klient KUPIŁ na Allegro, a co mamy na półce
         — mówi kolumna środkowa, przy pozycji zwrotu. Dwa razy to samo
         w jednym ekranie to szum, nie pomoc (dekalog, punkt 5). */
      undefined,
      /* Stan zdjęcia z mapy wczytanej raz na całą kolejkę. `offer_id` pozycji
         ZAMÓWIENIA to `lineItems[].offer.id` ze specyfikacji, więc tym wolno
         pytać — inaczej niż `offerId` pozycji zwrotu. */
      (p) => {
        const oferta = (p.offer_id as string) ?? "";
        return oferta === "" ? "nieznane"
          : stanZdjeciaOferty(zdjeciaOfert.get(`${z.channel_account_id}|${oferta}`));
      }) : null;

      return zloz(z, zlozone, zamowienie, teraz,
        rozmowyWgZam.get(String(z.order_id ?? "")) ?? [], surowe,
        drugiZwrotDla(z));
    })
    /* Najkrótszy termin na górze — to jest cała reguła kolejności i jedyna,
       jakiej ten ekran potrzebuje. ZWROTY BEZ TERMINU IDĄ NA KONIEC (0.339.0):
       ich paczka jeszcze nie wróciła, więc nie ma czego obsłużyć, a puste
       miejsce po terminie nie ma prawa udawać najpilniejszego. */
    .sort((a, b) => (a.dniDoTerminu ?? Infinity) - (b.dniDoTerminu ?? Infinity));
}

/**
 * Ile pozycji czeka na kartotekę i z jakiego powodu.
 *
 * Bez tej liczby nie da się powiedzieć, czy problem jest w kodzie, czy
 * w danych po stronie Allegro — a przez trzy wydania nie dało się tego
 * rozstrzygnąć właśnie dlatego, że każde zerwane ogniwo wyglądało tak samo.
 */
export function bilansKartotek(zwroty: WierszZwrotu[]) {
  const powody: Record<string, number> = {};
  let bez = 0;
  let wszystkie = 0;
  for (const z of zwroty) {
    /* Stany końcowe nie są pracą do zrobienia i nie mają prawa zawyżać
       licznika, który ma mówić „ile jeszcze przede mną". */
    if (z.kubelek === "zamkniety" || z.kubelek === "odrzucony") continue;
    for (const p of z.pozycje) {
      wszystkie++;
      if (p.twId !== null) continue;
      bez++;
      /* DWA RODZAJE CZEKANIA (0.220.0), bo znaczą co innego i co innego
         każą zrobić. Pewność `sku` wiąże automat sam — pozycja z taką
         propozycją NIE POWINNA tu stać, a gdy stoi, znaczy to, że automat
         nie chodzi (`services/wiazania.ts`). Pozostałe stopnie czekają
         na człowieka z założenia: zgadywanie prowadzi do korekty stanu
         w Subiekcie, więc klika je biuro. Jedna liczba na oba przypadki
         mieszała usterkę z pracą do zrobienia. */
      const powod = p.propozycja?.powod
        ?? (p.propozycja?.twId == null ? "inne"
          : p.propozycja.pewnosc === "sku" ? "do_zwiazania" : "do_zatwierdzenia");
      powody[powod] = (powody[powod] ?? 0) + 1;
    }
  }
  return { bez, wszystkie, powody };
}

/** Ile pracy stoi w każdym kubełku — liczby przy zakładkach kolejki. */
export function licznikiKubelkow(zwroty: WierszZwrotu[]): Record<Kubelek, number> {
  const puste: Record<Kubelek, number> = {
    decyzja: 0, ocena: 0, zwrot: 0, korekta: 0, zamkniety: 0, odrzucony: 0,
  };
  for (const z of zwroty) puste[z.kubelek]++;
  return puste;
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
 *
 * `zapamietaj: false` wiąże pozycję BEZ dopisania do `oferta_kartoteka`.
 * Używa tego automat sygnatur (0.169.0): pamięć niesie zdanie „wskazał to
 * człowiek" i jest w `zaproponujKartoteke` mocniejsza od automatu. Wpisanie
 * tam wyniku automatu podszywałoby go pod decyzję biura, a przy okazji
 * nadpisywało cudze imię w `wskazano_przez`.
 */
export function potwierdzKartoteke(
  database: Db,
  pozycjaId: number,
  twId: number | null,
  zrodlo: "sku" | "reczne",
  /* `id: null` = zrobił to automat, nie człowiek. `zwrot_zdarzenie.kto_user_id`
     ma klucz obcy do `app_user`, więc udawane zero wywróciłoby zapis na
     kluczu — a wpisanie tam cudzego konta byłoby kłamstwem w audycie. */
  kto: { id: number | null; name: string },
  teraz = new Date(),
  zapamietaj = true,
): { twId: number | null; twSymbol: string | null; twZrodlo: string | null } {
  const pozycja = database.prepare(
    `SELECT p.id, p.zwrot_id, p.offer_id, z.channel_account_id, z.order_id
     FROM zwrot_klienta_pozycja p
     JOIN zwrot_klienta z ON z.id = p.zwrot_id
     WHERE p.id=?`
  ).get(pozycjaId) as
    { id: number; zwrot_id: number; offer_id: string | null; channel_account_id: number;
      order_id: string | null } | undefined;
  if (!pozycja) throw new Error("Nie znaleziono pozycji zwrotu");

  if (twId === null) {
    database.prepare(`UPDATE zwrot_klienta_pozycja
      SET tw_id=NULL, tw_symbol=NULL, tw_zrodlo=NULL, tw_at=?, tw_przez=? WHERE id=?`)
      .run(teraz.toISOString(), kto.name, pozycjaId);
    /* Pamięć znika RAZEM z powiązaniem. Inaczej zdjęcie kartoteki nic by nie
       dało: następny odczyt zaproponowałby ją z powrotem, a operator
       zobaczyłby, że jego decyzja się nie przyjęła. */
    if (pozycja.offer_id) {
      database.prepare("DELETE FROM oferta_kartoteka WHERE channel_account_id=? AND offer_id=?")
        .run(pozycja.channel_account_id, pozycja.offer_id);
    }
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

  /* PAMIĘĆ POWIĄZAŃ — wzorzec `ean_alias`. Człowiek wskazuje kartotekę RAZ;
     ten sam towar wraca za miesiąc na innym zwrocie i wiąże się sam. Bez tego
     praca powtarza się w nieskończoność, a to jest dokładnie ten koszt, który
     panel zwrotów miał zdejmować.

     Pamięć trzyma się OFERTY, nie pozycji: pozycja żyje jednym zwrotem. */
  if (pozycja.offer_id && zapamietaj) {
    /* Sygnatura pozycji zamówienia W TEJ CHWILI (0.219.0) — po obu kolumnach
       złączenia, jak `dopasujPozycjeZamowienia`. Gdy sprzedawca przepnie
       sygnaturę, to wskazanie ma jej ustąpić — patrz `pamiecAktualna`. */
    const linia = pozycja.order_id ? database.prepare(`SELECT p.sku FROM zamowienie_klienta k
        JOIN zamowienie_klienta_pozycja p ON p.zamowienie_id = k.id
       WHERE k.channel_account_id=? AND k.external_id=? AND (p.offer_id=? OR p.external_id=?) LIMIT 1`)
      .get(pozycja.channel_account_id, pozycja.order_id, pozycja.offer_id, pozycja.offer_id) as
      { sku: string | null } | undefined : undefined;
    const skuWtedy = linia?.sku == null ? null : String(linia.sku);
    database.prepare(`INSERT INTO oferta_kartoteka
      (channel_account_id,offer_id,tw_id,tw_symbol,sku,sku_wtedy,wskazano_at,wskazano_przez)
      VALUES (?,?,?,?,?,?,?,?)
      ON CONFLICT(channel_account_id, offer_id) DO UPDATE SET
        tw_id=excluded.tw_id, tw_symbol=excluded.tw_symbol, sku=excluded.sku, sku_wtedy=excluded.sku_wtedy,
        wskazano_at=excluded.wskazano_at, wskazano_przez=excluded.wskazano_przez`).run(
      pozycja.channel_account_id, pozycja.offer_id, towar.tw_id, towar.symbol,
      zrodlo === "sku" ? towar.symbol : null, skuWtedy, teraz.toISOString(), kto.name);
  }

  database.prepare(`INSERT INTO zwrot_zdarzenie(zwrot_id,rodzaj,tresc,dane_json,kiedy_at,kto,kto_user_id)
    VALUES (?,?,?,?,?,?,?)`).run(
    pozycja.zwrot_id, "kartoteka",
    `Wskazano kartotekę ${towar.symbol}`,
    JSON.stringify({ pozycjaId, twId: towar.tw_id, zrodlo }),
    teraz.toISOString(), kto.name, kto.id);

  return { twId: towar.tw_id, twSymbol: towar.symbol, twZrodlo: zrodlo };
}

/* ── Decyzje biura (0.156.0) ─────────────────────────────────────────────────
   Do tego wydania kolejka bramek była DEKORACJĄ: `kubelekZwrotu` routuje po
   `werdykt`, ocenie pozycji, `kwota_grosze` i `korekta_numer`, a żadnej z tych
   kolumn nic nie zapisywało. Każdy zwrot stał w DO DECYZJI na zawsze.

   Trzy zapisy domykają trzy pierwsze kubełki. Korekta i zamknięcie zostają
   poza wydaniem: tamto wychodzi do Subiekta i ma własny kontrakt.

   KONTROLA WSPÓŁBIEŻNOŚCI jak przy rozmowie. Kolumna `wersja` stoi w schemacie
   od 0.150.0 z komentarzem „dwóch agentów nie zamyka jednego zwrotu dwiema
   różnymi kwotami" — dopiero teraz ma czego pilnować.                       */

export class ZwrotConflict extends Error {
  constructor(message: string, public readonly szczegoly: Record<string, unknown>) {
    super(message);
  }
}

type StanZwrotu = { id: number; wersja: number; werdykt: string | null; zamkniety_at: string | null };

/** Wczytanie ze sprawdzeniem wersji. Zwraca stan sprzed zmiany. */
function podKlucz(database: Db, zwrotId: number, wersja: number): StanZwrotu {
  const z = database.prepare(
    "SELECT id, wersja, werdykt, zamkniety_at FROM zwrot_klienta WHERE id=?")
    .get(zwrotId) as StanZwrotu | undefined;
  if (!z) throw new Error("Nie znaleziono zwrotu");
  if (Number(z.wersja) !== wersja) {
    throw new ZwrotConflict(
      "Zwrot zmienił się w międzyczasie — odśwież i sprawdź, co zrobił inny agent.",
      { wersja: Number(z.wersja), przyslana: wersja });
  }
  if (z.zamkniety_at) throw new Error("Zwrot jest zamknięty");
  return z;
}

const podnies = (database: Db, zwrotId: number) =>
  database.prepare("UPDATE zwrot_klienta SET wersja=wersja+1 WHERE id=?").run(zwrotId);

/**
 * Werdykt biura: przyjęcie albo odmowa.
 *
 * ODMOWA WYMAGA POWODU i to nie jest formalność. §25a.5 stawia ją wśród dwóch
 * rzeczy nieodwracalnych; zwrot odrzucony bez uzasadnienia nie da się później
 * obronić przed klientem ani przed Allegro.
 *
 * Nasza odmowa jest czymś innym niż `rejection_code` z Allegro i dlatego siedzi
 * w osobnych kolumnach — pochodzenie decyzji jest tu informacją, nie
 * szczegółem (patrz komentarz przy tabeli).
 */
export function rozstrzygnijZwrot(
  database: Db, zwrotId: number, decyzja: "przyjety" | "odrzucony",
  powod: string | null, wersja: number, kto: { id: number; name: string },
  teraz = new Date(),
): { werdykt: string; wersja: number } {
  const uzasadnienie = (powod ?? "").trim();
  if (decyzja === "odrzucony" && uzasadnienie === "") {
    throw new Error("Odmowa zwrotu wymaga powodu — bez niego nie ma czego pokazać klientowi.");
  }
  return transaction(database, () => {
    podKlucz(database, zwrotId, wersja);
    database.prepare(`UPDATE zwrot_klienta
      SET werdykt=?, werdykt_at=?, werdykt_przez=?, werdykt_user_id=?, werdykt_powod=?
      WHERE id=?`).run(decyzja, teraz.toISOString(), kto.name, kto.id,
        uzasadnienie === "" ? null : uzasadnienie, zwrotId);
    podnies(database, zwrotId);
    /* NA OŚ, nie tylko do dziennika (0.313.0). Do 0.284.0 oś zwrotu znała
       wyłącznie cofnięcia, bo tylko one ją zapisywały — karta pokazywałaby
       „Cofnięto przyjęcie" nad pustką po samym przyjęciu. `events` ma tę
       decyzję od zawsze, ale jest audytem SYSTEMU: nie ma retencji, nie ma
       ekranu i nie odpowiada na pytanie biura „co się z tą sprawą działo". */
    zdarzenie(database, zwrotId, "werdykt",
      decyzja === "przyjety" ? "Zwrot przyjęty" : `Odmowa: ${uzasadnienie}`,
      { decyzja, powod: uzasadnienie || null }, kto, teraz.toISOString());
    logEvent(`zwrot_werdykt_${decyzja}`, kto.name, null,
      { zwrotId, powod: uzasadnienie || null }, kto.id, database);
    return { werdykt: decyzja, wersja: wersja + 1 };
  })();
}

/**
 * Cofa PRZYJĘCIE zwrotu — wraca do kubełka DECYZJA (0.204.0).
 *
 * Trzeci i ostatni szczebel drabiny z §25a.5. Zgłoszenie właściciela: „gdy
 * kliknę przyjęcie zwrotu, na DO OCENY nie mogę tego cofnąć". Przyjęcie idzie
 * JEDNYM kliknięciem, bez pytania o nic — i tak ma zostać, bo tak wygląda
 * typowy zwrot. Kliknięcie bez pytania musi jednak mieć drogę powrotną,
 * inaczej cena pomyłki jest wyższa niż cena pytania, którego celowo nie ma.
 *
 * ODMOWY NIE COFAMY. Idzie do Allegro jako oświadczenie wobec klienta i drugiej
 * takiej samej nie da się złożyć (422) — dlatego to ona ma potwierdzenie
 * w formie wpisanego powodu, a nie cofnięcie.
 *
 * OCENA MUSI ZEJŚĆ PIERWSZA. Schodzi się po JEDNYM szczeblu: gdyby cofnięcie
 * werdyktu czyściło przy okazji oceny, kasowałoby wpisy, których nikt o to nie
 * prosił — a przy pozycji z zamkniętego koszyka rozjechałoby papier
 * z zawartością, czyli obeszłoby bramkę z `ocenPozycje`. Zwrot z ustaloną
 * kwotą jest tym samym przypadkiem: kwota bez kompletu ocen nie istnieje.
 */
export function cofnijWerdykt(
  database: Db, zwrotId: number, wersja: number, kto: { id: number; name: string },
  teraz = new Date(),
): { wersja: number } {
  return transaction(database, () => {
    const z = podKlucz(database, zwrotId, wersja);
    if (!z.werdykt) throw new Error("Ten zwrot nie ma jeszcze werdyktu");
    if (z.werdykt === "odrzucony") {
      throw new Error(
        "Odmowy zwrotu nie cofam — poszła do klienta jako oświadczenie i drugiej " +
        "takiej samej Allegro nie przyjmie.");
    }
    const pieniadze = database.prepare(
      "SELECT zwrot_pieniedzy_id FROM zwrot_klienta WHERE id=?")
      .get(zwrotId) as { zwrot_pieniedzy_id: string | null };
    if (pieniadze.zwrot_pieniedzy_id) {
      throw new Error("Pieniądze zostały już oddane — przyjęcia nie cofam.");
    }
    /* KWOTA BEZ OCEN ISTNIEJE (0.484.7). `zapiszKwote` wymaga samego
       przyjęcia, więc komentarz wyżej zakładał za dużo: cofnięcie werdyktu
       zostawiało kwotę i zlecone ZW na zwrocie bez decyzji. */
    const kwota = database.prepare("SELECT kwota_grosze FROM zwrot_klienta WHERE id=?")
      .get(zwrotId) as { kwota_grosze: number | null };
    if (kwota.kwota_grosze != null) {
      throw new Error("Najpierw cofnij kwotę — przyjęcie jest pod nią.");
    }
    const ocenione = database.prepare(
      `SELECT id, nazwa FROM zwrot_klienta_pozycja
        WHERE zwrot_id=? AND ocena IS NOT NULL`).all(zwrotId) as Array<{ id: number; nazwa: string }>;
    /* Pozycja na wystawionym MM oceny nie odda (`ocenPozycje`), więc „najpierw
       cofnij oceny" byłoby drogą donikąd (0.484.7). Mówimy to wprost. */
    for (const p of ocenione) {
      const kosz = zamknietyKoszPozycji(database, Number(p.id));
      if (kosz) {
        throw new Error(`„${p.nazwa}” jest już na dokumencie MM koszyka ${kosz.kod} — ` +
          "przyjęcia nie cofnę, bo towar pojechał na regał.");
      }
    }
    if (ocenione.length > 0) {
      throw new Error(`Najpierw cofnij oceny (${ocenione.length}) — przyjęcie jest pod nimi.`);
    }

    const kiedy = teraz.toISOString();
    database.prepare(`UPDATE zwrot_klienta
      SET werdykt=NULL, werdykt_at=NULL, werdykt_przez=NULL, werdykt_user_id=NULL,
          werdykt_powod=NULL
      WHERE id=?`).run(zwrotId);
    podnies(database, zwrotId);
    zdarzenie(database, zwrotId, "werdykt_cofniety", "Cofnięto przyjęcie zwrotu", {}, kto, kiedy);
    logEvent("zwrot_werdykt_cofniety", kto.name, null, { zwrotId }, kto.id, database);
    return { wersja: wersja + 1 };
  })();
}

/** Trzy oceny pozycji zwrotu; `null` cofa ocenę (0.375.0). */
export type OcenaPozycji = "stan" | "utylizacja" | "outlet" | null;

/** Jak ocena brzmi na osi zwrotu — czyta ją człowiek, nie kod. */
const OPIS_OCENY: Record<Exclude<OcenaPozycji, null>, string> = {
  stan: "na stan", utylizacja: "utylizacja", outlet: "na outlet",
};

/**
 * Ocena towaru: na stan, do utylizacji albo na outlet. `null` cofa ocenę.
 *
 * OCENA „NA STAN" DOKŁADA POZYCJĘ DO KOSZYKA ZWROTÓW (0.192.0) — bez
 * osobnego ruchu. Właściciel opisał obieg biura tak: „gdy agent zasiada do
 * zwrotów, to otwiera pustą MM i dodaje kolejno przedmioty ze zwrotów; gdy
 * koszyk się zapełni, zamyka MM i tak w kółko". Naciśnięcie, które operator
 * i tak wykonuje, JEST tym dołożeniem; osobny przycisk kazałby mu powiedzieć
 * dwa razy to samo.
 *
 * OCENY SĄ TRZY OD 0.375.0, a trzecia ma warunek. „Przecena" stała tu od
 * 0.156.0 i zeszła w 0.209.0, bo nie prowadziła DONIKĄD: nie dokładała do
 * koszyka, nie ruszała stanu, nie zakładała zadania — zapisywała się i na tym
 * się kończyła. Trzeci przycisk, który wygląda jak decyzja, a nie jest żadną,
 * kosztuje operatora namysł przy każdej pozycji.
 *
 * „Outlet" stoi w tym samym miejscu i też nie tworzy dokumentu — magazyn
 * outletowy nie jest skonfigurowany, bo właściciel obsługuje go RĘKĄ (decyzja
 * z 16 września 2026). Wolno jej tu stać, bo kończy się LISTĄ ROBOCZĄ:
 * `pozycjeNaOutlet` wymienia, co czeka na przeniesienie, a `przeniesionoNaOutlet`
 * to odklikuje. Bez tej listy byłaby „przeceną" drugi raz.
 *
 * Czego ta ocena BRONI: towar używany bez własnej oceny dostawał „na stan",
 * jechał na halę i wracał MM-em powrotnym na półkę pickingową obok
 * fabrycznych. Kompletujący brał ten, który stał bliżej.
 *
 * KAŻDA OCENA MA SWÓJ KOSZYK (0.211.0). „Stan" idzie na regał zwrotów,
 * „utylizacja" na magazyn odpadu — decyzja właściciela. Do 0.210.0 utylizacja
 * zapisywała się i na tym koniec: bez dokumentu, bez ruchu stanu, bez listy.
 * Towar leżał, a w Subiekcie nie było po nim żadnego śladu. Był to dokładnie
 * ten ślepy zaułek, za który w 0.209.0 zdjęto „przecenę" — tylko utylizacji
 * nikt wtedy nie policzył.
 *
 * Odpad bez `MAG_ID_ODP` w `wertis.env` zachowuje się jak przed 0.211.0:
 * ocena się zapisuje, koszyka nie ma. Zgadnięty numer magazynu wystawiłby
 * dokument przesuwający złom w cudze miejsce.
 *
 * `koszyk` w wyniku mówi, czy dołożenie się udało. Pozycja bez kartoteki nie
 * ma `tw_id`, a MM przesuwa stany kartotek — ocena zapisuje się mimo to, bo
 * jest faktem o towarze, ale ekran musi powiedzieć, czego nie zrobił.
 */
export function ocenPozycje(
  database: Db, pozycjaId: number, ocena: OcenaPozycji,
  wersja: number, kto: { id: number; name: string }, teraz = new Date(),
  koszId?: number | null,
): { wersja: number; koszyk: number | null } {
  const p = database.prepare(
    "SELECT id, zwrot_id, nazwa FROM zwrot_klienta_pozycja WHERE id=?")
    .get(pozycjaId) as { id: number; zwrot_id: number; nazwa: string } | undefined;
  if (!p) throw new Error("Nie znaleziono pozycji zwrotu");
  return transaction(database, () => {
    const z = podKlucz(database, Number(p.zwrot_id), wersja);
    /* Ocena ma sens dopiero po przyjęciu. Ocenianie towaru ze zwrotu, którego
       nie przyjęliśmy, zostawiałoby w bazie decyzję o czymś, co nie wraca. */
    if (z.werdykt !== "przyjety") throw new Error("Najpierw przyjmij zwrot");
    /* ODMOWA PRZED ZAPISEM, nie po nim: pozycja z zamkniętego koszyka jest już
       na dokumencie MM, który pojechał na halę. Do 0.202.0 zmiana oceny
       przechodziła tu po cichu i zostawiała towar na cudzym papierze — bez
       oceny, która go tam posłała, więc i bez tropu przy szukaniu. */
    const zamkniety = zamknietyKoszPozycji(database, pozycjaId);
    if (zamkniety) {
      throw new Error(`Pozycja jest na zamkniętym koszyku ${zamkniety.kod} — ` +
        "dokument już pojechał na halę.");
    }
    database.prepare(`UPDATE zwrot_klienta_pozycja
      SET ocena=?, ocena_at=?, ocena_przez=? WHERE id=?`)
      .run(ocena, ocena === null ? null : teraz.toISOString(),
        ocena === null ? null : kto.name, pozycjaId);
    podnies(database, Number(p.zwrot_id));
    /* Zdanie niesie NAZWĘ TOWARU, nie identyfikator pozycji: oś czyta człowiek
       szukający odpowiedzi „co się stało z tym sekatorem", a numer wiersza nie
       odpowiada na nic. */
    zdarzenie(database, Number(p.zwrot_id), ocena === null ? "ocena_cofnieta" : "ocena",
      ocena === null ? `${p.nazwa} — cofnięto ocenę` : `${p.nazwa} — ${OPIS_OCENY[ocena]}`,
      { pozycjaId, ocena }, kto, teraz.toISOString());
    logEvent(ocena === null ? "zwrot_ocena_cofnieta" : "zwrot_ocena", kto.name, null,
      { zwrotId: Number(p.zwrot_id), pozycjaId, ocena }, kto.id, database);
    /* Zmiana oceny ZDEJMUJE z koszyka, zanim cokolwiek dołoży. Inaczej
       „na stan", potem „utylizacja" zostawiłoby towar na dokumencie MM,
       którego nikt już nie chce na regale. Kosza z DOKUMENTEM to nie rusza —
       tamten pojechał na halę z wystawionym papierem (bramka wyżej). */
    zdejmijZKosza(database, pozycjaId, kto);
    /* Każda ocena do SWOJEGO koszyka. `zdejmijZKosza` wyżej zdejmuje
       z dowolnego kosza bez dokumentu, więc „na stan", potem „utylizacja"
       przenosi pozycję z jednego pudła do drugiego, a nie zostawia jej w obu. */
    /* OUTLET NIE MA KOSZYKA i to jest jego definicja, nie brak. Magazyn
       outletowy nie jest skonfigurowany, więc dokument MM nie miałby dokąd
       jechać — a zgadnięty numer przesunąłby używkę w cudze miejsce. */
    /* WSKAZANY KOSZYK JEDZIE DALEJ (0.379.0). Przy kilku otwartych pudłach
       `dolozDoKosza` odmawia zgadywania i oddaje wybór ekranowi — decyzja
       właściciela. Przy jednym pudle nikt o nic nie pyta. */
    const koszyk = ocena === null || ocena === "outlet" ? null
      : dolozDoKosza(database, pozycjaId, kto, teraz,
        ocena === "utylizacja" ? "odpad" : "zwroty", koszId);
    /* Zmiana oceny na inną KASUJE ślad przeniesienia: pozycja, która wraca do
       obiegu magazynowego, nie czeka już na niczyją rękę przy regale. */
    if (ocena !== "outlet") {
      database.prepare(
        "UPDATE zwrot_klienta_pozycja SET outlet_at=NULL, outlet_przez=NULL WHERE id=?")
        .run(pozycjaId);
    }
    return { wersja: wersja + 1, koszyk };
  })();
}

/* ── Lista robocza outletu (0.375.0) ────────────────────────────────────────
   Warunek, pod którym trzecia ocena w ogóle weszła. „Przecena" zeszła
   w 0.209.0, bo kończyła się znacznikiem w bazie — a znacznik, którego nikt
   nie czyta, jest ślepym zaułkiem. Tu znacznik ma czytelnika: człowieka, który
   niesie używkę na regał i wystawia jej MM w Subiekcie.

   Lista mówi, CO czeka. Odkliknięcie mówi, że już nie czeka. Nic poza tym —
   żadnego dokumentu z naszej strony, bo magazyn outletowy obsługuje dziś ręka
   (decyzja właściciela, 16 września 2026).                                    */

export interface PozycjaNaOutlet {
  pozycjaId: number;
  zwrotId: number;
  /** Numer zwrotu — po nim człowiek wraca do sprawy, gdy coś się nie zgadza. */
  numer: string;
  nazwa: string;
  /** Kartoteka, jeśli znana; bez niej zostaje sama nazwa z Allegro. */
  twId: number | null;
  symbol: string | null;
  ilosc: number;
  /**
   * Ile wartości ta sztuka straciła, w groszach.
   *
   * Nie ozdoba: to jest liczba, którą oddaliśmy klientowi MNIEJ, więc mówi
   * wprost, o ile przedmiot potaniał. Kto wycenia regał, ma ją pod ręką
   * zamiast szacować z pamięci.
   */
  potracenieGrosze: number | null;
  ocenionoAt: string | null;
}

/**
 * Pozycje ocenione „na outlet", których nikt jeszcze nie przeniósł.
 *
 * Kolejność od najstarszej: regał outletowy nie ma priorytetów, a przedmiot
 * leżący przy biurku od tygodnia jest jedyną rzeczą, o którą tu chodzi.
 */
export function pozycjeNaOutlet(database: Db = defaultDb()): PozycjaNaOutlet[] {
  return (database.prepare(
    `SELECT p.id, p.zwrot_id, p.nazwa, p.tw_id, p.tw_symbol, p.ilosc, p.ilosc_zwrocona,
            p.potracenie_grosze, p.ocena_at,
            COALESCE(z.reference_number, z.external_id) AS numer
       FROM zwrot_klienta_pozycja p
       JOIN zwrot_klienta z ON z.id = p.zwrot_id
      WHERE p.ocena='outlet' AND p.outlet_at IS NULL
      ORDER BY p.ocena_at, p.id`).all() as Array<Record<string, unknown>>)
    .map((w) => ({
      pozycjaId: Number(w.id), zwrotId: Number(w.zwrot_id), numer: String(w.numer),
      nazwa: String(w.nazwa),
      twId: w.tw_id === null ? null : Number(w.tw_id),
      symbol: (w.tw_symbol as string) ?? null,
      /* TO, CO WRÓCIŁO, nie deklaracja klienta — ta sama reguła co przy
         koszyku (`iloscLiczona`). Na regał trafia tyle sztuk, ile leży
         w pudle. */
      ilosc: iloscLiczona(w as { ilosc: number; ilosc_zwrocona: number | null }),
      potracenieGrosze: w.potracenie_grosze === null ? null : Number(w.potracenie_grosze),
      ocenionoAt: (w.ocena_at as string) ?? null,
    }));
}

/**
 * Odklikanie: ta pozycja stoi już na regale outletowym.
 *
 * BEZ WERSJI ZWROTU, świadomie. To nie jest zmiana decyzji o zwrocie ani
 * o pieniądzach, tylko meldunek o wykonanej pracy fizycznej — a dwie osoby
 * meldujące to samo pudło nie mają o co się spierać. Powtórzenie jest ciche
 * i zostawia pierwszy podpis: liczy się, że towar tam JEST.
 */
export function przeniesionoNaOutlet(
  database: Db, pozycjaId: number, kto: { id: number; name: string }, teraz = new Date(),
): { pozycjaId: number; outletAt: string } {
  const p = database.prepare(
    "SELECT id, zwrot_id, nazwa, ocena, outlet_at FROM zwrot_klienta_pozycja WHERE id=?")
    .get(pozycjaId) as
    { id: number; zwrot_id: number; nazwa: string; ocena: string | null;
      outlet_at: string | null } | undefined;
  if (!p) throw new Error("Nie znaleziono pozycji zwrotu");
  if (p.ocena !== "outlet") {
    throw new Error(`„${p.nazwa}" nie jest oceniona na outlet — nie ma czego przenosić.`);
  }
  if (p.outlet_at) return { pozycjaId, outletAt: p.outlet_at };

  const at = teraz.toISOString();
  return transaction(database, () => {
    database.prepare(
      "UPDATE zwrot_klienta_pozycja SET outlet_at=?, outlet_przez=? WHERE id=?")
      .run(at, kto.name, pozycjaId);
    zdarzenie(database, Number(p.zwrot_id), "outlet",
      `${p.nazwa} — przeniesiono na regał outletowy`, { pozycjaId }, kto, at);
    logEvent("zwrot_outlet_przeniesiony", kto.name, null,
      { zwrotId: Number(p.zwrot_id), pozycjaId }, kto.id, database);
    return { pozycjaId, outletAt: at };
  })();
}

/**
 * Skład kompletu wskazany ręką biura, z dołożeniem do koszyka (0.336.0).
 *
 * Zgłoszenie właściciela: „rozwiąż «nie weszła do koszyka» — nie wiem, gdzie
 * to wskazać". Zapis samego składu nie kończy sprawy: pozycja ma już ocenę
 * „na stan", tylko odbiła się od braku rozbicia. Kazanie operatorowi cofnąć
 * ocenę i postawić ją drugi raz byłoby pytaniem o to, co już powiedział.
 *
 * DOKŁADAMY WYŁĄCZNIE PRZY OCENIE „NA STAN". Pozycja bez oceny albo do
 * utylizacji nie ma czego szukać na regale zwrotów — skład zapisuje się
 * mimo to, bo jest faktem o ofercie, nie o tym jednym zwrocie.
 */
export function wskazSklad(
  database: Db, pozycjaId: number,
  skladniki: Array<{ twId: number; naKomplet: number }>,
  kto: { id: number; name: string }, teraz = new Date(),
): { sklad: SkladPozycji; koszyk: number | null } {
  return transaction(database, () => {
    const sklad = zapiszSkladRecznie(database, pozycjaId, skladniki, kto, teraz);
    const p = database.prepare(
      "SELECT zwrot_id, ocena FROM zwrot_klienta_pozycja WHERE id=?").get(pozycjaId) as
      { zwrot_id: number; ocena: string | null };
    zdarzenie(database, Number(p.zwrot_id), "sklad_wskazany",
      `skład kompletu wskazany ręcznie — kartotek: ${sklad.skladniki.length}`,
      { pozycjaId, kartotek: sklad.skladniki.length }, kto, teraz.toISOString());
    const koszyk = p.ocena === "stan" ? dolozDoKosza(database, pozycjaId, kto, teraz) : null;
    return { sklad, koszyk };
  })();
}

/**
 * Rejestracja paczki, która wróciła NIEODEBRANA (0.172.0).
 *
 * ── FORMULARZ ODSZEDŁ W 0.451.0, WIERSZ WRÓCIŁ W 0.493.0 ────────────────
 * W 0.451.0 rejestracja zniknęła z panelu i z serwera, decyzją właściciela.
 * Funkcja została, bo jest JEDYNĄ definicją kształtu takiego wiersza. Wraca
 * do niej `przyjmijNieodebrana`, nową decyzją — uzasadnienie stoi tam.
 *
 * Allegro takiego bytu nie zna: `CustomerReturn` powstaje z DEKLARACJI klienta,
 * a nieodebrana przesyłka wraca sama i zwrotem nigdy nie zostanie. Pieniądze
 * i tak trzeba oddać, więc paczka idzie TĄ SAMĄ kolejką — ale z jawnym
 * oznaczeniem `zrodlo = "nieodebrana"`, żeby nigdzie nie udawała zgłoszenia.
 *
 * Identyfikator dostaje przedrostek `nieodebrana:`. Dwie rzeczy naraz: nigdy
 * nie zderzy się z UUID-em z Allegro, więc synchronizator go nie tknie, i widać
 * na pierwszy rzut oka, że to nasz wiersz, a nie cudzy.
 *
 * Gdy podany numer zamówienia jest już w bazie, pozycje przepisujemy z niego —
 * bez nich zwrot nie miałby czego wycenić, a operator nie wie, co w paczce
 * jest, dopóki jej nie otworzy.
 *
 * ── LOGIN KUPUJĄCEGO (0.365.0) ─────────────────────────────────────────────
 * Zgłoszenie właściciela: „nieodebrane paczki powinienem móc wyszukiwać po
 * loginie klienta". Szukanie w panelu zna login od 0.337.0 i pole mówi to
 * wprost — ale TEJ paczce login brał się wyłącznie z zamówienia, a numeru
 * zamówienia przy nieodebranej najczęściej nie ma. Karton wraca sam, bez
 * zgłoszenia i bez kopii z Allegro, więc jedyne, co operator ma pod ręką, to
 * naklejka i wiadomość od klienta. Szukanie po loginie milczało wtedy tak
 * samo, jak gdyby paczki nie było — a to najgorszy rodzaj odpowiedzi.
 *
 * Login WPISANY bije ten z zamówienia, bo pochodzi od człowieka patrzącego na
 * sprawę. Gdy go nie ma, bierzemy z zamówienia — i zapisujemy do KOLUMNY,
 * zamiast liczyć na złączenie przy każdym odczycie: zwrot ma zostać
 * odnajdywalny także wtedy, gdy zamówienie wypadnie z okna synchronizacji.
 */

/*
 * ── NAZWA ODBIORCY I PRZEWOŹNIK Z NAKLEJKI (0.367.0) ───────────────────────
 * Właściciel: paczki nakleja klient albo kurier i tych numerów w Allegro nie
 * ma. To przewraca założenie z 0.172.0, że nietrafiony skan wracającej paczki
 * to zwykły wyścig synchronizacji — numeru z naklejki nasz system nie widział
 * NIGDY i nie zobaczy, więc pierwszy skan musi chybić z definicji.
 *
 * Zostają dwa uchwyty, które na naklejce widać: nazwa odbiorcy i przewoźnik.
 * Oba zapisujemy do kolumn zwrotu i oba wchodzą do szukania — dopiero razem
 * z loginem dają odpowiedź na „czyja to paczka i która".
 */

/** Ile znaków loginu zapisujemy. Allegro trzyma się dużo krótszych. */
const LIMIT_LOGINU = 100;

/** Ile znaków nazwy odbiorcy. Naklejka i tak nie mieści więcej. */
const LIMIT_NAZWY = 120;

export function zarejestrujNieodebrana(
  database: Db, dane: {
    waybill?: string | null; orderId?: string | null; notatka?: string | null;
    login?: string | null; odbiorcaNazwa?: string | null; przewoznik?: string | null;
  },
  kto: { id: number; name: string }, teraz = new Date(),
): { zwrotId: number; pozycji: number } {
  const waybill = (dane.waybill ?? "").trim();
  const orderId = (dane.orderId ?? "").trim() || null;
  /* Uchwytem jest numer listu ALBO zamówienie (0.493.0). Do 0.451.0 list
     był jedynym, bo formularz zakładał zwrot bez zamówienia. Przycisk przy
     wyniku szukania zna zamówienie zawsze, a listu nie, gdy biuro szukało
     klienta bez skanu naklejki. */
  if (!waybill && !orderId) {
    throw new Error("Numer listu przewozowego jest tu jedynym uchwytem — podaj go.");
  }

  const konto = database.prepare("SELECT id FROM channel_account ORDER BY id LIMIT 1")
    .get() as { id: number } | undefined;
  if (!konto) throw new Error("Brak konta kanału — sparuj konto Allegro: /obsluga → STAN SYSTEMU → KONTO ALLEGRO.");

  const external = `nieodebrana:${waybill || orderId}`;
  const juz = database.prepare(
    "SELECT id FROM zwrot_klienta WHERE channel_account_id=? AND external_id=?")
    .get(konto.id, external) as { id: number } | undefined;
  if (juz) throw new Error(`Ta paczka jest już zarejestrowana (zwrot ${juz.id}).`);

  const at = teraz.toISOString();

  /* Zamówienie czytamy PRZED wstawieniem, bo niesie login. Pozycje idą niżej
     własnym zapytaniem — tamto jest starsze i działa, a dublowanie odczytu
     jednego wiersza przy rejestracji jednej paczki nic nie kosztuje. */
  const zam = orderId
    ? database.prepare(`SELECT kupujacy_login, odbiorca_nazwa FROM zamowienie_klienta
         WHERE channel_account_id=? AND external_id=?`)
      .get(konto.id, orderId) as
      { kupujacy_login: string | null; odbiorca_nazwa: string | null } | undefined
    : undefined;
  const login = (dane.login ?? "").trim().slice(0, LIMIT_LOGINU)
    || (zam?.kupujacy_login ?? null);
  /* Ta sama zasada co przy loginie: wpisane bije to z zamówienia, bo pochodzi
     od człowieka patrzącego na naklejkę. Adres dostawy bywa inny niż kupujący
     i to WŁAŚNIE ta nazwa stoi na kartonie. */
  const odbiorca = (dane.odbiorcaNazwa ?? "").trim().slice(0, LIMIT_NAZWY)
    || (zam?.odbiorca_nazwa ?? null);
  /* Przewoźnika przy nieodebranej Allegro nie zna wcale — do 0.366.0 kolumna
     zostawała pusta. Operator widzi go na naklejce, a wybór z listy nie
     wymaga pisania. Trzymamy SUROWO, jak przy zwrocie z Allegro. */
  const przewoznik = (dane.przewoznik ?? "").trim().toUpperCase() || null;

  return transaction(database, () => {
    database.prepare(`INSERT INTO zwrot_klienta
      (channel_account_id,external_id,order_id,created_at,paczka_at,dostarczono_at,
       zrodlo,waybill,notatka,kupujacy_login,odbiorca_nazwa,przewoznik,synced_at)
      VALUES (?,?,?,?,?,?,'nieodebrana',?,?,?,?,?,?)`).run(
      konto.id, external, orderId, at,
      /* Paczka JEST u nas — inaczej nie byłoby czego rejestrować. To jedyny
         zwrot, przy którym datę powrotu znamy na pewno, więc `dostarczono_at`
         wpisuje się od razu zamiast czekać na tracking, którego tu nie ma:
         przy paczce nieodebranej nie znamy przewoźnika, a Allegro nie zna
         samego zwrotu. Bez tego panel pytał „czy dotarła" o karton leżący
         na biurku operatora. */
      at, at, waybill || null, (dane.notatka ?? "").trim() || null,
      login, odbiorca, przewoznik, at);
    const zwrotId = Number((database.prepare(
      "SELECT id FROM zwrot_klienta WHERE channel_account_id=? AND external_id=?")
      .get(konto.id, external) as { id: number }).id);

    let pozycji = 0;
    if (orderId) {
      const poz = database.prepare(`SELECT p.offer_id, p.nazwa, p.ilosc, p.cena_grosze, p.waluta
        FROM zamowienie_klienta_pozycja p
        JOIN zamowienie_klienta k ON k.id = p.zamowienie_id
       WHERE k.channel_account_id=? AND k.external_id=?`)
        .all(konto.id, orderId) as Array<Record<string, unknown>>;
      /* Przyrostek liczy się per POWTÓRZENIE, nie per wiersz — poprawka
         0.174.2. Do niej stało tu `i + 1` z pętli, więc druga pozycja
         zamówienia dostawała `|#2` nawet wtedy, gdy niczego nie powtarzała.
         Taki napis w kluczu zderzał się potem w migracji z prawdziwym
         duplikatem sąsiada i kładł start aplikacji. */
      const wystapienia = new Map<string, number>();
      poz.forEach((p) => {
        const baza = `${p.offer_id ?? ""}|${p.nazwa}`;
        const n = (wystapienia.get(baza) ?? 0) + 1;
        wystapienia.set(baza, n);
        database.prepare(`INSERT INTO zwrot_klienta_pozycja
          (zwrot_id,offer_id,nazwa,ilosc,cena_grosze,waluta,klucz)
          VALUES (?,?,?,?,?,?,?)`).run(
          zwrotId, (p.offer_id as string) ?? null, String(p.nazwa), Number(p.ilosc),
          Number(p.cena_grosze), String(p.waluta ?? "PLN"),
          `${baza}${n > 1 ? `|#${n}` : ""}`);
      });
      pozycji = poz.length;
    }

    /* W dzienniku SAME FAKTY, nie dane osobowe. Zdarzenie odpowiada na pytanie
       „skąd ten wiersz", a do tego wystarczy, że uchwyt był; login i nazwa
       odbiorcy leżą w kolumnach zwrotu i stamtąd się je czyta. Przewoźnik
       daną osobową nie jest, więc idzie wprost. */
    logEvent("zwrot_nieodebrana", kto.name, null,
      { zwrotId, orderId, pozycji, zLoginem: login !== null,
        zOdbiorca: odbiorca !== null, przewoznik }, kto.id, database);
    return { zwrotId, pozycji };
  })();
}

/**
 * Paczka nieodebrana przyjęta JEDNYM KLIKIEM z wyniku szukania (0.493.0).
 *
 * Decyzja właściciela, po pytaniu „jak procesujemy paczki, które wracają
 * nieodebrane". Od 0.451.0 biuro tylko szukało zamówienia, a resztę robiło
 * poza panelem: ZW w Subiekcie, towar na półkę, przelew w Allegro. Taka paczka
 * nie miała ani oceny, ani koszyka, ani automatu ZW, ani śladu oddanych
 * pieniędzy — czyli żadnej z rzeczy, dla których zwroty w ogóle są w panelu.
 *
 * To NIE jest powrót formularza z 0.451.0. Tamten miał sześć pól i zasłaniał
 * login. Ten przycisk stoi przy zamówieniu, które operator już wskazał, więc
 * pyta o nic: pozycje, login i odbiorcę bierze z zamówienia.
 *
 * TRZY BRAMKI, każda przed zapisem, każda z własnym zdaniem:
 * - zamówienia nie ma w bazie — bez niego zwrot nie miałby pozycji, czyli
 *   niczego do wyceny;
 * - zamówienie nie ma pozycji — to samo z drugiej strony;
 * - zamówienie ma już zwrot — drugi wiersz to druga kwota do oddania za ten
 *   sam towar. Jedno zamówienie bywa dwiema paczkami, ale tę rzadkość biuro
 *   rozstrzyga na istniejącym zwrocie, a nie drugim kliknięciem.
 */
export function przyjmijNieodebrana(
  database: Db, dane: { orderId: string; waybill?: string | null },
  kto: { id: number; name: string }, teraz = new Date(),
): { zwrotId: number; pozycji: number } {
  const orderId = (dane.orderId ?? "").trim();
  if (!orderId) throw new Error("Wskaż zamówienie, którego paczka wróciła.");
  const konto = database.prepare("SELECT id FROM channel_account ORDER BY id LIMIT 1")
    .get() as { id: number } | undefined;
  if (!konto) throw new Error("Brak konta kanału — sparuj konto Allegro: /obsluga → STAN SYSTEMU → KONTO ALLEGRO.");

  const zam = database.prepare(`SELECT k.id,
      (SELECT COUNT(*) FROM zamowienie_klienta_pozycja p WHERE p.zamowienie_id = k.id) AS pozycji
      FROM zamowienie_klienta k WHERE k.channel_account_id=? AND k.external_id=?`)
    .get(konto.id, orderId) as { id: number; pozycji: number } | undefined;
  if (!zam) {
    throw new ZwrotConflict(
      "Nie znam tego zamówienia — wyszukaj klienta po pełnym loginie, żeby pobrać je z Allegro.",
      { orderId });
  }
  if (!Number(zam.pozycji)) {
    throw new ZwrotConflict("Zamówienie nie ma pozycji, więc zwrot nie miałby czego wycenić.",
      { orderId });
  }
  const byl = database.prepare(`SELECT id, COALESCE(reference_number, external_id) AS numer
      FROM zwrot_klienta WHERE channel_account_id=? AND order_id=? ORDER BY id LIMIT 1`)
    .get(konto.id, orderId) as { id: number; numer: string } | undefined;
  if (byl) {
    throw new ZwrotConflict(
      `To zamówienie ma już zwrot ${byl.numer.replace(/^nieodebrana:/, "")} — pracuj na nim.`,
      /* Identyfikator jedzie z odmową, żeby panel mógł ten zwrot otworzyć:
         odmowa, po której trzeba go jeszcze szukać, to drugi krok za darmo. */
      { zwrotId: Number(byl.id) });
  }
  return zarejestrujNieodebrana(database, { orderId, waybill: dane.waybill ?? null }, kto, teraz);
}

/* ── Dopisanie produktu do zwrotu (0.184.0) ──────────────────────────────────
   Klient zgłasza jedną rzecz, a odsyła dwie. To nie jest wypadek przy pracy,
   tylko normalny bieg: formularz zwrotu wypełnia się na ekranie, a paczkę
   pakuje się przy stole i wtedy dokłada się to, co też nie pasowało.

   Regulamin Allegro stoi po stronie klienta i nie wymaga, żeby jedno zgadzało
   się z drugim. Liczy się TERMINOWE OŚWIADCZENIE o odstąpieniu, nie zgodność
   przesyłki ze zgłoszeniem; opóźnienie samej wysyłki nie unieważnia
   odstąpienia. Pieniądze i tak trzeba oddać, więc biuro musi mieć czym
   zapisać to, co naprawdę przyszło.

   Produkt wybiera się Z ZAMÓWIENIA, nie z pola tekstowego. Klient może odesłać
   wyłącznie to, co kupił, więc lista zamówienia jest granicą naturalną —
   a ograniczenie jest tańsze od komunikatu (dekalog ergonomii, punkt 6).
   Przy okazji pozycja przynosi cenę i walutę, więc kwota do oddania dalej
   liczy się z faktów, nie z tego, co ktoś wpisze.                            */

/** Pozycja zamówienia, której NIE MA jeszcze w zwrocie — kandydat do dopisania. */
export interface DoDopisania {
  zamPozycjaId: number;
  offerId: string | null;
  /** Stan zdjęcia oferty (0.217.0) — kandydat też jest odniesieniem do towaru. */
  ofertaZdjecie: StanZdjeciaOferty;
  nazwa: string;
  /** Ile sztuk BRAKUJE w zwrocie — tyle wejdzie przy dopisaniu (0.484.7). */
  ilosc: number;
  /** Ile kupiono w tej linii zamówienia; różne od `ilosc`, gdy część już wraca. */
  zamowiono: number;
  cenaGrosze: number;
  waluta: string;
}

/**
 * Co jeszcze z tego zamówienia można dopisać.
 *
 * Lista jest RÓŻNICĄ zamówienia i zwrotu, a nie całym zamówieniem. Pokazywanie
 * pozycji już zgłoszonych kazałoby operatorowi porównywać dwie listy oczami —
 * a to jest dokładnie ta praca, którą ekran ma zdjąć (dekalog, punkt 5).
 *
 * ── RÓŻNICA W SZTUKACH, NIE W LINIACH (0.484.7) ─────────────────────────────
 * Zgłoszenie właściciela: klient zgłosił jedną nakrętkę z dwóch, a w kartonie
 * przyszły obie. Linia zamówienia stała już w zwrocie, więc lista jej nie
 * dawała, a „wróciło mniej" słusznie nie przyjmuje liczby większej niż
 * zgłoszona. Odmowa tamtego pola odsyłała tutaj — do drogi, której nie było.
 *
 * Teraz linia wypada z listy dopiero wtedy, gdy w zwrocie są WSZYSTKIE jej
 * sztuki; przy części zostaje z resztą. Sztuki liczymy tą samą regułą co
 * plakietkę „↩ 1 z 2" w dowodach (`listaZwrotow`): pozycja zwrotu trafia
 * w linię po `offer_id` albo po `external_id`, bo nie wiadomo, którym z nich
 * Allegro ją podpisuje. Pula sztuk jest WSPÓLNA dla oferty i schodzi linia po
 * linii — dwie linie tej samej oferty nie policzą jednej sztuki dwa razy.
 *
 * Stary warunek po kluczu zostaje jako zapas: pozycja, której numer nie trafia
 * w żadną kolumnę zamówienia, a klucz tak, dalej zdejmuje całą linię. Bez tego
 * zwrot o nieznanej przestrzeni numerów dostałby do dopisania to, co już ma.
 */
export function doDopisania(zwrotId: number, database: Db = defaultDb()): DoDopisania[] {
  const z = database.prepare(
    "SELECT channel_account_id, order_id FROM zwrot_klienta WHERE id=?")
    .get(zwrotId) as { channel_account_id: number; order_id: string | null } | undefined;
  if (!z?.order_id) return [];

  const wZwrocie = database.prepare(
    "SELECT klucz, offer_id, ilosc FROM zwrot_klienta_pozycja WHERE zwrot_id=?").all(zwrotId) as
    Array<{ klucz: string; offer_id: string | null; ilosc: number }>;
  const klucze = new Set(wZwrocie.map((r) => String(r.klucz)));
  /* Sztuki w zwrocie według numeru, pod którym stoją. DEKLARACJA klienta,
     nie `ilosc_zwrocona`: brak sztuk w kartonie to potrącenie w kwocie, a nie
     powód, żeby ta sama linia wróciła na listę do dopisania. */
  const pula = new Map<string, number>();
  for (const r of wZwrocie) {
    if (!r.offer_id) continue;
    pula.set(r.offer_id, (pula.get(r.offer_id) ?? 0) + Number(r.ilosc ?? 0));
  }

  const poz = database.prepare(`SELECT p.id, p.offer_id, p.external_id, p.nazwa, p.ilosc,
         p.cena_grosze, p.waluta
      FROM zamowienie_klienta_pozycja p
      JOIN zamowienie_klienta k ON k.id = p.zamowienie_id
     WHERE k.channel_account_id=? AND k.external_id=?
     ORDER BY p.id`).all(z.channel_account_id, z.order_id) as Array<Record<string, unknown>>;

  /* Snapshoty ofert TEGO konta jednym zapytaniem — kandydatów bywa kilku. */
  const obrazy = new Map<string, string | null>();
  for (const o of database.prepare(
    "SELECT external_id AS id, primary_image_url AS url FROM offer_snapshot WHERE channel_account_id=?",
  ).all(z.channel_account_id) as Array<{ id: string; url: string | null }>) {
    obrazy.set(o.id, o.url);
  }

  /* Klucz liczy się tak samo jak przy synchronizacji i przy paczce
     nieodebranej: przyrostek per POWTÓRZENIE pary `offer_id|nazwa`. */
  const licznik = new Map<string, number>();
  const wynik: DoDopisania[] = [];
  for (const p of poz) {
    const baza = `${p.offer_id ?? ""}|${p.nazwa}`;
    const n = (licznik.get(baza) ?? 0) + 1;
    licznik.set(baza, n);
    const zamowiono = Number(p.ilosc);

    const numer = [p.offer_id, p.external_id].map((x) => (x as string) ?? "")
      .find((x) => x && pula.has(x));
    let wraca = 0;
    if (numer) {
      wraca = Math.min(zamowiono, pula.get(numer)!);
      pula.set(numer, pula.get(numer)! - wraca);
    } else if (klucze.has(n === 1 ? baza : `${baza}|#${n}`)) {
      wraca = zamowiono;
    }
    const brakuje = zamowiono - wraca;
    if (brakuje <= 0) continue;

    wynik.push({
      zamPozycjaId: Number(p.id), offerId: (p.offer_id as string) ?? null,
      ofertaZdjecie: (p.offer_id as string)
        ? stanZdjeciaOferty(obrazy.get(String(p.offer_id))) : "nieznane",
      nazwa: String(p.nazwa), ilosc: brakuje, zamowiono,
      cenaGrosze: Number(p.cena_grosze), waluta: String(p.waluta ?? "PLN"),
    });
  }
  return wynik;
}

/**
 * Dopisuje pozycję zamówienia do zwrotu jako pozycję BIURA.
 *
 * `zrodlo='biuro'` nie jest etykietą dla ozdoby. Po pierwsze, synchronizacja
 * kasuje pozycje, których Allegro nie oddaje — bez tej wartości dopisana
 * znikałaby przy najbliższym takcie razem z oceną hali. Po drugie, ekran ma
 * mówić, że to zapis człowieka, a nie zgłoszenie klienta: projekt panelu §4.3
 * nie pozwala, żeby wybór człowieka udawał fakt z Allegro.
 */
export function dopiszPozycje(
  database: Db, zwrotId: number, zamPozycjaId: number, wersja: number,
  kto: { id: number; name: string },
): { wersja: number; pozycjaId: number } {
  return transaction(database, () => {
    podKlucz(database, zwrotId, wersja);
    /* Kandydata bierzemy z TEJ SAMEJ listy, którą widział operator. Dzięki temu
       nie da się dopisać pozycji z cudzego zamówienia ani zdublować tej, która
       w zwrocie już stoi — jedno zapytanie zamiast trzech osobnych warunków. */
    const kandydat = doDopisania(zwrotId, database)
      .find((k) => k.zamPozycjaId === zamPozycjaId);
    if (!kandydat) {
      throw new Error(
        "Tej pozycji nie ma na liście do dopisania — jest już w zwrocie albo " +
        "nie pochodzi z tego zamówienia. Odśwież ekran.");
    }

    /* Klucz musi być liczony PONOWNIE względem tego, co stoi w zwrocie, a nie
       przepisany z zamówienia: pozycja o tej samej parze mogła już wejść ze
       zgłoszenia klienta. Duplikat klucza wywróciłby zapis na indeksie
       UNIQUE — blizna 0.174.2. */
    const baza = `${kandydat.offerId ?? ""}|${kandydat.nazwa}`;
    const zajete = new Set((database.prepare(
      "SELECT klucz FROM zwrot_klienta_pozycja WHERE zwrot_id=?").all(zwrotId) as
      Array<{ klucz: string }>).map((r) => String(r.klucz)));
    let klucz = baza;
    for (let n = 2; zajete.has(klucz); n++) klucz = `${baza}|#${n}`;

    const wynik = database.prepare(`INSERT INTO zwrot_klienta_pozycja
      (zwrot_id,offer_id,nazwa,ilosc,cena_grosze,waluta,klucz,zrodlo)
      VALUES (?,?,?,?,?,?,?,'biuro')`).run(
      zwrotId, kandydat.offerId, kandydat.nazwa, kandydat.ilosc,
      kandydat.cenaGrosze, kandydat.waluta, klucz);

    podnies(database, zwrotId);
    logEvent("zwrot_pozycja_dopisana", kto.name, null,
      { zwrotId, klucz, nazwa: kandydat.nazwa, cenaGrosze: kandydat.cenaGrosze },
      kto.id, database);
    return { wersja: wersja + 1, pozycjaId: Number(wynik.lastInsertRowid) };
  })();
}

/**
 * Zdejmuje pozycję dopisaną przez biuro — cofnięcie zamiast potwierdzenia
 * (§25a.5).
 *
 * Pozycji ze zgłoszenia klienta zdjąć się NIE DA i to nie jest brak funkcji.
 * Ona przyszła z Allegro; usunięta u nas wróciłaby przy najbliższym takcie,
 * więc przycisk obiecywałby skutek, którego nie ma.
 */
export function usunDopisanaPozycje(
  database: Db, pozycjaId: number, wersja: number,
  kto: { id: number; name: string },
): { wersja: number } {
  return transaction(database, () => {
    const p = database.prepare(
      "SELECT id, zwrot_id, zrodlo, nazwa FROM zwrot_klienta_pozycja WHERE id=?")
      .get(pozycjaId) as
      { id: number; zwrot_id: number; zrodlo: string; nazwa: string } | undefined;
    if (!p) throw new Error("Nie znaleziono pozycji zwrotu");
    if (String(p.zrodlo) !== "biuro") {
      throw new Error(
        "Tej pozycji nie dopisało biuro — przyszła ze zgłoszenia klienta " +
        "i usunięta u nas wróciłaby przy najbliższej synchronizacji.");
    }
    podKlucz(database, Number(p.zwrot_id), wersja);
    database.prepare("DELETE FROM zwrot_klienta_pozycja WHERE id=?").run(pozycjaId);
    podnies(database, Number(p.zwrot_id));
    logEvent("zwrot_pozycja_zdjeta", kto.name, null,
      { zwrotId: Number(p.zwrot_id), nazwa: String(p.nazwa) }, kto.id, database);
    return { wersja: wersja + 1 };
  })();
}

/**
 * Potrącenie za utratę wartości pojedynczej pozycji (0.170.0).
 *
 * Do tego wydania kwota była BINARNA per pozycja: cała cena albo nic. Towar
 * wracający używany nie miał jak zjechać w dół, a to codzienność biura.
 *
 * §25a.3 zostaje nienaruszone: panel nadal NIE przysyła kwoty do oddania —
 * przysyła zaznaczenie, a sumę składa `zapiszKwote`. Potrącenie jest osobnym,
 * WALIDOWANYM zapisem przy pozycji, a nie liczbą doklejaną do sumy. Widełki
 * `0…cena × ilość` pilnuje serwer: potrącenie większe niż wartość pozycji
 * znaczyłoby, że klient nam dopłaca.
 *
 * Powód jest OBOWIĄZKOWY, bo to jego treść tłumaczy klientowi, czemu dostał
 * mniej. `null` w kwocie cofa potrącenie razem z powodem — to samo cofnięcie
 * co przy ocenie i korekcie (§25a.5).
 */
/**
 * Ile sztuk NAPRAWDĘ wróciło w kartonie (0.212.0).
 *
 * Klient zgłasza w Allegro dwie sztuki, w paczce przyjeżdża jedna — do tego
 * wydania nie było tego gdzie zapisać. Pozycji z Allegro nie da się poprawić
 * (zdjąć wolno tylko pozycję dopisaną przez biuro), a kwota liczyła się
 * z DEKLARACJI klienta. Zostawało odznaczyć całą pozycję albo zapłacić za
 * dwie; „wróciła jedna z dwóch" nie mieściło się w bazie.
 *
 * LICZY BIURO — decyzja właściciela: to ono otwiera i procesuje zwroty.
 *
 * `null` CZYŚCI zapis i wraca do deklaracji. To nie to samo co zero: zero
 * znaczy „nie wróciło nic", puste — „nikt jeszcze nie liczył".
 *
 * Więcej niż zgłoszono ODPADA. W kartonie bywa więcej, niż klient zgłosił, ale
 * to jest INNA pozycja i ma własną drogę (`dopiszPozycje` od 0.184.0).
 * Podniesienie liczby tutaj wypłaciłoby za sztuki, o których zwrocie klient
 * nigdy nie napisał.
 */
export function zapiszIloscZwrocona(
  database: Db, pozycjaId: number, ilosc: number | null,
  wersja: number, kto: { id: number; name: string },
): { wersja: number; iloscZwrocona: number | null } {
  const p = database.prepare(
    `SELECT id, zwrot_id, ilosc, nazwa, cena_grosze, potracenie_grosze
       FROM zwrot_klienta_pozycja WHERE id=?`)
    .get(pozycjaId) as
    { id: number; zwrot_id: number; ilosc: number; nazwa: string;
      cena_grosze: number; potracenie_grosze: number | null } | undefined;
  if (!p) throw new Error("Nie znaleziono pozycji zwrotu");

  if (ilosc !== null) {
    if (!Number.isFinite(ilosc) || ilosc < 0) {
      throw new Error("Liczba sztuk nie może być ujemna.");
    }
    if (ilosc > Number(p.ilosc)) {
      throw new Error(
        `Klient zgłosił ${Number(p.ilosc)} szt. — więcej nie wpiszesz. ` +
        "Nadmiar z kartonu dopisz jako osobną pozycję.");
    }
  }

  /* POTRĄCENIE NIE MOŻE PRZEROSNĄĆ TEGO, CO WRÓCIŁO (0.484.7). Widełki
     potrącenia liczyły się z deklaracji; mniejsza liczba sztuk po nim dawała
     linię ujemną. `zapiszKwote` ją sumował, a zwrot pieniędzy pomijał — i
     przycisk wypłaty odmawiał zdaniem „popraw kwotę", którego nie dało się
     wykonać. */
  const potracenie = Number(p.potracenie_grosze ?? 0);
  if (ilosc !== null && potracenie > Math.round(Number(p.cena_grosze) * ilosc)) {
    throw new Error("Potrącenie jest większe niż wartość tylu sztuk — najpierw je zmniejsz.");
  }

  return transaction(database, () => {
    const z = podKlucz(database, Number(p.zwrot_id), wersja);
    /* Tak samo jak ocena i potrącenie: liczenie sztuk ma sens po przyjęciu. */
    if (z.werdykt !== "przyjety") throw new Error("Najpierw przyjmij zwrot");
    database.prepare("UPDATE zwrot_klienta_pozycja SET ilosc_zwrocona=? WHERE id=?")
      .run(ilosc, pozycjaId);
    podnies(database, Number(p.zwrot_id));
    logEvent("zwrot_ilosc_zwrocona", kto.name, null,
      { zwrotId: Number(p.zwrot_id), pozycjaId, zgloszono: Number(p.ilosc), wrocilo: ilosc },
      kto.id, database);
    return { wersja: wersja + 1, iloscZwrocona: ilosc };
  })();
}

export function zapiszPotracenie(
  database: Db, pozycjaId: number, grosze: number | null, powod: string,
  wersja: number, kto: { id: number; name: string }, teraz = new Date(),
): { wersja: number; potracenieGrosze: number | null } {
  const p = database.prepare(
    "SELECT id, zwrot_id, cena_grosze, ilosc, ilosc_zwrocona FROM zwrot_klienta_pozycja WHERE id=?")
    .get(pozycjaId) as { id: number; zwrot_id: number; cena_grosze: number; ilosc: number;
      ilosc_zwrocona: number | null } | undefined;
  if (!p) throw new Error("Nie znaleziono pozycji zwrotu");

  const uzasadnienie = (powod ?? "").trim();
  if (grosze !== null) {
    if (!Number.isInteger(grosze) || grosze < 0) {
      throw new Error("Potrącenie to pełne grosze, nie mniej niż zero.");
    }
    /* Widełki z tego, co WRÓCIŁO, nie z deklaracji (0.484.7) — ta sama
       liczba, z której `zapiszKwote` liczy wartość linii. Inaczej linia
       wychodziła ujemna, a wypłata odmawiała bez drogi wyjścia. */
    const wartosc = Math.round(Number(p.cena_grosze) * iloscLiczona(p));
    if (grosze > wartosc) {
      throw new Error(
        `Potrącenie nie może przekroczyć wartości pozycji (${(wartosc / 100).toFixed(2)}).`);
    }
    if (uzasadnienie === "") {
      throw new Error("Potrącenie wymaga powodu — to jego treść zobaczy klient.");
    }
  }

  return transaction(database, () => {
    const z = podKlucz(database, Number(p.zwrot_id), wersja);
    /* Tak samo jak ocena: potrącenie ma sens dopiero po przyjęciu zwrotu.
       Obniżanie kwoty przy zwrocie, którego nie przyjmujemy, zostawiałoby
       w bazie decyzję o pieniądzach, które i tak nie wyjdą. */
    if (z.werdykt !== "przyjety") throw new Error("Najpierw przyjmij zwrot");
    database.prepare(`UPDATE zwrot_klienta_pozycja
      SET potracenie_grosze=?, potracenie_powod=?, potracenie_at=?, potracenie_przez=?
      WHERE id=?`).run(
      grosze, grosze === null ? null : uzasadnienie,
      grosze === null ? null : teraz.toISOString(),
      grosze === null ? null : kto.name, pozycjaId);
    podnies(database, Number(p.zwrot_id));
    logEvent(grosze === null ? "zwrot_potracenie_cofniete" : "zwrot_potracenie",
      kto.name, null,
      { zwrotId: Number(p.zwrot_id), pozycjaId, grosze, powod: uzasadnienie || null },
      kto.id, database);
    return { wersja: wersja + 1, potracenieGrosze: grosze };
  })();
}

/**
 * Kwota do oddania — z ZAZNACZENIA, nie z liczby przysłanej przez panel.
 *
 * §25a.3 mówi wprost: „Liczy ją serwer, panel niczego nie zgaduje". Panel
 * przysyła więc listę zaznaczonych pozycji i informację o dostawie, a sumę
 * składa ta funkcja. Gdyby przyjmowała gotową liczbę, dałoby się zapisać
 * dowolną kwotę żądaniem z pominięciem ekranu — a to są cudze pieniądze.
 *
 * `kwota_wariant` wylicza się z zaznaczenia i jest ETYKIETĄ, nie wyborem:
 * wszystko z dostawą to `pelna`, wszystko bez niej `bez_wysylki`, każde inne
 * zaznaczenie `inna`.
 */
export function zapiszKwote(
  database: Db, zwrotId: number, wybor: { pozycjeIds: number[]; dostawa: boolean },
  wersja: number, kto: { id: number; name: string }, teraz = new Date(),
): { kwotaGrosze: number; dostawaGrosze: number; wariant: string; wersja: number } {
  const wynik = transaction(database, () => {
    const z = podKlucz(database, zwrotId, wersja);
    if (z.werdykt !== "przyjety") throw new Error("Najpierw przyjmij zwrot");

    const wszystkie = database.prepare(
      `SELECT id, cena_grosze, ilosc, ilosc_zwrocona, potracenie_grosze
         FROM zwrot_klienta_pozycja WHERE zwrot_id=?`)
      .all(zwrotId) as Array<{ id: number; cena_grosze: number; ilosc: number;
        ilosc_zwrocona: number | null; potracenie_grosze: number | null }>;
    const znane = new Set(wszystkie.map((p) => Number(p.id)));
    /* Obca pozycja ODPADA GŁOŚNO. Ciche pominięcie zapisałoby kwotę niższą,
       niż operator widział na ekranie — a on kliknął to, co widział. */
    const obce = wybor.pozycjeIds.filter((id) => !znane.has(Number(id)));
    if (obce.length) {
      throw new Error(`Pozycje ${obce.join(", ")} nie należą do tego zwrotu.`);
    }
    const wybrane = new Set(wybor.pozycjeIds.map(Number));
    /* Potrącenie odejmuje SERWER, z tego, co zapisano przy pozycji — panel
       nadal nie przysyła ani jednej liczby o pieniądzach. Widełki sprawdziło
       `zapiszPotracenie`, więc suma nie ma prawa zejść poniżej zera. */
    const suma = wszystkie
      .filter((p) => wybrane.has(Number(p.id)))
      /* PO TYM, CO WRÓCIŁO (0.212.0). Do tego wydania kwota liczyła się
         z deklaracji klienta, więc zwrot dwóch sztuk, z których przyjechała
         jedna, wypłacał za dwie. */
      .reduce((s, p) => s + Math.round(Number(p.cena_grosze) * iloscLiczona(p))
        - Number(p.potracenie_grosze ?? 0), 0);

    /* Koszt dostawy bierze się z ZAMÓWIENIA, nie ze zwrotu: Allegro nie
       przysyła go przy zwrocie. Dociągamy zamówienia od 0.152.0 i dopiero to
       zdjęło blokadę opisaną przy `sumaPozycji`. Brak zamówienia znaczy zero,
       bo nie ma czego oddać — a nie „oddaj nieznaną kwotę".

       KTÓRĄ dostawę oddajemy — decyzja właściciela z 3 września 2026. Tę,
       którą klient WYBRAŁ i za którą zapłacił, czyli `dostawa_grosze`
       z zamówienia. Pytanie było realne, bo ustawa pozwala oddać MNIEJ:
       gdy klient wybrał opcję droższą niż najtańsza zwykła, sprzedawca nie
       musi dopłacać różnicy. Oddajemy więcej i to jest wybór, nie
       przeoczenie — tak samo rozlicza to Allegro, a liczenie najtańszej
       opcji wymagałoby cennika oferty, którego przy zwrocie nie mamy. */
    const dostawa = wybor.dostawa
      ? Number((database.prepare(`SELECT k.dostawa_grosze AS d FROM zamowienie_klienta k
          JOIN zwrot_klienta z ON z.order_id = k.external_id
            AND z.channel_account_id = k.channel_account_id
          WHERE z.id=?`).get(zwrotId) as { d: number | null } | undefined)?.d ?? 0)
      : 0;

    const wariant = wybrane.size === wszystkie.length
      ? (wybor.dostawa ? "pelna" : "bez_wysylki")
      : "inna";

    database.prepare("UPDATE zwrot_klienta_pozycja SET w_zwrocie=0 WHERE zwrot_id=?").run(zwrotId);
    if (wybrane.size) {
      const znaki = [...wybrane].map(() => "?").join(",");
      database.prepare(
        `UPDATE zwrot_klienta_pozycja SET w_zwrocie=1 WHERE id IN (${znaki})`).run(...wybrane);
    }
    database.prepare(`UPDATE zwrot_klienta
      SET kwota_grosze=?, kwota_dostawa_grosze=?, kwota_wariant=?, kwota_at=?, kwota_przez=?
      WHERE id=?`).run(suma + dostawa, dostawa, wariant, teraz.toISOString(), kto.name, zwrotId);
    podnies(database, zwrotId);
    /* Zdanie mówi KWOTĘ I WARIANT, bo po zamknięciu zwrotu to jest jedyne
       miejsce, w którym widać, ile obiecano klientowi i za co. */
    zdarzenie(database, zwrotId, "kwota",
      `Do oddania ${((suma + dostawa) / 100).toFixed(2)} (${NAZWA_WARIANTU[wariant] ?? wariant})`,
      { kwotaGrosze: suma + dostawa, dostawaGrosze: dostawa, wariant }, kto,
      teraz.toISOString());
    logEvent("zwrot_kwota", kto.name, null,
      { zwrotId, kwotaGrosze: suma + dostawa, dostawaGrosze: dostawa, wariant,
        pozycje: [...wybrane] }, kto.id, database);
    return { kwotaGrosze: suma + dostawa, dostawaGrosze: dostawa, wariant, wersja: wersja + 1 };
  })();

  /* ZW ZLECA SIĘ SAM PO KWOCIE (0.349.0, decyzja właściciela). PO transakcji,
     bo `zakolejkujZw` otwiera własną, a `BEGIN IMMEDIATE` się nie zagnieżdża.
     Pod parasolem: kwota jest zapisana i obiecana klientowi, a nieudane
     zlecenie ZW nie ma prawa jej wywrócić — biuro wystawi ZW ręką. Wersji
     zwrotu zlecenie nie podnosi, więc panel zapisuje dalej bez konfliktu. */
  try {
    zakolejkujZw(database, zwrotId, kto, teraz);
  } catch (e) {
    console.error("[zw] zlecenie nie weszło:", zwrotId, e instanceof Error ? e.message : e);
  }
  return wynik;
}

/**
 * Cofa ustaloną kwotę — zwrot wraca do DO ZWROTU (0.202.0).
 *
 * §25a.5 obiecuje cofnięcie wszędzie poza oddaniem pieniędzy i odmową. Kwota
 * była z tej obietnicy wyjęta: nadpisać dawało się ją tylko w kubełku DO
 * ZWROTU, a zapis natychmiast z niego wyprowadzał. Pomyłka w zaznaczeniu
 * zostawała więc na zawsze.
 *
 * DWIE ODMOWY, obie z nazwą, po czym szukać:
 *
 * 1. **Pieniądze wyszły.** `zwrot_pieniedzy_id` znaczy, że przelew poszedł do
 *    klienta PRZECIW tej kwocie, a wiersz jest jedynym jego śladem. Ta sama
 *    zasada, co bramka w `zwroty-reset.ts`. Poprawia się to dopłatą w panelu
 *    Allegro, nie skasowaniem liczby u nas.
 * 2. **Korekta stoi.** Cofa się o JEDEN szczebel: najpierw korekta, potem
 *    kwota. Bez tego zdania człowiek dostałby gołe „Zwrot jest zamknięty"
 *    z `podKlucz` i nie wiedziałby, że droga wyjścia istnieje.
 *
 * Pozycje wracają do `w_zwrocie=0`, bo ta kolumna JEST zaznaczeniem: gdyby
 * została, następna wycena startowałaby z cudzego wyboru.
 */
export function cofnijKwote(
  database: Db, zwrotId: number, wersja: number, kto: { id: number; name: string },
  teraz = new Date(),
): { wersja: number } {
  return transaction(database, () => {
    const z = database.prepare(
      `SELECT wersja, kwota_grosze, korekta_numer, zwrot_pieniedzy_id
         FROM zwrot_klienta WHERE id=?`).get(zwrotId) as
      { wersja: number; kwota_grosze: number | null; korekta_numer: string | null;
        zwrot_pieniedzy_id: string | null } | undefined;
    if (!z) throw new Error("Nie znaleziono zwrotu");
    if (Number(z.wersja) !== wersja) {
      throw new ZwrotConflict(
        "Zwrot zmienił się w międzyczasie — odśwież i sprawdź, co zrobił inny agent.",
        { wersja: Number(z.wersja), przyslana: wersja });
    }
    if (z.kwota_grosze === null) throw new Error("Ten zwrot nie ma ustalonej kwoty");
    if (z.zwrot_pieniedzy_id) {
      throw new Error(
        "Pieniądze zostały już oddane — kwoty nie cofam. Różnicę dopłać w panelu Allegro.");
    }
    if (z.korekta_numer) {
      throw new Error(`Najpierw cofnij korektę ${z.korekta_numer} — kwota jest pod nią.`);
    }
    /* ZW zlecony z TEJ kwoty (0.349.0) czeka w kolejce albo już powstał.
       Czekający anulujemy — poprawiona kwota zleci nowy. Wystawiony
       zatrzymuje cofnięcie, bo dokument stoi w Subiekcie na starą kwotę. */
    odsunZwPrzedRecznym(database, zwrotId, "kwota", teraz);

    const kiedy = teraz.toISOString();
    database.prepare("UPDATE zwrot_klienta_pozycja SET w_zwrocie=0 WHERE zwrot_id=?").run(zwrotId);
    database.prepare(
      `UPDATE zwrot_klienta
        SET kwota_grosze=NULL, kwota_dostawa_grosze=NULL, kwota_wariant=NULL,
            kwota_at=NULL, kwota_przez=NULL
        WHERE id=?`).run(zwrotId);
    podnies(database, zwrotId);
    zdarzenie(database, zwrotId, "kwota_cofnieta",
      `Cofnięto kwotę ${(Number(z.kwota_grosze) / 100).toFixed(2)}`,
      { kwotaGrosze: Number(z.kwota_grosze) }, kto, kiedy);
    logEvent("zwrot_kwota_cofnieta", kto.name, null,
      { zwrotId, kwotaGrosze: Number(z.kwota_grosze) }, kto.id, database);
    return { wersja: wersja + 1 };
  })();
}

/* ── Korekta i zamknięcie (0.162.0) ──────────────────────────────────────────
   Piąty kubełek był ślepym zaułkiem: `kubelekZwrotu` routuje po
   `korekta_numer`, a tej kolumny nic nie zapisywało. Zwrot z ustaloną kwotą
   stał w DO KOREKTY na zawsze, a ekran pisał przy nim „czeka na własne
   wydanie".

   KOREKTĘ WYSTAWIA CZŁOWIEK W SUBIEKCIE, a panel zapisuje jej numer. To nie
   jest półśrodek w drodze do automatu, tylko jedyna droga, jaką dziś widać:
   `korekta_zwrot` w kolejce Sfery potrzebuje `dok_Id` dokumentu SPRZEDAŻY,
   a read-model `sgt_dokument` trzyma wyłącznie FZ i PZ — zakupy. Bez tego
   identyfikatora automat musiałby go zgadywać, a zgadywanie kształtu cudzej
   bazy kosztowało już w tym repo trzy wydania.

   PIENIĄDZE NADAL ODDAJE CZŁOWIEK w panelu Allegro. Zamknięcie znaczy tu
   „nasza część jest zrobiona", nie „klient dostał przelew" — i tak samo mówi
   o tym ekran.                                                              */

/**
 * Numer korekty wystawionej w Subiekcie. Zamyka zwrot.
 *
 * Zamknięcie zapisujemy WPROST w `zamkniety_at`, choć `kubelekZwrotu`
 * wywiódłby je z samego numeru. Godzina zejścia sprawy z biurka jest faktem,
 * którego z obecności napisu nie da się odtworzyć.
 */
export function zapiszKorekte(
  database: Db, zwrotId: number, numer: string, wersja: number,
  kto: { id: number; name: string }, teraz = new Date(),
): { korektaNumer: string; zamknietyAt: string; wersja: number } {
  const dokument = (numer ?? "").trim();
  if (!dokument) {
    throw new Error("Korekta wymaga numeru dokumentu z Subiekta — bez niego nic nie domyka.");
  }
  const wynik = transaction(database, () => {
    podKlucz(database, zwrotId, wersja);
    /* Kolejność bramek jest UMOWĄ kolejki. Numer zapisany przed kwotą
       przeskoczyłby zwrot z DO ZWROTU wprost do zamkniętych — czyli zamknąłby
       sprawę pieniędzy, o których nikt nie zdecydował. */
    const stan = database.prepare(
      "SELECT werdykt, kwota_grosze FROM zwrot_klienta WHERE id=?")
      .get(zwrotId) as { werdykt: string | null; kwota_grosze: number | null };
    if (stan.werdykt !== "przyjety") throw new Error("Najpierw przyjmij zwrot");
    if (stan.kwota_grosze === null) throw new Error("Najpierw ustal kwotę do oddania");
    /* Człowiek wyprzedza automat (0.349.0). Bez anulowania czekającego ZW
       powstałby drugi dokument obok tego, którego numer właśnie wpisano. */
    odsunZwPrzedRecznym(database, zwrotId, "korekta", teraz);

    const kiedy = teraz.toISOString();
    /* `reczne` odróżnia to od numeru znalezionego w Subiekcie przez automat
       (0.201.0). Wybór człowieka nie ma udawać faktu z danych, ale i odwrotnie:
       fakt z danych nie ma udawać czyjejś decyzji. */
    database.prepare(`UPDATE zwrot_klienta
      SET korekta_numer=?, korekta_zrodlo='reczne', zamkniety_at=? WHERE id=?`)
      .run(dokument, kiedy, zwrotId);
    podnies(database, zwrotId);
    zdarzenie(database, zwrotId, "korekta", `Korekta ${dokument}`, { numer: dokument }, kto, kiedy);
    logEvent("zwrot_korekta", kto.name, null, { zwrotId, numer: dokument }, kto.id, database);
    return { korektaNumer: dokument, zamknietyAt: kiedy, wersja: wersja + 1 };
  })();

  /* Ten numer bywa OSTATNIM brakującym w koszyku, który stoi zamknięty
     i czeka na komplet korekt (0.200.0). MM wychodzi wtedy natychmiast,
     a nie po najbliższym takcie — biuro wpisuje numer i odchodzi.

     PO transakcji, nie w niej: `transaction` woła `BEGIN IMMEDIATE`, którego
     SQLite nie zagnieżdża. Wypuszczenie ma zresztą własną atomowość na
     koszyk i nie ma prawa wywrócić zapisu numeru. */
  wypuscGotoweKoszyki(database, teraz);
  return wynik;
}

/**
 * Cofnięcie korekty — JEDYNA operacja dozwolona na zamkniętym zwrocie.
 *
 * §25a.5: potwierdzenie dostają dwie rzeczy nieodwracalne (oddanie pieniędzy
 * i odmowa), reszta ma cofnięcie. Numer dokumentu jest tu przepisywany
 * z Subiekta ręką, więc literówka jest zdarzeniem normalnym, nie awarią.
 *
 * Cofamy KOREKTĘ, nie pracę nad zwrotem: werdykt, oceny i kwota zostają, więc
 * zwrot wraca do DO KOREKTY, a nie na początek kolejki.
 */
export function cofnijKorekte(
  database: Db, zwrotId: number, wersja: number, kto: { id: number; name: string },
  teraz = new Date(),
): { wersja: number } {
  return transaction(database, () => {
    /* Z pominięciem `podKlucz`: ta bramka odrzuca zwrot zamknięty, a tu
       zamknięcie jest właśnie tym, co cofamy. Wersji pilnujemy tak samo. */
    const z = database.prepare(
      "SELECT wersja, korekta_numer FROM zwrot_klienta WHERE id=?")
      .get(zwrotId) as { wersja: number; korekta_numer: string | null } | undefined;
    if (!z) throw new Error("Nie znaleziono zwrotu");
    if (Number(z.wersja) !== wersja) {
      throw new ZwrotConflict(
        "Zwrot zmienił się w międzyczasie — odśwież i sprawdź, co zrobił inny agent.",
        { wersja: Number(z.wersja), przyslana: wersja });
    }
    if (!z.korekta_numer) throw new Error("Ten zwrot nie ma zapisanej korekty");

    const kiedy = teraz.toISOString();
    database.prepare(
      `UPDATE zwrot_klienta
        SET korekta_numer=NULL, korekta_zrodlo=NULL, zamkniety_at=NULL,
            korekta_queue_id=NULL WHERE id=?`).run(zwrotId);
    /* `korekta_queue_id` ODPINAMY (0.349.0). Wykonane zadanie ZW zostałoby
       inaczej przy zwrocie i `wpiszNumeryZw` wpisałby cofnięty numer z powrotem
       w ciągu minuty. Sam dokument zostaje w Subiekcie — usuwa go biuro. */
    podnies(database, zwrotId);
    zdarzenie(database, zwrotId, "korekta_cofnieta", `Cofnięto korektę ${z.korekta_numer}`,
      { numer: z.korekta_numer }, kto, kiedy);
    logEvent("zwrot_korekta_cofnieta", kto.name, null,
      { zwrotId, numer: z.korekta_numer }, kto.id, database);
    return { wersja: wersja + 1 };
  })();
}

/* ── Otwarcie zwrotu skanem etykiety zwrotnej (0.163.0) ──────────────────────
   Paczka wraca do biura wcześniej niż wiedza o tym, który to zwrot. Do tego
   wydania operator szukał go oczami; teraz odpowiada za to czytnik.

   TRZY KSZTAŁTY, bo etykiety bywają różne: numer zwrotu doklejony przez
   klienta, identyfikator z panelu i — najczęściej — numer listu kuriera
   (`600000367616070023174201` u InPostu, `AD00R28X72` u DPD).

   DOPASOWANIE WYŁĄCZNIE DOKŁADNE. `routes/products.ts` opisuje, dlaczego
   furtka na literówki jest tam wyłączona: trasa sama otwiera kartę przy jednym
   wyniku, więc przybliżenie prowadzi do CUDZEJ kartoteki. Przy zwrocie
   znaczyłoby to cudzego klienta i cudze pieniądze.

   DWA TRAFIENIA TO BRAK TRAFIENIA — wzorzec `ktoMaTenKod` z `ean-alias.ts`,
   gdzie każde dodatkowe trafienie jest powodem odmowy, nie zachętą do wzięcia
   pierwszego z brzegu. Rozstrzyga człowiek, patrząc na oba.                 */

export type TrafienieSkanu = "numer" | "external" | "waybill";

export interface WynikSkanu {
  trafienie: TrafienieSkanu | "wiele" | null;
  zwrotId: number | null;
  /** Przy „wiele": tyle, ile ekran potrzebuje, żeby dać wybrać. */
  zwroty: Array<{ id: number; numer: string | null; externalId: string }>;
}

const PUSTY: WynikSkanu = { trafienie: null, zwrotId: null, zwroty: [] };

/**
 * Zwrot spod zeskanowanego kodu.
 *
 * NUMER LISTU CZYTAMY Z LĄDOWISKA, nie z modelu pracy — tam go nie ma i nie
 * dokładamy mu kolumny. `ksztalt.ts` nazywa numer listu „daną osobową okrężną
 * drogą" (prowadzi w systemie kuriera do adresu odbiorcy), więc jest tu
 * UŻYTY, a nie ZAPAMIĘTANY: w bazie zostaje dokładnie to, co i tak leży
 * w kopii odpowiedzi Allegro.
 *
 * `transportingWaybill` szukamy razem z `waybill`, bo przy dwóch kurierach na
 * jednej przesyłce na naklejce bywa ten drugi (schemat `CustomerReturnReturnParcel`).
 */
export function znajdzZwrotPoKodzie(kod: string, database: Db = defaultDb()): WynikSkanu {
  const szukane = (kod ?? "").trim();
  if (!szukane) return PUSTY;

  const poKolumnie = (kolumna: "reference_number" | "external_id" | "waybill"): number[] =>
    (database.prepare(`SELECT id FROM zwrot_klienta WHERE ${kolumna} = ?`)
      .all(szukane) as Array<{ id: number }>).map((w) => Number(w.id));

  const kandydaci: Array<[TrafienieSkanu, number[]]> = [
    ["numer", poKolumnie("reference_number")],
    ["external", poKolumnie("external_id")],
    /* Paczka nieodebrana ma numer listu W MODELU, bo nie ma kopii odpowiedzi
       Allegro, w której dałoby się go szukać (0.172.0). Stoi przed szukaniem
       po lądowisku, żeby raz zarejestrowana paczka znalazła się od razu. */
    ["waybill", poKolumnie("waybill")],
    ["waybill", (database.prepare(`
      SELECT z.id FROM zwrot_klienta z
        JOIN allegro_zwrot a ON a.id = z.external_id,
        json_each(json_extract(a.surowe_json, '$.parcels')) p
       WHERE json_extract(p.value, '$.waybill') = ?
          OR json_extract(p.value, '$.transportingWaybill') = ?`)
      .all(szukane, szukane) as Array<{ id: number }>).map((w) => Number(w.id))],
  ];

  for (const [trafienie, idy] of kandydaci) {
    const jedyne = [...new Set(idy)];
    if (jedyne.length === 1) return { trafienie, zwrotId: jedyne[0], zwroty: [] };
    if (jedyne.length > 1) return { trafienie: "wiele", zwrotId: null, zwroty: opisz(database, jedyne) };
  }
  return { ...PUSTY, zwroty: [] };
}

function opisz(database: Db, idy: number[]) {
  const miejsca = idy.map(() => "?").join(",");
  return (database.prepare(
    `SELECT id, reference_number, external_id FROM zwrot_klienta WHERE id IN (${miejsca}) ORDER BY id`
  ).all(...idy) as Wiersz[]).map((w) => ({
    id: Number(w.id),
    numer: (w.reference_number as string) ?? null,
    externalId: String(w.external_id),
  }));
}

/* ── Notatka biura i oś zwrotu (0.313.0) ─────────────────────────────────────
   Dwie strony jednej sprawy: co biuro ZAPISAŁO od siebie i co się ze zwrotem
   DZIAŁO. Do 0.284.0 pierwszego nie dało się zrobić przy zwrocie z Allegro,
   a drugie zapisywało pięć serwisów i nie czytał nikt.                      */

export interface WpisOsiZwrotu {
  id: number;
  rodzaj: string;
  tresc: string | null;
  kiedy: string;
  kto: string | null;
  dane: Record<string, unknown> | null;
}

/**
 * Oś zwrotu — rosnąco po czasie, czyli w kolejności pracy.
 *
 * Najnowsze na górze byłoby kolejnością SZUKANIA, a tu czyta się drogę sprawy
 * od początku: przyjęcie, ocena, kwota, korekta, pieniądze. Tę samą kolejność
 * ma oś rozmowy w skrzynce i to jest ten sam nawyk.
 *
 * `dane_json` wychodzi rozpakowane, bo panel odróżnia po nim numer korekty
 * znaleziony przez automat od przepisanego ręką. Zepsuty JSON oddajemy jako
 * `null` zamiast wywracać całą oś — jeden wiersz nie ma prawa zabrać reszty.
 */
export function osZwrotu(database: Db, zwrotId: number): WpisOsiZwrotu[] {
  const wiersze = database.prepare(
    `SELECT id, rodzaj, tresc, dane_json, kiedy_at, kto
       FROM zwrot_zdarzenie WHERE zwrot_id=? ORDER BY kiedy_at, id`)
    .all(zwrotId) as Array<Record<string, unknown>>;
  return wiersze.map((w) => {
    let dane: Record<string, unknown> | null = null;
    try {
      dane = w.dane_json ? JSON.parse(String(w.dane_json)) as Record<string, unknown> : null;
    } catch { dane = null; }
    return {
      id: Number(w.id),
      rodzaj: String(w.rodzaj),
      tresc: (w.tresc as string) ?? null,
      kiedy: String(w.kiedy_at),
      kto: (w.kto as string) ?? null,
      dane,
    };
  });
}

/** Stan notatki po zapisie — panel odświeża z tego nagłówek zwrotu. */
export interface StanNotatki {
  notatka: string | null;
  notatkaAt: string | null;
  notatkaPrzez: string | null;
  maPoprzednia: boolean;
  wersja: number;
}

function wierszNotatki(database: Db, zwrotId: number) {
  const w = database.prepare(
    `SELECT wersja, notatka, notatka_poprzednia, notatka_at, notatka_przez
       FROM zwrot_klienta WHERE id=?`).get(zwrotId) as Record<string, unknown> | undefined;
  if (!w) throw new Error("Nie znaleziono zwrotu");
  return w;
}

const stanNotatki = (w: Record<string, unknown>): StanNotatki => ({
  notatka: (w.notatka as string) ?? null,
  notatkaAt: (w.notatka_at as string) ?? null,
  notatkaPrzez: (w.notatka_przez as string) ?? null,
  maPoprzednia: ((w.notatka_poprzednia as string) ?? null) !== null,
  wersja: Number(w.wersja),
});

/**
 * Sprawdzenie wersji BEZ bramki na zwrocie zamkniętym.
 *
 * `podKlucz` odmawia przy `zamkniety_at` i ma rację przy decyzjach: one
 * zmieniają to, co obiecaliśmy klientowi. Notatka niczego nie obiecuje —
 * zapisuje ustalenie biura — a najczęściej dopisuje się ją PO zamknięciu,
 * gdy sprawa wraca pytaniem. Ta sama decyzja co przy zapisie przelewu.
 */
function wersjaSieZgadza(w: Record<string, unknown>, wersja: number | undefined): void {
  if (wersja === undefined) return;
  if (Number(w.wersja) !== wersja) {
    throw new ZwrotConflict(
      "Zwrot zmienił się w międzyczasie — odśwież i sprawdź, co zrobił inny agent.",
      { wersja: Number(w.wersja), przyslana: wersja });
  }
}

/* ZNACZNIKA „BIORĘ TO" PRZY ZWROCIE JUŻ NIE MA (0.370.0).

   Wraca to do PIERWSZEJ decyzji z 0.315.0, a nie ustala nową: tamto wydanie
   ustaliło najpierw, że przy zwrocie prowadzącego nie ma, bo zwroty prowadzi
   całe biuro i sito „Moje"/„Niczyje" nie odpowiadałoby na żadne prawdziwe
   pytanie — a tego samego dnia przywróciło znacznik z powrotem. Właściciel
   wskazał go teraz wprost jako niepotrzebny przy prośbie o wymagane minimum.

   REKLAMACJA I DYSKUSJA ZOSTAJĄ ZE ZNACZNIKIEM (0.278.0) i to nie jest
   niekonsekwencja: tam sprawę bierze konkretna osoba i prowadzi rozmowę
   z klientem, więc pytanie „czyje to" jest prawdziwe. Zwrot przechodzi przez
   biuro jako kolejka decyzji, nie jako czyjaś sprawa.

   Kolumny `prowadzi`, `prowadzi_user_id` i `prowadzi_at` zostają w tabeli:
   przebudowa dla trzech nieużywanych kolumn niesie więcej ryzyka, niż
   kupuje. Czyta ich odtąd nikt. */

/**
 * Zapis notatki. Poprzednia treść zostaje na wierszu — stąd cofnięcie.
 *
 * DO DZIENNIKA IDZIE DŁUGOŚĆ, NIGDY TREŚĆ, i tak samo na oś: notatka bywa
 * zdaniem o kliencie, a `events` nie ma retencji (§9 architektury). Oś niesie
 * sam fakt zapisu, bo treść i tak stoi w nagłówku zwrotu.
 */
export function zapiszNotatkeZwrotu(
  database: Db, zwrotId: number, notatka: string | null,
  kto: { id: number; name: string }, wersja?: number, teraz = new Date(),
): StanNotatki {
  return transaction(database, () => {
    const w = wierszNotatki(database, zwrotId);
    wersjaSieZgadza(w, wersja);
    const wartosc = (notatka ?? "").trim() || null;
    const at = teraz.toISOString();
    database.prepare(`UPDATE zwrot_klienta
      SET notatka=?, notatka_poprzednia=?, notatka_at=?, notatka_przez=?, notatka_user_id=?,
          wersja=wersja+1
      WHERE id=?`).run(wartosc, (w.notatka as string) ?? null, at, kto.name, kto.id, zwrotId);
    zdarzenie(database, zwrotId, wartosc === null ? "notatka_zdjeta" : "notatka",
      wartosc === null ? "Notatka skasowana" : "Notatka biura zmieniona",
      { znakow: wartosc?.length ?? 0 }, kto, at);
    logEvent(wartosc === null ? "zwrot_notatka_zdjeta" : "zwrot_notatka", kto.name, null,
      { zwrotId, znakow: wartosc?.length ?? 0 }, kto.id, database);
    return stanNotatki(wierszNotatki(database, zwrotId));
  })();
}

/**
 * Cofnięcie ZMIANY notatki — jeden szczebel, przez zamianę.
 *
 * Bieżąca treść ląduje w `notatka_poprzednia`, więc drugie kliknięcie wraca
 * tam, gdzie było. Wiersz sprzed tego wydania nie zna swojej poprzedniej
 * treści i dostaje odmowę ze zdaniem, a nie ciche nic.
 */
export function cofnijNotatkeZwrotu(
  database: Db, zwrotId: number, kto: { id: number; name: string },
  wersja?: number, teraz = new Date(),
): StanNotatki {
  return transaction(database, () => {
    const w = wierszNotatki(database, zwrotId);
    wersjaSieZgadza(w, wersja);
    const poprzednia = (w.notatka_poprzednia as string) ?? null;
    if (poprzednia === null) throw new Error("Nie ma do czego wracać — to pierwsza notatka");
    const at = teraz.toISOString();
    database.prepare(`UPDATE zwrot_klienta
      SET notatka=?, notatka_poprzednia=?, notatka_at=?, notatka_przez=?, notatka_user_id=?,
          wersja=wersja+1
      WHERE id=?`).run(poprzednia, (w.notatka as string) ?? null, at, kto.name, kto.id, zwrotId);
    zdarzenie(database, zwrotId, "notatka_cofnieta", "Cofnięto zmianę notatki",
      { znakow: poprzednia.length }, kto, at);
    logEvent("zwrot_notatka_cofnieta", kto.name, null,
      { zwrotId, znakow: poprzednia.length }, kto.id, database);
    return stanNotatki(wierszNotatki(database, zwrotId));
  })();
}

/**
 * Wariant kwoty po ludzku — na oś, nie do bazy.
 *
 * Kolumna niesie `pelna` / `bez_wysylki` / `inna`, bo to KLUCZ. Oś czyta
 * człowiek, a „bez_wysylki" w zdaniu o pieniądzach wygląda jak usterka.
 */
const NAZWA_WARIANTU: Record<string, string> = {
  pelna: "pełna", bez_wysylki: "bez wysyłki", inna: "część pozycji",
};

function zdarzenie(
  database: Db, zwrotId: number, rodzaj: string, tresc: string,
  dane: Record<string, unknown>, kto: { id: number; name: string }, kiedy: string,
): void {
  database.prepare(`INSERT INTO zwrot_zdarzenie
    (zwrot_id,rodzaj,tresc,dane_json,kiedy_at,kto,kto_user_id) VALUES (?,?,?,?,?,?,?)`)
    .run(zwrotId, rodzaj, tresc, JSON.stringify(dane), kiedy, kto.name, kto.id);
}
