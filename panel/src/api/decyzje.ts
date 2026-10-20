import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./klient";

/* ── DO DECYZJI (0.435.0) ──────────────────────────────────────────────────
   Kształt z `server/src/services/do-decyzji.ts` — tam stoi całe uzasadnienie:
   lista liczona w locie, bez własnej tabeli i bez własnego „załatwione". */

export type Obszar = "magazyn" | "obsluga";

export type ZrodloDecyzji =
  | "dostawy" | "odpowiedzi" | "kosze" | "zapisy" | "kody" | "allegro"
  | "reklamacje" | "zwroty" | "skrzynka" | "dyskusje" | "sonda" | "zadania" | "dosylki" | "braki";

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
  /** Druga linijka wiersza, gdy decyzja potrzebuje kontekstu, np. reszta zamówienia przy braku. */
  szczegol?: string;
  /**
   * Przycisk przy wierszu: „Śledź dosyłkę” przy odmowie z panelu Allegro
   * i „Klient powiadomiony” przy braku z kompletacji. Oba rejestrują
   * rozstrzygnięcie, które zapadło gdzie indziej.
   */
  akcja?: AkcjaDecyzji;
}

export type AkcjaDecyzji =
  | { rodzaj: "sledz_dosylke"; zwrotId: number }
  /** `statusAt` wraca do serwera bez zmian. `allegro` to adres zamówienia w Allegro albo `null` bez konfiguracji. */
  | { rodzaj: "brak_powiadomiony"; zamowienieId: number; statusAt: string; allegro: string | null };

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

/**
 * „Klient powiadomiony” przy braku z kompletacji — trasa z `routes/sellasist.ts`.
 *
 * Hak mieszka przy liście, nie przy wglądzie Sellasist na profilu. Wołającym
 * jest tylko ten wiersz, a skutek widać tylko na tej liście. `statusAt` to
 * wejście w status, które ekran widział. Nowsze wejście serwer odrzuca 409,
 * żeby kliknięcie nie odhaczyło braku, którego agent nie widział.
 *
 * Lista odświeża się PO SUKCESIE i hak na to czeka. Przycisk gaśnie dopiero,
 * gdy wiersz już zszedł, więc drugiego kliknięcia nie ma. Po błędzie listy
 * nie ruszamy: wiersz z nowym wejściem dostałby nowy klucz i komunikat
 * zniknąłby, zanim ktoś go przeczyta. Stan bieżący przyniesie odświeżenie
 * co pół minuty.
 */
export function useKlientPowiadomiony() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { zamowienieId: number; statusAt: string }) =>
      api<{ ok: true }>(`/api/obsluga/sellasist/braki/${v.zamowienieId}/powiadomiony`,
        { method: "POST", body: JSON.stringify({ statusAt: v.statusAt }) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["do-decyzji"] }),
  });
}
