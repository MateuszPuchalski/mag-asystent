import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./klient";
import type { Tag } from "./typy";

/* ── Słownik tagów ───────────────────────────────────────────────────────────
   Słownik ma własny klucz cache i własny plik, bo żyje za zębatką, a nie
   przy żadnej kolejce. Wiersze kolejek tagów nie niosą, więc zmiana nazwy
   unieważnia wyłącznie słownik. Odświeżona lista nie miałaby czego pokazać. */

export const kluczeTagow = { slownik: ["tagi"] as const };

export function useTagi() {
  return useQuery({
    queryKey: kluczeTagow.slownik,
    queryFn: () => api<{ tagi: Tag[] }>("/api/obsluga/tagi"),
  });
}

/** Zmiana nazwy albo stanu — jedna trasa, bo to jeden wiersz słownika. */
export function useZmienTag() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { tagId: number; nazwa?: string; aktywny?: boolean }) =>
      api<{ tag: Tag }>(`/api/obsluga/tagi/${v.tagId}`, {
        method: "PATCH",
        body: JSON.stringify(v.nazwa !== undefined
          ? { nazwa: v.nazwa } : { aktywny: v.aktywny }),
      }),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: kluczeTagow.slownik });
    },
  });
}
