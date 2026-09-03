import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./klient";
import { klucze } from "./rozmowy";
import type { ModelUrzadzenia, NowaPropozycja, PowodNegatywny, RodzajDowodu, Zastosowanie } from "./typy";

/* ── Baza wiedzy (§12, etap E2) ──────────────────────────────────────────────
   Hooki w OSOBNYM pliku od `rozmowy.ts`, bo strażnik adresów w testach tras
   czyta pliki z nazwy: `routes/skrzynka.test.ts` czyta `rozmowy.ts`,
   `routes/wiedza.test.ts` czyta ten. Hook w trzecim pliku ominąłby oba
   i kupiłby bliznę 0.181.1 po raz trzeci. */

export const kluczeWiedzy = {
  kolejka: ["wiedza", "kolejka"] as const,
  modele: (q: string) => ["wiedza", "modele", q] as const,
  towar: (twId: number) => ["wiedza", "towar", twId] as const,
};

/**
 * Kolejka propozycji. Zegarem, bo propozycja przychodzi z CUDZEJ rozmowy
 * i cudzego pomiaru — ten ekran nie ma po czym poznać, że coś doszło.
 * Trzydzieści sekund to rytm wzmianek.
 */
export function useKolejkaWiedzy() {
  return useQuery({
    queryKey: kluczeWiedzy.kolejka,
    queryFn: () => api<{ propozycje: Zastosowanie[]; liczba: number }>(`/api/obsluga/wiedza/kolejka`),
    refetchInterval: 30_000,
  });
}

export function useModele(q: string) {
  return useQuery({
    queryKey: kluczeWiedzy.modele(q),
    queryFn: () => api<{ modele: ModelUrzadzenia[] }>(`/api/obsluga/wiedza/modele?q=${encodeURIComponent(q)}`),
    enabled: q.trim().length >= 2,
  });
}

export function useWiedzaTowaru(twId: number | null) {
  return useQuery({
    queryKey: kluczeWiedzy.towar(twId ?? 0),
    queryFn: () => api<{ potwierdzone: Zastosowanie[]; negatywne: Zastosowanie[]; propozycje: Zastosowanie[] }>(
      `/api/obsluga/wiedza/towar/${twId}`),
    enabled: twId !== null,
  });
}

/* Każda mutacja unieważnia kolejkę, wiedzę o kartotece i KANDYDATÓW każdej
   otwartej rozmowy: zatwierdzone zastosowanie jest od razu szczeblem doboru. */
function poWiedzy(qc: ReturnType<typeof useQueryClient>, twId?: number) {
  qc.invalidateQueries({ queryKey: kluczeWiedzy.kolejka });
  qc.invalidateQueries({ queryKey: ["wiedza", "towar"] });
  qc.invalidateQueries({ queryKey: ["kandydaci"] });
  qc.invalidateQueries({ queryKey: ["wiedzaDoboru"] });
  if (twId !== undefined) qc.invalidateQueries({ queryKey: klucze.towar(twId) });
}

export function useZaproponujZastosowanie() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: NowaPropozycja) =>
      api<Zastosowanie>(`/api/obsluga/wiedza/propozycje`, { method: "POST", body: JSON.stringify(v) }),
    onSettled: (_d, _e, v) => poWiedzy(qc, v.twId),
  });
}

export function useRozstrzygnijZastosowanie() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: number; decyzja: "zatwierdz" | "odrzuc"; powod?: string | null }) =>
      api<Zastosowanie>(`/api/obsluga/wiedza/${v.id}/rozstrzygnij`, {
        method: "POST", body: JSON.stringify({ decyzja: v.decyzja, powod: v.powod ?? null }),
      }),
    onSettled: () => poWiedzy(qc),
  });
}

export function useWycofajZastosowanie() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: number; powod?: string | null }) =>
      api<Zastosowanie>(`/api/obsluga/wiedza/${v.id}/wycofaj`, {
        method: "POST", body: JSON.stringify({ powod: v.powod ?? null }),
      }),
    onSettled: () => poWiedzy(qc),
  });
}

export function useDodajDowod() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: number; rodzaj: RodzajDowodu; tresc: string; link?: string | null }) =>
      api<Zastosowanie>(`/api/obsluga/wiedza/${v.id}/dowody`, {
        method: "POST", body: JSON.stringify({ rodzaj: v.rodzaj, tresc: v.tresc, link: v.link ?? null }),
      }),
    onSettled: () => poWiedzy(qc),
  });
}

export type { PowodNegatywny };
