import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./klient";
import type { Tag } from "./typy";
import { kluczeReklamacji } from "./reklamacje";
import { kluczeDyskusji } from "./dyskusje";

/* ── Słownik tagów i przypięcia (0.279.0) ────────────────────────────────────
   SŁOWNIK JEST JEDEN dla reklamacji i dyskusji, więc ma własny klucz cache
   i własny plik. Przypięcie idzie pod adres SPRAWY, bo tam stoi bramka roli
   i tam sprawa ma swój rodzaj.

   Unieważniamy OBIE kolejki po każdej zmianie. Tag zmieniony przy reklamacji
   bywa tym samym tagiem, który filtruje dyskusje — a kolejka pokazująca starą
   nazwę byłaby drugą wersją prawdy, nie opóźnieniem.                        */

export const kluczeTagow = { slownik: ["tagi"] as const };

export function useTagi() {
  return useQuery({
    queryKey: kluczeTagow.slownik,
    queryFn: () => api<{ tagi: Tag[] }>("/api/obsluga/tagi"),
  });
}

/** Rodzaj sprawy rozstrzyga tylko ADRES — reszta jest wspólna. */
export type RodzajSprawy = "reklamacje" | "dyskusje";

function useOdswiezWszystko() {
  const qc = useQueryClient();
  return (id: number, rodzaj: RodzajSprawy) => {
    void qc.invalidateQueries({ queryKey: kluczeTagow.slownik });
    void qc.invalidateQueries({ queryKey: kluczeReklamacji.kolejka });
    void qc.invalidateQueries({ queryKey: kluczeDyskusji.kolejka });
    void qc.invalidateQueries({
      queryKey: rodzaj === "reklamacje"
        ? kluczeReklamacji.reklamacja(id) : kluczeDyskusji.dyskusja(id),
    });
  };
}

/**
 * Nowy tag prosto przy sprawie.
 *
 * JEDNYM RUCHEM: nazwa wchodzi do słownika i od razu na sprawę. Rozbicie tego
 * na „dodaj do słownika", a potem „przypnij" kazałoby agentowi zrobić dwie
 * czynności tam, gdzie ma jeden zamiar — Dekalog p. 1.
 */
export function useNowyTag() {
  const odswiez = useOdswiezWszystko();
  return useMutation({
    mutationFn: async (v: { id: number; rodzaj: RodzajSprawy; nazwa: string }) => {
      const { tag } = await api<{ tag: Tag }>("/api/obsluga/tagi",
        { method: "POST", body: JSON.stringify({ nazwa: v.nazwa }) });
      await api(`/api/obsluga/${v.rodzaj}/${v.id}/tagi/${tag.id}`, { method: "POST" });
      return tag;
    },
    onSettled: (_d, _e, v) => odswiez(v.id, v.rodzaj),
  });
}

export function usePrzypnijTag() {
  const odswiez = useOdswiezWszystko();
  return useMutation({
    mutationFn: (v: { id: number; rodzaj: RodzajSprawy; tagId: number }) =>
      /* BEZ CIAŁA i bez nagłówka typu treści — numery stoją w adresie.
         Komunikat bez treści nie ma prawa deklarować typu treści; pilnuje
         tego `api/klient.test.ts`. */
      api(`/api/obsluga/${v.rodzaj}/${v.id}/tagi/${v.tagId}`, { method: "POST" }),
    onSettled: (_d, _e, v) => odswiez(v.id, v.rodzaj),
  });
}

export function useOdepnijTag() {
  const odswiez = useOdswiezWszystko();
  return useMutation({
    mutationFn: (v: { id: number; rodzaj: RodzajSprawy; tagId: number }) =>
      api(`/api/obsluga/${v.rodzaj}/${v.id}/tagi/${v.tagId}`, { method: "DELETE" }),
    onSettled: (_d, _e, v) => odswiez(v.id, v.rodzaj),
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
      void qc.invalidateQueries({ queryKey: kluczeDyskusji.kolejka });
    },
  });
}
