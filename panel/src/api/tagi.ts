import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./klient";
import type { Tag } from "./typy";
import { kluczeReklamacji } from "./reklamacje";
import { kluczeZwrotow } from "./zwroty";

/* ── Słownik tagów ───────────────────────────────────────────────────────────
   SŁOWNIK JEST JEDEN dla reklamacji i zwrotów, więc ma własny klucz cache
   i własny plik.

   Unieważniamy OBIE kolejki po każdej zmianie. Tag zmieniony przy reklamacji
   bywa tym samym tagiem, który filtruje zwroty — a kolejka pokazująca starą
   nazwę byłaby drugą wersją prawdy, nie opóźnieniem.                        */

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
      void qc.invalidateQueries({ queryKey: kluczeReklamacji.kolejka });
      void qc.invalidateQueries({ queryKey: kluczeZwrotow.kolejka });
    },
  });
}
