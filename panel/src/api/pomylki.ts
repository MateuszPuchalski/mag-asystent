import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { api, Konflikt } from "./klient";

/* ── POMYŁKI WYSYŁKOWE — trasy z `server/src/routes/pomylki.ts` ─────────────
   Rejestr złych paczek, który biuro prowadziło w arkuszu. Agent wpisuje tu
   tylko to, czego system nie może wiedzieć: co klient dostał i kto zbierał
   oraz pakował. Resztę wypełniają kolejki, więc pola `zKolejki` są faktem.

   `method` STOI PIERWSZE w `init`, a adres w każdym wywołaniu w całości.
   Strażnik adresów panelu (`server/src/routes/panel-adresy.test.ts`) czyta
   metodę wyrażeniem urywanym na pierwszym `}` i pomija adresy składane. */

/** Osoba z magazynu przy pomyłce. `userId: null` = konto skasowane, zostało imię. */
export interface OsobaPomylki { userId: number | null; nazwa: string }

/** Fakt, który zna kolejka (`zKolejki`) albo wpisało biuro ręcznie. */
export interface FaktPomylki<T> { wartosc: T | null; zKolejki: boolean }

export type StanPomylki = "do_uzupelnienia" | "w_toku" | "zakonczona";
export type FiltrPomylek = "do_uzupelnienia" | "w_toku" | "zakonczone" | "wszystkie";

export interface Pomylka {
  id: number;
  /** Dzień zgłoszenia, „RRRR-MM-DD". */
  zgloszono: string;
  login: string;
  konto: number | null;
  /** Numer zamówienia Allegro; `null` przy paragonie. */
  zamowienie: string | null;
  zwrotId: number | null;
  coZamowil: string | null;
  coDostal: string | null;
  /** Zdanie złożone przez serwer, np. „Dostał X zamiast Y". */
  opis: string | null;
  uwagi: string | null;
  zrodlo: "odmowa" | "dosylka" | "recznie";
  zbieral: OsobaPomylki | null;
  pakowal: OsobaPomylki | null;
  winaZbierajacego: boolean;
  winaPakujacego: boolean;
  nowyTowar: FaktPomylki<"tak" | "nie">;
  /** „RRRR-MM-DD" albo „nie_wraca". */
  towarWrocil: FaktPomylki<string>;
  odmowa: FaktPomylki<"tak" | "nie_trzeba"> & { kod: string | null };
  stan: StanPomylki;
  zakonczonaRecznie: boolean;
  wersja: number;
}

export interface OsobaPodsumowania {
  userId: number | null; nazwa: string; zbieral: number; pakowal: number; winny: number;
}

export interface PodsumowaniePomylek {
  miesiac: string;
  razem: number;
  /** Osoby z pomyłek miesiąca; pusta, gdy nikogo jeszcze nie wpisano. */
  osoby: OsobaPodsumowania[];
  stany: Record<StanPomylki, number>;
  zrodla: Record<Pomylka["zrodlo"], number>;
  /** Pomyłki z osobą, ale bez wskazanej winy. */
  bezWinnego: number;
  /** Sześć miesięcy do wybranego włącznie, od najstarszego. */
  trend: Array<{ miesiac: string; razem: number }>;
  /** Najczęściej mylone towary, po „co zamówił". */
  towary: Array<{ nazwa: string; ile: number }>;
}

export interface OdpowiedzPomylek {
  pomylki: Pomylka[];
  podsumowanie: PodsumowaniePomylek;
  doUzupelnienia: number;
  /** Imiona wpisane ręcznie, spoza kont — do ponownego wyboru. */
  osobyReczne: string[];
}

export interface PozycjaDoWyboru { nazwa: string; ilosc: number; sku: string | null }

/** Pola, które agent zmienia jednym kliknięciem albo wpisem. */
export interface ZmianaPomylki {
  coZamowil?: string | null;
  coDostal?: string | null;
  uwagi?: string | null;
  zbieralUserId?: number | null;
  pakowalUserId?: number | null;
  /** Osoba bez konta: samo imię. Nie idzie razem z `…UserId`. */
  zbieralNazwa?: string;
  pakowalNazwa?: string;
  winaZbierajacego?: boolean;
  winaPakujacego?: boolean;
  nowyTowar?: "tak" | "nie" | null;
  towarWrocil?: string | null;
  odmowa?: "tak" | "nie_trzeba" | null;
}

export interface NowaPomylka {
  login: string;
  konto?: number | null;
  zamowienie?: string | null;
  coZamowil?: string | null;
  coDostal?: string | null;
  uwagi?: string | null;
}

/** Prefiks wszystkich odczytów rejestru: lista, licznik i pozycje. */
export const KLUCZ_POMYLEK = "pomylki";
const kluczListy = (filtr: FiltrPomylek, miesiac: string) => [KLUCZ_POMYLEK, "lista", filtr, miesiac] as const;

/**
 * Adres wiersza pomyłki na jej ekranie. Miesiąc jedzie w adresie, bo ekran
 * filtruje po miesiącu, a pomyłka sprzed miesiąca nie stoi w bieżącym.
 */
export const adresPomylki = (id: number, zgloszono: string | null | undefined) =>
  `/obsluga/pomylki?id=${id}${zgloszono ? `&miesiac=${zgloszono.slice(0, 7)}` : ""}`;

export function usePomylki(filtr: FiltrPomylek, miesiac: string) {
  return useQuery({
    queryKey: kluczListy(filtr, miesiac),
    queryFn: () => api<OdpowiedzPomylek>(
      `/api/pomylki?stan=${encodeURIComponent(filtr)}&miesiac=${encodeURIComponent(miesiac)}`),
  });
}

/* Licznik przy zakładce, z każdego ekranu panelu: pomyłka założona sama przy
   odmowie wypłaty ma być widoczna, zanim ktoś wejdzie na jej ekran. Minuta,
   bo nowa pomyłka nie pali się tak jak pytanie klienta. */
export function useLicznikPomylek() {
  return useQuery({
    queryKey: [KLUCZ_POMYLEK, "licznik"] as const,
    queryFn: () => api<{ doUzupelnienia: number }>("/api/pomylki/licznik"),
    refetchInterval: 60_000,
  });
}

/**
 * Pomyłki zbierania złapane przy pakowaniu — z Sellasist, nie z rejestru.
 *
 * Liczy wejścia zamówień w status braku przy pakowaniu na dobę magazynu.
 * Takiej paczki klient nie dostał z błędem, więc rejestr niżej jej nie zna.
 */
export interface ZlapanePomylki {
  /** `false`: Sellasist wyłączony, lustro stoi albo status pomyłki nieustawiony — ekran milczy. */
  wlaczone: boolean;
  /**
   * Doby od najstarszej, najwyżej czternaście: tylko te, które lustro
   * przeczytało całe z ustawionym statusem. Pusta lista to brak danych, nie zero.
   */
  dni: Array<{ data: string; zlapanych: number }>;
  /** Suma po `dni`; `null` przy pustej liście. */
  razem: number | null;
  /** Pomyłki z rejestru zgłoszone w tych samych dobach; `null` przy pustej liście. */
  doKlienta: number | null;
  /**
   * Kto zbierał złapane, z dziennika Sellasist, dla całego biura.
   * `nazwa: null` = numer Sellasist, któremu admin nie przypisał jeszcze osoby.
   */
  osoby: OsobaZlapanych[];
  /** Złapane bez ustalonej osoby; `null`, gdy blok nie ma danych. */
  bezOsoby: number | null;
}

export interface OsobaZlapanych { sellasistId: number; userId: number | null; nazwa: string | null; zlapanych: number }

/* Pod kluczem rejestru, bo nowa pomyłka w rejestrze zmienia liczbę „do
   klienta”. Odczyt idzie z bazy serwera, nie z Sellasist, więc odświeżenie
   po zapisie kosztuje jedno lekkie zapytanie. Pięć minut, bo złapane
   dochodzą przebiegami synchronizacji, nie na żywo. */
export function useZlapanePomylki() {
  return useQuery({
    queryKey: [KLUCZ_POMYLEK, "zlapane"] as const,
    queryFn: () => api<ZlapanePomylki>("/api/pomylki/zlapane"),
    staleTime: 5 * 60_000,
  });
}

/** Pozycje zamówienia do wyboru „co zamówił"; `null` wyłącza zapytanie. */
export function usePozycjePomylki(id: number | null) {
  return useQuery({
    queryKey: [KLUCZ_POMYLEK, "pozycje", id ?? 0] as const,
    queryFn: () => api<{ pozycje: PozycjaDoWyboru[]; podpowiedz: string | null }>(`/api/pomylki/${id}/pozycje`),
    enabled: id !== null,
    staleTime: 5 * 60_000,
  });
}

/**
 * Magazynierzy do dwóch rzędów imion — z istniejącej trasy `/api/users`.
 *
 * Lista kont jest już wystawiona biuru, a drugi adres na te same dane to
 * drugie miejsce do pilnowania przy zmianie ról. Bez magazynierów w bazie
 * (świeża instalacja, konta biura zbierają same) zostają wszyscy czynni,
 * bo pusty rząd nie pozwoliłby uzupełnić pomyłki wcale.
 */
export function useOsobyPomylek() {
  return useQuery({
    queryKey: ["agenci-pomylki"],
    queryFn: () => api<{ users: Array<{ userId: number; name: string; role: string; active?: boolean }> }>("/api/users"),
    staleTime: 5 * 60_000,
    retry: false,
    select: (d) => {
      const czynni = d.users.filter((u) => u.active !== false);
      const hala = czynni.filter((u) => u.role === "magazynier");
      return (hala.length > 0 ? hala : czynni).map((u) => ({ userId: u.userId, nazwa: u.name }));
    },
  });
}

/** Świeża pomyłka staje w każdej wczytanej liście od razu, zanim ta się odświeży. */
function wstawDoList(qc: QueryClient, p: Pomylka) {
  qc.setQueriesData<OdpowiedzPomylek>({ queryKey: [KLUCZ_POMYLEK, "lista"] }, (d) =>
    d && { ...d, pomylki: d.pomylki.map((x) => (x.id === p.id ? p : x)) });
}

/* Po zapisie czytają się od nowa: rejestr (lista, licznik), profil klienta,
   który ma sekcję pomyłek, i droga zakupu, która ma ich przystanki. Obietnica
   wraca, więc przyciski czekają na świeżą wersję i drugi klik nie dostaje 409. */
function poZapisie(qc: QueryClient) {
  return Promise.all([
    qc.invalidateQueries({ queryKey: [KLUCZ_POMYLEK] }),
    qc.invalidateQueries({ queryKey: ["profil-klienta"] }),
    qc.invalidateQueries({ queryKey: ["droga-sprawy"] }),
  ]);
}

/** Świeży wiersz z konfliktu (409) — serwer odsyła go obok zdania. */
export function pomylkaZKonfliktu(e: unknown): Pomylka | null {
  return e instanceof Konflikt ? ((e.szczegoly as { pomylka?: Pomylka }).pomylka ?? null) : null;
}

/** Nowa pomyłka. Ta sama paczka zgłoszona drugi raz oddaje istniejącą (200). */
export function useNowaPomylka() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: NowaPomylka) => api<{ pomylka: Pomylka }>("/api/pomylki",
      { method: "POST", body: JSON.stringify(v) }),
    onSettled: () => poZapisie(qc),
  });
}

/** Zmiana pól; `wersja` to ta, którą ekran narysował, więc cudza zmiana daje 409. */
export function useZmienPomylke() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...v }: ZmianaPomylki & { id: number; wersja: number }) =>
      api<{ pomylka: Pomylka }>(`/api/pomylki/${id}`, { method: "PATCH", body: JSON.stringify(v) }),
    onSuccess: (d) => wstawDoList(qc, d.pomylka),
    onError: (e) => { const p = pomylkaZKonfliktu(e); if (p) wstawDoList(qc, p); },
    onSettled: () => poZapisie(qc),
  });
}

/** Ręczne zakończenie — wyjątek, bo zwykle stan liczy się sam z kolejek. */
export function useZakonczPomylke() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: number; wersja: number }) => api<{ pomylka: Pomylka }>(`/api/pomylki/${v.id}/zakoncz`,
      { method: "POST", body: JSON.stringify({ wersja: v.wersja }) }),
    onSuccess: (d) => wstawDoList(qc, d.pomylka),
    onError: (e) => { const p = pomylkaZKonfliktu(e); if (p) wstawDoList(qc, p); },
    onSettled: () => poZapisie(qc),
  });
}

export function useWznowPomylke() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: number; wersja: number }) => api<{ pomylka: Pomylka }>(`/api/pomylki/${v.id}/wznow`,
      { method: "POST", body: JSON.stringify({ wersja: v.wersja }) }),
    onSuccess: (d) => wstawDoList(qc, d.pomylka),
    onError: (e) => { const p = pomylkaZKonfliktu(e); if (p) wstawDoList(qc, p); },
    onSettled: () => poZapisie(qc),
  });
}

/**
 * Usuwa pomyłkę założoną niepotrzebnie, np. gdy klient nie miał racji.
 * Pod blokadą wersji, więc cudza zmiana w międzyczasie daje 409.
 */
export function useUsunPomylke() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: number; wersja: number }) => api<{ usunieto: true }>(`/api/pomylki/${v.id}/usun`,
      { method: "POST", body: JSON.stringify({ wersja: v.wersja }) }),
    onError: (e) => { const p = pomylkaZKonfliktu(e); if (p) wstawDoList(qc, p); },
    onSettled: () => poZapisie(qc),
  });
}

/**
 * Numer pracownika Sellasist jako osoba z naszych kont; `userId: null` zdejmuje
 * przypisanie. Tylko admin — serwer odmawia innym rolom.
 */
export function usePrzypiszPracownikaSellasist() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { sellasistId: number; userId: number | null }) => api<{ zapisano: true }>(
      "/api/pomylki/zlapane/pracownik", { method: "POST", body: JSON.stringify(v) }),
    onSettled: () => qc.invalidateQueries({ queryKey: [KLUCZ_POMYLEK, "zlapane"] }),
  });
}
