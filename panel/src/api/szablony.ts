import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./klient";

/* ── Szablony odpowiedzi (0.399.0) ───────────────────────────────────────────
   Zgłoszenie właściciela: „dodaj ten szablon do szablonów odpowiedzi
   w skrzynce". Szablonów nie było wcale — §10.4 wymieniał je wśród rzeczy
   planowanych i sam pisał „Nie ma szablonów".

   Lista jest WSPÓLNA dla całego panelu, nie per rozmowa: te same zdania służą
   w skrzynce, reklamacjach i dyskusjach. Stąd klucz bez identyfikatora sprawy
   — jedno zapytanie na sesję, a nie jedno na otwarty wątek.                  */

export interface Szablon {
  id: number;
  nazwa: string;
  tresc: string;
  utworzono: string;
  utworzyl: string;
  zmieniono: string | null;
  zmienil: string | null;
}

export const kluczeSzablonow = {
  lista: ["szablony"] as const,
  archiwum: ["szablony", "archiwum"] as const,
};

export function useSzablony() {
  return useQuery({
    queryKey: kluczeSzablonow.lista,
    queryFn: () => api<{ szablony: Szablon[] }>("/api/obsluga/szablony"),
  });
}

export function useArchiwumSzablonow(wlaczone: boolean) {
  return useQuery({
    queryKey: kluczeSzablonow.archiwum,
    queryFn: () => api<{ szablony: Szablon[] }>("/api/obsluga/szablony/archiwum"),
    /* Archiwum pyta się dopiero wtedy, gdy ktoś je otworzy: to lista, po którą
       sięga się raz na miesiąc, a nie przy każdej odpowiedzi. */
    enabled: wlaczone,
  });
}

export function useDodajSzablon() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { nazwa: string; tresc: string }) =>
      api<{ szablon: Szablon }>("/api/obsluga/szablony", {
        method: "POST", body: JSON.stringify(v),
      }),
    onSettled: () => qc.invalidateQueries({ queryKey: kluczeSzablonow.lista }),
  });
}

export function useZmienSzablon() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: number; nazwa: string; tresc: string }) =>
      api<{ szablon: Szablon }>(`/api/obsluga/szablony/${v.id}`, {
        method: "POST", body: JSON.stringify({ nazwa: v.nazwa, tresc: v.tresc }),
      }),
    onSettled: () => qc.invalidateQueries({ queryKey: kluczeSzablonow.lista }),
  });
}

/** Zdjęcie z listy i przywrócenie — jedna decyzja w dwie strony (§25a.5). */
export function useArchiwizujSzablon() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: number; archiwalny: boolean }) =>
      api(`/api/obsluga/szablony/${v.id}/archiwum`, {
        method: "POST", body: JSON.stringify({ archiwalny: v.archiwalny }),
      }),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: kluczeSzablonow.lista });
      void qc.invalidateQueries({ queryKey: kluczeSzablonow.archiwum });
    },
  });
}
