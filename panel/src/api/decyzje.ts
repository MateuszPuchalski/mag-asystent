import { useQuery } from "@tanstack/react-query";
import { api } from "./klient";

/* ── DO DECYZJI (0.435.0) ──────────────────────────────────────────────────
   Kształt z `server/src/services/do-decyzji.ts` — tam stoi całe uzasadnienie:
   lista liczona w locie, bez własnej tabeli i bez własnego „załatwione". */

export type Obszar = "magazyn" | "obsluga";

export type ZrodloDecyzji =
  | "dostawy" | "odpowiedzi" | "kosze" | "zapisy" | "kody" | "allegro"
  | "reklamacje" | "zwroty" | "skrzynka" | "dyskusje" | "sonda" | "zadania";

/** Adres w panelu — od 0.441.0 każdy wiersz prowadzi do ekranu panelu. */
export type CelDecyzji = { panel: string };

export interface PozycjaDecyzji {
  klucz: string;
  obszar: Obszar;
  zrodlo: ZrodloDecyzji;
  pytanie: string;
  co: string;
  od: string | null;
  pilne: boolean;
  cel: CelDecyzji;
}

export function useDoDecyzji() {
  return useQuery({
    queryKey: ["do-decyzji"],
    queryFn: () => api<{ pozycje: PozycjaDecyzji[]; liczniki: Record<"wszystko" | Obszar, number> }>(
      "/api/biuro/do-decyzji"),
    /* Pół minuty, jak lista dostaw: to jest ekran, na którym biuro SIEDZI,
       i sprawa rozstrzygnięta przy innym biurku ma z niego zejść bez klikania. */
    refetchInterval: 30_000,
  });
}
