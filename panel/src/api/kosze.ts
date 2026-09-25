import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./klient";

/* ── Kosze w zakładce Zwroty (0.438.0) ─────────────────────────────────────
   Przeniesione z MAGAZYNU ZWROTÓW w `biuro.html`. Decyzja właściciela: kosze
   mieszkają w Zwrotach, bo tam powstają — ocena „na stan" dokłada towar do
   koszyka, a zamknięcie wysyła go na halę. Osobny ekran w drugim rzędzie
   kazałby szukać dalszego ciągu zwrotu gdzie indziej niż jego początku.

   Trasy są TE SAME, którymi jeździło biuro — przeprowadzka zmienia front,
   nie umowę z serwerem. Typy stoją tutaj z tego samego powodu co w
   `api/dostawy.ts`: to kształty tylko dla biura, nie kontrakt z kolektorem. */

/** Na czym stoi dokument MM kosza — liczy serwer (`WierszListyKoszy.mmStan`). */
export type StanMm = "gotowa" | "zamowiona" | "blad" | "czeka_na_korekte" | "brak";

export interface WierszKosza {
  id: number;
  kod: string;
  /** `otwarty` → `zamkniety` (na hali) → `rozlozony`; `anulowany` to wyjście z cyklu. */
  status: string;
  pozycji: number;
  odlozonych: number;
  pominietych: number;
  mmNumer: string | null;
  utworzonoAt: string;
  zamknietoAt: string | null;
  zamknietoPrzez: string | null;
  rozlozonoAt: string | null;
  rozlozonoPrzez: string | null;
  /** `zwroty` albo `karton` — karton zbiera hala, biuro go tylko ogląda. */
  rodzaj: string;
  anulowanoAt: string | null;
  anulowanoPrzez: string | null;
  zwrotow: number;
  brakujeKorekt: number;
  mmStan: StanMm;
  wirtualny: boolean;
  /**
   * Kłopot z MM tego kosza (@wydanie): odmowa Sfery, nawet przepuszczona potem
   * PONÓW-em. `null` = każda MM weszła za pierwszym razem. Opcjonalne, bo
   * starszy serwer pola nie przysyła.
   */
  problemMm?: { prob: number; ostatniBlad: string | null; ostatnioAt: string;
    nierozwiazany: boolean } | null;
}

export interface PozycjaWKoszu {
  id: number;
  twId: number;
  symbol: string;
  nazwa: string;
  ilosc: number;
  status: string;
  unit: string;
  lokOczekiwana: string | null;
  lokFaktyczna: string | null;
  odlozonoPrzez: string | null;
  odlozonoAt: string | null;
  zalatwioneAt: string | null;
  zalatwionePrzez: string | null;
  zalatwioneNotatka: string | null;
  powod: string | null;
  mmStatus: string | null;
  mmNumer: string | null;
}

export interface SzczegolKosza {
  id: number;
  kod: string;
  status: string;
  utworzonoAt: string;
  zamknietoAt: string | null;
  zamknietoPrzez: string | null;
  rozlozonoAt: string | null;
  rozlozonoPrzez: string | null;
  pozycje: PozycjaWKoszu[];
  odlozonych: number;
  mmNumer: string | null;
  powrot: { status: string; numer: string | null } | null;
  rodzaj: string;
  anulowanoAt: string | null;
  anulowanoPrzez: string | null;
  /** Dokumentu jeszcze nie ma — zawartość da się przeliczyć ze zwrotów. */
  doEdycji: boolean;
  /** Zwroty, z których przyszedł towar — połowa wiązania kosz ↔ zwrot. */
  zwroty: Array<{ id: number; numer: string; korektaNumer: string | null }>;
}

export interface Pominieta {
  pozycjaId: number;
  koszId: number;
  kod: string;
  mmNumer: string | null;
  twId: number;
  symbol: string;
  nazwa: string;
  ilosc: number;
  powod: string;
  at: string | null;
  dni: number;
}

export interface ZnalezionaWKoszu {
  koszId: number;
  kod: string;
  mmNumer: string | null;
  koszStatus: string;
  symbol: string;
  nazwa: string;
  ilosc: number;
  status: string;
  lokFaktyczna: string | null;
  powod: string | null;
  kiedy: string | null;
}

export const kluczeKoszy = {
  wszystko: ["kosze"] as const,
  lista: ["kosze", "lista"] as const,
  pominiete: ["kosze", "pominiete"] as const,
  kosz: (id: number) => ["kosze", "kosz", id] as const,
  szukaj: (q: string) => ["kosze", "szukaj", q] as const,
};

/* Pół minuty, jak dostawy: hala rozkłada kosz na żywo, a biuro patrzy na
   postęp tego samego pudła. */
const RYTM = 30_000;

export function useKosze() {
  return useQuery({
    queryKey: kluczeKoszy.lista,
    queryFn: () => api<{ kosze: WierszKosza[] }>("/api/biuro/kosze"),
    refetchInterval: RYTM,
  });
}

export function usePominiete() {
  return useQuery({
    queryKey: kluczeKoszy.pominiete,
    queryFn: () => api<{ pominiete: Pominieta[] }>("/api/biuro/kosze/pominiete"),
    refetchInterval: RYTM,
  });
}

export function useSzczegolKosza(id: number | null) {
  return useQuery({
    queryKey: kluczeKoszy.kosz(id ?? 0),
    queryFn: () => api<{ kosz: SzczegolKosza }>(`/api/biuro/kosze/${id}`),
    enabled: id !== null,
    refetchInterval: RYTM,
  });
}

/**
 * „W którym koszu jechał ten towar?" — szuka SERWER, po snapshocie z kosza,
 * więc odpowiada o tym, co w koszu naprawdę leżało, nawet gdy kartoteka się
 * zmieniła. Poniżej dwóch znaków serwer odmawia, więc nie pytamy go wcale.
 */
export function useSzukajWKoszach(q: string) {
  return useQuery({
    queryKey: kluczeKoszy.szukaj(q),
    queryFn: () => api<{ znalezione: ZnalezionaWKoszu[] }>(
      `/api/biuro/kosze/szukaj?q=${encodeURIComponent(q)}`),
    enabled: q.length >= 2,
  });
}

/**
 * Zamknięcie sprawy pominięcia. Pozycja ZOSTAJE pominięta — to fakt z hali;
 * znika tylko z listy pracy. Notatka dobrowolna: najczęstszym zakończeniem
 * jest „znalazło się", a wymuszanie zdania kosztowałoby więcej niż jest warte.
 */
export function useZalatwPominiecie() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { pozycjaId: number; notatka: string }) =>
      api(`/api/biuro/kosze/pominiete/${v.pozycjaId}/zalatwione`, {
        method: "POST", body: JSON.stringify({ notatka: v.notatka }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: kluczeKoszy.wszystko }),
  });
}

/**
 * PRZELICZ ZE ZWROTÓW — bez pytania o zgodę (§25a.5): niczego nie wysyła
 * i niczego nie traci, układa zawartość od nowa z tych samych ocen.
 * Nieodwracalny jest dopiero dokument, a tego tu jeszcze nie ma.
 */
export function usePrzeliczKosz() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) =>
      api<{ przed: number; po: number }>(`/api/biuro/kosze/${id}/przelicz`, { method: "POST" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: kluczeKoszy.wszystko }),
  });
}
