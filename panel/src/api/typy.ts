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
  allegro?: { stan?: string };
  allegroInbox: {
    status: StatusSynchronizacji;
    alarm: boolean;
    ostatniaProba: string | null;
    ostatniaUdanaSynchronizacja: string | null;
    kodOstatniegoBledu: number | null;
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
