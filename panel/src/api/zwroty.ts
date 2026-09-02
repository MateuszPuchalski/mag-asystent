import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./klient";
import type { KolejkaZwrotow, WpisOsiZwrotu, Zwrot } from "./typy";

/* Zwroty jadą JEDNYM zapytaniem razem z licznikami. Zwrotów w pracy są
   dziesiątki, nie tysiące, a dzięki temu przełączenie kubełka nie kosztuje
   ani jednego strzału do serwera — czyli dokładnie ten koszt, który ten
   ekran miał zdjąć. */

export const kluczeZwrotow = {
  kolejka: ["zwroty"] as const,
  zwrot: (id: number) => ["zwrot", id] as const,
};

export function useZwroty() {
  return useQuery({
    queryKey: kluczeZwrotow.kolejka,
    queryFn: () => api<KolejkaZwrotow>("/api/obsluga/zwroty"),
  });
}

export function useZwrot(id: number | null) {
  return useQuery({
    queryKey: kluczeZwrotow.zwrot(id ?? 0),
    queryFn: () => api<{ zwrot: Zwrot; os: WpisOsiZwrotu[] }>(`/api/obsluga/zwroty/${id}`),
    enabled: id !== null,
  });
}

/** Grosze na tekst, który czyta biuro. Jedna funkcja na cały panel. */
export const zlote = (grosze: number | null | undefined, waluta = "PLN") =>
  grosze == null ? "—" : `${(grosze / 100).toFixed(2).replace(".", ",")} ${waluta}`;

/**
 * Potwierdzenie kartoteki dla pozycji zwrotu.
 *
 * `twId: null` ZDEJMUJE powiązanie — droga wyjścia z błędnego potwierdzenia.
 * `zrodlo` jedzie razem z wyborem, bo bez niego nie da się później odróżnić
 * zatwierdzonej propozycji automatu od wskazania człowieka (§4.3).
 */
export function usePotwierdzKartoteke() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { pozycjaId: number; twId: number | null; zrodlo: "sku" | "reczne" }) =>
      api<{ twId: number | null; twSymbol: string | null; twZrodlo: string | null }>(
        `/api/obsluga/zwroty/pozycje/${v.pozycjaId}/kartoteka`,
        { method: "POST", body: JSON.stringify({ twId: v.twId, zrodlo: v.zrodlo }) },
      ),
    onSettled: () => qc.invalidateQueries({ queryKey: kluczeZwrotow.kolejka }),
  });
}


/**
 * Ręczne dociągnięcie zamówień.
 *
 * Bez niego diagnoza „czemu ta pozycja nie ma kartoteki" wymagała czekania
 * dziesięciu minut na najrzadszy z trzech tickerów — czyli dokładnie wtedy,
 * gdy ktoś patrzy na ekran i chce wiedzieć, czy problem jest w danych, czy
 * w kodzie.
 */
export function useDociagnijZamowienia() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api<{ pobrano: number }>("/api/obsluga/zwroty/zamowienia", { method: "POST" }),
    onSettled: () => qc.invalidateQueries({ queryKey: kluczeZwrotow.kolejka }),
  });
}

/* ── Decyzje biura (0.156.0) ─────────────────────────────────────────────────
   Trzy mutacje domykają trzy pierwsze kubełki. Każda niesie WERSJĘ zwrotu,
   bo dwóch agentów nie ma prawa zamknąć jednego zwrotu dwiema kwotami —
   ten sam wzorzec, co przy przejmowaniu rozmowy. Konflikt wraca kodem 409
   i typem `Konflikt`, więc ekran rysuje „ktoś zdążył pierwszy", a nie błąd. */

export function useWerdykt() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: number; decyzja: "przyjety" | "odrzucony"; powod: string | null; wersja: number }) =>
      api<{ werdykt: string; wersja: number }>(`/api/obsluga/zwroty/${v.id}/werdykt`,
        { method: "POST", body: JSON.stringify({ decyzja: v.decyzja, powod: v.powod, wersja: v.wersja }) }),
    onSettled: () => qc.invalidateQueries({ queryKey: kluczeZwrotow.kolejka }),
  });
}

export function useOcena() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { pozycjaId: number; ocena: "stan" | "przecena" | "utylizacja"; wersja: number }) =>
      api<{ wersja: number }>(`/api/obsluga/zwroty/pozycje/${v.pozycjaId}/ocena`,
        { method: "POST", body: JSON.stringify({ ocena: v.ocena, wersja: v.wersja }) }),
    onSettled: () => qc.invalidateQueries({ queryKey: kluczeZwrotow.kolejka }),
  });
}

/**
 * Zapis kwoty — wysyła ZAZNACZENIE, nigdy liczby.
 *
 * §25a.3: „Liczy ją serwer, panel niczego nie zgaduje". Suma na ekranie jest
 * podglądem; gdyby panel przysyłał gotową kwotę, dałoby się oddać dowolną
 * sumę żądaniem z pominięciem ekranu.
 */
export function useKwota() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: number; pozycjeIds: number[]; dostawa: boolean; wersja: number }) =>
      api<{ kwotaGrosze: number; dostawaGrosze: number; wariant: string; wersja: number }>(
        `/api/obsluga/zwroty/${v.id}/kwota`,
        { method: "POST", body: JSON.stringify({
          pozycjeIds: v.pozycjeIds, dostawa: v.dostawa, wersja: v.wersja }) }),
    onSettled: () => qc.invalidateQueries({ queryKey: kluczeZwrotow.kolejka }),
  });
}

/**
 * Numer korekty wystawionej w Subiekcie — i jego cofnięcie.
 *
 * Panel niczego nie wystawia: `korekta_zwrot` w kolejce Sfery potrzebuje
 * `dok_Id` dokumentu SPRZEDAŻY, a read-model zna wyłącznie zakupy. Zapisujemy
 * FAKT, że korekta powstała, i pozwalamy go cofnąć — numer przepisuje ręką
 * człowiek, więc literówka jest tu zdarzeniem normalnym (§25a.5).
 */
export function useKorekta() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: number; numer: string; wersja: number }) =>
      api<{ korektaNumer: string; zamknietyAt: string; wersja: number }>(
        `/api/obsluga/zwroty/${v.id}/korekta`,
        { method: "POST", body: JSON.stringify({ numer: v.numer, wersja: v.wersja }) }),
    onSettled: () => qc.invalidateQueries({ queryKey: kluczeZwrotow.kolejka }),
  });
}

export function useCofnijKorekte() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: number; wersja: number }) =>
      api<{ wersja: number }>(`/api/obsluga/zwroty/${v.id}/korekta/cofnij`,
        { method: "POST", body: JSON.stringify({ wersja: v.wersja }) }),
    onSettled: () => qc.invalidateQueries({ queryKey: kluczeZwrotow.kolejka }),
  });
}

/* ── Skan etykiety zwrotnej (0.163.0) ────────────────────────────────────────
   Kod jedzie CIAŁEM ŻĄDANIA, nie adresem, i to jest ta sama ostrożność co przy
   szynie zdarzeń: numer listu przewozowego w adresie wylądowałby w logu żądań
   serwera. */

export type TrafienieSkanu = "numer" | "external" | "waybill" | "wiele" | null;

export interface WynikSkanu {
  trafienie: TrafienieSkanu;
  zwrotId: number | null;
  zwroty: Array<{ id: number; numer: string | null; externalId: string }>;
  /** Tylko z dociągnięcia: ile zwrotów przyjechało z Allegro. */
  pobrano?: number;
}

export function useSkanZwrotu() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (kod: string) =>
      api<WynikSkanu>("/api/obsluga/zwroty/skan", {
        method: "POST", body: JSON.stringify({ kod }),
      }),
    /* Trafienie bywa świeże po dociągnięciu, więc kolejka ma się odświeżyć —
       ale samo szukanie niczego nie zapisuje. */
    onSuccess: (w) => { if (w.trafienie) qc.invalidateQueries({ queryKey: kluczeZwrotow.kolejka }); },
  });
}

/** Skan, który nie trafił u nas: pytamy Allegro o ten jeden numer listu. */
export function useDociagnijPoSkanie() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (kod: string) =>
      api<WynikSkanu>("/api/obsluga/zwroty/skan/dociagnij", {
        method: "POST", body: JSON.stringify({ kod }),
      }),
    onSettled: () => qc.invalidateQueries({ queryKey: kluczeZwrotow.kolejka }),
  });
}

