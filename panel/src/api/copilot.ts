import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./klient";
import { klucze } from "./rozmowy";
import type {
  Kategoria, OcenaDanych, OcenaPasowania, OcenaSzkicu, PomiarCopilota, StanCopilota, SzkicCopilota,
  WymianaCopilota, WynikPartii,
} from "./typy";

/* ── Copilot: rozpoznanie, o co pyta klient (§14, etap F) ────────────────────
   Osobny plik, nie dopisek do `rozmowy.ts`: tamten ma już ponad dwadzieścia
   haków, a Copilot będzie rósł o kolejne zadania etapu F. Klucze cache
   dokładamy do JEDNEJ mapy w `rozmowy.ts` — druga mapa rozjechałaby się
   z pierwszą przy pierwszym unieważnieniu.                                   */

export const kluczeCopilota = {
  stan: ["copilot"] as const,
  pomiar: ["copilot-pomiar"] as const,
  pytania: (rozmowaId: number) => ["copilot-pytania", rozmowaId] as const,
};

/**
 * Czy da się kliknąć i ile bierze jedno kliknięcie.
 *
 * `staleTime: Infinity`, bo to jest odczyt KONFIGURACJI — zmienia się przy
 * restarcie usługi, nie w trakcie zmiany agenta. Odpytywanie tego zegarem
 * byłoby ruchem po nic.
 */
export function useCopilot() {
  return useQuery({
    queryKey: kluczeCopilota.stan,
    queryFn: () => api<StanCopilota>("/api/obsluga/copilot"),
    staleTime: Infinity,
  });
}

/** Pomiar zza zębatki. Odpytywany dopiero, gdy ktoś otworzy ustawienia. */
export function usePomiarCopilota(wlaczone = true) {
  return useQuery({
    queryKey: kluczeCopilota.pomiar,
    queryFn: () => api<PomiarCopilota>("/api/obsluga/copilot/pomiar"),
    enabled: wlaczone,
  });
}

/**
 * Partia rozpoznania.
 *
 * Unieważnia LISTĘ, nie pojedyncze rozmowy: partia dotyka kilkunastu wierszy
 * naraz, a plakietki siedzą właśnie na liście. Unieważnienie leci także po
 * przerwaniu limitem — wcześniejsze wyniki zostały zapisane i zapłacone,
 * więc ekran ma je pokazać, a nie wyrzucić.
 */
export function useKlasyfikuj() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { rozmowyId: number[] }) =>
      api<WynikPartii>("/api/obsluga/copilot/klasyfikacja",
        { method: "POST", body: JSON.stringify(v) }),
    onSettled: (_d, _e, v) => {
      qc.invalidateQueries({ queryKey: klucze.rozmowy });
      qc.invalidateQueries({ queryKey: kluczeCopilota.pomiar });
      /* Otwarta rozmowa ma własny klucz i własną plakietkę w nagłówku. Bez
         tego agent widziałby świeżą etykietę na liście i pustkę obok tekstu,
         który właśnie czyta. */
      for (const id of v.rozmowyId) qc.invalidateQueries({ queryKey: klucze.rozmowa(id) });
    },
  });
}

/**
 * Etykieta człowieka: potwierdzenie albo poprawka kategorii. Unieważnia
 * rozmowę, listę I pomiar — etykieta jest pomiarem, a plakietka stoi w obu
 * miejscach ekranu.
 */
export function usePoprawKlasyfikacje() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { rozmowaId: number; kategoria: Kategoria }) =>
      api<{ kategoria: Kategoria; decyzjaId: number }>(
        `/api/obsluga/copilot/klasyfikacja/${v.rozmowaId}/korekta`,
        { method: "POST", body: JSON.stringify({ kategoria: v.kategoria }) }),
    onSettled: (_d, _e, v) => {
      qc.invalidateQueries({ queryKey: klucze.rozmowy });
      qc.invalidateQueries({ queryKey: klucze.rozmowa(v.rozmowaId) });
      qc.invalidateQueries({ queryKey: kluczeCopilota.pomiar });
    },
  });
}

/* ── Szkic odpowiedzi z faktów (§14.6, 0.231.0) ──────────────────────────────
   Jedna rozmowa na kliknięcie. Unieważnia ROZMOWĘ, bo propozycja jedzie
   w `osRozmowy` obok szkicu agenta — i pomiar, bo każde wywołanie kosztuje. */

export function useUlozSzkic() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { rozmowaId: number }) =>
      api<{ szkic: SzkicCopilota }>("/api/obsluga/copilot/szkic",
        { method: "POST", body: JSON.stringify(v) }),
    onSettled: (_d, _e, v) => {
      qc.invalidateQueries({ queryKey: klucze.rozmowa(v.rozmowaId) });
      qc.invalidateQueries({ queryKey: kluczeCopilota.pomiar });
    },
  });
}

/** Werdykt agenta o szkicu: wstawił, zastąpił, odrzucił. To jest miernik. */
export function useOcenSzkic() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { rozmowaId: number; ocena: OcenaSzkicu }) =>
      api<{ ocena: OcenaSzkicu }>(`/api/obsluga/copilot/szkic/${v.rozmowaId}/ocena`,
        { method: "POST", body: JSON.stringify({ ocena: v.ocena }) }),
    onSettled: (_d, _e, v) => {
      qc.invalidateQueries({ queryKey: klucze.rozmowa(v.rozmowaId) });
      qc.invalidateQueries({ queryKey: kluczeCopilota.pomiar });
    },
  });
}

/**
 * Los danych doboru rozpoznanych w rozmowie (przyrost trzeci): „wpisane"
 * idzie z WERSJĄ doboru, bo serwer zapisuje je drogą ręcznego zapisu i 409
 * przy wyścigu jest tym samym 409, co przy formularzu. Konflikt NIE jest tu
 * łapany — zakładka Dobór mówi „ktoś zmienił dane — odśwież".
 *
 * Unieważnia rozmowę (propozycja i dobór jadą w `osRozmowy`), kolejkę
 * (pastylka statusu doboru) i kandydatów (nowe dane = nowe szczeble).
 */
export function useOcenDaneDoboru() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { rozmowaId: number; ocena: OcenaDanych; expectedVersion?: number }) =>
      api<{ szkic: SzkicCopilota }>(`/api/obsluga/copilot/szkic/${v.rozmowaId}/dane`,
        { method: "POST", body: JSON.stringify({ ocena: v.ocena, expectedVersion: v.expectedVersion }) }),
    onSettled: (_d, _e, v) => {
      qc.invalidateQueries({ queryKey: klucze.rozmowa(v.rozmowaId) });
      qc.invalidateQueries({ queryKey: klucze.rozmowy });
      qc.invalidateQueries({ queryKey: klucze.kandydaci(v.rozmowaId) });
      qc.invalidateQueries({ queryKey: kluczeCopilota.pomiar });
    },
  });
}

/**
 * Los pasowania rozpoznanego w rozmowie (przyrost czwarty): `zaproponowane`
 * kładzie parę w kolejce wiedzy jako propozycję ze źródłem `copilot`,
 * `odrzucone` odsyła. Unieważnia rozmowę (propozycja jedzie w `osRozmowy`),
 * pomiar i KOLEJKĘ WIEDZY — para właśnie tam wylądowała — oraz kartoteki,
 * bo blok towaru w rozmowie pokazuje, co czeka.
 */
export function useOcenPasowanie() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { rozmowaId: number; ocena: OcenaPasowania }) =>
      api<{ szkic: SzkicCopilota }>(`/api/obsluga/copilot/szkic/${v.rozmowaId}/pasowanie`,
        { method: "POST", body: JSON.stringify({ ocena: v.ocena }) }),
    onSettled: (_d, _e, v) => {
      qc.invalidateQueries({ queryKey: klucze.rozmowa(v.rozmowaId) });
      qc.invalidateQueries({ queryKey: kluczeCopilota.pomiar });
      qc.invalidateQueries({ queryKey: ["wiedza", "kolejka"] });
      qc.invalidateQueries({ queryKey: ["wiedza", "towar"] });
    },
  });
}

/* ── Dopytanie Copilota (0.332.0) ────────────────────────────────────────────
   Agent pyta o szkic, model odpowiada JEMU. Nie ma stąd drogi do klienta:
   żeby coś z wymiany trafiło do wiadomości, agent układa szkic od nowa.

   Wymiany trzymamy pod WŁASNYM kluczem, nie w `rozmowa(id)`. Powód jest
   praktyczny: dopytanie nie zmienia osi rozmowy ani szkicu, więc doklejenie
   go do tamtego klucza kazałoby przy każdym pytaniu odświeżać całą oś —
   z migotaniem listy wiadomości pod ręką agenta. */

/**
 * Ile znaków może mieć pytanie.
 *
 * DRUGA KOPIA `LIMIT_PYTANIA` z serwera i to jest świadome, nie przeoczenie.
 * Ta gasi przycisk, zanim żądanie poleci; tamta odrzuca żądanie, zanim
 * poleci do dostawcy. Panel bez własnej liczby musiałby pytać serwer o to,
 * czy wolno zapytać.
 */
export const LIMIT_PYTANIA = 600;

export function useWymianyCopilota(rozmowaId: number) {
  return useQuery({
    queryKey: kluczeCopilota.pytania(rozmowaId),
    queryFn: () => api<WymianaCopilota[]>(`/api/obsluga/copilot/pytania/${rozmowaId}`),
    staleTime: 30_000,
    /* Bez rozmowy nie ma czego pobierać — inaczej ekran bez wybranej rozmowy
       strzelałby po `/pytania/0` przy każdym wejściu. */
    enabled: rozmowaId > 0,
  });
}

/** „Zapisz jako propozycję” przy pasowaniu z sieci (0.528.0). Parę bierze serwer z wiersza wymiany. */
export function useZapiszPasowanieZDopytania() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { rozmowaId: number; wymianaId: number; nr: number }) =>
      api<{ wymiana: WymianaCopilota }>(`/api/obsluga/copilot/pytania/${v.wymianaId}/pasowania/${v.nr}`,
        { method: "POST" }),
    onSettled: (_d, _e, v) => {
      qc.invalidateQueries({ queryKey: kluczeCopilota.pytania(v.rozmowaId) });
      /* Propozycja stanęła w Kolejce Wiedzy — jej licznik ma to widzieć. */
      qc.invalidateQueries({ queryKey: ["wiedza"] });
    },
  });
}

export function useZadajPytanie() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { rozmowaId: number; pytanie: string }) =>
      api<{ wymiana: WymianaCopilota }>("/api/obsluga/copilot/pytanie",
        { method: "POST", body: JSON.stringify(v) }),
    onSettled: (_d, _e, v) => {
      qc.invalidateQueries({ queryKey: kluczeCopilota.pytania(v.rozmowaId) });
      /* Pomiar TAK, oś rozmowy NIE: każde pytanie kosztuje i ma stanąć
         w rachunku, ale szkicu ani wiadomości nie rusza ani o znak. */
      qc.invalidateQueries({ queryKey: kluczeCopilota.pomiar });
    },
  });
}
