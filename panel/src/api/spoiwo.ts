import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./klient";
import type { HistoriaKlienta, MaszynaKlienta, WpisHistorii } from "./typy";

/* ── Ponad kolejkami (23 września 2026) ─────────────────────────────────────
   Kształty z `server/src/services/szukaj-wszedzie.ts` i `klient-historia.ts`.
   Oba odczyty są GET — ani szukanie, ani otwarcie historii niczego nie
   zapisuje. */

export type RodzajTrafienia =
  | "klient" | "rozmowa" | "zwrot" | "reklamacja" | "dyskusja" | "dostawa" | "towar" | "zamowienie";

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

/* ── Profil klienta (24 września 2026) — kształt z `services/profil-klienta.ts` */

export type RodzajSprawyKlienta = "rozmowa" | "zwrot" | "reklamacja" | "dyskusja";

export interface ProfilKlienta {
  login: string;
  liczby: {
    zamowien: number; wydanoGrosze: number; waluta: string | null;
    zwrotow: number; reklamacji: number; dyskusji: number; rozmow: number;
    pierwszyZakup: string | null; ostatniZakup: string | null;
  };
  sygnaly: Array<{ ton: "zle" | "uwaga"; tekst: string; cel: string | null }>;
  otwarte: Array<{ rodzaj: RodzajSprawyKlienta; id: number; opis: string; od: string; stan: string; cel: string }>;
  zamowienia: Array<{
    id: string; kupionoAt: string | null; status: string | null; sumaGrosze: number | null;
    waluta: string | null; pozycje: Array<{ nazwa: string; ilosc: number; cenaGrosze: number }>;
    przesylka: string | null; link: string | null;
  }>;
  maszyny: MaszynaKlienta[];
  os: WpisHistorii[];
  notatka: { tresc: string; at: string; przez: string; cofalna: boolean } | null;
}

const kluczProfilu = (login: string) => ["profil-klienta", login.toLowerCase()] as const;

export function useProfilKlienta(login: string) {
  return useQuery({
    queryKey: kluczProfilu(login),
    queryFn: () => api<ProfilKlienta>(`/api/obsluga/klient/${encodeURIComponent(login)}`),
    retry: false,
  });
}

/** Zapis notatki; `tresc: null` zdejmuje. Po zapisie profil czyta się od nowa. */
export function useNotatkaKlienta(login: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (tresc: string | null) => api(`/api/obsluga/klient/${encodeURIComponent(login)}/notatka`,
      { method: "POST", body: JSON.stringify({ tresc }) }),
    onSettled: () => qc.invalidateQueries({ queryKey: kluczProfilu(login) }),
  });
}

/* Cofnięcie idzie BEZ ciała — reguła klienta HTTP (`CLAUDE.md`): pusty JSON
   to „Bad Request" od Fastify. */
export function useCofnijNotatkeKlienta(login: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api(`/api/obsluga/klient/${encodeURIComponent(login)}/notatka/cofnij`, { method: "POST" }),
    onSettled: () => qc.invalidateQueries({ queryKey: kluczProfilu(login) }),
  });
}
