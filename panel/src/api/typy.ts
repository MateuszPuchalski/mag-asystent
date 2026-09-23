/**
 * Co wiadomo o zdjęciu oferty, zanim ktokolwiek pójdzie po plik (0.214.0).
 *
 * Trzy stany, bo każdy każe co innego zrobić — a jeden napis „bez zdjęcia"
 * na wszystkie trzy kazał agentowi zgadywać, czy obraz dopiero przyjedzie.
 * Lustro `StanZdjeciaOferty` z `services/zdjecia-ofert.ts`.
 */
export type StanZdjeciaOferty = "jest" | "brak" | "nieznane";

/* Kształty odpowiedzi serwera. Trzymane osobno, bo czytają je i ekrany,
   i testy — a duplikat rozjechałby się przy pierwszym nowym polu. */

/* Lista ZAMKNIĘTA, wprost z §7 projektu panelu. Ten sam komplet stoi
   w `STATUSY_ROZMOWY` na serwerze i w `CHECK` na kolumnie — trzy kopie jednej
   listy, bo każda pilnuje innej granicy: typów, API i bazy. */
export type StatusRozmowy =
  | "new" | "open" | "waiting_for_customer" | "waiting_for_us" | "waiting_for_internal"
  | "snoozed" | "resolved" | "closed" | "spam";

/** Źródło zakończenia rozmowy — patrz `wyliczStatus` na serwerze. */
export type ZrodloZakonczenia = "agent" | "podziekowanie" | "cisza" | "allegro";

export type Rozmowa = {
  id: number;
  klient: string;
  ostatniaWiadomosc: string;
  ostatniaWiadomoscAt: string;
  /** Czy podgląd to słowa klienta (0.166.0). Fałsz = ostatnia NASZA, bo klient nic nie napisał. */
  ostatniaOdKlienta: boolean;
  nieprzeczytana: boolean;
  wlascicielId: number | null;
  wlasciciel: string | null;
  wersja: number;
  /** Status WYLICZONY: odłożenie po terminie przyjeżdża już jako `open`. */
  status: StatusRozmowy;
  /** Ręczna flaga „pilne" (§10.2, 0.181.0). */
  priorytet: "normalny" | "pilny";
  /**
   * Ręczny znacznik „to sprawa reklamacyjna" (0.390.0) — NASZ, nie Allegro.
   *
   * Sprawy posprzedażowej sprzedawca nie może założyć: `/sale/issues` ma
   * wyłącznie GET, otwiera ją kupujący. Znacznik mówi wyłącznie, że biuro
   * prowadzi tę rozmowę jak reklamację — zegara ustawowego nie dokłada.
   */
  reklamacyjna: boolean;
  /** Ile czeka pytanie klienta. `null` = klient nic nie napisał, nikt nie czeka. */
  czekaOdMs: number | null;
  /**
   * Wiadomości klienta OD NASZEJ ODPOWIEDZI — nie „nieprzeczytane przez
   * agenta". Tamtego policzyć się nie da (Allegro daje samą flagę wątku),
   * więc ekran podpisuje tę liczbę tak, jak ją liczy.
   */
  nowychOdOdpowiedzi: number;
  /** Niezamknięte zadanie terenowe przy rozmowie. */
  zadanieWToku: boolean;
  /** Status doboru (§7, §10.2, etap E1). Bez wiersza doboru — `not_started`. */
  dobor: StatusDoboru;
  odlozoneDo: string | null;
  /** Odłożenie, którego termin minął. Liczy SERWER — panel tej reguły nie powtarza. */
  poTerminie: boolean;
  /**
   * Ostatnia wiadomość klienta to podziękowanie po naszej odpowiedzi
   * (22 września 2026). Status jest wtedy „Czeka na klienta"; liczy SERWER
   * z decyzji klasyfikatora, panel tej reguły nie powtarza.
   */
  podziekowal: boolean;
  /**
   * Skąd zakończenie, gdy `status` to `resolved` (23 września 2026): ręka
   * agenta, podziękowanie, dwa dni ciszy albo wątek zamknięty w Allegro.
   * Liczy serwer (`wyliczStatus`); panel tylko je nazywa.
   */
  zakonczenie?: ZrodloZakonczenia | null;
  /** Rozpoznanie Copilota (§14, etap F). `null` = nikt jeszcze nie rozpoznał. */
  kopilot: Kopilot | null;
  /* Kto SIEDZI przy rozmowie teraz. Przydział tymczasowy, na czas oglądania —
     żyje w pamięci serwera i wygasa sam, więc bywa `null` sekundę później. */
  oglada: { userId: number; name: string } | null;
};

/* Słownik kategorii — LUSTRO `KATEGORIE` z `server/src/services/klasyfikacja-slownik.ts`
   (specyfikacja z 20 września 2026). Wartości po angielsku, bo to kontrakt
   niezależny od dostawcy; nazwy po polsku stoją w `skrzynka/statusy.ts`
   i `Record<Kategoria, string>` nie skompiluje się bez kompletu. */
export type Kategoria =
  | "ORDER_STATUS" | "DELIVERY_DELAY" | "DELIVERY_LOST" | "DELIVERY_DAMAGED"
  | "PRODUCT_COMPATIBILITY" | "PRODUCT_QUESTION" | "PRODUCT_AVAILABILITY"
  | "WRONG_PRODUCT" | "MISSING_PRODUCT" | "DAMAGED_PRODUCT"
  | "RETURN" | "COMPLAINT" | "CANCEL_ORDER" | "INVOICE" | "OTHER";

/** Następny krok — podpowiedź, nie pozwolenie. Panel żadnej akcji sam nie wykonuje. */
export type Akcja =
  | "GET_ORDER" | "GET_SHIPMENT" | "GET_PRODUCT" | "CHECK_COMPATIBILITY" | "CHECK_STOCK"
  | "START_RETURN" | "START_COMPLAINT" | "ASK_FOR_MACHINE_MODEL" | "ASK_FOR_PART_NUMBER"
  | "ASK_FOR_PHOTO" | "HUMAN_REVIEW" | "NO_ACTION";

export type Pewnosc = "wysoka" | "srednia" | "niska";

export type Kopilot = {
  kategoria: Kategoria;
  dodatkowe: Kategoria[];
  akcja: Akcja;
  /** Akcja modelu, gdy polityka zamieniła ją na przegląd. `null` = bez zmian. */
  akcjaModelu: Akcja | null;
  /** Specyfikacyjne `needsHuman`: model, prośba klienta, niepewność albo awaria. */
  wymagaCzlowieka: boolean;
  brakDanychZamowienia: boolean;
  brakDanychProduktu: boolean;
  /** Pewność ZGŁOSZONA przez model; `null`, gdy modelu nie pytano. */
  pewnosc: Pewnosc | null;
  zrodlo: "ALLEGRO_MAPPING" | "MODEL" | "FALLBACK";
  status: "SUCCESS" | "FAILED" | "NEEDS_REVIEW";
  /** Reguły, które coś zmieniły. Zbiór otwarty — nieznany kod ekran pokazuje wprost. */
  kody: string[];
  uzasadnienie: string | null;
  /** Klient dopisał po rozpoznaniu. Liczy SERWER — panel tej reguły nie powtarza. */
  nieaktualna: boolean;
  /** Kategoria, którą człowiek JAWNIE potwierdził albo wskazał. To ona jest pomiarem. */
  kategoriaCzlowieka: Kategoria | null;
  kategoriaModelu: Kategoria | null;
};

/** Stan Copilota do paska nad kolejką. Czysty odczyt — nic nie mutuje. */
export type StanCopilota = {
  wlaczony: boolean;
  /** Zdanie dla człowieka, gdy `wlaczony` jest fałszem. `null`, gdy działa. */
  powod: string | null;
  model: string;
  /** Model klasyfikacji; bez `COPILOT_MODEL_KLASYFIKACJA` równy `model`. */
  modelKlasyfikacji: string;
  maxPartia: number;
  /** Takt sam rozpoznaje każdą nową wiadomość (`COPILOT_AUTO_KLASYFIKACJA`). */
  autoKlasyfikacja: boolean;
  /** Takt sam układa szkic (`COPILOT_AUTO_SZKIC`). */
  autoSzkic: boolean;
  /** Szkic układa się sam zaraz po rozpoznaniu (23 września 2026). Starszy serwer go nie zna. */
  szkicPoRozpoznaniu?: boolean;
};

/** Wynik partii. `przerwane` niepuste znaczy: część zapłacona, reszta czeka. */
export type WynikPartii = {
  sklasyfikowane: number;
  pominiete: Array<{ rozmowaId: number; powod: string }>;
  bledy: Array<{ rozmowaId: number; powod: string }>;
  przerwane: string | null;
  zuzycie: {
    wej: number; wyj: number; cacheZapis: number; cacheOdczyt: number; kosztUsd: number;
  };
  /** Ile szkiców serwer zlecił w tle po tym rozpoznaniu (23 września 2026). */
  szkicow?: number;
};

/** Udział z przedziałem Wilsona 95 %. Liczy SERWER. */
export type Udzial = { k: number; n: number; p: number; dolna: number; gorna: number };

export type PomiarKlasyfikacji = {
  taksonomia: string;
  decyzji: number;
  wgZrodla: Record<Kopilot["zrodlo"], number>;
  wgStatusu: Record<string, number>;
  wymagaCzlowieka: number;
  oznaczonych: number;
  /** Bez tej liczby każdy procent udawałby pomiar. */
  nieoznaczonych: number;
  poprawionych: number;
  wgKategorii: Array<{ kategoria: Kategoria; przewidzianych: number;
    precyzja: Udzial | null; czulosc: Udzial | null }>;
  /** Zgodność mapowania struktury Allegro z etykietą człowieka — osobno od modelu. */
  mapowanie: Udzial | null;
};

/** Pomiar zza zębatki (0.168.0: diagnostyka nie stoi na ekranie pracy). */
export type PomiarCopilota = {
  wywolan: number;
  bledow: number;
  tokeny: { wej: number; wyj: number; cacheZapis: number; cacheOdczyt: number };
  kosztUsd: number;
  udzialCache: number | null;
  /** Klasyfikacja w kształcie specyfikacji — precyzja i czułość per klasa. */
  klasyfikacja: PomiarKlasyfikacji;
  /** Rozbicie księgi po zadaniu (0.231.0) — koszt szkiców osobno od klasyfikacji. */
  wgZadania: Array<{ zadanie: string; wywolan: number; bledow: number; kosztUsd: number }>;
  szkice: {
    ile: number; odrzuconych: number;
    /** Los danych doboru z rozmowy — osobno od losu szkicu. */
    daneZaproponowane: number; daneWpisane: number; daneOdrzucone: number;
    /** Pasowania z rozmowy (przyrost czwarty); ostatnia liczba to właściwa miara jakości. */
    pasowaniaRozpoznane: number; pasowaniaZaproponowane: number; pasowaniaOdrzucone: number;
    pasowaniaZatwierdzonePrzezBiuro: number;
    /** Los szkicu przy wysyłce: poszedł bez zmian albo z poprawką. */
    wyslanychBezZmian: number; wyslanychPoprawionych: number;
  };
};

/** Załącznik wiadomości. `doPobrania` liczy serwer — panel go nie wylicza. */
export type ZalacznikOsi = {
  id: number; nazwa: string; typ: string | null; status: string; doPobrania: boolean;
  /* Czy obraz rysuje się WPROST na osi (0.218.0). Liczy SERWER — panel nie
     zgaduje po `typ`, bo lista typów, które trasa podglądu odda, jest tam. */
  podglad: boolean;
};

export type WpisOsi = {
  id: string;
  /* `odeslanie_zadania` (0.352.0) — odpowiedź hali BEZ wyniku. Musi tu stać
     jawnie: nieznany rodzaj wpada w `Os.tsx` do gałęzi domyślnej, czyli
     rysuje się jak wypowiedź w rozmowie z klientem. Odmowa hali udająca
     zdanie wysłane kupującemu to najgorszy możliwy wynik tej zmiany. */
  rodzaj: "wiadomosc" | "zlecenie" | "wynik_zadania" | "odeslanie_zadania"
    | "komentarz" | "status" | "dobor";
  autor: string;
  odKlienta: boolean;
  tresc: string;
  at: string;
  ofertaId: string | null;
  /** Tytuł oferty ze snapshotu, a gdy go nie ma — nazwa z pozycji zamówienia. */
  nazwaOferty?: string | null;
  /** Zamówienie, którego dotyczy wiadomość (`relatesTo.order`, 0.166.0). */
  zamowienieId?: string | null;
  zadanieId?: number;
  /**
   * Szczegóły ZLECENIA dla hali (0.226.0) — tylko przy `rodzaj: "zlecenie"`.
   * Lustro pola z `services/skrzynka.ts`; panel rysuje z tego blok, więc
   * części jadą osobno, a nie sklejone w jeden łańcuch.
   */
  zlecenie?: {
    rodzaj: string; tytul: string; status: string; priorytet: string;
    przypisanoPrzez: string | null;
    twId: number | null; symbol: string | null; nazwaTowaru: string | null;
  };
  /**
   * Zdarzenie w postaci KLUCZY (0.243.0) — przy `status` i `dobor`.
   * `tresc` zostaje zdaniem dla podpowiedzi, a to pole niesie
   * to samo rozłożone na części, żeby pasek zdarzeń mógł pokazać krótką
   * etykietę po polsku. Słownik polszczyzny stoi w panelu — angielskie klucze
   * zostają w bazie i w API. Panel nie ma prawa rozbierać `tresc` z powrotem:
   * to jest zdanie dla człowieka, a nie format.
   */
  zdarzenie?:
    | { rodzaj: "status" | "dobor"; po: string | null }
    | { rodzaj: "dobor_wybor"; wybrano: boolean; symbol: string | null };
  messageId?: number;
  zalaczniki?: ZalacznikOsi[];
  wzmianki?: Array<{ userId: number; name: string }>;
  /* Nasze automatyczne „Dziękujemy za kontakt" (0.218.0) — wpis zwinięty. */
  automatyczna?: boolean;
  /* Blok firmowy odcięty od treści (0.219.1) — `tresc` jest bez niego. */
  stopka?: string;
};

/* Wzmianka w skrzynce „wspomniano o mnie" (§6.4, 0.160.0). Fragment liczy
   SERWER — panel nie skraca treści drugi raz po swojemu. */
export type WpisWzmianki = {
  commentId: number;
  conversationId: number;
  klient: string;
  autor: string;
  fragment: string;
  at: string;
  odhaczona: boolean;
  odhaczonaAt: string | null;
};

export type Szkic = { body: string; wersja: number; expectedLastMessageId: number | null };

export type StanSkrzynki = { ostatniaSynchronizacja: string | null; bledy: number };

export type OfertaWskazana = { ofertaId: string; autor: string };

/* Zamówienie przy rozmowie (0.166.0). `pobrane` jest `null`, dopóki ticker
   nie dociągnie treści — numer i odnośnik do panelu Allegro są od razu. */
export type ZamowienieRozmowy = {
  externalId: string; link: string | null; pobrane: Zamowienie | null;
  /** Stan paczki z ostatniego sprawdzenia; `null`, dopóki zamówienia nie ma w bazie. */
  przesylka: StanPrzesylki | null;
};

/* Oferta przy rozmowie (0.178.0). `pobrana` jest `null`, dopóki ticker nie
   dociągnie snapshotu — numer i odnośnik są od razu. Cena opisuje CHWILĘ
   pytania (§15.2), nie dzisiejszy cennik. */
export type OfertaRozmowy = {
  externalId: string; link: string | null;
  /** Skąd numer (0.215.0): wskazanie agenta, wiadomość klienta albo jedyna pozycja zamówienia. */
  zrodlo: "wiadomosc" | "reczne" | "zamowienie";
  /**
   * Lista „Pasuje do" z oferty z trafieniami maszyny z doboru (23 września 2026).
   * `null`: treści oferty jeszcze nie pobrano albo lista jest pusta.
   */
  zgodnosc: ZgodnoscOferty | null;
  pobrana: {
    nazwa: string; sku: string | null; cenaGrosze: number | null;
    waluta: string | null; status: string | null; syncedAt: string;
    /**
     * Co wiadomo o zdjęciu listingowym (0.214.0; do 0.213.0 `maZdjecie`).
     *
     * Sam adres do panelu NIE JEDZIE i to jest cała różnica: gdyby jechał,
     * front miałby w ręku `https://a.allegroimg.com/…` i prędzej czy później
     * ktoś wstawiłby go w `src`, czyli wyprowadził przeglądarkę biura poza
     * własną sieć. Jedzie sam STAN.
     */
    zdjecie: StanZdjeciaOferty;
  } | null;
  /** Kartoteka wywiedziona z SKU oferty (0.179.0) — PROPOZYCJA z powodem. */
  kartoteka: DopasowanieKartoteki;
};

/* Ten sam kształt, co przy pozycji zwrotu: `zrodlo` jest gotowym ZDANIEM
   z serwera, a nie kodem do przetłumaczenia w panelu. Druga kopia tej reguły
   po tej stronie rozjechałaby się przy pierwszej poprawce jednej z nich. */
export type DopasowanieKartoteki = {
  pewnosc: "brak" | "sku" | "pamiec" | "jedyna_pozycja" | "nazwa_w_zamowieniu" | "niejednoznaczne";
  twId: number | null;
  symbol: string | null;
  zrodlo: string;
  powod: string | null;
};

/* Karta towaru z Subiekta — podzbiór `ProductCard` z serwera, opisany tu tak
   samo jak `Towar` w `wyszukiwarka.tsx`. Bierzemy to, co odpowiada na pytanie
   agenta przy rozmowie: czy jest, ile jest i gdzie leży. */
export type KartaTowaru = {
  id: number; sym: string; name: string; ean: string | null; unit: string | null;
  /** Opis kartoteki i zamienniki z niego wyczytane — serwer to zwraca od dawna, kolektor czyta. */
  desc?: string;
  zamienniki?: { znane: Array<{ id: number; sym: string; name: string }>; obce: string[] };
  /** Identyfikatory części (E3): z opisu po imporcie albo wpisane ręcznie. Pole addytywne. */
  identyfikatory?: Array<{ rodzaj: RodzajIdentyfikatora; wartosc: string; zrodlo: ZrodloIdentyfikatora }>;
  locs: string[];
  /**
   * Ceny z kartoteki Subiekta — WSZYSTKIE poziomy (0.396.0, decyzja właściciela).
   *
   * Pole ADDYTYWNE i opcjonalne, bo czyta tę odpowiedź także kolektor
   * (`ignoreUnknownKeys` w `Dtos.kt`), a ceny go nie dotyczą. Pusta lista
   * znaczy „nie wiemy", nigdy „za darmo".
   */
  ceny?: CenaPoziomu[];
  mag: { stan: number; rez: number; avail: number };
  magazyny: Array<{ magId: number; kod: string; nazwa: string; stan: number; rez: number }>;
};

/** Lista zgodności oferty — to samo dopasowanie, co fakt szkicu (`zgodnosc-oferty.ts`). */
export type ZgodnoscOferty = {
  lista: string[];
  /** „HECHT 1803S DYM1182c", gdy agent wpisał markę i model w doborze. */
  maszyna: string | null;
  trafienia: string[];
  wariantSprawdzony: boolean;
};

/** Jeden poziom cenowy kartoteki; kwoty w GROSZACH całkowitych. */
export type CenaPoziomu = {
  poziom: number;
  /** Nazwa ze słownika Subiekta; pusta, gdy baza nazw nie trzyma. */
  nazwa: string;
  nettoGrosze: number | null;
  bruttoGrosze: number | null;
  waluta: string;
};

/* ── Spoiwo kolejek (`docs/obsluga-klienta-calosc.md`) ───────────────────────
   Typy stoją TUTAJ, a nie przy komponencie, bo niesie je ładunek czterech
   różnych tras. Komponent, który by je posiadał, kazałby `api/` importować
   z warstwy widoku — a wtedy zmiana układu bloku ruszałaby kontrakt HTTP. */

/** Reklamacja albo dyskusja tego samego zakupu — wiersz lekki, do czytania. */
export interface SprawaZakupu {
  id: number;
  /** `CLAIM` albo `DISPUTE`; jedna plakietka na oba to blizna 0.121.0. */
  typ: string;
  numer: string | null;
  temat: string | null;
  statusAllegro: string | null;
  decyzjaDo: string | null;
  otwartoAt: string;
  prowadzi: string | null;
  otwarta: boolean;
}

/**
 * Jedna pozycja listy „Moje" (S4 spoiwa) — z której kolejki i co to za sprawa.
 *
 * TRZY KOLEJKI, nie cztery: zwrot nie ma prowadzącego od 0.370.0, bo
 * przechodzi przez biuro jako kolejka decyzji, a nie jako czyjaś sprawa.
 */
export interface MojaSprawa {
  kolejka: "rozmowa" | "reklamacja" | "dyskusja";
  id: number;
  opis: string;
  /** Ostatni ruch przy sprawie — zegar opisowy, nie termin. */
  at: string;
  /** Termin z Allegro; `null` przy rozmowie i dyskusji, które go nie mają. */
  terminDo: string | null;
}

/** Jeden miesiąc miary eskalacji (S5 spoiwa) — zawsze z własną podstawą. */
export interface MiesiacEskalacji {
  miesiac: string;
  /** Zakupy, przy których klient napisał do skrzynki. */
  zRozmowa: number;
  /** Z nich: ile skończyło się dyskusją albo reklamacją PO naszej rozmowie. */
  eskalowane: number;
}

/**
 * Co wiemy o paczce do klienta (0.393.0).
 *
 * `sprawdzonoAt === null` znaczy „jeszcze nie pytaliśmy Allegro", a nie „nie
 * ma przesyłki" — to dwa różne zdania i dwa różne następne ruchy agenta.
 */
export interface StanPrzesylki {
  waybill: string | null;
  przewoznik: string | null;
  /** Kod ostatniego statusu przewoźnika: `IN_TRANSIT`, `DELIVERED`, `ISSUE`… */
  status: string | null;
  dostarczonoAt: string | null;
  sprawdzonoAt: string | null;
}

/** Jeden przystanek drogi zakupu przez kolejki, z momentem wejścia. */
export interface PrzystanekDrogi {
  rodzaj: "rozmowa" | "dyskusja" | "reklamacja" | "zwrot";
  id: number;
  at: string;
  opis: string | null;
}

/** Zakup kupującego z rozmowy — wiersz do przeczytania i jednego kliknięcia. */
export type KandydatZamowienia = {
  externalId: string;
  link: string | null;
  status: string | null;
  kupionoAt: string | null;
  sumaGrosze: number | null;
  waluta: string;
  /** Nazwy pozycji po przecinku — po nich agent poznaje „to ta paczka". */
  pozycje: string;
  /** Czy zakup niesie OFERTĘ z tej rozmowy; jedyna przesłanka mocniejsza od czasu. */
  maTeOferte: boolean;
};

export type OsRozmowy = {
  rozmowa: Rozmowa;
  os: WpisOsi[];
  szkic: Szkic | null;
  ofertaWskazana: OfertaWskazana | null;
  zamowienie: ZamowienieRozmowy | null;
  oferta: OfertaRozmowy | null;
  /**
   * Zakupy tego kupującego — kandydaci do powiązania (0.397.0).
   *
   * Wątek z Allegro niesie JEDEN obiekt powiązany, więc pytanie zadane pod
   * ofertą numeru zakupu nie ma. Mostkiem jest login kupującego, ten sam,
   * którym chodzi zakładka „Klient".
   */
  kandydaciZamowien: KandydatZamowienia[];
  /** Zwroty TEGO zamówienia (0.221.0) — ten sam wiersz, co w kolejce zwrotów. */
  zwroty: Zwrot[];
  /* Spoiwo kolejek (S1 i S3, `docs/obsluga-klienta-calosc.md`): reklamacje
     i dyskusje tego zakupu oraz jego droga przez kolejki. */
  sprawy: SprawaZakupu[];
  droga: PrzystanekDrogi[];
  dobor: Dobor;
  /** Propozycja Copilota (§14.6) — osobny byt, nie szkic agenta. `null` = nikt nie prosił. */
  szkicCopilota: SzkicCopilota | null;
};

/* ── Szkic odpowiedzi z Copilota (§14.6, 0.231.0) ────────────────────────────
   Serwer układa fakty, model pisze prozę, serwer sprawdza numery. Do szkicu
   agenta trafia WYŁĄCZNIE na kliknięcie — stąd `ocena`, która jest miernikiem. */
export type OcenaSzkicu = "wstawiony" | "zastapiony" | "odrzucony";
export type SzkicCopilota = {
  tresc: string;
  /** Czego model NIE znalazł w faktach — treść dla agenta, nie dla klienta. */
  zastrzezenia: string[];
  uzyteFakty: string[];
  /** Ostatnia wiadomość klienta, na której powstał. Nowsza = propozycja nieświeża. */
  messageId: number | null;
  model: string;
  at: string;
  przez: string;
  ocena: OcenaSzkicu | null;
  /**
   * Dane doboru rozpoznane w rozmowie (przyrost trzeci), sprawdzone przez
   * serwer przeciw wątkowi. `null` = nic nie rozpoznano. To PROPOZYCJA: do
   * pól doboru wchodzi na kliknięcie agenta, wyłącznie w puste.
   */
  daneDoboru: DaneDoboru | null;
  daneOcena: OcenaDanych | null;
  /** Wersja doboru, na której szkic powstał — inna dziś = szkic nieświeży. */
  doborWersja: number;
  /**
   * Pasowanie rozpoznane w rozmowie (przyrost czwarty): oba końce to kartoteki
   * z kontekstu tej rozmowy, sprawdzone przez serwer. `null` = nic. To
   * PROPOZYCJA: do kolejki wiedzy wchodzi na kliknięcie agenta, rozstrzyga biuro.
   */
  pasowanie: PropozycjaPasowaniaCopilota | null;
  pasowanieOcena: OcenaPasowania | null;
  /**
   * SKĄD MODEL TO WIE (0.253.0) — rachunek za tekst, który agent zaraz wyśle.
   *
   * Do 0.252.0 model nie miał prawa użyć własnej wiedzy: numer spoza faktów
   * wywracał cały szkic. Właściciel zdjął ten zakaz pod jednym warunkiem —
   * „pełna swoboda, ale niech przy tym załącza źródła". Ta lista jest tym
   * warunkiem, a okno „Skąd to wiem" w panelu jest miejscem, w którym agent
   * ją czyta, ZANIM kliknie „Wstaw".
   *
   * Pewność przyznaje SERWER, nie model: `obnizona` znaczy, że model chciał
   * wyżej, niż wolno przy tym źródle.
   */
  twierdzenia: TwierdzenieCopilota[];
  /**
   * POKWITOWANIE wiedzy odzyskanej z oferty (0.264.0).
   *
   * Właściciel w 0.254.0: „jeśli jakieś numery są w ofercie, a nie ma
   * w kartotece, zaznacz — to jest organiczna okazja do uzupełnienia danych".
   * Do 0.263.0 był to sam akapit z listą braków, liczony od zera przy każdym
   * kliknięciu. Teraz mówi, co przy tym szkicu FAKTYCZNIE trafiło do bazy
   * i ile pozycji tej kartoteki czeka w kolejce Wiedzy.
   *
   * Liczy je serwer, nie model, i do faktów nie wchodzą: czego nam brakuje
   * w danych, to zdanie o NAS, a nie o maszynie klienta.
   */
  lukiKartoteki: PokwitowanieZOferty;
  /**
   * CO MODEL ODCZYTAŁ ZE ZDJĘĆ przysłanych przez klienta.
   *
   * To jest CENA za prawo powołania się na fotografię. Odsiew numerów odrzuca
   * szkic z numerem nieobecnym w faktach i w wątku, a tabliczka znamionowa to
   * sama numeracja — bez zadeklarowanego odczytu każde UDANE odczytanie
   * kasowałoby własny szkic. Odczyt otwiera tym numerom drogę i jednocześnie
   * czyni je sprawdzalnymi: agent czyta go obok miniatury i rozstrzyga jednym
   * spojrzeniem, czy model przeczytał tabliczkę, czy ją sobie wyobraził.
   *
   * Pusta lista znaczy jedno z trojga i ekran ich nie rozróżnia, bo nie musi:
   * rozmowa nie miała zdjęć, zdjęcia nie przeszły bramki albo model niczego
   * nie odczytał. Za każdym razem wynika z tego to samo — nie ma się na co
   * powołać.
   */
  odczytZeZdjec: OdczytZdjecia[];
};

export type PokwitowanieZOferty = {
  /** Do KTÓREJ kartoteki to poszło; `null`, gdy oferta nie wskazuje pewnej kartoteki. */
  symbol: string | null;
  numery: Array<{ rodzaj: string; wartosc: string }>;
  /** Pozycje zgodności ODŁOŻONE do kolejki — te, przy których marka milczała. */
  modele: string[];
  /**
   * Pozycje, które weszły do wiedzy OD RAZU (0.341.0), bo markę dało się
   * odczytać z tekstu, z naszej bazy albo z tytułu oferty. Rozłączne
   * z `modele`. Szkice sprzed tego wydania mają tu pustą listę.
   */
  wpisane: string[];
  czeka: number;
};

/**
 * Wpis, który automat wiedzy dopisał BEZ człowieka (0.331.0).
 *
 * Rozpoznany po parze `rozstrzygnal` niepuste i `rozstrzygnal_user_id` puste.
 * Karta w ustawieniach pokazuje te wiersze do PROSTOWANIA — cofanie idzie
 * istniejącymi trasami wiedzy, bo to dalej to samo wycofanie, tylko cudzego
 * wpisu zamiast własnego.
 */
export type WpisAutomatu = {
  rodzaj: "zastosowanie" | "pasowanie";
  id: number;
  symbol: string;
  etykieta: string;
  at: string;
};

/**
 * Wymiana z Copilotem (0.332.0): pytanie agenta i odpowiedź modelu.
 *
 * ODPOWIEDŹ CZYTA AGENT, nie klient, i nie ma stąd drogi do wiadomości.
 * Dlatego wiersz nie ma `ocena` — mierzy się szkic, nie rozmowę o nim —
 * i dlatego ekran nie daje przycisku „wstaw". Żeby coś z wymiany poszło do
 * klienta, agent układa szkic od nowa, a tamten ma swoje sita.
 */
export type WymianaCopilota = {
  id: number;
  pytanie: string;
  odpowiedz: string;
  twierdzenia: TwierdzenieCopilota[];
  model: string;
  at: string;
  przez: string;
};

/** Skąd wziął się wiersz identyfikatora. `oferta` doszło w 0.264.0, `dostawca`
 *  z importem odsyłaczy od dostawców. */
export type ZrodloIdentyfikatora = "opis" | "reczne" | "oferta" | "dostawca";

/**
 * Skąd wzięło się twierdzenie: nasza baza, opis oferty, ZDJĘCIE od klienta,
 * wiedza własna modelu. `zdjecie` ma sufit „prawdopodobne" i to nie jest
 * ostrożność na wyrost: z tego, że na fotografii widać tabliczkę, nie wynika,
 * że to tabliczka maszyny, o którą klient pyta.
 */
export type ZrodloTwierdzenia = "fakty" | "oferta" | "zdjecie" | "model";
export type PoziomPewnosci = "pewne" | "prawdopodobne" | "niepewne";
export type TwierdzenieCopilota = {
  teza: string;
  zrodlo: ZrodloTwierdzenia;
  /** `F3`, nazwa parametru oferty albo `null`, gdy model mówi z siebie. */
  odwolanie: string | null;
  pewnosc: PoziomPewnosci;
  /** Serwer obniżył pewność do sufitu źródła — model chciał wyżej. */
  obnizona: boolean;
};
/** Co model odczytał z jednego zdjęcia. `zdjecie` to `Z1`, `Z2` ze spisu. */
export type OdczytZdjecia = { zdjecie: string; tekst: string };
export type OcenaDanych = "wpisane" | "odrzucone";
export type OcenaPasowania = "zaproponowane" | "odrzucone";
export type PropozycjaPasowaniaCopilota = {
  czesc: KartotekaPasowania; doCzego: KartotekaPasowania; rola: RolaPasowania; pozycja: string | null;
};

/* ── Dobór części (§11, etap E1) ─────────────────────────────────────────────
   Lista statusów ZAMKNIĘTA, wprost z §7 — trzecia kopia obok `STATUSY_DOBORU`
   na serwerze i `CHECK` na kolumnie. `extracting_data` nie ma w E nadawcy:
   serwer go odrzuca, nada go Copilot (F). */
export type StatusDoboru =
  | "not_started" | "extracting_data" | "missing_information" | "searching"
  | "candidates_found" | "requires_expert" | "confirmed" | "rejected" | "not_applicable";

/* Jedenaście dróg §11.2. `silnik` to zastosowanie o jeden przeskok dalej:
   część pasuje do silnika, a silnik stoi w maszynie, o którą pyta klient.
   `wymiar` to zgodna liczba z jednostką z parametrów doboru — podpowiedź. */
export type DrogaDoboru =
  | "oferta" | "zamiennik" | "symbol" | "ean" | "wyszukiwarka" | "zastosowanie" | "silnik" | "pasowanie"
  | "oem" | "pelnotekst" | "wymiar";

export type DaneDoboru = {
  marka: string | null; model: string | null; wariant: string | null; rocznik: string | null;
  nrSeryjny: string | null; silnik: string | null; oem: string | null; nazwaCzesci: string | null;
  parametry: Record<string, string>;
};

export type WyborDoboru = {
  twId: number; symbol: string; droga: DrogaDoboru; przez: string; at: string;
  /** Zdanie do szkicu pisze SERWER (§14.3) — ze źródłem; panel go nie układa. */
  zdanieDoSzkicu: string;
};

export type Dobor = {
  status: StatusDoboru;
  /** Wersja DANYCH doboru — własna, nie `Rozmowa.wersja`. */
  wersja: number;
  dane: DaneDoboru;
  brakuje: string | null;
  wybrany: WyborDoboru | null;
  updatedBy: string | null;
  updatedAt: string | null;
};

export type KandydatDoboru = {
  /** `twId: null` = numer OEM bez wiersza w kartotece (§11.2, E3, makieta Dobor.dc.html): bez stanu i bez Wybierz. */
  nr: number; twId: number | null; symbol: string; nazwa: string; stan: number | null;
  droga: DrogaDoboru;
  pewnosc: "potwierdzone" | "prawdopodobne" | "wymaga_danych";
  /** Zdanie z serwera (§11.3): skąd kandydat, nie sam kod drogi. */
  zrodlo: string;
  ostrzezenia: string[];
};

/** Szczebel §11.2: sprawdzony z liczbą wyników albo pominięty Z POWODEM. */
/**
 * Czym agent może zamknąć brak TU I TERAZ, bez opuszczania rozmowy (0.267.0).
 * Rodzaj nadaje serwer, w tej samej gałęzi, w której pisze powód — panel nie
 * rozbiera zdania po polsku, żeby zgadnąć przycisk.
 */
export type AkcjaSzczebla = { rodzaj: "dane" | "wymiar" | "zabudowa"; etykieta: string };

export type SzczebelDoboru = {
  droga: DrogaDoboru; sprawdzona: boolean; wynikow: number; powod?: string;
  /** Brak akcji znaczy „tego nie da się załatwić w rozmowie" — i tak ma zostać. */
  akcja?: AkcjaSzczebla;
};

/* Negatyw jest widoczny także dla kartoteki, której NIE MA wśród kandydatów (§11.4). */
export type NegatywDoboru = {
  twId: number; symbol: string; nazwa: string | null; powod: string; zrodlo: string; at: string;
};

/** Kartoteka wskazana przez agenta (symbol/EAN/OEM) albo kartoteka oferty — cel przycisku „Pasuje do…". */
export type KotwicaDoboru = { twId: number; symbol: string; nazwa: string };
export type KandydaciDoboru = {
  kandydaci: KandydatDoboru[]; drogi: SzczebelDoboru[]; negatywne: NegatywDoboru[]; kotwice: KotwicaDoboru[];
};

/* ── Baza wiedzy (§11.3, §11.4, §12, etap E2) ────────────────────────────────
   Listy ZAMKNIĘTE — trzecia kopia obok `services/wiedza.ts` i `CHECK`. */
export type PowodNegatywny =
  | "nie_pasuje" | "tylko_inny_wariant" | "niewlasciwy_rozstaw"
  | "srednica_ok_inne_mocowanie" | "mylace_oznaczenie" | "wymaga_pomiaru";
export type RodzajDowodu =
  | "producent" | "katalog_dostawcy" | "pomiar_wlasny" | "sprzedaz_weryfikacja" | "decyzja_biura" | "rozmowa";
export type StanZastosowania = "propozycja" | "zatwierdzone" | "odrzucone" | "wycofane";
/* `oferta` (0.264.0): propozycja z pozycji listy zgodności NASZEJ oferty
   Allegro, złożona ręką biura w kolejce Wiedzy. Osobno od `opis`, bo to inne
   świadectwo — deklaracja sprzedawcy w aukcji, nie opis towaru z magazynu. */
export type ZrodloPropozycji = "dobor" | "pomiar" | "reczne" | "opis" | "copilot" | "oferta";

export type ModelUrzadzenia = {
  id: number; rodzaj: "maszyna" | "silnik"; marka: string; nazwa: string;
  wariant: string | null; lata: string | null; klucz: string; etykieta: string;
};

export type DowodZastosowania = {
  id: number; rodzaj: RodzajDowodu; nazwaRodzaju: string; tresc: string; link: string | null;
  zadanieId: number | null; conversationId: number | null; autor: string; at: string;
};

/** Kwalifikatory wpisu: lata, zakres numerów seryjnych, warunek słowny. Wszystkie `null` = bez warunków. */
export type WarunkiZastosowania = {
  rokOd: number | null; rokDo: number | null; seryjnyOd: string | null; seryjnyDo: string | null; warunek: string | null;
};

export type Zastosowanie = {
  id: number; twId: number; symbol: string; model: ModelUrzadzenia;
  polaryzacja: "pasuje" | "nie_pasuje"; powodNegatywny: PowodNegatywny | null; zdaniePowodu: string | null;
  stan: StanZastosowania; zrodlo: ZrodloPropozycji; komentarz: string | null;
  conversationId: number | null; zastepujeId: number | null;
  zaproponowal: string; zaproponowanoAt: string;
  rozstrzygnal: string | null; rozstrzygnietoAt: string | null; powodRozstrzygniecia: string | null;
  dowody: DowodZastosowania[];
  pewnosc: "potwierdzone" | "prawdopodobne";
  warunki: WarunkiZastosowania;
  /** „roczniki 2014–2018, nr seryjny od 175000000" — pisze SERWER; `null` = bez warunków. */
  zdanieWarunkow: string | null;
  /** Wykaz części, z którego przyszła propozycja; `null` = inne źródło. Brak pola = serwer sprzed przeglądu wykazów. */
  importId?: number | null;
  /** Zdanie źródła pisze SERWER (§14.3). */
  zdanieZrodla: string;
};

/* ── Identyfikatory i sekcje „Modele:" z opisów (§11.2, etap E3) ─────────── */
export type RodzajIdentyfikatora = "oem" | "nr_oryg" | "katalog_obcy" | "stare_sku" | "zamiennik";

export type Identyfikator = {
  id: number; twId: number; symbol: string; nazwa: string | null;
  rodzaj: RodzajIdentyfikatora; nazwaRodzaju: string; wartosc: string;
  zrodlo: ZrodloIdentyfikatora; dodal: string; at: string;
  /** Z KTÓREJ oferty; `null` dla `opis` i `reczne`. */
  ofertaId: string | null;
  /** Od KOGO — nazwa dostawcy z importu odsyłaczy; `null` poza źródłem `dostawca`. */
  dostawca: string | null;
};

/* ── Import odsyłaczy od dostawców ───────────────────────────────────────────
   Kształt z `services/odsylacze-dostawcow.ts`. Kolumny wskazuje MAPOWANIE po
   pozycji, bo każdy cennik ma inne nagłówki. */
export type MapowanieOdsylaczy = {
  symbol: number | null; ean: number | null; numery: number[]; rodzaj: "oem" | "katalog_obcy";
};

export type TrescImportu = { csv?: string; tabela?: string[][] };

export type RaportImportuOdsylaczy = {
  naglowki: string[];
  probka: string[][];
  mapowanie: MapowanieOdsylaczy | null;
  zgadniete: boolean;
  wierszy: number;
  dopasowanych: number;
  kartotek: number;
  bezKartoteki: { liczba: number; przyklady: string[] };
  niejednoznaczne: { liczba: number; przyklady: string[] };
  bezNumerow: number;
  numerow: { nowych: number; znanych: number };
  zastapi: number;
  noweKandydaty: number;
  przyklady: Array<{ symbol: string; nazwa: string; numery: string[] }>;
  zapisano: { importId: number; numerow: number } | null;
};

export type ImportOdsylaczy = {
  id: number; dostawca: string; plik: string | null; wierszy: number; dopasowanych: number; numerow: number;
  stan: "aktywny" | "zastapiony" | "wycofany"; zaimportowal: string; at: string;
  wycofal: string | null; wycofanoAt: string | null;
};

/* ── Wykaz części producenta (IPL) ───────────────────────────────────────────
   Kształt z `services/wykaz-czesci.ts`. Marka, model i wariant to kolumna
   ALBO jedna wartość dla całego pliku — wykaz jednej maszyny nie ma kolumny
   „model". */
export type PoleWykazu = { kolumna: number } | { tekst: string } | null;

export type MapowanieWykazu = {
  marka: PoleWykazu; model: PoleWykazu; wariant: PoleWykazu; numery: number[];
  rokOd: number | null; rokDo: number | null; seryjnyOd: number | null; seryjnyDo: number | null;
  rodzaj: "maszyna" | "silnik";
};

export type ParaWykazu = { symbol: string; nazwa: string; maszyna: string; numery: string[]; warunki: string | null };

export type RaportWykazu = {
  naglowki: string[];
  probka: string[][];
  mapowanie: MapowanieWykazu | null;
  zgadniete: boolean;
  wierszy: number;
  dopasowanych: number;
  bezMaszyny: number;
  bezNumerow: number;
  bledneWarunki: { liczba: number; przyklady: string[] };
  bezKartoteki: { liczba: number; przyklady: string[] };
  maszyn: { nowych: number; znanych: number };
  par: { nowych: number; znanych: number; znanychInneWarunki: number };
  przyklady: ParaWykazu[];
  inneWarunki: ParaWykazu[];
  zapisano: { importId: number; propozycji: number } | null;
};

/** Czekające propozycje jednego wykazu — przegląd listą w kolejce. */
export type PozycjaPrzegladu = {
  id: number; twId: number; symbol: string; nazwa: string | null; maszyna: string; warunki: string | null; dowod: string;
};
export type PrzegladWykazu = {
  id: number; zrodlo: string; link: string | null; rodzaj: "maszyna" | "silnik"; pozycje: PozycjaPrzegladu[];
};

export type ImportWykazu = {
  id: number; zrodlo: string; link: string | null; plik: string | null; rodzaj: "maszyna" | "silnik";
  wierszy: number; par: number; propozycji: number; czeka: number; zatwierdzonych: number;
  stan: "aktywny" | "wycofany"; zaimportowal: string; at: string; wycofal: string | null; wycofanoAt: string | null;
};

/**
 * Tekst, z którego CZŁOWIEK składa klucz modelu, i który zamienia na
 * propozycję albo odrzuca. Od 0.264.0 kolejka niesie dwa źródła: sekcję
 * „Modele:" z opisu kartoteki i pozycję listy zgodności z naszej oferty.
 * Zadanie człowieka jest to samo, więc kolejka jedna — ale wiersz mówi,
 * na co człowiek patrzy: na wycinek opisu magazynu czy na deklarację
 * sprzedawcy z aukcji.
 */
export type ModelZOpisu = {
  id: number; twId: number; symbol: string; nazwa: string | null; tekst: string;
  stan: "nowy" | "przerobiony" | "odrzucony"; zastosowanieId: number | null;
  rozstrzygnal: string | null; rozstrzygnietoAt: string | null; at: string;
  zrodlo: "opis" | "oferta"; ofertaId: string | null;
};

/**
 * Skuteczność doboru (0.267.0) — którym z jedenastu szczebli §11.2 przyszedł
 * kandydat, którego agent naprawdę wybrał. Liczone z KSIĘGI ZDARZEŃ, nie ze
 * stanu tabeli: tamta pamięta ostatni wybór, a pytanie brzmi „która droga dała
 * trafienie". `naStole` jest jedyną częścią liczoną ze stanu i dlatego stoi
 * osobno — to inne pytanie i inna populacja.
 */
export type SkutecznoscDoboru = {
  dni: number;
  /** Próg, przed którym rozmów w bazie nie ma; bez niego selektor „90 dni" obiecuje kwartał. */
  granicaHistorii: string | null;
  wyborow: number;
  drogi: Array<{ droga: DrogaDoboru; wybranych: number; zatwierdzonych: number }>;
  medianaDoWyboruMin: number | null;
  wyborowZCzasem: number;
  osoby: Array<{
    userId: number | null; osoba: string; wybranych: number; zatwierdzonych: number;
    najczestszaDroga: DrogaDoboru | null; medianaMin: number | null;
  }>;
  bezKonta: number;
  naStole: { doborow: number; statusy: Array<{ status: StatusDoboru; ile: number }> };
  progWiarygodnosci: number;
  /** Art. 22² Kodeksu pracy — jedzie w ładunku, żeby karta nie mogła go zgubić. */
  podstawaPrawna: string;
};

export type PokrycieWiedzy = {
  kartotek: number; zOpisem: number; zIdentyfikatorem: number;
  identyfikatorow: number; identyfikatorowRecznych: number;
  /** Numery odzyskane z opisów NASZYCH ofert Allegro (0.264.0). */
  identyfikatorowZOfert: number;
  modeleZOpisu: { nowych: number; przerobionych: number; odrzuconych: number };
  zastosowania: { zatwierdzonych: number; negatywnych: number; propozycji: number };
  /** Tokeny silników w nazwach kartotek (0.239.0): ile słów, ile kartotek czeka, ile zatwierdzono. */
  tokeny: { tokenow: number; nowych: number; zatwierdzonych: number };
  /** Wymiary z nazw i opisów kartotek — paliwo szczebla „zgodne wymiary". */
  wymiary: { kartotek: number; wymiarow: number };
  fts: { dostepne: boolean; wpisow: number };
};

/* ── Tokeny silników w nazwach kartotek (0.239.0) ────────────────────────────
   Token to słowo wpisane ręką biura („GX160") z modelem silnika; serwer
   dopasowuje je do NAZW kartotek po `zwin`. Kartoteka z tokenem ma cykl jak
   sekcja „Modele:": `nowa` czeka na decyzję, `zatwierdzona` ma zastosowanie,
   `pominieta` nie wraca po imporcie. */
export type KartotekaTokenu = {
  twId: number; symbol: string; nazwa: string | null;
  stan: "nowa" | "zatwierdzona" | "pominieta"; zastosowanieId: number | null;
};

export type TokenSilnika = {
  id: number; token: string; silnik: ModelUrzadzenia; dodal: string; dodanoAt: string;
  nowych: number; zatwierdzonych: number; pominietych: number;
  /** Kartoteki do decyzji — najwyżej 200, jak lista „Z opisów". */
  nowe: KartotekaTokenu[];
};

export type NowaPropozycja = {
  twId: number;
  model: { rodzaj: "maszyna" | "silnik"; marka: string; nazwa: string; wariant?: string | null; lata?: string | null };
  polaryzacja: "pasuje" | "nie_pasuje";
  powodNegatywny?: PowodNegatywny | null;
  komentarz?: string | null;
  dowod: { rodzaj: RodzajDowodu; tresc: string; link?: string | null };
  zastepujeId?: number | null;
  warunki?: WarunkiDoZapisu | null;
};

/* Rok jedzie tak, jak go wpisano, gdy nie jest liczbą — serwer odpowiada
   zdaniem „rok z czterech cyfr", zamiast przyjąć wpis bez granicy. */
export type WarunkiDoZapisu = { [K in keyof WarunkiZastosowania]: string | number | null };

export type PomiarRozmowy = {
  zadanieId: number; tytul: string; wynik: string; wykonanoAt: string; wykonanoPrzez: string;
  twId: number | null; symbol: string | null; zaproponowano: boolean;
};

export type WiedzaDoboru = {
  zastosowanie: Zastosowanie | null;
  /** Drugie ogniwo, gdy podparcie idzie przez silnik — inaczej `null`. */
  zabudowa: Zabudowa | null;
  /** Pasowanie do części, którą agent wskazał (symbol/numer w danych doboru) — inaczej `null`. */
  pasowanie: TrafieniePasowania | null;
  /** ZATWIERDZONE silniki wpisanej maszyny: czipy pod polem i wybór przy zatwierdzeniu. */
  silniki: Zabudowa[];
  /**
   * Tekst z pola „Silnik" rozpoznany SŁOWNIKIEM (0.238.0) i żywa para z wpisaną
   * maszyną (`propozycja` albo `zatwierdzone`); `zabudowa: null` = można
   * zaproponować. `null` = tekstu nie ma w słowniku albo pole jest puste.
   */
  silnikZPola: { alias: AliasSilnika; zabudowa: Zabudowa | null } | null;
  pomiary: PomiarRozmowy[];
};

/** Słownik silników: co znaczy tekst z pola „Silnik". Zapis ręki biura, bez cyklu życia. */
export type AliasSilnika = {
  id: number; tekst: string; silnik: ModelUrzadzenia; dodal: string; dodanoAt: string;
};

/* ── Zabudowa silnika (§11.2) ─────────────────────────────────────────────── */

export type Zabudowa = {
  id: number; maszyna: ModelUrzadzenia; silnik: ModelUrzadzenia;
  stan: StanZastosowania; zrodlo: "reczne" | "dobor" | "copilot";
  rodzajDowodu: RodzajDowodu; nazwaRodzajuDowodu: string;
  dowodTresc: string; dowodLink: string | null; komentarz: string | null;
  conversationId: number | null; zastepujeId: number | null;
  zaproponowal: string; zaproponowanoAt: string;
  rozstrzygnal: string | null; rozstrzygnietoAt: string | null; powodRozstrzygniecia: string | null;
  pewnosc: "potwierdzone" | "prawdopodobne";
  /** Zdanie źródła z serwera — drugie ogniwo łańcucha. Panel go nie układa. */
  zdanieZrodla: string;
};

/** Maszyna z doborów i to, czego o jej silniku jeszcze nie wiemy. */
export type LukaSilnika = {
  marka: string; model: string; wariant: string | null; klucz: string;
  /** Ile doborów wskazało tę maszynę — po tym idzie kolejność. */
  pytan: number;
  /**
   * SUROWY tekst z pola „Silnik" z licznikiem, scalony po zwinięciu. Automat go
   * NIE rozbija — `silnik` to wyłącznie wpis biura ze słownika, `null` bez aliasu.
   */
  wpisaneSilniki: Array<{ tekst: string; ile: number; silnik: ModelUrzadzenia | null }>;
  zabudowy: Zabudowa[];
};

export type NowaZabudowa = {
  maszyna: { rodzaj: "maszyna"; marka: string; nazwa: string; wariant?: string | null; lata?: string | null };
  silnik: { rodzaj: "silnik"; marka: string; nazwa: string; wariant?: string | null; lata?: string | null };
  rodzajDowodu: RodzajDowodu; dowodTresc: string; dowodLink?: string | null;
  /** Para spod pola „Silnik" w rozmowie — serwer nadaje wtedy źródło `dobor`. */
  conversationId?: number | null;
};

/* ── Historia klienta (§10.1, zakładka KLIENT) ───────────────────────────────
   Kształt jest ODCZYTEM po loginie kupującego — panel nie ma tu czego zapisać.
   `login: null` znaczy „wątek bez rozmówcy", a nie „klient bez historii":
   ekran mówi wtedy, że nie wie, zamiast pokazywać pustą oś. */
export type MaszynaKlienta = {
  marka: string; nazwa: string; wariant: string | null;
  rocznik: string | null; silnik: string | null;
  /** Rozmowa, w której maszynę ustalono — makieta: „ustalone w rozmowie #N". */
  rozmowaId: number; at: string;
};

export type WpisHistorii = {
  /* Trzy rodzaje doszły w S2 spoiwa (`docs/obsluga-klienta-calosc.md`).
     Zakładka obiecywała historię klienta, a znała wyłącznie zakupy i rozmowy:
     zwrot, reklamacja i dyskusja tego samego kupującego nie docierały tu
     wcale, więc agent czytał „nic się nie działo" o kliencie, który miesiąc
     wcześniej odesłał towar. */
  rodzaj: "zakup" | "rozmowa" | "zwrot" | "reklamacja" | "dyskusja";
  at: string; tresc: string;
  zamowienieId: string | null; link: string | null; rozmowaId: number | null;
  /** Identyfikator sprawy albo zwrotu u nas; `null` przy zakupie i rozmowie. */
  sprawaId: number | null;
};

export type HistoriaKlienta = {
  login: string | null; maszyny: MaszynaKlienta[]; wpisy: WpisHistorii[];
};

export type Zadanie = {
  id: number; rodzaj: string; tytul: string; instrukcja: string;
  /* Skąd zadanie się wzięło (0.408.0) — pytanie klienta, numer oferty, podpis
     o wskazanej kartotece. WYŁĄCZNIE dla biura: kolektor dostaje towar
     i polecenie. `null` przy zadaniach zakładanych ręcznie i sprzed 0.408.0. */
  kontekst: string | null;
  twId: number | null; symbol: string | null; nazwaTowaru: string | null;
  lokalizacja: string | null; priorytet: "normalny" | "pilny";
  /* `odeslane` (0.352.0): hala odpowiedziała, ale bez wyniku. Ruch wraca do
     biura, a nie do magazynu — dlatego to osobny status, nie `anulowane`
     (anuluje zlecający) ani `wykonane` (to byłby pomiar, którego nie ma). */
  status: "nowe" | "w_toku" | "wykonane" | "anulowane" | "odeslane";
  utworzonoAt: string; utworzonoPrzez: string; przypisanoPrzez: string | null;
  wynik: string | null; wykonanoPrzez: string | null;
  odeslanoAt: string | null; odeslanoPrzez: string | null;
  powodKod: "brak_towaru" | "nie_da_sie" | null; powod: string | null;
  /* Liczy SERWER, nie ekran — patrz `zleconeOdMs` w `zadania-terenowe.ts`.
     `null` przy zadaniu zamkniętym. */
  zleconeOdMs: number | null;
  /* Zdjęcia od hali (§13.3) — sama lista, treść ciągnie `useZdjecieZadania`. */
  zalaczniki: ZalacznikZadania[];
}

export type ZalacznikZadania = {
  id: number; opis: string | null; at: string; przez: string;
};

export type StatusSynchronizacji =
  | "current" | "delayed" | "rate_limited" | "authentication_error" | "failed";

export type Zdrowie = {
  /** Stan POŁĄCZENIA (tokena), osobny od stanu synchronizacji. */
  allegro?: { stan?: string };
  /** Zdania „co zrobić" z trasy zdrowia — pusta lista nie przyjeżdża wcale. */
  problemy?: string[];
  allegroInbox: {
    status: StatusSynchronizacji;
    alarm: boolean;
    ostatniaProba: string | null;
    ostatniaUdanaSynchronizacja: string | null;
    kodOstatniegoBledu: number | null;
    /* Powód SŁOWEM. Kod HTTP odpowiada tylko na część porażek — brak
       parowania, timeout i odmowa wersji zasobu kodu nie mają. */
    tekstOstatniegoBledu: string | null;
    liczbaBledow: number;
    watkiZBledem: number;
    opoznienieMs: number | null;
    nastepnaProba: string | null;
    interwalMs: number;
  };
  obsluga: {
    rozmowyOczekujace: number;
    zadaniaTerenowe: number;
    najstarszeZadanieMs: number | null;
    kolejkaWysylek: string;
    /** Wysyłki czekające na człowieka: nieudane, niepewne i te w toku. */
    wysylkiDoSprawdzenia: number;
  };
  worker?: { zyje: boolean; mode: string; widziany: string | null };
  /* Pola karty SERWER w stanie systemu (0.441.0). Trasa oddawała je
     zawsze; panel ich nie czytał, bo karta mieszkała w `biuro.html`. */
  wersja?: string;
  mode?: string;
  srodowisko?: string;
  configZPliku?: string | null;
  ok?: boolean;
  audyt?: { zdarzen?: number; najstarsze?: string | null; bazaBajtow?: number } | null;
  /* Obecność tych dwóch pól mówi, czy w tej instalacji w ogóle SĄ zdjęcia
     kartotek: z Subiekta (`zdjecia`) albo z kolektora (`zdjeciaWlasne`).
     Treść liczników panel ignoruje — liczy się, że trasa je przysłała. */
  zdjecia?: unknown;
  zdjeciaWlasne?: unknown;
};

/** Konflikt przejęcia — kształt szczegółów, które serwer zwraca przy 409. */
export type SzczegolyKonfliktu = {
  assignedUserId?: number | null;
  assignedUserName?: string | null;
  assignedAt?: string | null;
  version?: number;
};

export type StatusWysylki = "sending" | "sent" | "send_uncertain" | "send_failed";

export type WynikWysylki = {
  outboxId: number;
  status: StatusWysylki;
  kluczIdempotencji: string;
  externalMessageId: string | null;
};

/** Szczegóły 409 przy kontroli świeżości — z nich rysuje się dialog konfliktu. */
export type SzczegolyWysylki = {
  lastMessageId?: number | null;
  /* `rola` jedzie tylko przy reklamacji (0.224.0): rozmowa bywa trójstronna,
     więc dopisek bywa doradcy Allegro, a nie kupującego. Skrzynka jej nie
     podaje i nie potrzebuje — tam autor dopisku jest zawsze klientem. */
  nowaWiadomosc?: { id: number; tresc: string; at: string | null; rola?: string | null } | null;
  kluczIdempotencji?: string;
  /* Drugi rodzaj konfliktu wysyłki (0.159.0): przy rozmowie siedzi kto inny.
     Osobne pole, bo i pytanie do agenta jest inne — tam „klient dopisał",
     tu „kolega już przy tym siedzi". */
  trzymajacyName?: string;
  trzymajacyUserId?: number;
};

/* ── Zwroty klienckie (0.150.0) ──────────────────────────────────────────────
   Kształt lustrzany do `WierszZwrotu` w `server/src/services/zwroty.ts`.
   Kubełek i sygnały LICZY SERWER — panel ich nie wyprowadza po raz drugi,
   bo dwie kopie tej reguły rozjechałyby się przy pierwszej poprawce jednej
   z nich, a rozjazd byłby niewidoczny: ekran po prostu pokazywałby inną
   kolejkę niż liczniki.                                                     */

export type Kubelek = "decyzja" | "ocena" | "zwrot" | "korekta" | "zamkniety" | "odrzucony";

/**
 * Ocena towaru ze zwrotu (0.375.0).
 *
 * Trzy wartości, dwa zachowania. `stan` i `utylizacja` mają swój koszyk
 * i swój dokument MM; `outlet` nie ma żadnego, bo magazyn outletowy obsługuje
 * dziś ręka — a to znaczy listę roboczą zamiast papieru.
 */
export type Ocena = "stan" | "utylizacja" | "outlet";

/** Pozycja czekająca na przeniesienie na regał outletowy (0.375.0). */
export interface PozycjaNaOutlet {
  pozycjaId: number;
  zwrotId: number;
  numer: string;
  nazwa: string;
  twId: number | null;
  symbol: string | null;
  ilosc: number;
  /** Ile wartości sztuka straciła — tyle mniej dostał klient za nią. */
  potracenieGrosze: number | null;
  ocenionoAt: string | null;
}
export type Sygnal = "termin" | "brak_dowodu" | "odrzucony_w_allegro"
  | "pieniadze_niepotwierdzone" | "pieniadze_poza_panelem" | "kwota_nieaktualna"
  | "rozjazd_ilosci" | "przelew_czeka";

/** Wynik dopasowania — §11.3 żąda widocznego źródła i pewności. */
export interface Dopasowanie {
  pewnosc: "brak" | "sku" | "pamiec" | "jedyna_pozycja" | "nazwa_w_zamowieniu" | "niejednoznaczne";
  twId: number | null;
  symbol: string | null;
  zrodlo: string;
  /** Które ogniwo pękło; `null` przy trafieniu. */
  powod:
    | "brak_zamowienia_w_zwrocie" | "zamowienie_niepobrane" | "oferty_nie_ma_w_zamowieniu"
    | "oferta_bez_sku" | "sku_nie_trafia" | "symbol_zdublowany" | null;
  poKolumnie: "offer_id" | "external_id" | null;
}

/* Rabat transakcyjny przy pozycji zwrotu (0.164.0). Stan LICZY SERWER —
   panel go nie wyprowadza, bo wiąże wniosek z pozycją zamówienia, a to
   złączenie ma jedno miejsce. */
export type StanRabatu = {
  stan: "brak" | "zlozony" | "przyznany" | "odrzucony" | "nie_wiadomo";
  lineItemId: string | null;
  ilosc: number;
  wniosekId: string | null;
  prowizjaGrosze: number | null;
  waluta: string | null;
  typ: string | null;
  /** Dlaczego nie da się złożyć wniosku. Zdanie pisze serwer. */
  powod: string | null;
  /** Skąd wiadomo o wniosku: nasze lustro wniosków czy status samego zwrotu. */
  zrodlo: "lustro" | "zwrot" | null;
};

export interface PozycjaZwrotu {
  /**
   * Ile sztuk NAPRAWDĘ wróciło. `null` = nikt jeszcze nie liczył (0.212.0).
   *
   * `ilosc` obok niesie DEKLARACJĘ klienta i nadpisuje ją synchronizator.
   */
  iloscZwrocona: number | null;
  id: number;
  /** `allegro` = ze zgłoszenia klienta, `biuro` = dopisana u nas (0.184.0). */
  zrodlo: string;
  offerId: string | null;
  /**
   * Numer oferty wzięty z POZYCJI ZAMÓWIENIA (0.213.0) — tym wolno pytać
   * o zdjęcie listingowe. `offerId` wyżej należy do przestrzeni, której nie
   * znamy, więc do niczego poza wyświetleniem się nie nadaje.
   */
  ofertaZamowienia: string | null;
  /** Co wiadomo o zdjęciu tej oferty (0.214.0) — liczy SERWER. */
  ofertaZdjecie: StanZdjeciaOferty;
  nazwa: string;
  ilosc: number;
  cenaGrosze: number;
  waluta: string;
  powod: string | null;
  powodKomentarz: string | null;
  /** Czy pozycja leży już w koszyku zwrotów, czyli na dokumencie MM. */
  wKoszyku: boolean;
  ocena: string | null;
  url: string | null;
  twId: number | null;
  twSymbol: string | null;
  twZrodlo: string | null;
  sku: string | null;
  ean: string | null;
  /** Ile MNIEJ oddajemy za tę pozycję i dlaczego (0.170.0). */
  potracenieGrosze: number | null;
  potraceniePowod: string | null;
  propozycja: Dopasowanie | null;
  rabat: StanRabatu;
}

export interface PozycjaZamowienia {
  offerId: string | null;
  nazwa: string;
  sku: string | null;
  /** Ile sztuk KUPIONO. */
  ilosc: number;
  cenaGrosze: number;
  waluta: string;
  zwracana: boolean;
  /** Ile sztuk WRACA — mniej niż `ilosc`, gdy klient oddaje część zakupu. */
  wracaIlosc: number;
  /** Kartoteka Subiekta za pozycją (0.215.0): z pamięci wskazań albo po SKU. `null` = brak. */
  twId: number | null;
  twSymbol: string | null;
  /** Zdanie źródła pisze serwer (§4.3). */
  twZrodlo: string | null;
  /** Co wiadomo o zdjęciu OFERTY tej pozycji (0.217.0) — liczy serwer. */
  ofertaZdjecie: StanZdjeciaOferty;
}

export interface Zamowienie {
  externalId: string;
  status: string | null;
  kupujacyLogin: string | null;
  dostawaGrosze: number | null;
  dostawaMetoda: string | null;
  /** `ONLINE`, `CASH_ON_DELIVERY`… — surowo, bo Allegro nie zamyka listy. */
  platnoscTyp: string | null;
  platnoscAt: string | null;
  /** `null` znaczy „nie wiadomo", nie „paragon". */
  fakturaZadana: boolean | null;
  sumaGrosze: number | null;
  waluta: string;
  kupionoAt: string | null;
  link: string | null;
  pozycje: PozycjaZamowienia[];
}

export interface Zwrot {
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
   * Numer listu przewozowego paczki zwrotnej (0.344.0).
   *
   * Do 0.343.0 panel go nie znał: polityka 0.163.0 trzymała numer wyłącznie
   * w kopii odpowiedzi Allegro, więc szukanie po nim wymagało Entera i pytania
   * serwera. Decyzja właściciela zdjęła tę politykę.
   */
  waybill: string | null;
  kubelek: Kubelek;
  sygnaly: Sygnal[];
  /**
   * Termin OBSŁUGI: siedem dni od paczki u nas (0.341.0).
   *
   * `null` znaczy, że paczka jeszcze nie wróciła, więc zegar nie ruszył —
   * a nie że termin minął. Do 0.338.0 było to czternaście dni od zgłoszenia
   * klienta i pole nigdy nie bywało puste.
   */
  terminAt: string | null;
  dniDoTerminu: number | null;
  /** Ostatni status zwrotu po stronie Allegro; `FINISHED` = pieniądze oddane. */
  statusAllegro: string | null;
  /**
   * Kiedy Allegro PIERWSZY RAZ powiedziało, że pieniądze wróciły (0.345.0).
   *
   * `statusAllegro` mówi, co jest TERAZ: rozliczony zwrot idzie dalej osią
   * czasu Allegro, choćby na `COMMISSION_REFUND_CLAIMED` — a ten dotyczy
   * NASZEJ prowizji, nie pieniędzy klienta. Ten zatrzask trzyma fakt.
   */
  rozliczonyAllegroAt: string | null;
  sumaPozycjiGrosze: number;
  kwotaPelnaGrosze: number | null;
  waluta: string;
  linkZwrotu: string | null;
  zamowienie: Zamowienie | null;
  werdykt: string | null;
  /** Powód odmowy wpisany przez biuro (0.210.0). */
  werdyktPowod: string | null;
  kwotaGrosze: number | null;
  kwotaWariant: string | null;
  korektaNumer: string | null;
  /**
   * `subiekt` = numer znaleziony w Subiekcie, `reczne` = przepisany ręką,
   * `sfera` = ZW wystawił automat po zapisaniu kwoty (0.349.0).
   */
  korektaZrodlo: string | null;
  /**
   * Zadanie automatycznego ZW (0.349.0); `null`, gdy automat go nie zlecił.
   * Opcjonalne, bo panel ma działać także z serwerem sprzed tego wydania.
   */
  zw?: ZadanieZw | null;
  rejectionCode: string | null;
  /** `allegro` albo `nieodebrana` — paczka, której klient nie odebrał. */
  zrodlo: string;
  /* PROWADZĄCEGO I TAGÓW ZWROT JUŻ NIE NIESIE (0.370.0). Serwer ich nie
     wysyła, więc typ nie ma prawa ich obiecywać — pole zadeklarowane, a nigdy
     nieprzychodzące, jest `undefined` udającym `null`. Reklamacja i dyskusja
     mają jedno i drugie dalej. */
  /** Notatka biura — od 0.313.0 przy KAŻDYM zwrocie, nie tylko przy paczce. */
  notatka: string | null;
  notatkaAt: string | null;
  notatkaPrzez: string | null;
  /** Czy cofnięcie zmiany ma dokąd wrócić (§25a.5). */
  maPoprzedniaNotatke: boolean;
  kupujacyLogin: string | null;
  /**
   * Nazwa odbiorcy Z NAKLEJKI (0.367.0).
   *
   * Paczki nakleja klient albo kurier, więc numeru listu z wracającego
   * kartonu nasz system nie widział nigdy — pierwszy skan takiej paczki
   * chybia z definicji. Zostaje to, co na naklejce widać.
   *
   * W eksporcie CSV jej NIE MA, tak samo jak numeru listu.
   */
  odbiorcaNazwa: string | null;
  przewoznik: string | null;
  rozmowy: RozmowaZwrotu[];
  /** Dokument sprzedaży z Subiekta — snapshot numeru, nie odczyt na żywo. */
  faktura: FakturaZwrotu;
  wersja: number;
  pozycje: PozycjaZwrotu[];
}

/**
 * Automatyczny ZW w kolejce Sfery (0.349.0).
 *
 * `status` to status wiersza kolejki: `pending`, `processing` i
 * `waiting_for_doc` znaczą „numer przyjdzie sam", `error` — „wystaw ręką".
 * `pending` z `blad` to paragon otwarty w biurze; zadanie ponowi się samo.
 */
export interface ZadanieZw {
  status: string;
  numer: string | null;
  blad: string | null;
}

/**
 * Dokument sprzedaży przy zwrocie (0.174.0).
 *
 * `zrodlo` mówi, KTO go wskazał: `numer` to automat po numerze zamówienia na
 * dokumencie, `reczne` to wybór człowieka. Ekran musi je rozróżniać — wybór
 * człowieka nie ma udawać faktu z danych.
 */
export interface FakturaZwrotu {
  dokId: number | null;
  numer: string | null;
  typ: string | null;
  zrodlo: "numer" | "reczne" | null;
  at: string | null;
  przez: string | null;
}

/** Dokument, którym MOŻE być ta sprzedaż — z jawnym uzasadnieniem. */
/** Pozycja zamówienia, której NIE MA jeszcze w zwrocie (0.184.0). */
/**
 * Co naprawdę wejdzie do koszyka za jedną pozycję zwrotu (0.328.0).
 *
 * Komplet sprzedany jedną ofertą leży na magazynie osobno, a rozbicie ma
 * wyłącznie paragon. `skladniki` puste znaczy: NIE WEJDZIE, a `powod` mówi
 * dlaczego — zdanie pisze serwer, panel go nie układa.
 */
/** Wiersz paragonu — materiał, z którego biuro składa komplet (0.336.0). */
export interface WierszDokumentu {
  twId: number;
  symbol: string;
  nazwa: string;
  /** Sztuki na CAŁYM dokumencie, czyli na całe zamówienie. */
  naDokumencie: number;
}

export interface SkladPozycji {
  /**
   * `wKoszyku` mówi, czy ten składnik NAPRAWDĘ leży dziś w koszyku (0.335.0).
   * To stan wiersza `kosz_pozycja`, a nie zamiar: ptaszek rysowany z samego
   * składu obiecywałby dokument, którego zawartość wygląda inaczej.
   */
  skladniki: Array<{
    twId: number; symbol: string; nazwa: string; ilosc: number; wKoszyku: boolean;
  }>;
  zrodlo: "oferta" | "paragon" | "biuro" | null;
  powod: string | null;
}

export interface DoDopisania {
  zamPozycjaId: number;
  offerId: string | null;
  /** Co wiadomo o zdjęciu tej oferty (0.217.0). */
  ofertaZdjecie: StanZdjeciaOferty;
  nazwa: string;
  ilosc: number;
  cenaGrosze: number;
  waluta: string;
}

export interface KandydatFaktury {
  dokId: number;
  numer: string;
  typ: string;
  data: string;
  powody: string[];
  /** Numer zamówienia stoi na dokumencie. Tylko to wiąże automatycznie. */
  pewny: boolean;
}

/** Rozmowa o tym samym zakupie — mostkiem jest numer zamówienia. */
export interface RozmowaZwrotu {
  id: number;
  temat: string | null;
  status: string;
  ostatniaAt: string | null;
}

export interface WpisOsiZwrotu {
  id: number;
  rodzaj: string;
  tresc: string | null;
  /** ISO. Nazwa PO NASZEMU, nie kolumną bazy — od 0.313.0, gdy oś dostała ekran. */
  kiedy: string;
  kto: string | null;
  /** Rozpakowane przez serwer; `null` przy wierszu bez danych albo zepsutym. */
  dane: Record<string, unknown> | null;
}

/** Kształt z `stanZwrotowHealth` — lustrzany do bloku skrzynki w §21. */
export interface StanZwrotow {
  status: "current" | "delayed" | "rate_limited" | "authentication_error" | "failed";
  alarm: boolean;
  ostatniaProba: string | null;
  ostatniaUdanaSynchronizacja: string | null;
  kodOstatniegoBledu: number | null;
  liczbaBledow: number;
  opoznienieMs: number | null;
  nastepnaProba: string | null;
  interwalMs: number;
  /**
   * Ile zwrotów Allegro miało jeszcze do oddania po ostatnim przebiegu.
   *
   * `null` znaczy „nie wiem", zero — „lista skończyła się sama". Liczba większa
   * od zera znaczy, że kolejka NIE JEST kompletna, choć synchronizacja
   * skończyła się sukcesem.
   */
  pozostaloDoPobrania: number | null;
}

/** Ile pozycji czeka na kartotekę i dlaczego — licznik do nagłówka ekranu. */
export interface BilansKartotek {
  bez: number;
  wszystkie: number;
  powody: Record<string, number>;
}

export interface KolejkaZwrotow {
  zwroty: Zwrot[];
  liczniki: Record<Kubelek, number>;
  kartoteki: BilansKartotek;
  stan: StanZwrotow;
}

/* ── Tagi spraw posprzedażowych (0.279.0) ──────────────────────────────────
   Tag na wierszu niesie TYLE, ile mieści czip: numer do zdjęcia i nazwę do
   przeczytania. Stan „aktywny" należy do słownika w Ustawieniach, nie do
   wiersza — na starej sprawie wyłączony tag ma być widoczny tak samo. */
export interface TagSprawy {
  id: number;
  nazwa: string;
}

/** Wiersz słownika tagów — to, czym zarządza ekran ustawień. */
export interface Tag extends TagSprawy {
  /** Wyłączony nie podpowiada się przy nowej sprawie, ale na starych zostaje. */
  aktywny: boolean;
}

/** Sygnatura, która nie prowadzi do jednej kartoteki (§ pokrycie sygnatur). */
export interface WierszSygnatury {
  sygnatura: string;
  nazwa: string;
  pozycji: number;
  /** 0 = nie ma takiego symbolu w Subiekcie, >1 = symbol zdublowany. */
  kartotek: number;
}

/** Ile sygnatur z Allegro trafia w kartotekę Subiekta — `GET /api/obsluga/sygnatury`. */
export interface PokrycieSygnatur {
  pozycji: number;
  bezSygnatury: number;
  trafia: number;
  sygnatur: number;
  pudla: WierszSygnatury[];
  zdublowane: WierszSygnatury[];
}

/**
 * Stan zapisu do Allegro przy zwrocie (0.190.0).
 *
 * Liczy go SERWER i to jest celowe: przeszkody (brak identyfikatora
 * płatności, pobranie, brak kwoty) są regułą serwera, a panel powtarzający ją
 * u siebie rozjechałby się z nią przy pierwszej zmianie. Rozjazd znaczyłby
 * przycisk obiecujący pracę, której serwer nie przyjmie — dokładnie ta blizna,
 * którą przy rabacie zgłosił właściciel w 0.175.0.
 */
export type StanZwrotuPieniedzy = {
  moznaZwrocic: boolean;
  moznaOdmowic: boolean;
  /** Dlaczego nie da się oddać pieniędzy. Zdanie pisze serwer. */
  powod: string | null;
  kwotaGrosze: number | null;
  waluta: string;
  oddane: {
    id: string | null; status: string | null; kiedy: string | null;
    /** Czy ALLEGRO potwierdziło wyjście pieniędzy — nie mylić ze `status`. */
    potwierdzone: boolean;
  } | null;
  odmowa: { kod: string; powod: string | null; kiedy: string | null } | null;
  /**
   * Ślad po przelewie oddanym POZA Allegro (0.269.0). Przy pobraniu jedyny,
   * jaki może istnieć — to notatka biura o ruchu pieniędzy, nie sam ruch.
   */
  przelew: { kiedy: string; przez: string | null; referencja: string | null } | null;
  moznaZapisacPrzelew: boolean;
  powodPrzelewu: string | null;
};

/**
 * Otwarty koszyk zwrotów operatora.
 *
 * Odpowiednik pustej MM, którą biuro zakłada w Subiekcie, zasiadając do
 * zwrotów: dokłada się do niej pozycja po pozycji, a domknięcie wystawia
 * dokument na regał zwrotów.
 */
export interface KoszZwrotow {
  /** `zwroty` na regał zwrotów, `odpad` na magazyn odpadu (0.211.0). */
  rodzaj: "zwroty" | "odpad";
  id: number;
  /** Kod z przedrostkiem `Z-`; numery bez niego należą do koszy z Subiekta. */
  kod: string;
  pozycji: number;
  sztuk: number;
  otwartyOd: string;
  pozycje: Array<{
    /** Id wiersza — po nim zdejmuje się to, co dołożono ręką (0.365.0). */
    id: number;
    symbol: string;
    nazwa: string;
    ilosc: number;
    /** Wiersz przyszedł z oceny zwrotu; tamten schodzi cofnięciem oceny. */
    zeZwrotu: boolean;
  }>;
}

/* ── Reklamacje klienckie (0.222.0) ──────────────────────────────────────────
   Panel prowadzi wyłącznie reklamacje (`type: "CLAIM"` z `/sale/issues`).
   Dyskusje odsiewa synchronizator, więc tu ich nie ma. */

export type KubelekReklamacji = "decyzja" | "odpowiedz" | "zamknieta" | "bez_ruchu";

/**
 * Co próg daty schował przed kolejką.
 *
 * Jedzie przy OBU kolejkach — reklamacji i dyskusji — bo obie karmi ta sama
 * tabela i ten sam próg. `zdjety` mówi, czy patrzymy właśnie na komplet:
 * przełącznik musi umieć narysować się w obie strony.
 */
export interface ProgKolejki {
  /** Próg w ISO albo `null`, gdy go nie ma. Zdanie na pasku pisze panel. */
  od: string | null;
  ukrytych: number;
  /**
   * Ile UKRYTYCH spraw ma jeszcze żywy obowiązek — nierozstrzygniętych
   * i z terminem decyzji w przyszłości. Zwykle zero; gdy nie zero, pasek
   * mówi to głośno, bo wtedy próg chowa pracę, a nie archiwum.
   */
  ukrytychZTerminem: number;
  zdjety: boolean;
}

export type SygnalReklamacji =
  | "termin"
  | "klient_czeka"
  | "doradca"
  | "czat_zamkniety"
  | "zwrot_wymagany"
  | "status_nieznany"
  /* Los NASZEGO werdyktu (przyrost trzeci) — `statusAllegro` mówi o nim
     dopiero po synchronizacji. */
  | "werdykt_niepotwierdzony"
  | "werdykt_nieudany"
  | "towar_do_decyzji";

/** `ClaimStatusChangeRequest.status` — jedenaście wartości ze schematu Allegro. */
export type Werdykt =
  | "ACCEPTED_REPAIR" | "ACCEPTED_REFUND" | "ACCEPTED_EXCHANGE" | "ACCEPTED_PARTIAL_REFUND"
  | "REJECTED_ADDITIONAL_REQUIREMENTS_NOT_COMPLETED" | "REJECTED_PRODUCT_NOT_RETURNED"
  | "REJECTED_PRODUCT_DAMAGED_BY_USER" | "REJECTED_PRODUCT_CONFORMS_TO_CONTRACT"
  | "REJECTED_MINOR_DEFECT" | "REJECTED_OTHER" | "REJECTED_CLAIM_WITHDRAWN_BY_BUYER";

/** Los próby werdyktu — te same cztery stany, co przy wysyłce odpowiedzi. */
export type StatusWerdyktu = "sending" | "sent" | "send_uncertain" | "send_failed";

export interface Reklamacja {
  id: number;
  externalId: string;
  /** Czytelny numer, np. „123/2026". Po nim szuka człowiek. */
  numer: string | null;
  orderId: string | null;
  offerId: string | null;
  kupujacyLogin: string | null;
  /** WARRANTY (gwarancja) albo COMPLAINT (rękojmia). */
  prawo: string | null;
  powodTyp: string | null;
  powodOpis: string | null;
  temat: string | null;
  opis: string | null;
  /** Czego klient chce: REPAIR, EXCHANGE, REFUND albo PARTIAL_REFUND. */
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
  /** Czy rozmowę urwał NASZ bezpiecznik stron (0.273.0), a nie takt. */
  czatUrwany: boolean;
  ostatniaWiadomoscStatus: string | null;
  ostatniaWiadomoscAt: string | null;
  otwartoAt: string;
  /* ── Kiedy to kupiono (0.282.0) ──────────────────────────────────────────
     Dwa zegary i dwie etykiety: `zamowienie` to `boughtAt` z pełnego
     zamówienia, `sprawa` to `checkoutForm.createdAt` z ładunku reklamacji,
     czyli złożenie koszyka. Nazwanie jednego drugim to blizna 0.121.0.

     Dyskusja tego pola NIE MA i to nie jest przeoczenie: nie ma też Copilota,
     a bez niego data byłaby ozdobą na ekranie, którego nikt o nią nie prosił. */
  kupionoAt: string | null;
  kupionoZrodlo: "zamowienie" | "sprawa" | null;
  /* ── Wiek zakupu (0.413.0) ───────────────────────────────────────────────
     Liczy SERWER, z tej samej daty, którą nazywa `kupionoZrodlo`. Odjęcie
     w panelu brałoby zegar przeglądarki, a ten bywa przestawiony — a przy
     rękojmi (dwa lata od wydania rzeczy) liczba dni jest argumentem, nie
     ozdobą. `null` = nie mamy daty zakupu, nie „kupione dziś". */
  dniOdZakupu: number | null;
  prowadzi: string | null;
  /** Tożsamość prowadzącego — po NIEJ liczy się sito „Moje" (0.278.0). */
  prowadziId: number | null;
  prowadziAt: string | null;
  /** Tagi biura (0.279.0). Zawężają listę, NIGDY nie przestawiają kolejki. */
  tagi: TagSprawy[];
  /* ── Droga powrotna z notatki (0.280.0) ──────────────────────────────────
     Poprzedniej TREŚCI panel nie dostaje i nie potrzebuje: cofnięcie jest
     zamianą, więc drugie kliknięcie przywraca stan sprzed pierwszego. */
  notatkaAt: string | null;
  notatkaPrzez: string | null;
  maPoprzedniaNotatke: boolean;
  notatka: string | null;
  /* ── Werdykt z panelu (przyrost trzeci) — NASZ, nie `statusAllegro` ───────
     `werdykt: null` przy `CLAIM_ACCEPTED` znaczy „rozstrzygnięte poza
     panelem" i ekran to mówi, zamiast udawać, że to nasza decyzja. */
  werdykt: Werdykt | string | null;
  /** Zdanie pisze serwer; panel ma własną mapę tylko do listy wyboru. */
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
  kubelek: KubelekReklamacji;
  sygnaly: SygnalReklamacji[];
  /** `null` znaczy „nie ma czego linkować" — ekran pokazuje wtedy sam tekst. */
  link: string | null;
  linkZamowienia: string | null;
  linkOferty: string | null;
  /* Co widać na wierszu (0.223.0). Reklamacja dotyczy jednej oferty, więc
     obraz jest tożsamością sprawy, a nie ozdobą. */
  ofertaNazwa: string | null;
  ofertaZdjecie: StanZdjeciaOferty;
  /** Kartoteka POTWIERDZONA; propozycję liczy dopiero szczegół sprawy. */
  twId: number | null;
  twSymbol: string | null;
  /** Czy sygnatura przyszła Z PARAGONU (0.400.0), a nie z dzisiejszej półki. */
  twZParagonu: boolean;
}

export interface ZalacznikReklamacji {
  id: number;
  wiadomoscId: number | null;
  nazwa: string;
  /**
   * Czy warto próbować pokazać go na osi — PODPOWIEDŹ z nazwy pliku.
   *
   * Allegro nie podaje przy tym zasobie ani typu MIME, ani stanu `SAFE`, więc
   * rozstrzygają dopiero BAJTY po stronie serwera. Ta flaga decyduje o
   * układzie, nie o wydaniu: kafel, którego trasa nie obsłuży, spada
   * z powrotem na przycisk pobrania.
   */
  podglad: boolean;
}

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

export interface StanReklamacji extends StanZwrotow {
  /** Ile spraw z ostatniego przebiegu było dyskusjami. Nie jest to błąd. */
  dyskusjiPominietych: number | null;
}

export interface KolejkaReklamacji {
  reklamacje: Reklamacja[];
  liczniki: Record<KubelekReklamacji, number>;
  prog: ProgKolejki;
  stan: StanReklamacji;
}

export interface SzczegolReklamacji {
  reklamacja: Reklamacja;
  czat: WiadomoscReklamacji[];
  zalaczniki: ZalacznikReklamacji[];
  zwroty: Zwrot[];
  rozmowy: Array<{ id: number; temat: string | null; status: string; ostatniaAt: string | null }>;
  /* Spoiwo kolejek (S1 i S3): rodzeństwo posprzedażowe BEZ tej sprawy oraz
     droga zakupu przez kolejki. */
  sprawy: SprawaZakupu[];
  droga: PrzystanekDrogi[];
  /** Zamówienie z pozycjami i CENAMI (0.393.0); `null` = jeszcze niepobrane. */
  zamowienie: Zamowienie | null;
  /** Gdzie jest paczka do klienta (0.393.0); `null` = nie ma zamówienia. */
  przesylka: StanPrzesylki | null;
  kartoteka: {
    pewnosc: string; twId: number | null; symbol: string | null;
    zrodlo: string | null; powod: string | null;
  } | null;
  /** Karta faktów Copilota (0.275.0); `null`, gdy nikt jeszcze nie prosił. */
  karta: KartaSprawy | null;
  /** Ile razy TO SAMO już się zdarzyło (0.413.0). */
  historia: HistoriaSprawy;
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
 * potwierdzonej kartoteki nie ma towaru, po którym szukać. Zero przy towarze,
 * którego nie rozpoznaliśmy, czytałoby się jak „nigdy się nie sypał".
 */
export interface HistoriaSprawy {
  towar: SladHistorii | null;
  klient: SladHistorii | null;
}

/** Pole karty z cytatem — numer wiadomości, z której model to wziął. */
export interface PoleKarty { tresc: string; zrodlo: string }

/**
 * Karta faktów ze sprawy — co maszyna WYCZYTAŁA, nigdy co radzi.
 *
 * Werdyktu tu nie ma i nie będzie: uznanie i odrzucenie są nieodwracalne wobec
 * kupującego i należą do człowieka. Najcenniejsze pole to `brakuje` — sprawa
 * stoi tygodniami nie dlatego, że nikt nie umie zdecydować, tylko dlatego, że
 * nikt nie zapytał o zdjęcie tabliczki.
 */
export interface KartaSprawy {
  usterka: PoleKarty | null;
  kiedy: PoleKarty | null;
  oczekiwanie: PoleKarty | null;
  dowody: PoleKarty[];
  brakuje: string[];
  /** Co maszyna RADZI zrobić (0.276.0); `null`, gdy nie miała z czego. */
  rada: RadaMaszyny | null;
  /** `trafna`/`nietrafna` — liczone z werdyktu, nie z ankiety; `null` przed nim. */
  ocena: string | null;
  /* Które zdjęcie było którym `Z` (0.283.0). Bez tej mapy cytat `Z2` byłby
     numerem, którego agent nie ma jak sprawdzić. */
  zdjecia: ZdjecieKarty[];
  model: string;
  przez: string | null;
  at: string;
}

export interface ZdjecieKarty {
  numer: string;
  zalacznikId: number;
  nazwa: string;
}

/**
 * Rada maszyny: co zrobić, dlaczego, jak pewnie i CZEGO NIE WIE.
 *
 * `co` to jedna z jedenastu wartości werdyktu Allegro albo `POPROSIC_O_DOWODY`
 * — nasza dwunasta, znacząca „nie ma jeszcze czego rozstrzygać".
 *
 * `czegoNieWiem` jest przeciwwagą dla `pewnosc`, nie ozdobą: serwer odrzuca
 * kartę, w której model deklaruje wysoką pewność i nie umie nazwać ani jednej
 * rzeczy, której nie wie.
 */
export interface RadaMaszyny {
  co: string;
  uzasadnienie: PoleKarty;
  pewnosc: string;
  czegoNieWiem: string[];
}

/* ── Dyskusje (0.245.0) ──────────────────────────────────────────────────────
   Ten sam zasób Allegro co reklamacje, ta sama tabela i ten sam czat — więc
   `WiadomoscReklamacji` i `ZalacznikReklamacji` obsługują oba ekrany. Różni
   się WIERSZ: dyskusja nie ma numeru, terminu, prawa, powodu, oczekiwania,
   kwoty ani oferty. Schemat mówi przy każdym z tych pól `Null for disputes`,
   więc powtórzenie ich tutaj jako `null` byłoby obietnicą pustych kolumn. */

export type KubelekDyskusji = "odpowiedz" | "klient" | "zamknieta";

export type SygnalDyskusji =
  | "klient_czeka" | "doradca" | "czat_zamkniety"
  | "nierozstrzygnieta" | "status_nieznany";

export interface Dyskusja {
  id: number;
  externalId: string;
  orderId: string | null;
  kupujacyLogin: string | null;
  temat: string | null;
  opis: string | null;
  /** DISPUTE_ONGOING, DISPUTE_CLOSED albo DISPUTE_UNRESOLVED. */
  statusAllegro: string | null;
  czatAktywny: boolean;
  wiadomosciIle: number;
  /** Czy rozmowę urwał NASZ bezpiecznik stron (0.273.0). */
  czatUrwany: boolean;
  ostatniaWiadomoscStatus: string | null;
  ostatniaWiadomoscAt: string | null;
  /** Czy ruch należy do nas — z niego biorą się kubełek i czas czekania. */
  ruchNasz: boolean;
  /**
   * Ile dni piłka jest po naszej stronie; `null`, gdy nie jest.
   *
   * TO NIE JEST TERMIN i ekran nie ma prawa tak tego nazwać. Allegro dla
   * dyskusji zegara nie oddaje — to jest fakt o naszej skrzynce.
   */
  czekaOdDni: number | null;
  dlugoCzeka: boolean;
  otwartoAt: string;
  prowadzi: string | null;
  /** Tożsamość prowadzącego — po NIEJ liczy się sito „Moje" (0.278.0). */
  prowadziId: number | null;
  prowadziAt: string | null;
  /** Tagi biura (0.279.0). Zawężają listę, NIGDY nie przestawiają kolejki. */
  tagi: TagSprawy[];
  /* ── Droga powrotna z notatki (0.280.0) ──────────────────────────────────
     Poprzedniej TREŚCI panel nie dostaje i nie potrzebuje: cofnięcie jest
     zamianą, więc drugie kliknięcie przywraca stan sprzed pierwszego. */
  notatkaAt: string | null;
  notatkaPrzez: string | null;
  maPoprzedniaNotatke: boolean;
  notatka: string | null;
  /** Los NASZEJ prośby o zakończenie. Stan dyskusji mówi `statusAllegro`. */
  zakonczenieStatus: "sent" | "send_uncertain" | null;
  zakonczenieAt: string | null;
  zakonczeniePrzez: string | null;
  wersja: number;
  kubelek: KubelekDyskusji;
  sygnaly: SygnalDyskusji[];
  linkZamowienia: string | null;
}

export interface KolejkaDyskusji {
  dyskusje: Dyskusja[];
  liczniki: Record<KubelekDyskusji, number>;
  /** Próg jest WSPÓLNY z reklamacjami — jedna tabela, jedna granica widoku. */
  prog: ProgKolejki;
  /** Pasek synchronizacji jest WSPÓLNY: obie sprawy jadą jedną listą. */
  stan: StanReklamacji;
}

export interface SzczegolDyskusji {
  dyskusja: Dyskusja;
  czat: WiadomoscReklamacji[];
  zalaczniki: ZalacznikReklamacji[];
  zwroty: Zwrot[];
  rozmowy: Array<{ id: number; temat: string | null; status: string; ostatniaAt: string | null }>;
  /* Spoiwo kolejek (S1 i S3): rodzeństwo posprzedażowe BEZ tej sprawy oraz
     droga zakupu przez kolejki. */
  sprawy: SprawaZakupu[];
  droga: PrzystanekDrogi[];
  /** Zamówienie z pozycjami i cenami (0.393.0). */
  zamowienie: Zamowienie | null;
  /** Gdzie jest paczka do klienta (0.393.0). */
  przesylka: StanPrzesylki | null;
}

/** Wynik prośby o zakończenie — los próby, nie potwierdzenie zamknięcia. */
export interface WynikZakonczenia {
  status: "sent" | "send_uncertain";
  wersja: number;
}

/** Wynik wysyłki odpowiedzi w reklamacji (0.224.0). */
export interface WynikOdpowiedziReklamacji {
  status: "sending" | "sent" | "send_uncertain" | "send_failed";
  externalMessageId: string | null;
  kluczIdempotencji: string;
}

/** Wynik werdyktu (przyrost trzeci) — los próby, nie potwierdzenie Allegro. */
export interface WynikWerdyktu {
  werdykt: Werdykt;
  werdyktNazwa: string;
  status: StatusWerdyktu;
  blad: string | null;
  wersja: number;
}

/* ── Pasowanie części: uszczelka pasuje DO gaźnika (§11.2) ─────────────────
   Trzecia kopia list obok `services/pasowania.ts` i `CHECK`. */
export type RolaPasowania = "uszczelka" | "membrana" | "zestaw_naprawczy" | "lacznik" | "element_zestawu" | "inne";

export type KartotekaPasowania = { twId: number; symbol: string; nazwa: string };

export type Pasowanie = {
  id: number;
  /** Część, która PASUJE (uszczelka). */
  czesc: KartotekaPasowania;
  /** DO CZEGO pasuje (gaźnik). */
  doCzego: KartotekaPasowania;
  rola: RolaPasowania; nazwaRoli: string; pozycja: string | null;
  polaryzacja: "pasuje" | "nie_pasuje"; powodNegatywny: PowodNegatywny | null; zdaniePowodu: string | null;
  stan: StanZastosowania; zrodlo: "reczne" | "dobor" | "opis" | "copilot";
  rodzajDowodu: RodzajDowodu; nazwaRodzajuDowodu: string; dowodTresc: string; dowodLink: string | null;
  komentarz: string | null; conversationId: number | null; zastepujeId: number | null;
  zaproponowal: string; zaproponowanoAt: string;
  rozstrzygnal: string | null; rozstrzygnietoAt: string | null; powodRozstrzygniecia: string | null;
  pewnosc: "potwierdzone" | "prawdopodobne";
  /** Zdanie źródła z serwera. Panel go nie układa. */
  zdanieZrodla: string;
};

/** Trafienie przy odczycie: wprost albo przez zamiennik (wtedy pewność najwyżej `prawdopodobne`). */
export type TrafieniePasowania = {
  czesc: KartotekaPasowania; doCzego: KartotekaPasowania; pasowanie: Pasowanie;
  przezZamiennik: string | null; pewnosc: "potwierdzone" | "prawdopodobne"; zdanie: string;
};

export type PasowaniaTowaru = {
  pasujeDo: TrafieniePasowania[]; pasujace: TrafieniePasowania[]; negatywne: Pasowanie[]; propozycje: Pasowanie[];
};

/* Zamienność przez wspólny numer oryginału. Kandydat nie ma wiersza — serwer
   liczy go przy odczycie z identyfikatorów; wiersz ma dopiero DECYZJA. Kształt
   z `services/zamiennosc-oem.ts`. */
export type KandydatZamiennosci = {
  a: KartotekaPasowania;
  b: KartotekaPasowania;
  /** Wspólne numery w zapisie z opisu — po nich człowiek rozstrzyga. */
  numery: string[];
};

export type Zamiennosc = {
  id: number;
  a: KartotekaPasowania;
  b: KartotekaPasowania;
  stan: "zatwierdzone" | "odrzucone" | "wycofane";
  numery: string[];
  powod: string | null;
  rozstrzygnal: string;
  rozstrzygnietoAt: string;
  wycofal: string | null;
  wycofanoAt: string | null;
  powodWycofania: string | null;
  /** Zdanie z serwera. Panel go nie układa. */
  zdanie: string;
};

/* Sieć wiedzy (widok „Sieć"): cztery warstwy — pasowania część→część,
   zastosowania część→maszyna/silnik, zabudowy silnik→maszyna i zamienniki
   z opisów. Kształt z `services/siec-wiedzy.ts`. Krawędź zamiennika to odczyt
   opisu, nie wiersz — stąd `wierszId: null` i pewność najwyżej `prawdopodobne`. */
export type RodzajWezla = "kartoteka" | "maszyna" | "silnik";

export type WezelSieci = {
  /** `tw:<tw_id>` albo `model:<id>`. */
  klucz: string;
  rodzaj: RodzajWezla;
  twId: number | null;
  /** Krótko, pod węzłem: symbol kartoteki albo „Honda GX160". */
  etykieta: string;
  nazwa: string;
};

export type WarstwaSieci = "pasowania" | "zastosowania" | "zabudowy" | "zamienniki";
export type RodzajKrawedzi = "pasuje" | "nie_pasuje" | "propozycja" | "zabudowa" | "zamiennik";

export type KrawedzSieci = {
  /** Część, silnik albo kartoteka, której opis podaje zamiennik. */
  z: string;
  /** Do czego pasuje, w czym stoi albo symbol wymieniony w opisie. */
  do: string;
  warstwa: WarstwaSieci;
  rodzaj: RodzajKrawedzi;
  polaryzacja: "pasuje" | "nie_pasuje" | null;
  wierszId: number | null;
  rola: RolaPasowania | null;
  pewnosc: "potwierdzone" | "prawdopodobne";
  obustronnie: boolean;
  /** Zdanie z serwera. Panel go nie układa. */
  zdanie: string;
};

export type SiecWiedzy = { wezly: WezelSieci[]; krawedzie: KrawedzSieci[] };

export type NowePasowanie = {
  twId: number; doTwId: number; rola: RolaPasowania; pozycja?: string | null;
  polaryzacja: "pasuje" | "nie_pasuje"; powodNegatywny?: PowodNegatywny | null;
  rodzajDowodu: RodzajDowodu; dowodTresc: string; dowodLink?: string | null; komentarz?: string | null;
  /** Obecność mówi serwerowi, że propozycja idzie z pracy (`dobor`), nie z ekranu Wiedza (`reczne`). */
  conversationId?: number | null;
};
