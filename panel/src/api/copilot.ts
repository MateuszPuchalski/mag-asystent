import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./klient";
import { klucze } from "./rozmowy";
import type { PomiarCopilota, StanCopilota, WynikPartii } from "./typy";

/* ── Copilot: rozpoznanie, o co pyta klient (§14, etap F) ────────────────────
   Osobny plik, nie dopisek do `rozmowy.ts`: tamten ma już ponad dwadzieścia
   haków, a Copilot będzie rósł o kolejne zadania etapu F. Klucze cache
   dokładamy do JEDNEJ mapy w `rozmowy.ts` — druga mapa rozjechałaby się
   z pierwszą przy pierwszym unieważnieniu.                                   */

export const kluczeCopilota = {
  stan: ["copilot"] as const,
  pomiar: ["copilot-pomiar"] as const,
};

/**
 * Czy da się kliknąć i ile bierze jedno kliknięcie.
 *
 * `staleTime: Infinity`, bo to jest odczyt KONFIGURACJI — zmienia się przy
 * restarcie usługi, nie w trakcie zmiany agenta. Odpytywanie tego zegarem
 * byłoby ruchem po nic.
 */
export function useCopilot() {
  return useQuery({
    queryKey: kluczeCopilota.stan,
    queryFn: () => api<StanCopilota>("/api/obsluga/copilot"),
    staleTime: Infinity,
  });
}

/** Pomiar zza zębatki. Odpytywany dopiero, gdy ktoś otworzy ustawienia. */
export function usePomiarCopilota(wlaczone = true) {
  return useQuery({
    queryKey: kluczeCopilota.pomiar,
    queryFn: () => api<PomiarCopilota>("/api/obsluga/copilot/pomiar"),
    enabled: wlaczone,
  });
}

/**
 * Partia rozpoznania.
 *
 * Unieważnia LISTĘ, nie pojedyncze rozmowy: partia dotyka kilkunastu wierszy
 * naraz, a plakietki siedzą właśnie na liście. Unieważnienie leci także po
 * przerwaniu limitem — wcześniejsze wyniki zostały zapisane i zapłacone,
 * więc ekran ma je pokazać, a nie wyrzucić.
 */
export function useKlasyfikuj() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { rozmowyId: number[] }) =>
      api<WynikPartii>("/api/obsluga/copilot/klasyfikacja",
        { method: "POST", body: JSON.stringify(v) }),
    onSettled: (_d, _e, v) => {
      qc.invalidateQueries({ queryKey: klucze.rozmowy });
      qc.invalidateQueries({ queryKey: kluczeCopilota.pomiar });
      /* Otwarta rozmowa ma własny klucz i własną plakietkę w nagłówku. Bez
         tego agent widziałby świeżą etykietę na liście i pustkę obok tekstu,
         który właśnie czyta. */
      for (const id of v.rozmowyId) qc.invalidateQueries({ queryKey: klucze.rozmowa(id) });
    },
  });
}

/** Werdykt człowieka. Unieważnia rozmowę I pomiar — to on jest pomiarem. */
export function useOcenKlasyfikacje() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { rozmowaId: number; ocena: "trafna" | "nietrafna" }) =>
      api<{ ocena: string }>(`/api/obsluga/copilot/klasyfikacja/${v.rozmowaId}/ocena`,
        { method: "POST", body: JSON.stringify({ ocena: v.ocena }) }),
    onSettled: (_d, _e, v) => {
      qc.invalidateQueries({ queryKey: klucze.rozmowy });
      qc.invalidateQueries({ queryKey: klucze.rozmowa(v.rozmowaId) });
      qc.invalidateQueries({ queryKey: kluczeCopilota.pomiar });
    },
  });
}
