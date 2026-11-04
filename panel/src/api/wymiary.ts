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
  /** Adresy półek z kartoteki, rozdzielone spacją; `null` = brak. */
  lokalizacja: string | null;
  /** Wagi z kartoteki w kg (`tw_Masa`, `tw_MasaNetto`); `null` = brak. */
  brutto: number | null;
  netto: number | null;
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
  /** Niezmierzone towary z listy pilnych biura; 0, gdy lista jest pusta. */
  pilneRazem: number;
  pozycje: PozycjaBezWymiarow[];
}

/** Pomiar z formularza: tekst tak, jak wpisał człowiek. Puste = pole zostaje w Subiekcie. */
export interface Pomiar {
  bruttoKg: string;
  nettoKg: string;
  dlugosc: string;
  szerokosc: string;
  wysokosc: string;
}

export const NA_STRONIE = 50;

/** Porządki listy wymiarów: te z listy bez zdjęcia i obchód po regałach. */
export type SortWymiarow = SortBezZdjecia | "lokalizacja";

/** Początek symbolu jak na kolektorze: bez spacji z brzegów, wielkimi literami. */
export const poczatekSymbolu = (wpis: string) => wpis.trim().toUpperCase().slice(0, 100);

export function useBezWymiarow(q: string, offset: number, sortuj: SortWymiarow = "sprzedaz",
  naStanie = false, sprzedane = false, symbolOd = "", pilne = false) {
  const p = new URLSearchParams({ q, limit: String(NA_STRONIE), offset: String(offset), sortuj });
  if (naStanie) p.set("naStanie", "1");
  if (sprzedane) p.set("sprzedane", "1");
  if (pilne) p.set("pilne", "1");
  // pusty początek nie jedzie wcale, tak jak flagi: serwer czyta brak jako „bez filtra"
  if (symbolOd) p.set("symbolOd", symbolOd);
  return useQuery({
    queryKey: ["wymiary", "bez-wymiarow", q, offset, sortuj, naStanie, sprzedane, symbolOd, pilne],
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

/* ── LISTA PILNYCH ────────────────────────────────────────────────────────
   Biuro wkleja z Excela symbole, które trzeba zważyć i zmierzyć najpierw.
   Normalizuje serwer; tu jest tylko odczyt i zapis całej listy naraz. */

export interface ListaPilnych { symbole: string[] }

/** Nagłówek kolumny z Excela, który wkleja się razem z symbolami. */
const NAGLOWEK = new Set(["WERTIS", "NO."]);

/**
 * Symbole z wklejonego tekstu, policzone tak jak serwer: po białych znakach,
 * przecinkach i średnikach, wielkimi literami, bez powtórzeń. Liczba w oknie
 * ma się zgadzać z tym, co zapisze serwer, zanim człowiek kliknie „Zapisz".
 */
export function rozpoznajSymbole(tekst: string): string[] {
  const slowa = tekst.split(/[\s,;]+/).map((s) => s.trim().toUpperCase()).filter((s) => s && !NAGLOWEK.has(s));
  return [...new Set(slowa)];
}

/** Odczyt listy pilnych. Woła go tylko otwarte okno, więc ekran listy nie płaci za niego. */
export function useListaPilnych() {
  return useQuery({
    queryKey: ["wymiary", "pilne"],
    queryFn: () => api<ListaPilnych>("/api/wymiary/pilne"),
  });
}

/** Zapis całej listy pilnych; pusta tablica czyści listę. */
export function useZapiszPilne() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (symbole: string[]) =>
      api<ListaPilnych>("/api/wymiary/pilne", { method: "PUT", body: JSON.stringify({ symbole }) }),
    /* Całe `wymiary`, bo nowa lista zmienia licznik filtra i zawartość listy pod nim. */
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["wymiary"] }); },
  });
}
