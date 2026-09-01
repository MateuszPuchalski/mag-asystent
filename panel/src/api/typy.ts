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
  rodzaj: "wiadomosc" | "wynik_zadania" | "komentarz" | "status";
  autor: string;
  odKlienta: boolean;
  tresc: string;
  at: string;
  ofertaId: string | null;
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

export type Szkic = { body: string; wersja: number; expectedLastMessageId: number | null };

export type StanSkrzynki = { ostatniaSynchronizacja: string | null; bledy: number };

export type OfertaWskazana = { ofertaId: string; autor: string };

export type OsRozmowy = {
  rozmowa: Rozmowa;
  os: WpisOsi[];
  szkic: Szkic | null;
  ofertaWskazana: OfertaWskazana | null;
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
  propozycja: Dopasowanie | null;
}

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
  wersja: number;
  pozycje: PozycjaZwrotu[];
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
