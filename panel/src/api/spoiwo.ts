import { useQuery } from "@tanstack/react-query";
import { api } from "./klient";
import type { HistoriaKlienta } from "./typy";

/* ── Ponad kolejkami (23 września 2026) ─────────────────────────────────────
   Kształty z `server/src/services/szukaj-wszedzie.ts` i `klient-historia.ts`.
   Oba odczyty są GET — ani szukanie, ani otwarcie historii niczego nie
   zapisuje. */

export type RodzajTrafienia =
  | "rozmowa" | "zwrot" | "reklamacja" | "dyskusja" | "dostawa" | "towar" | "zamowienie";

export interface Trafienie {
  rodzaj: RodzajTrafienia;
  id: string;
  tytul: string;
  dlaczego: string;
  cel: string | null;
  link: string | null;
}

/** Fraza krótsza niż trzy znaki nie odpytuje serwera — i tak by nic nie oddał. */
export function useSzukajWszedzie(fraza: string) {
  return useQuery({
    queryKey: ["szukaj", fraza],
    queryFn: () => api<{ trafienia: Trafienie[] }>(`/api/obsluga/szukaj?q=${encodeURIComponent(fraza)}`),
    enabled: fraza.trim().length >= 3,
    placeholderData: (poprzednie) => poprzednie,
    staleTime: 30_000,
  });
}

/**
 * Historia kupującego ze zwrotu albo ze sprawy. Pobiera się dopiero po
 * otwarciu szuflady (`wlaczona`) — sama sprawa na ekranie jej nie potrzebuje.
 */
export function useHistoriaSprawy(rodzaj: "zwrot" | "sprawa", id: number, wlaczona: boolean) {
  return useQuery({
    queryKey: ["historia-sprawy", rodzaj, id],
    queryFn: () => api<HistoriaKlienta>(rodzaj === "zwrot"
      ? `/api/obsluga/zwroty/${id}/klient` : `/api/obsluga/sprawy/${id}/klient`),
    enabled: wlaczona,
  });
}
