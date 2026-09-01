import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./klient";
import type { OsRozmowy, Rozmowa, StanSkrzynki, WynikWysylki, Zadanie, Zdrowie } from "./typy";

/* Klucze cache w jednym miejscu. Literał rozsypany po plikach kończy się tym,
   że unieważnienie mija się z zapytaniem o jedną literę — i ekran pokazuje
   stare dane bez żadnego objawu. */
export const klucze = {
  rozmowy: ["rozmowy"] as const,
  rozmowa: (id: number) => ["rozmowa", id] as const,
  zadania: ["zadania"] as const,
  ja: ["ja"] as const,
  zdrowie: ["zdrowie"] as const,
};

export function useJa() {
  return useQuery({
    queryKey: klucze.ja,
    queryFn: () => api<{ user: { userId: number; name: string; role: string } }>("/api/auth/me"),
    staleTime: Infinity,
  });
}

export function useRozmowy() {
  return useQuery({
    queryKey: klucze.rozmowy,
    queryFn: () => api<{ rozmowy: Rozmowa[]; stan: StanSkrzynki }>("/api/obsluga/rozmowy"),
  });
}

export function useRozmowa(id: number | null) {
  return useQuery({
    queryKey: klucze.rozmowa(id ?? 0),
    queryFn: () => api<OsRozmowy>(`/api/obsluga/rozmowy/${id}`),
    enabled: id !== null,
  });
}

export function useZadania() {
  return useQuery({
    queryKey: klucze.zadania,
    queryFn: () => api<{ zadania: Zadanie[] }>("/api/zadania-terenowe"),
  });
}

/**
 * Przejęcie rozmowy.
 *
 * Konflikt NIE jest tu łapany: `Konflikt` leci do wołającego, bo ekran ma go
 * narysować kafelkami z właścicielem i wersją, a nie zamienić w komunikat.
 */
export function usePrzejmij() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: number; expectedVersion: number }) =>
      api(`/api/conversations/${v.id}/claim`, {
        method: "POST", body: JSON.stringify({ expectedVersion: v.expectedVersion }),
      }),
    onSettled: (_d, _e, v) => {
      qc.invalidateQueries({ queryKey: klucze.rozmowy });
      qc.invalidateQueries({ queryKey: klucze.rozmowa(v.id) });
    },
  });
}

/* Szkic jest współdzielony, więc zapis jest jawny i niesie wersję. Cicha
   autozapisywarka gubiłaby cudzą pracę przy dwóch agentach na jednej sprawie. */
export function useZapiszSzkic() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: number; body: string; expectedLastMessageId: number | null; expectedVersion: number | null }) =>
      api<{ version: number }>(`/api/conversations/${v.id}/draft`, {
        method: "PUT",
        body: JSON.stringify({
          body: v.body,
          expectedLastMessageId: v.expectedLastMessageId,
          expectedVersion: v.expectedVersion,
        }),
      }),
    onSettled: (_d, _e, v) => qc.invalidateQueries({ queryKey: klucze.rozmowa(v.id) }),
  });
}

export function useZlecPomiar() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { rozmowaId: number; wiadomoscId: number; instrukcja: string; twId: number | null }) =>
      api("/api/obsluga/zadania/pomiar", { method: "POST", body: JSON.stringify(v) }),
    onSettled: (_d, _e, v) => {
      qc.invalidateQueries({ queryKey: klucze.rozmowa(v.rozmowaId) });
      qc.invalidateQueries({ queryKey: klucze.zadania });
    },
  });
}

export function useNoweZadanie() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: Record<string, unknown>) =>
      api("/api/zadania-terenowe", { method: "POST", body: JSON.stringify({ ...v, zrodlo: "panel" }) }),
    onSettled: () => qc.invalidateQueries({ queryKey: klucze.zadania }),
  });
}

/**
 * Stan integracji z `/api/health` (§21).
 *
 * Odpytujemy zegarem, nie szyną zdarzeń: awaria synchronizacji objawia się
 * właśnie tym, że żadne zdarzenie nie przychodzi. Ekran, który czeka na
 * sygnał od zepsutego nadawcy, milczy razem z nim.
 */
export function useZdrowie() {
  return useQuery({
    queryKey: klucze.zdrowie,
    queryFn: () => api<Zdrowie>("/api/health"),
    refetchInterval: 30_000,
    staleTime: 0,
  });
}

export function useSynchronizuj() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api("/api/obsluga/synchronizuj", { method: "POST" }),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: klucze.zdrowie });
      qc.invalidateQueries({ queryKey: klucze.rozmowy });
    },
  });
}

/** Wymuszone przekazanie — odebranie rozmowy komuś z rąk. Powód obowiązkowy. */
export function usePrzekaz() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: number; doUserId: number | null; powod: string; expectedVersion: number }) =>
      api(`/api/conversations/${v.id}/assign`, {
        method: "POST",
        body: JSON.stringify({ doUserId: v.doUserId, powod: v.powod, expectedVersion: v.expectedVersion }),
      }),
    onSettled: (_d, _e, v) => {
      qc.invalidateQueries({ queryKey: klucze.rozmowy });
      qc.invalidateQueries({ queryKey: klucze.rozmowa(v.id) });
    },
  });
}

export function useWskazOferte() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: number; ofertaId: string }) =>
      api(`/api/conversations/${v.id}/oferta`, {
        method: "POST", body: JSON.stringify({ ofertaId: v.ofertaId }),
      }),
    onSettled: (_d, _e, v) => qc.invalidateQueries({ queryKey: klucze.rozmowa(v.id) }),
  });
}

/**
 * Wysyłka odpowiedzi do klienta (§8.5).
 *
 * Konflikt świeżości NIE jest tu łapany: `Konflikt` leci do ekranu, bo to on
 * ma pokazać dopisek klienta obok szkicu i poprosić o jawną zgodę.
 */
export function useWyslij() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: {
      id: number; body: string; expectedVersion: number;
      expectedLastMessageId: number | null; mimoNowejWiadomosci?: boolean;
    }) => api<WynikWysylki>(`/api/conversations/${v.id}/send`, {
      method: "POST",
      body: JSON.stringify({
        body: v.body, expectedVersion: v.expectedVersion,
        expectedLastMessageId: v.expectedLastMessageId,
        mimoNowejWiadomosci: Boolean(v.mimoNowejWiadomosci),
      }),
    }),
    onSettled: (_d, _e, v) => {
      qc.invalidateQueries({ queryKey: klucze.rozmowa(v.id) });
      qc.invalidateQueries({ queryKey: klucze.rozmowy });
    },
  });
}

/**
 * Komentarz wewnętrzny (0.157.0).
 *
 * Do tego wydania `conversation_comment` miała w kodzie serwera jeden INSERT
 * i zero odczytów — notatka agenta przepadała. Trasa istniała, ekranu nie było.
 */
export function useDodajKomentarz() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { rozmowaId: number; body: string; mentionedUserIds: number[] }) =>
      api<{ id: number }>(`/api/obsluga/rozmowy/${v.rozmowaId}/komentarz`,
        { method: "POST", body: JSON.stringify({
          body: v.body, mentionedUserIds: v.mentionedUserIds }) }),
    onSettled: (_d, _e, v) => {
      qc.invalidateQueries({ queryKey: klucze.rozmowa(v.rozmowaId) });
    },
  });
}

/**
 * Konta do wzmianek — z istniejącej trasy `/api/users`.
 *
 * Bez własnej końcówki: lista kont jest już wystawiona biuru i adminowi,
 * a drugi adres na te same dane znaczyłby dwa miejsca do pilnowania przy
 * zmianie ról.
 */
export function useAgenci() {
  return useQuery({
    queryKey: ["agenci"],
    queryFn: () => api<{ users: Array<{ userId: number; name: string; role: string }> }>("/api/users"),
    staleTime: 5 * 60_000,
    /* Hala nie dostaje listy kont (403) i to jest poprawne — wtedy po prostu
       nie ma kogo wzmiankować, a ekran nie ma prawa się o to wywrócić. */
    retry: false,
  });
}
