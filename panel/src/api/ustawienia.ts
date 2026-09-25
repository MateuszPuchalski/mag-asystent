import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./klient";

/* ── Ustawienia biura (0.444.0) ────────────────────────────────────────
   Przeniesione z widoku za zębatką w `biuro.html`. Trasy są TE SAME, którymi
   jeździło biuro, z jednym wyjątkiem: dane firmy mieszkały w localStorage
   i dopiero to wydanie dało im trasę (`/api/biuro/firma`). Wzory typów leżą
   na serwerze: `services/firma.ts`, `routes/zbiorki.ts`, `services/users.ts`,
   `services/auth.ts` i `services/logo-dostawcy.ts`.

   Ekran otwiera się SAMYMI odczytami. Każdy zapis stoi za przyciskiem,
   także przeniesienie danych firmy z przeglądarki — reguła „zero zapisu
   przy patrzeniu" nie zna wyjątku dla wygody. */

/* ── Dane firmy ────────────────────────────────────────────────────────── */

export const POLA_FIRMY = ["nazwa", "nip", "adres", "miejscowosc", "osoba", "telefon"] as const;
export type PoleFirmy = (typeof POLA_FIRMY)[number];
export type DaneFirmy = Record<PoleFirmy, string>;
export interface StanFirmy { dane: DaneFirmy; zmieniono: { at: string; przez: string } | null }

/* Dane zmieniają się kilka razy w roku; minuta świeżości wystarcza, a druk
   protokołu nie pyta serwera przy każdym przerysowaniu. */
export const useFirma = () => useQuery({
  queryKey: ["firma"],
  queryFn: () => api<StanFirmy>("/api/biuro/firma"),
  staleTime: 60_000,
});

export function useZapiszFirme() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (dane: DaneFirmy) =>
      api<StanFirmy>("/api/biuro/firma", { method: "PUT", body: JSON.stringify(dane) }),
    onSuccess: (s) => qc.setQueryData(["firma"], s),
  });
}

/* ── Reguły strefy złotej ─────────────────────────────────────────────── */

/** Kształt edytora z serwera: poziomy jako tekst „2,3", nie tablica. */
export interface RegulaStrefy { alejka: string; od: string; do: string; poziomy: string }

export const useStrefa = () => useQuery({
  queryKey: ["strefa"],
  queryFn: () => api<{ reguly: RegulaStrefy[] }>("/api/biuro/strefa"),
});

export function useZapiszStrefe() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (reguly: RegulaStrefy[]) =>
      api<{ ok: boolean; regul: number }>("/api/biuro/strefa", { method: "PUT", body: JSON.stringify({ reguly }) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["strefa"] });
      /* Serwer przy zapisie zeruje ranking kandydatów — lista w analizie
         ma się policzyć od nowa, a nie pokazać ranking sprzed zmiany. */
      qc.invalidateQueries({ queryKey: ["kandydaciStrefy"] });
    },
  });
}

/* ── Konta i sesje ─────────────────────────────────────────────────────── */

export interface Konto {
  userId: number;
  /** `null` = konto-ślad z historii: audyt ma na co wskazywać, zalogować się nie da. */
  login: string | null;
  name: string;
  role: string;
  active: boolean;
  maHaslo: boolean;
}

export interface SesjaKonta { deviceId: string | null; createdAt: string; lastSeen: string | null }

/* KLUCZ WSPÓLNY z `useAgenci` (wzmianki, filtr osoby w dzienniku): ta sama
   trasa i te same dane. Wyłączone konto ma zniknąć z podpowiedzi wzmianek
   po jednym unieważnieniu, a nie po pięciu minutach świeżości tamtej listy. */
export const useKonta = () => useQuery({
  queryKey: ["agenci"],
  queryFn: () => api<{ users: Konto[] }>("/api/users"),
  retry: false,
});

/** Sesje pobierane NA ŻĄDANIE — trasa jest adminowa, a lista kont nie. */
export const useSesje = (userId: number | null) => useQuery({
  queryKey: ["sesje", userId],
  queryFn: () => api<{ sesje: SesjaKonta[] }>(`/api/users/${userId}/sesje`),
  enabled: userId != null,
  retry: false,
});

export function useWylogujWszedzie() {
  const qc = useQueryClient();
  return useMutation({
    /* Bez ciała: trasa go nie czyta, a pusty JSON z typem treści to 400
       (reguła z `klient.ts`). Biuro wysyłało tu „{}". */
    mutationFn: (userId: number) =>
      api<{ ok: boolean; sesji: number }>(`/api/users/${userId}/wyloguj`, { method: "POST" }),
    onSuccess: (_d, userId) => qc.invalidateQueries({ queryKey: ["sesje", userId] }),
  });
}

export const useResetHasla = () => useMutation({
  mutationFn: ({ userId, haslo }: { userId: number; haslo: string }) =>
    api<{ ok: boolean }>(`/api/users/${userId}/haslo`, { method: "POST", body: JSON.stringify({ haslo }) }),
});

export type RolaKonta = "magazynier" | "biuro" | "admin";

/* Zakładanie konta z panelu (0.490.0). Dotąd tylko kreator na kolektorze albo
   `curl`. Bramkę ról trzyma serwer: biuro zakłada halę, konta biura i admina
   zakłada admin — ekran tylko nie proponuje ról, których serwer odmówi. */
export function useZalozKonto() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (k: { name: string; login: string; haslo: string; role: RolaKonta }) =>
      api<{ user: Konto }>("/api/users", { method: "POST", body: JSON.stringify(k) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["agenci"] }),
  });
}

export function useAktywnosc() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, active }: { userId: number; active: boolean }) =>
      api<{ ok: boolean }>(`/api/users/${userId}/active`, { method: "POST", body: JSON.stringify({ active }) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["agenci"] }),
  });
}

/* ── Konfiguracja serwera (0.488.0) ────────────────────────────────────── */

export type ZrodloUstawienia = "plik" | "przykryte" | "srodowisko" | "domyslna";

export interface WierszKonfiguracji {
  klucz: string;
  grupa: string;
  kto: "instalator" | "wlasciciel" | "zaawansowane" | "dev";
  opis: string;
  czyta: string[];
  tajny: boolean;
  zrodlo: ZrodloUstawienia;
  /** `null` dla sekretu i dla wartości domyślnej — serwer nie wysyła ich wcale. */
  wartosc: string | null;
  /** Jak zmienić z panelu (0.491.0); `null` = tylko plik albo instalator. */
  edycja: { rodzaj: "tekst" | "liczba" | "data" | "wybor"; opcje?: string[] } | null;
}

export interface StanKonfiguracji {
  plik: string | null;
  grupy: Record<string, string>;
  wiersze: WierszKonfiguracji[];
  nieznane: string[];
}

/**
 * Zmiana jednego klucza (0.491.0). Serwer zapisuje `wertis.env` dopiero po
 * udanej próbie startu i sam się restartuje pod NSSM (`restart: "sam"`).
 * Odświeżenie karty czeka, aż serwer wstanie — wcześniej pokazałaby starą
 * wartość, bo proces czyta plik raz, przy starcie.
 */
export function useZmienUstawienie() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (z: { klucz: string; wartosc: string | null }) =>
      api<{ ok: boolean; klucz: string; restart: "sam" | "reczny" }>("/api/biuro/konfiguracja",
        { method: "POST", body: JSON.stringify(z) }),
    onSuccess: (d) => {
      if (d.restart === "sam") {
        setTimeout(() => void qc.invalidateQueries({ queryKey: ["konfiguracja"] }), 8000);
      }
    },
  });
}

/** Trasa adminowa, więc pytamy tylko jako admin — biuro dostałoby 403. */
export const useKonfiguracja = (admin: boolean) => useQuery({
  queryKey: ["konfiguracja"],
  queryFn: () => api<StanKonfiguracji>("/api/biuro/konfiguracja"),
  enabled: admin,
  retry: false,
});

/* ── Aktualizacja serwera (0.492.0) ────────────────────────────────────
   Wzory typów: `server/src/services/aktualizacja-serwera.ts`. */

export interface WydanieSerwera { wersja: string; opublikowano: string | null; maPaczke: boolean }
export interface SekcjaZmian { wersja: string; tytul: string; tresc: string; wymagaDzialania: boolean }
export interface StanZadaniaAktualizacji {
  etap: "trwa" | "gotowe" | "blad";
  wersja: string;
  kto?: string;
  od?: string;
  do?: string;
  kod?: number;
  komunikat?: string;
}
export interface StanAktualizacji {
  obecna: string;
  sprawdzono: string | null;
  bladSprawdzenia: string | null;
  wydania: WydanieSerwera[];
  zmiany: SekcjaZmian[];
  ostatnia: StanZadaniaAktualizacji | null;
  czekaZlecenie: boolean;
  /** `null` = wolno zlecić; inaczej zdanie, dlaczego nie. */
  blokada: string | null;
  /** Decyzja automatu (0.494.0) — `services/aktualizacja-auto.ts`. */
  auto?: {
    tryb: "noc" | "zaraz" | "wylaczona";
    okno: { od: number; do: number };
    dojrzaloscGodz: number;
    kanarek: string | null;
    kandydat: string | null;
    teraz: boolean;
    powod: string;
  };
}

/** W trakcie aktualizacji serwer znika na minutę albo dwie — pytamy co pięć
 *  sekund i nie traktujemy chwilowej odmowy jako końca świata. */
const trwa = (s: StanAktualizacji | undefined) => !!s && (s.czekaZlecenie || s.ostatnia?.etap === "trwa");

/** Trasa adminowa, więc pytamy tylko jako admin — biuro dostałoby 403. */
export const useAktualizacja = (admin: boolean) => useQuery({
  queryKey: ["aktualizacja"],
  queryFn: () => api<StanAktualizacji>("/api/biuro/aktualizacja"),
  enabled: admin,
  retry: false,
  refetchInterval: (q) => (trwa(q.state.data) ? 5000 : false),
});

/** Bez ciała, więc bez typu treści — reguła klienta HTTP z CLAUDE.md. */
export function useSprawdzWydania() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api<StanAktualizacji>("/api/biuro/aktualizacja/sprawdz", { method: "POST" }),
    onSuccess: (d) => qc.setQueryData(["aktualizacja"], d),
  });
}

export function useZlecAktualizacje() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (z: { wersja: string; haslo: string }) =>
      api<{ ok: boolean; wersja: string }>("/api/biuro/aktualizacja", { method: "POST", body: JSON.stringify(z) }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["aktualizacja"] }),
  });
}

/* ── Nowy kolektor (@wydanie) ──────────────────────────────────────────── */

export interface DaneKolektora { adresy: string[]; port: number; apk: { wersja: string | null } | null }

/** Trasa biura — hala jej nie dostaje, więc pytamy tylko jako biuro albo admin. */
export const useKolektor = (biuro: boolean) => useQuery({
  queryKey: ["kolektor"],
  queryFn: () => api<DaneKolektora>("/api/biuro/kolektor"),
  enabled: biuro,
  retry: false,
});

/* ── Logo dostawców ───────────────────────────────────────────────────── */

export interface DostawcaZLogo { khId: number; nazwa: string; dokumentow: number; maLogo: boolean }

export const useDostawcy = () => useQuery({
  queryKey: ["dostawcyLogo"],
  queryFn: () => api<{ dostawcy: DostawcaZLogo[] }>("/api/biuro/dostawcy"),
});

export function useZapiszLogo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ khId, nazwa, logoBase64 }: { khId: number; nazwa: string; logoBase64: string }) =>
      api<{ etag: string; bajtow: number }>(`/api/biuro/dostawcy/${khId}/logo`, {
        method: "PUT", body: JSON.stringify({ nazwa, logoBase64 }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["dostawcyLogo"] }),
  });
}

export function useUsunLogo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (khId: number) =>
      api<{ ok: boolean }>(`/api/biuro/dostawcy/${khId}/logo`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["dostawcyLogo"] }),
  });
}
