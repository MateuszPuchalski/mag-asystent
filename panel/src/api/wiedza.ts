import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./klient";
import { klucze } from "./rozmowy";
import type {
  AliasSilnika, Identyfikator, LukaSilnika, ModelUrzadzenia, ModelZOpisu, NowaPropozycja, NowePasowanie,
  NowaZabudowa, Pasowanie, PasowaniaTowaru, PowodNegatywny, RodzajDowodu, RodzajIdentyfikatora, Zabudowa,
  Zastosowanie,
} from "./typy";

/* ── Baza wiedzy (§12, etap E2) ──────────────────────────────────────────────
   Hooki w OSOBNYM pliku od `rozmowy.ts`, bo strażnik adresów w testach tras
   czyta pliki z nazwy: `routes/skrzynka.test.ts` czyta `rozmowy.ts`,
   `routes/wiedza.test.ts` czyta ten. Hook w trzecim pliku ominąłby oba
   i kupiłby bliznę 0.181.1 po raz trzeci. */

export const kluczeWiedzy = {
  kolejka: ["wiedza", "kolejka"] as const,
  modele: (q: string) => ["wiedza", "modele", q] as const,
  towar: (twId: number) => ["wiedza", "towar", twId] as const,
  zOpisow: ["wiedza", "z-opisow"] as const,
  identyfikatory: (twId: number) => ["wiedza", "identyfikatory", twId] as const,
  silniki: ["wiedza", "silniki"] as const,
};

/**
 * Kolejka propozycji. Zegarem, bo propozycja przychodzi z CUDZEJ rozmowy
 * i cudzego pomiaru — ten ekran nie ma po czym poznać, że coś doszło.
 * Trzydzieści sekund to rytm wzmianek.
 */
export function useKolejkaWiedzy() {
  return useQuery({
    queryKey: kluczeWiedzy.kolejka,
    /* Dwa rodzaje propozycji w jednej kolejce; liczniki OSOBNO (lekcja 0.229.0). */
    queryFn: () => api<{ propozycje: Zastosowanie[]; liczba: number; pasowania: Pasowanie[]; pasowanDoRozstrzygniecia: number }>(
      `/api/obsluga/wiedza/kolejka`),
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
    queryFn: () => api<{
      potwierdzone: Zastosowanie[]; negatywne: Zastosowanie[]; propozycje: Zastosowanie[];
      /** Pasowania część↔część — ta sama trasa, drugi strzał po to samo byłby zbędny. */
      pasowania: PasowaniaTowaru;
    }>(`/api/obsluga/wiedza/towar/${twId}`),
    enabled: twId !== null,
  });
}

/* Każda mutacja unieważnia kolejkę, wiedzę o kartotece i KANDYDATÓW każdej
   otwartej rozmowy: zatwierdzone zastosowanie jest od razu szczeblem doboru. */
function poWiedzy(qc: ReturnType<typeof useQueryClient>, twId?: number) {
  qc.invalidateQueries({ queryKey: kluczeWiedzy.kolejka });
  qc.invalidateQueries({ queryKey: kluczeWiedzy.zOpisow });
  qc.invalidateQueries({ queryKey: ["wiedza", "identyfikatory"] });
  qc.invalidateQueries({ queryKey: ["wiedza", "towar"] });
  qc.invalidateQueries({ queryKey: kluczeWiedzy.silniki });
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

/* ── E3: sekcje „Modele:" z opisów i identyfikatory ─────────────────────────
   Lista z opisów zmienia się tylko po imporcie i po decyzji człowieka, więc
   minuta świeżości wystarczy; licznik na zakładce bierze się z tej samej
   odpowiedzi. */
export function useModeleZOpisow() {
  return useQuery({
    queryKey: kluczeWiedzy.zOpisow,
    queryFn: () => api<{ wiersze: ModelZOpisu[]; liczba: number }>(`/api/obsluga/wiedza/z-opisow`),
    staleTime: 60_000,
  });
}

export function usePrzerobModelZOpisu() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: number; model: NowaPropozycja["model"] }) =>
      api<Zastosowanie>(`/api/obsluga/wiedza/z-opisow/${v.id}/przerob`, {
        method: "POST", body: JSON.stringify({ model: v.model }),
      }),
    onSettled: () => poWiedzy(qc),
  });
}

export function useOdrzucModelZOpisu() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: number }) =>
      api<ModelZOpisu>(`/api/obsluga/wiedza/z-opisow/${v.id}/odrzuc`, { method: "POST", body: "{}" }),
    onSettled: () => poWiedzy(qc),
  });
}

export function useIdentyfikatory(twId: number | null) {
  return useQuery({
    queryKey: kluczeWiedzy.identyfikatory(twId ?? 0),
    queryFn: () => api<Identyfikator[]>(`/api/obsluga/wiedza/identyfikatory/${twId}`),
    enabled: twId !== null,
  });
}

export function useDodajIdentyfikator() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { twId: number; rodzaj: RodzajIdentyfikatora; wartosc: string }) =>
      api<Identyfikator>(`/api/obsluga/wiedza/identyfikatory`, { method: "POST", body: JSON.stringify(v) }),
    onSettled: (_d, _e, v) => poWiedzy(qc, v.twId),
  });
}

export type { PowodNegatywny };

/* ── Zabudowa silnika (§11.2) ────────────────────────────────────────────────
   Jeden odczyt oddaje trzy rzeczy: kolejkę par do rozstrzygnięcia, listę luk
   i pary zatwierdzone. Trzy zapytania po to samo byłyby trzema strzałami przy
   jednym otwarciu zakładki.

   Zegar jak przy kolejce propozycji: para przychodzi z cudzej rozmowy, więc
   ten ekran nie ma po czym poznać, że coś doszło. */
export function useSilniki() {
  return useQuery({
    queryKey: kluczeWiedzy.silniki,
    queryFn: () => api<{
      propozycje: Zabudowa[]; doRozstrzygniecia: number;
      luki: LukaSilnika[]; lukiRazem: number; zatwierdzone: Zabudowa[];
      /** Słownik silników (0.238.0) — ten sam odczyt, bo ekran pokazuje go obok luk. */
      aliasy: AliasSilnika[];
    }>(`/api/obsluga/wiedza/silniki`),
    refetchInterval: 30_000,
  });
}

/* ── Słownik silników (0.238.0) ──────────────────────────────────────────────
   Alias to zapis ręki biura: dodanie i usunięcie, bez rozstrzygania. Każda
   zmiana unieważnia też dobór (podpowiedź pod polem „Silnik") i kandydatów
   (powód pominięcia szczebla nazywa słownik) — robi to wspólne `poWiedzy`. */
export function useDodajAliasSilnika() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { tekst: string; silnik: NowaZabudowa["silnik"] }) =>
      api<AliasSilnika>(`/api/obsluga/wiedza/silniki/aliasy`, { method: "POST", body: JSON.stringify(v) }),
    onSettled: () => poWiedzy(qc),
  });
}

export function useUsunAliasSilnika() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: number }) =>
      api<{ ok: true }>(`/api/obsluga/wiedza/silniki/aliasy/${v.id}/usun`, { method: "POST" }),
    onSettled: () => poWiedzy(qc),
  });
}

export function useZaproponujZabudowe() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: NowaZabudowa) =>
      api<Zabudowa>(`/api/obsluga/wiedza/silniki`, { method: "POST", body: JSON.stringify(v) }),
    onSettled: () => poWiedzy(qc),
  });
}

export function useRozstrzygnijZabudowe() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: number; decyzja: "zatwierdz" | "odrzuc"; powod?: string | null }) =>
      api<Zabudowa>(`/api/obsluga/wiedza/silniki/${v.id}/rozstrzygnij`, {
        method: "POST", body: JSON.stringify({ decyzja: v.decyzja, powod: v.powod ?? null }),
      }),
    onSettled: () => poWiedzy(qc),
  });
}

export function useWycofajZabudowe() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: number; powod: string }) =>
      api<Zabudowa>(`/api/obsluga/wiedza/silniki/${v.id}/wycofaj`, {
        method: "POST", body: JSON.stringify({ powod: v.powod }),
      }),
    onSettled: () => poWiedzy(qc),
  });
}

/* ── Pasowanie części (§11.2) ────────────────────────────────────────────────
   Adresy WYŁĄCZNIE tutaj — strażnik w `routes/wiedza.test.ts` czyta ten plik. */
export function useZaproponujPasowanie() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: NowePasowanie) =>
      api<Pasowanie>(`/api/obsluga/wiedza/pasowania`, { method: "POST", body: JSON.stringify(v) }),
    onSettled: (_d, _e, v) => { poWiedzy(qc, v.twId); qc.invalidateQueries({ queryKey: klucze.towar(v.doTwId) }); },
  });
}

export function useRozstrzygnijPasowanie() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: number; decyzja: "zatwierdz" | "odrzuc"; powod?: string | null }) =>
      api<Pasowanie>(`/api/obsluga/wiedza/pasowania/${v.id}/rozstrzygnij`, {
        method: "POST", body: JSON.stringify({ decyzja: v.decyzja, powod: v.powod ?? null }),
      }),
    onSettled: () => poWiedzy(qc),
  });
}

export function useWycofajPasowanie() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: number; powod?: string | null }) =>
      api<Pasowanie>(`/api/obsluga/wiedza/pasowania/${v.id}/wycofaj`, {
        method: "POST", body: JSON.stringify({ powod: v.powod ?? null }),
      }),
    onSettled: () => poWiedzy(qc),
  });
}
