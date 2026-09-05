/* Kształty odpowiedzi serwera. Trzymane osobno, bo czytają je i ekrany,
   i testy — a duplikat rozjechałby się przy pierwszym nowym polu. */

/* Lista ZAMKNIĘTA, wprost z §7 projektu panelu. Ten sam komplet stoi
   w `STATUSY_ROZMOWY` na serwerze i w `CHECK` na kolumnie — trzy kopie jednej
   listy, bo każda pilnuje innej granicy: typów, API i bazy. */
export type StatusRozmowy =
  | "new" | "open" | "waiting_for_customer" | "waiting_for_internal"
  | "snoozed" | "resolved" | "closed" | "spam";

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
  /** Rozpoznanie Copilota (§14, etap F). `null` = nikt jeszcze nie rozpoznał. */
  kopilot: Kopilot | null;
  /* Kto SIEDZI przy rozmowie teraz. Przydział tymczasowy, na czas oglądania —
     żyje w pamięci serwera i wygasa sam, więc bywa `null` sekundę później. */
  oglada: { userId: number; name: string } | null;
};

/* Słownik kategorii — LUSTRO stałej `KATEGORIE` z serwera. Dwa kosze, bo mówią
   o dwóch różnych naprawach: `inne` znaczy „słownik jest za krótki”,
   `nie_wiadomo` — „za mało treści, przeczytaj sam”. */
export type Kategoria =
  | "dobor" | "dostepnosc" | "wysylka" | "zwrot" | "reklamacja" | "dokumenty"
  | "inne" | "nie_wiadomo";

export type Pewnosc = "wysoka" | "srednia" | "niska";

export type Kopilot = {
  kategoria: Kategoria;
  pewnosc: Pewnosc;
  /** Klient dopisał po rozpoznaniu. Liczy SERWER — panel tej reguły nie powtarza. */
  nieaktualna: boolean;
  /** Werdykt człowieka. To on, a nie liczba klasyfikacji, jest pomiarem. */
  ocena: "trafna" | "nietrafna" | null;
};

/** Stan Copilota do paska nad kolejką. Czysty odczyt — nic nie mutuje. */
export type StanCopilota = {
  wlaczony: boolean;
  /** Zdanie dla człowieka, gdy `wlaczony` jest fałszem. `null`, gdy działa. */
  powod: string | null;
  model: string;
  maxPartia: number;
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
};

/** Pomiar zza zębatki (0.168.0: diagnostyka nie stoi na ekranie pracy). */
export type PomiarCopilota = {
  wywolan: number;
  bledow: number;
  tokeny: { wej: number; wyj: number; cacheZapis: number; cacheOdczyt: number };
  kosztUsd: number;
  udzialCache: number | null;
  ocen: number;
  trafnych: number;
  /** Bez tej liczby „100 % trafności” z dwóch ocen udawałoby pomiar. */
  nieocenionych: number;
  wgKategorii: Array<{ kategoria: string; ile: number; ocen: number; trafnych: number }>;
};

/** Załącznik wiadomości. `doPobrania` liczy serwer — panel go nie wylicza. */
export type ZalacznikOsi = {
  id: number; nazwa: string; typ: string | null; status: string; doPobrania: boolean;
};

export type WpisOsi = {
  id: string;
  rodzaj: "wiadomosc" | "wynik_zadania" | "komentarz" | "status" | "sprawa" | "dobor";
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
  messageId?: number;
  zalaczniki?: ZalacznikOsi[];
  wzmianki?: Array<{ userId: number; name: string }>;
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

/* Sprawa (§6.1, 0.161.0) — klamra nad rozmowami jednego problemu. Nie ma
   statusu ani osi: §7 nie zna statusów sprawy, a zdarzenia wiszą przy ŹRÓDLE
   (blizna 0.130.0). */
export type SprawaRozmowy = {
  id: number;
  tytul: string;
  rozmowy: Array<{ id: number; klient: string; ostatniaWiadomoscAt: string }>;
};

export type WierszSprawy = {
  id: number; tytul: string; liczbaRozmow: number; ostatniaWiadomoscAt: string | null;
};

export type Szkic = { body: string; wersja: number; expectedLastMessageId: number | null };

export type StanSkrzynki = { ostatniaSynchronizacja: string | null; bledy: number };

export type OfertaWskazana = { ofertaId: string; autor: string };

/* Zamówienie przy rozmowie (0.166.0). `pobrane` jest `null`, dopóki ticker
   nie dociągnie treści — numer i odnośnik do panelu Allegro są od razu. */
export type ZamowienieRozmowy = {
  externalId: string; link: string | null; pobrane: Zamowienie | null;
};

/* Oferta przy rozmowie (0.178.0). `pobrana` jest `null`, dopóki ticker nie
   dociągnie snapshotu — numer i odnośnik są od razu. Cena opisuje CHWILĘ
   pytania (§15.2), nie dzisiejszy cennik. */
export type OfertaRozmowy = {
  externalId: string; link: string | null;
  pobrana: {
    nazwa: string; sku: string | null; cenaGrosze: number | null;
    waluta: string | null; status: string | null; syncedAt: string;
    /**
     * Czy Allegro podało adres zdjęcia listingowego (0.211.0).
     *
     * Sam adres do panelu NIE JEDZIE i to jest cała różnica: gdyby jechał,
     * front miałby w ręku `https://a.allegroimg.com/…` i prędzej czy później
     * ktoś wstawiłby go w `src`, czyli wyprowadził przeglądarkę biura poza
     * własną sieć. Flaga mówi tylko „jest po co pytać naszej trasy".
     */
    maZdjecie: boolean;
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
  identyfikatory?: Array<{ rodzaj: RodzajIdentyfikatora; wartosc: string; zrodlo: "opis" | "reczne" }>;
  locs: string[];
  mag: { stan: number; rez: number; avail: number };
  magazyny: Array<{ magId: number; kod: string; nazwa: string; stan: number; rez: number }>;
};

export type OsRozmowy = {
  rozmowa: Rozmowa;
  os: WpisOsi[];
  szkic: Szkic | null;
  ofertaWskazana: OfertaWskazana | null;
  sprawa: SprawaRozmowy | null;
  zamowienie: ZamowienieRozmowy | null;
  oferta: OfertaRozmowy | null;
  dobor: Dobor;
};

/* ── Dobór części (§11, etap E1) ─────────────────────────────────────────────
   Lista statusów ZAMKNIĘTA, wprost z §7 — trzecia kopia obok `STATUSY_DOBORU`
   na serwerze i `CHECK` na kolumnie. `extracting_data` nie ma w E nadawcy:
   serwer go odrzuca, nada go Copilot (F). */
export type StatusDoboru =
  | "not_started" | "extracting_data" | "missing_information" | "searching"
  | "candidates_found" | "requires_expert" | "confirmed" | "rejected" | "not_applicable";

/* Osiem dróg §11.2. `zastosowanie`, `oem` i `pelnotekst` czekają na E2/E3. */
export type DrogaDoboru =
  | "oferta" | "zamiennik" | "symbol" | "ean" | "wyszukiwarka" | "zastosowanie" | "oem" | "pelnotekst";

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
export type SzczebelDoboru = { droga: DrogaDoboru; sprawdzona: boolean; wynikow: number; powod?: string };

/* Negatyw jest widoczny także dla kartoteki, której NIE MA wśród kandydatów (§11.4). */
export type NegatywDoboru = {
  twId: number; symbol: string; nazwa: string | null; powod: string; zrodlo: string; at: string;
};

export type KandydaciDoboru = { kandydaci: KandydatDoboru[]; drogi: SzczebelDoboru[]; negatywne: NegatywDoboru[] };

/* ── Baza wiedzy (§11.3, §11.4, §12, etap E2) ────────────────────────────────
   Listy ZAMKNIĘTE — trzecia kopia obok `services/wiedza.ts` i `CHECK`. */
export type PowodNegatywny =
  | "nie_pasuje" | "tylko_inny_wariant" | "niewlasciwy_rozstaw"
  | "srednica_ok_inne_mocowanie" | "mylace_oznaczenie" | "wymaga_pomiaru";
export type RodzajDowodu =
  | "producent" | "katalog_dostawcy" | "pomiar_wlasny" | "sprzedaz_weryfikacja" | "decyzja_biura" | "rozmowa";
export type StanZastosowania = "propozycja" | "zatwierdzone" | "odrzucone" | "wycofane";
export type ZrodloPropozycji = "dobor" | "pomiar" | "reczne" | "opis" | "copilot";

export type ModelUrzadzenia = {
  id: number; rodzaj: "maszyna" | "silnik"; marka: string; nazwa: string;
  wariant: string | null; lata: string | null; klucz: string; etykieta: string;
};

export type DowodZastosowania = {
  id: number; rodzaj: RodzajDowodu; nazwaRodzaju: string; tresc: string; link: string | null;
  zadanieId: number | null; conversationId: number | null; autor: string; at: string;
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
  /** Zdanie źródła pisze SERWER (§14.3). */
  zdanieZrodla: string;
};

/* ── Identyfikatory i sekcje „Modele:" z opisów (§11.2, etap E3) ─────────── */
export type RodzajIdentyfikatora = "oem" | "nr_oryg" | "katalog_obcy" | "stare_sku";

export type Identyfikator = {
  id: number; twId: number; symbol: string; nazwa: string | null;
  rodzaj: RodzajIdentyfikatora; nazwaRodzaju: string; wartosc: string;
  zrodlo: "opis" | "reczne"; dodal: string; at: string;
};

/** Sekcja „Modele:" z opisu kartoteki, którą człowiek zamienia na propozycję albo odrzuca. */
export type ModelZOpisu = {
  id: number; twId: number; symbol: string; nazwa: string | null; tekst: string;
  stan: "nowy" | "przerobiony" | "odrzucony"; zastosowanieId: number | null;
  rozstrzygnal: string | null; rozstrzygnietoAt: string | null; at: string;
};

export type PokrycieWiedzy = {
  kartotek: number; zOpisem: number; zIdentyfikatorem: number;
  identyfikatorow: number; identyfikatorowRecznych: number;
  modeleZOpisu: { nowych: number; przerobionych: number; odrzuconych: number };
  zastosowania: { zatwierdzonych: number; negatywnych: number; propozycji: number };
  fts: { dostepne: boolean; wpisow: number };
};

export type NowaPropozycja = {
  twId: number;
  model: { rodzaj: "maszyna" | "silnik"; marka: string; nazwa: string; wariant?: string | null; lata?: string | null };
  polaryzacja: "pasuje" | "nie_pasuje";
  powodNegatywny?: PowodNegatywny | null;
  komentarz?: string | null;
  dowod: { rodzaj: RodzajDowodu; tresc: string; link?: string | null };
  zastepujeId?: number | null;
};

export type PomiarRozmowy = {
  zadanieId: number; tytul: string; wynik: string; wykonanoAt: string; wykonanoPrzez: string;
  twId: number | null; symbol: string | null; zaproponowano: boolean;
};

export type WiedzaDoboru = { zastosowanie: Zastosowanie | null; pomiary: PomiarRozmowy[] };

export type Zadanie = {
  id: number; rodzaj: string; tytul: string; instrukcja: string;
  twId: number | null; symbol: string | null; nazwaTowaru: string | null;
  lokalizacja: string | null; priorytet: "normalny" | "pilny";
  status: "nowe" | "w_toku" | "wykonane" | "anulowane";
  utworzonoAt: string; utworzonoPrzez: string; przypisanoPrzez: string | null;
  wynik: string | null; wykonanoPrzez: string | null;
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
  nowaWiadomosc?: { id: number; tresc: string; at: string } | null;
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
export type Sygnal = "termin" | "brak_dowodu" | "odrzucony_w_allegro"
  | "pieniadze_niepotwierdzone" | "pieniadze_poza_panelem" | "kwota_nieaktualna";

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
  id: number;
  /** `allegro` = ze zgłoszenia klienta, `biuro` = dopisana u nas (0.184.0). */
  zrodlo: string;
  offerId: string | null;
  /**
   * Numer oferty wzięty z POZYCJI ZAMÓWIENIA (0.211.0) — tym wolno pytać
   * o zdjęcie listingowe. `offerId` wyżej należy do przestrzeni, której nie
   * znamy, więc do niczego poza wyświetleniem się nie nadaje.
   */
  ofertaZamowienia: string | null;
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
  kubelek: Kubelek;
  sygnaly: Sygnal[];
  terminAt: string;
  dniDoTerminu: number;
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
  /** `subiekt` = numer znaleziony w Subiekcie, `reczne` = przepisany ręką. */
  korektaZrodlo: string | null;
  rejectionCode: string | null;
  /** `allegro` albo `nieodebrana` — paczka, której klient nie odebrał. */
  zrodlo: string;
  notatka: string | null;
  kupujacyLogin: string | null;
  przewoznik: string | null;
  rozmowy: RozmowaZwrotu[];
  /** Dokument sprzedaży z Subiekta — snapshot numeru, nie odczyt na żywo. */
  faktura: FakturaZwrotu;
  wersja: number;
  pozycje: PozycjaZwrotu[];
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
export interface DoDopisania {
  zamPozycjaId: number;
  offerId: string | null;
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
  rodzaj: string;
  tresc: string | null;
  dane_json: string | null;
  kiedy_at: string;
  kto: string | null;
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
};

/**
 * Otwarty koszyk zwrotów operatora.
 *
 * Odpowiednik pustej MM, którą biuro zakłada w Subiekcie, zasiadając do
 * zwrotów: dokłada się do niej pozycja po pozycji, a domknięcie wystawia
 * dokument na regał zwrotów.
 */
export interface KoszZwrotow {
  id: number;
  /** Kod z przedrostkiem `Z-`; numery bez niego należą do koszy z Subiekta. */
  kod: string;
  pozycji: number;
  sztuk: number;
  otwartyOd: string;
  pozycje: Array<{ symbol: string; nazwa: string; ilosc: number }>;
}
