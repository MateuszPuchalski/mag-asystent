import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./klient";

/* ── Szukanie zgubionego kolektora ─────────────────────────────────────
   Wzór typów stoi na serwerze obok funkcji, która je liczy:
   `server/src/services/szukanie-kolektora.ts`. Oba zapisy idą BEZ CIAŁA —
   trasa go nie czyta, a pusty JSON z typem treści to gołe „Bad Request". */

export interface WezwanieKolektora {
  przez: string;
  od: string;
  doKiedy: string;
  odebrane: boolean;
}

export interface Kolektor {
  deviceId: string;
  etykieta: string;
  osoba: string | null;
  zalogowany: boolean;
  ostatnioWidziany: string | null;
  slucha: boolean;
  wezwanie: WezwanieKolektora | null;
}

/* RYTM ZALEŻY OD TEGO, CZY KTOŚ SZUKA. Przy trwającym wezwaniu 5 s: szukający
   stoi w hali z laptopem albo telefonem i czeka na „dzwoni". Bez wezwania
   lista jest tłem, więc 30 s jak reszta stanu systemu. */
export const useKolektory = () => useQuery({
  queryKey: ["kolektory"],
  queryFn: () => api<{ kolektory: Kolektor[] }>("/api/kolektory"),
  refetchInterval: (q) => (q.state.data?.kolektory.some((k) => k.wezwanie) ? 5_000 : 30_000),
});

export function useSzukanieKolektora() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ deviceId, ruch }: { deviceId: string; ruch: "wezwij" | "odwolaj" }) =>
      api<{ ok: boolean }>(`/api/kolektory/${encodeURIComponent(deviceId)}/${ruch}`, { method: "POST" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["kolektory"] }),
  });
}
