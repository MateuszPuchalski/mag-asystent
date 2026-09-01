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

export type OsRozmowy = { rozmowa: Rozmowa; os: WpisOsi[]; szkic: Szkic | null };

export type Zadanie = {
  id: number; rodzaj: string; tytul: string; instrukcja: string;
  twId: number | null; symbol: string | null; nazwaTowaru: string | null;
  lokalizacja: string | null; priorytet: "normalny" | "pilny";
  status: "nowe" | "w_toku" | "wykonane" | "anulowane";
  utworzonoAt: string; utworzonoPrzez: string; przypisanoPrzez: string | null;
  wynik: string | null; wykonanoPrzez: string | null;
};
