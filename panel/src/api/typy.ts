/* Kształty odpowiedzi serwera. Trzymane osobno, bo czytają je i ekrany,
   i testy — a duplikat rozjechałby się przy pierwszym nowym polu. */

export type Rozmowa = {
  id: number;
  klient: string;
  ostatniaWiadomosc: string;
  ostatniaWiadomoscAt: string;
  nieprzeczytana: boolean;
  wlascicielId: number | null;
  wlasciciel: string | null;
  wersja: number;
};

/** Załącznik wiadomości. `doPobrania` liczy serwer — panel go nie wylicza. */
export type ZalacznikOsi = {
  id: number; nazwa: string; typ: string | null; status: string; doPobrania: boolean;
};

export type WpisOsi = {
  id: string;
  rodzaj: "wiadomosc" | "wynik_zadania";
  autor: string;
  odKlienta: boolean;
  tresc: string;
  at: string;
  ofertaId: string | null;
  zadanieId?: number;
  messageId?: number;
  zalaczniki?: ZalacznikOsi[];
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
};

/* ── Zwroty klienckie (0.150.0) ──────────────────────────────────────────────
   Kształt lustrzany do `WierszZwrotu` w `server/src/services/zwroty.ts`.
   Kubełek i sygnały LICZY SERWER — panel ich nie wyprowadza po raz drugi,
   bo dwie kopie tej reguły rozjechałyby się przy pierwszej poprawce jednej
   z nich, a rozjazd byłby niewidoczny: ekran po prostu pokazywałby inną
   kolejkę niż liczniki.                                                     */

export type Kubelek = "decyzja" | "ocena" | "zwrot" | "korekta" | "zamkniety" | "odrzucony";
export type Sygnal = "termin" | "brak_dowodu" | "odrzucony_w_allegro";

/** Wynik dopasowania po SKU — §11.3 żąda widocznego źródła i pewności. */
export interface Dopasowanie {
  pewnosc: "brak" | "sku" | "niejednoznaczne";
  twId: number | null;
  symbol: string | null;
  zrodlo: string;
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

export interface KolejkaZwrotow {
  zwroty: Zwrot[];
  liczniki: Record<Kubelek, number>;
  stan: StanZwrotow;
}
