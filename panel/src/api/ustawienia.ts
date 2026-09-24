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
}

export interface StanKonfiguracji {
  plik: string | null;
  grupy: Record<string, string>;
  wiersze: WierszKonfiguracji[];
  nieznane: string[];
}

/** Trasa adminowa, więc pytamy tylko jako admin — biuro dostałoby 403. */
export const useKonfiguracja = (admin: boolean) => useQuery({
  queryKey: ["konfiguracja"],
  queryFn: () => api<StanKonfiguracji>("/api/biuro/konfiguracja"),
  enabled: admin,
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
