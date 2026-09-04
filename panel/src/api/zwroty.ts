import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./klient";
import type { DoDopisania, FakturaZwrotu, KandydatFaktury, KolejkaZwrotow, KoszZwrotow, StanZwrotuPieniedzy, WpisOsiZwrotu, Zwrot } from "./typy";

/* Zwroty jadą JEDNYM zapytaniem razem z licznikami. Zwrotów w pracy są
   dziesiątki, nie tysiące, a dzięki temu przełączenie kubełka nie kosztuje
   ani jednego strzału do serwera — czyli dokładnie ten koszt, który ten
   ekran miał zdjąć. */

export const kluczeZwrotow = {
  kolejka: ["zwroty"] as const,
  zwrot: (id: number) => ["zwrot", id] as const,
  kosz: ["zwroty", "kosz"] as const,
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
    queryFn: () => api<{
      zwrot: Zwrot; os: WpisOsiZwrotu[]; kandydaciFaktury: KandydatFaktury[];
      doDopisania: DoDopisania[]; pieniadze: StanZwrotuPieniedzy;
    }>(
      `/api/obsluga/zwroty/${id}`),
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
    /* `null` COFA ocenę (0.202.0) — serwer i trasa umiały to od 0.192.0, tylko
       panel nie miał klawisza. */
    mutationFn: (v: { pozycjaId: number; ocena: "stan" | "przecena" | "utylizacja" | null;
      wersja: number }) =>
      api<{ wersja: number; koszyk: number | null }>(
        `/api/obsluga/zwroty/pozycje/${v.pozycjaId}/ocena`,
        { method: "POST", body: JSON.stringify({ ocena: v.ocena, wersja: v.wersja }) }),
    /* Ocena „na stan" dokłada pozycję do koszyka zwrotów, więc odświeża też
       jego pasek — inaczej licznik na ekranie stałby w miejscu, a operator
       nie wiedziałby, ile już zebrał (0.192.0). */
    onSettled: () => {
      qc.invalidateQueries({ queryKey: kluczeZwrotow.kolejka });
      qc.invalidateQueries({ queryKey: kluczeZwrotow.kosz });
    },
  });
}

/** Koszyk zamknięty, który CZEKA na korekty (0.200.0). */
export interface KoszykCzekajacy {
  id: number;
  kod: string;
  zamknietoAt: string;
  brakuje: Array<{ zwrotId: number; numer: string }>;
}

/** Co leży w otwartym koszyku zwrotów tego operatora (0.192.0). */
export function useKosz() {
  return useQuery({
    queryKey: kluczeZwrotow.kosz,
    queryFn: () => api<{ kosz: KoszZwrotow | null; czekajace?: KoszykCzekajacy[] }>(
      "/api/obsluga/zwroty/kosz"),
  });
}

/**
 * Domknięcie koszyka: MM wychodzi PO KOMPLECIE KOREKT (0.200.0).
 *
 * Odświeża TAKŻE kolejkę zwrotów, bo domknięcie zmienia stan pozycji
 * (`wKoszyku`) w każdym zwrocie, z którego coś do kosza wpadło.
 */
export function useZamknijKosz() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (koszId: number) =>
      api<{ koszId: number; kod: string; pozycji: number; queueId: number }>(
        "/api/obsluga/zwroty/kosz/zamknij",
        { method: "POST", body: JSON.stringify({ koszId }) }),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: kluczeZwrotow.kolejka });
      qc.invalidateQueries({ queryKey: kluczeZwrotow.kosz });
    },
  });
}

/**
 * Rejestracja paczki, której klient nie odebrał (0.172.0).
 *
 * Allegro takiego bytu nie zna, więc wiersz zakłada biuro — to jedyne miejsce
 * w panelu, gdzie zwrot powstaje od zera, a nie z synchronizacji.
 */
export function useNieodebrana() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { waybill: string; orderId?: string | null; notatka?: string | null }) =>
      api<{ zwrotId: number; pozycji: number }>("/api/obsluga/zwroty/nieodebrana",
        { method: "POST", body: JSON.stringify(v) }),
    onSettled: () => qc.invalidateQueries({ queryKey: kluczeZwrotow.kolejka }),
  });
}

/**
 * Potrącenie za utratę wartości pojedynczej pozycji (0.170.0).
 *
 * To JEDYNA liczba o pieniądzach, jaką panel wolno mu wysłać — i dlatego
 * serwer trzyma ją w widełkach `0…wartość pozycji` i żąda powodu. Kwotę do
 * oddania dalej składa on sam z zaznaczenia; potrącenie tylko ją obniża.
 */
export function usePotracenie() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { pozycjaId: number; grosze: number | null; powod: string; wersja: number }) =>
      api<{ wersja: number; potracenieGrosze: number | null }>(
        `/api/obsluga/zwroty/pozycje/${v.pozycjaId}/potracenie`,
        { method: "POST", body: JSON.stringify({ grosze: v.grosze, powod: v.powod, wersja: v.wersja }) }),
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

/**
 * Cofnięcie ustalonej kwoty — zwrot wraca do DO ZWROTU (0.202.0).
 *
 * Odświeża kolejkę tak samo jak zapis kwoty: kubełek zwrotu się zmienia, więc
 * licznik przy nagłówku musi ruszyć razem z nim.
 */
export function useCofnijKwote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: number; wersja: number }) =>
      api<{ wersja: number }>(`/api/obsluga/zwroty/${v.id}/kwota/cofnij`,
        { method: "POST", body: JSON.stringify({ wersja: v.wersja }) }),
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

/**
 * Złożenie wniosku o rabat transakcyjny — jedyna mutacja panelu, która
 * WYCHODZI do Allegro.
 *
 * Bez `wersja` i to jest wybór: wniosek nie zmienia stanu zwrotu u nas, a przed
 * dubletem broni strażnik serwera (końcówka Allegro nie ma idempotencji).
 * Blokada optymistyczna na cudzym zasobie dawałaby złudzenie kontroli.
 */
export function useZglosRabat() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { pozycjaId: number }) =>
      api<{ wniosekId: string; lineItemId: string }>(
        `/api/obsluga/zwroty/pozycje/${v.pozycjaId}/rabat`, { method: "POST" }),
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

/**
 * Wskazanie dokumentu sprzedaży z Subiekta (0.174.0).
 *
 * `dokId: null` ZDEJMUJE powiązanie — droga wyjścia z pomyłki, a nie brak
 * funkcji (§25a.5). Panel wysyła sam identyfikator z listy kandydatów: numeru
 * wpisanego z palca serwer i tak nie przyjmie, bo dokument musi stać
 * w read-modelu.
 */
export function useFaktura() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: number; dokId: number | null }) =>
      api<{ faktura: FakturaZwrotu }>(`/api/obsluga/zwroty/${v.id}/faktura`,
        { method: "POST", body: JSON.stringify({ dokId: v.dokId }) }),
    onSettled: (_d, _e, v) => {
      qc.invalidateQueries({ queryKey: kluczeZwrotow.kolejka });
      qc.invalidateQueries({ queryKey: kluczeZwrotow.zwrot(v.id) });
    },
  });
}

/**
 * Dopisanie produktu, którego klient nie zgłosił (0.184.0).
 *
 * Panel wysyła identyfikator POZYCJI ZAMÓWIENIA, nigdy nazwy ani ceny. Klient
 * może odesłać wyłącznie to, co kupił, a kwotę do oddania dalej składa serwer
 * z zaznaczenia (§25a.3).
 */
export function useDopiszPozycje() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: number; zamPozycjaId: number; wersja: number }) =>
      api<{ wersja: number; pozycjaId: number }>(`/api/obsluga/zwroty/${v.id}/pozycje`,
        { method: "POST", body: JSON.stringify({ zamPozycjaId: v.zamPozycjaId, wersja: v.wersja }) }),
    onSettled: (_d, _e, v) => {
      qc.invalidateQueries({ queryKey: kluczeZwrotow.kolejka });
      qc.invalidateQueries({ queryKey: kluczeZwrotow.zwrot(v.id) });
    },
  });
}

/** Zdjęcie pozycji dopisanej przez biuro — §25a.5, cofnięcie zamiast potwierdzenia. */
export function useZdejmijPozycje() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: number; pozycjaId: number; wersja: number }) =>
      api<{ wersja: number }>(`/api/obsluga/zwroty/pozycje/${v.pozycjaId}/zdejmij`,
        { method: "POST", body: JSON.stringify({ wersja: v.wersja }) }),
    onSettled: (_d, _e, v) => {
      qc.invalidateQueries({ queryKey: kluczeZwrotow.kolejka });
      qc.invalidateQueries({ queryKey: kluczeZwrotow.zwrot(v.id) });
    },
  });
}

/* ── Zwrot pieniędzy i odmowa (0.190.0) ──────────────────────────────────────
   Pierwsze wyjście tego panelu po CUDZE PIENIĄDZE. Stąd trzy różnice
   względem sąsiednich mutacji.

   KWOTY NIE MA W CIELE. Serwer bierze tę, którą sam policzył z zaznaczenia;
   panel podający liczbę pozwoliłby oddać dowolną kwotę żądaniem z pominięciem
   ekranu (ta sama decyzja co przy `useKwota`).

   PONOWIENIE JEST BEZPIECZNE po stronie serwera (`commandId`), ale przycisk
   i tak blokuje się na czas żądania: dwa kliknięcia to dwa żądania, a drugie
   dostałoby 409 i wyglądałoby jak awaria.

   UNIEWAŻNIAMY TEŻ SZCZEGÓŁ, nie samą kolejkę — po oddaniu pieniędzy zmienia
   się dokładnie ten ekran, na który patrzy operator. */

export function useZwrocPieniadze() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: number; wersja: number }) =>
      api<{ refundId: string; status: string | null; wersja: number }>(
        `/api/obsluga/zwroty/${v.id}/pieniadze`,
        { method: "POST", body: JSON.stringify({ wersja: v.wersja }) }),
    onSettled: (_d, _e, v) => {
      qc.invalidateQueries({ queryKey: kluczeZwrotow.kolejka });
      qc.invalidateQueries({ queryKey: kluczeZwrotow.zwrot(v.id) });
    },
  });
}

export function useOdmowPlatnosci() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: number; kod: string; powod: string | null; wersja: number }) =>
      api<{ kod: string; wersja: number }>(`/api/obsluga/zwroty/${v.id}/odmowa-platnosci`,
        { method: "POST", body: JSON.stringify({ kod: v.kod, powod: v.powod, wersja: v.wersja }) }),
    onSettled: (_d, _e, v) => {
      qc.invalidateQueries({ queryKey: kluczeZwrotow.kolejka });
      qc.invalidateQueries({ queryKey: kluczeZwrotow.zwrot(v.id) });
    },
  });
}
