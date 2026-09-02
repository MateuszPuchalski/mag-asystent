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
  odlozoneDo: string | null;
  /** Odłożenie, którego termin minął. Liczy SERWER — panel tej reguły nie powtarza. */
  poTerminie: boolean;
  /* Kto SIEDZI przy rozmowie teraz. Przydział tymczasowy, na czas oglądania —
     żyje w pamięci serwera i wygasa sam, więc bywa `null` sekundę później. */
  oglada: { userId: number; name: string } | null;
};

/** Załącznik wiadomości. `doPobrania` liczy serwer — panel go nie wylicza. */
export type ZalacznikOsi = {
  id: number; nazwa: string; typ: string | null; status: string; doPobrania: boolean;
};

export type WpisOsi = {
  id: string;
  rodzaj: "wiadomosc" | "wynik_zadania" | "komentarz" | "status" | "sprawa";
  autor: string;
  odKlienta: boolean;
  tresc: string;
  at: string;
  ofertaId: string | null;
  /** Nazwa towaru Z ZAMÓWIENIA, nie z oferty — §4.3, źródło w nazwie pola. */
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

export type OsRozmowy = {
  rozmowa: Rozmowa;
  os: WpisOsi[];
  szkic: Szkic | null;
  ofertaWskazana: OfertaWskazana | null;
  sprawa: SprawaRozmowy | null;
  zamowienie: ZamowienieRozmowy | null;
};

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
export type Sygnal = "termin" | "brak_dowodu" | "odrzucony_w_allegro";

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
  offerId: string | null;
  nazwa: string;
  ilosc: number;
  cenaGrosze: number;
  waluta: string;
  powod: string | null;
  powodKomentarz: string | null;
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
  kwotaGrosze: number | null;
  kwotaWariant: string | null;
  korektaNumer: string | null;
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
