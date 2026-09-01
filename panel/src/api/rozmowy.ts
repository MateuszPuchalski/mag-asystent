import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./klient";
import type {
  OsRozmowy, Rozmowa, StanSkrzynki, StatusRozmowy, WynikWysylki, Zadanie, Zdrowie,
} from "./typy";

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
      expectedLastMessageId: number | null;
      mimoNowejWiadomosci?: boolean; mimoObecnosci?: boolean;
    }) => api<WynikWysylki>(`/api/conversations/${v.id}/send`, {
      method: "POST",
      body: JSON.stringify({
        body: v.body, expectedVersion: v.expectedVersion,
        expectedLastMessageId: v.expectedLastMessageId,
        mimoNowejWiadomosci: Boolean(v.mimoNowejWiadomosci),
        mimoObecnosci: Boolean(v.mimoObecnosci),
      }),
    }),
    onSettled: (_d, _e, v) => {
      qc.invalidateQueries({ queryKey: klucze.rozmowa(v.id) });
      qc.invalidateQueries({ queryKey: klucze.rozmowy });
    },
  });
}

/* ── Status rozmowy (0.157.0) ────────────────────────────────────────────────
   Trzy mutacje, bo trzy różne decyzje. Wszystkie unieważniają OBIE listy:
   kubełki liczą się z tej samej odpowiedzi co wiersze, więc odświeżenie
   jednego bez drugiego pokazałoby liczbę przy zakładce niezgodną z jej
   zawartością — i to jest ten gatunek rozjazdu, którego nikt nie zgłasza. */

const odswiez = (qc: ReturnType<typeof useQueryClient>, id: number) => {
  qc.invalidateQueries({ queryKey: klucze.rozmowy });
  qc.invalidateQueries({ queryKey: klucze.rozmowa(id) });
};

/** Odłożenie z terminem powrotu. Bez terminu byłoby ukrytym zamknięciem. */
export function useOdloz() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: number; do: string; expectedVersion: number }) =>
      api<{ status: StatusRozmowy; version: number }>(`/api/conversations/${v.id}/snooze`, {
        method: "POST", body: JSON.stringify({ do: v.do, expectedVersion: v.expectedVersion }),
      }),
    onSettled: (_d, _e, v) => odswiez(qc, v.id),
  });
}

/** Najczęstsza decyzja dnia, więc ma własną trasę i jedno kliknięcie. */
export function useZalatw() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: number; expectedVersion: number }) =>
      api<{ status: StatusRozmowy; version: number }>(`/api/conversations/${v.id}/resolve`, {
        method: "POST", body: JSON.stringify({ expectedVersion: v.expectedVersion }),
      }),
    onSettled: (_d, _e, v) => odswiez(qc, v.id),
  });
}

/** Zamknięcie, spam i POWRÓT do `open` — cofnięcie każdej z tych decyzji. */
export function useUstawStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: number; status: StatusRozmowy; powod?: string; expectedVersion: number }) =>
      api<{ status: StatusRozmowy; version: number }>(`/api/conversations/${v.id}/status`, {
        method: "POST",
        body: JSON.stringify({ status: v.status, powod: v.powod, expectedVersion: v.expectedVersion }),
      }),
    onSettled: (_d, _e, v) => odswiez(qc, v.id),
  });
}

/* ── Uchwyt rozmowy (0.158.0) ────────────────────────────────────────────────
   Samo wejście w pytanie przydziela je agentowi NA CZAS SIEDZENIA; odpowiedź
   przydziela na stałe. Uchwyt żyje w pamięci serwera i wygasa bez znaku
   życia, więc panel musi bić sercem i musi się wymeldować przy wyjściu.

   Odstęp jest TRZYKROTNIE krótszy od czasu życia uchwytu po stronie serwera:
   jedno zgubione żądanie nie ma prawa oddać rozmowy komuś innemu w połowie
   pisania odpowiedzi. */
const BICIE_MS = 15_000;

export function useUchwytRozmowy(id: number | null) {
  useEffect(() => {
    if (id === null) return;
    const melduj = (obecny: boolean) => api(`/api/conversations/${id}/presence`, {
      method: "POST", body: JSON.stringify({ obecny }),
      /* `keepalive` po to, żeby wymeldowanie doszło także wtedy, gdy karta
         znika. Bez niego przeglądarka przerywa żądanie w locie, a rozmowa
         zostaje zablokowana do końca czasu życia uchwytu. */
      keepalive: !obecny,
    }).catch(() => {});

    void melduj(true);
    const zegar = setInterval(() => void melduj(true), BICIE_MS);
    const naZamkniecie = () => void melduj(false);
    window.addEventListener("pagehide", naZamkniecie);

    return () => {
      clearInterval(zegar);
      window.removeEventListener("pagehide", naZamkniecie);
      void melduj(false);
    };
  }, [id]);
}
