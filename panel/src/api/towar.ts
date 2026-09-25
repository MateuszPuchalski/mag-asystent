import { useQuery } from "@tanstack/react-query";
import { api } from "./klient";

/* ── Przekrój towaru (0.502.0) — `server/src/services/przekroj-towaru.ts` ── */

export interface PrzekrojTowaru {
  twId: number;
  oferty: Array<{ konto: number; ofertaId: string; nazwa: string | null }>;
  otwarteZwroty: Array<{ id: number; numer: string | null; at: string; ilosc: number }>;
  otwarteSprawy: Array<{ id: number; typ: "CLAIM" | "DISPUTE"; numer: string | null; at: string }>;
  otwarteRozmowy: Array<{ id: number; temat: string | null; at: string }>;
  okno: { dni: number; sprzedanych: number; zwroconych: number; reklamacji: number; udzialZwrotow: number | null };
}

export function usePrzekrojTowaru(twId: number | null) {
  return useQuery({
    queryKey: ["towar", "przekroj", twId ?? 0],
    queryFn: () => api<PrzekrojTowaru>(`/api/obsluga/towar/${twId}/przekroj`),
    enabled: twId !== null,
  });
}
