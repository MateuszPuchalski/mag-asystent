import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Konflikt, api } from "./klient";
import type { SortBezZdjecia } from "./zdjecia";

/* ── TOWARY BEZ WAGI ALBO WYMIARÓW ────────────────────────────────────────
   Lista kartotek Subiekta, którym brakuje wagi albo choć jednego wymiaru,
   i zapis pomiaru. Pomiar idzie do Subiekta tą samą kolejką co reszta
   zapisów. Typy stoją tutaj, bo to kształt tylko dla biura. */

export interface PozycjaBezWymiarow {
  twId: number;
  symbol: string;
  nazwa: string;
  ean: string | null;
  stan: number;
  /** Sztuki sprzedane na FS i PA w ostatnich 30 dniach. */
  sprzedaz: number;
  /** Waga z kartoteki w kg; `null` = brak. */
  masa: number | null;
  /** Surowa treść pól własnych z Subiekta; `null` = puste. */
  dlugosc: string | null;
  szerokosc: string | null;
  wysokosc: string | null;
  /** Pomiar już czeka w kolejce do Subiekta. */
  oczekuje: boolean;
}

export interface ListaBezWymiarow {
  wlaczone: boolean;
  powod?: string;
  razem: number;
  pozycje: PozycjaBezWymiarow[];
}

/** Pomiar z formularza: tekst tak, jak wpisał człowiek. Puste = pole zostaje w Subiekcie. */
export interface Pomiar {
  masaKg: string;
  dlugosc: string;
  szerokosc: string;
  wysokosc: string;
}

export const NA_STRONIE = 50;

export function useBezWymiarow(q: string, offset: number, sortuj: SortBezZdjecia = "sprzedaz",
  naStanie = false, sprzedane = false) {
  const p = new URLSearchParams({ q, limit: String(NA_STRONIE), offset: String(offset), sortuj });
  if (naStanie) p.set("naStanie", "1");
  if (sprzedane) p.set("sprzedane", "1");
  return useQuery({
    queryKey: ["wymiary", "bez-wymiarow", q, offset, sortuj, naStanie, sprzedane],
    queryFn: () => api<ListaBezWymiarow>(`/api/wymiary/bez-wymiarow?${p}`),
    /* Poprzednia strona zostaje na ekranie do przyjścia następnej — pusta
       lista na ułamek sekundy przesuwałaby wiersze pod kursorem. */
    placeholderData: keepPreviousData,
  });
}

/** Pomiar → kolejka do Subiekta. Puste pola nie jadą: serwer zostawia je nietknięte. */
export function useZapiszPomiar() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ twId, pomiar }: { twId: number; pomiar: Pomiar }) =>
      api<{ queueId: number }>(`/api/wymiary/${twId}`, {
        method: "POST",
        body: JSON.stringify(Object.fromEntries(Object.entries(pomiar).filter(([, v]) => v.trim() !== ""))),
      }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["wymiary"] }); },
    /* 409: funkcję wyłączono w trakcie pracy. Lista dowie się o tym od serwera
       i zamieni ekran w wyjaśnienie, zamiast zostawić martwy formularz. */
    onError: (e) => { if (e instanceof Konflikt) void qc.invalidateQueries({ queryKey: ["wymiary"] }); },
  });
}
